/**
 * Assessment pipeline (DESIGN.md §12, §17):
 *   observation → linked-document excerpts → sanitized request → relay/Jev → code composition.
 */
import type { Assessment, Statuses, TabStatus } from "../shared/assessment";
import { WarningLevel } from "../shared/assessment";
import { ext } from "../shared/browser";
import type { ContentNotice } from "../shared/messages";
import type {
  AssessRequest,
  ComponentObservation,
  DocumentLink,
  LinkedDocumentState,
  PageObservation,
} from "../shared/schema";
import { LIMITS, SCHEMA_VERSION } from "../shared/schema";
import { componentsFromHeaders, dedupeComponents } from "../shared/component-patterns";
import { observationSignature } from "../shared/signature";
import { compose, type RemoteResult } from "../risk/composer";
import { cacheKeyInput, getCached, putCached, sha256Hex } from "./cache";
import { fetchDocument } from "./document-fetcher";
import { OPERATOR_KEYWORDS, PRIVACY_KEYWORDS, extractExcerpts, htmlToBlocks } from "./document-text";
import { relationOf, summarizeThirdParty } from "./network-observer";
import { requestAssessment } from "./relay-client";
import { loadSettings, type Settings } from "./settings";
import { clearTabStatus, getTabStatus, setTabStatus } from "./tab-state";

export interface Deps {
  fetchImpl: typeof fetch;
  now: () => number;
}

const defaultDeps: Deps = { fetchImpl: (...args) => fetch(...args), now: () => Date.now() };

/** Latest assessment run per tab; older runs finishing late are discarded. */
const generations = new Map<number, number>();

const observationKey = (tabId: number) => `obs:${tabId}`;

export async function rememberObservation(tabId: number, observation: PageObservation): Promise<void> {
  await ext.storage.session.set({ [observationKey(tabId)]: observation });
}

export async function recallObservation(tabId: number): Promise<PageObservation | null> {
  const k = observationKey(tabId);
  return ((await ext.storage.session.get(k))[k] as PageObservation | undefined) ?? null;
}

export async function forgetObservation(tabId: number): Promise<void> {
  await ext.storage.session.remove(observationKey(tabId));
}

/**
 * Forgets everything about the tab's current page: invalidates any assessment still
 * running for it (so a late result cannot be written back), then clears the observation,
 * status and badge. Used on navigation, tab close and when the reported form disappears.
 */
export async function resetTab(tabId: number): Promise<void> {
  generations.set(tabId, (generations.get(tabId) ?? 0) + 1);
  await Promise.all([clearTabStatus(tabId), forgetObservation(tabId)]);
}

/** Drops the per-tab counter once the tab is gone. */
export function forgetTab(tabId: number): void {
  generations.delete(tabId);
}

export async function assessTab(
  tabId: number,
  observation: PageObservation,
  options: { force?: boolean } = {},
  deps: Deps = defaultDeps,
): Promise<void> {
  const generation = (generations.get(tabId) ?? 0) + 1;
  generations.set(tabId, generation);
  const isCurrent = () => generations.get(tabId) === generation;

  const settings = await loadSettings();
  const keyHash = await sha256Hex(cacheKeyInput(observation.page.origin, observationSignature(observation)));
  const focused = await wasFocused(tabId);

  if (!options.force) {
    const cached = await getCached(keyHash, deps.now());
    if (cached) {
      await finish(tabId, cached, focused, settings, isCurrent);
      return;
    }
  }

  // Every write is preceded by a currency check: resetTab() may run during any await.
  if (!isCurrent()) return;
  await setTabStatus(tabId, { kind: "assessing", focused });
  const assessment = await evaluate(observation, settings, deps);
  if (!isCurrent()) return;
  await putCached(keyHash, assessment);
  const focusedNow = await wasFocused(tabId);
  await finish(tabId, assessment, focusedNow, settings, isCurrent);
}

export async function evaluate(observation: PageObservation, settings: Settings, deps: Deps): Promise<Assessment> {
  const { request, actionRelation, components } = await buildRequest(observation, settings.remoteEvaluation, deps.fetchImpl);

  let remote: RemoteResult = { kind: "disabled" };
  if (settings.remoteEvaluation) {
    const response = await requestAssessment(settings, request, deps.fetchImpl);
    remote = response ? { kind: "answered", answers: response.answers } : { kind: "unavailable" };
  }

  const kinds = Array.from(new Set(observation.form.fields.map((f) => f.kind))).filter((k) => k !== "unknown");
  return compose({
    request,
    actionRelation,
    actionScheme: observation.form.actionScheme,
    sensitiveKinds: kinds.sort(),
    components,
    remote,
    now: deps.now(),
  });
}

export async function buildRequest(
  o: PageObservation,
  fetchDocuments: boolean,
  fetchImpl: typeof fetch,
): Promise<{ request: AssessRequest; actionRelation: Statuses["formAction"]; components: ComponentObservation[] }> {
  const actionRelation: Statuses["formAction"] = o.form.actionOrigin
    ? relationOf(o.page.origin, o.form.actionOrigin)
    : "none";

  const [policy, operator] = await Promise.all([
    readLinkedDocument(o.page.origin, o.links.privacy, PRIVACY_KEYWORDS, fetchDocuments, fetchImpl),
    readLinkedDocument(o.page.origin, o.links.operator, OPERATOR_KEYWORDS, fetchDocuments, fetchImpl),
  ]);
  const privacyPolicy = policy.state;
  const operatorInfo = operator.state;
  // Components stay in the extension; they are not part of the relay request.
  const components = dedupeComponents([...o.components, ...policy.components, ...operator.components], LIMITS.components);

  const page: AssessRequest["website"]["page"] = {
    origin: o.page.origin,
    scheme: o.page.scheme,
    pathClass: o.page.pathClass,
    headings: o.page.headings,
  };
  if (o.page.title) page.title = o.page.title;
  if (o.page.footer) page.footer = o.page.footer;

  return {
    actionRelation,
    components,
    request: {
      schemaVersion: SCHEMA_VERSION,
      website: {
        page,
        form: {
          method: o.form.method,
          crossOriginAction: o.form.crossOriginAction,
          crossSiteAction: actionRelation === "cross_site",
          fields: o.form.fields,
          context: o.form.context,
        },
        privacyPolicy,
        operatorInfo,
        thirdParty: summarizeThirdParty(o.page.origin, o.resources),
      },
    },
  };
}

async function readLinkedDocument(
  pageOrigin: string,
  links: DocumentLink[],
  keywords: RegExp,
  fetchDocuments: boolean,
  fetchImpl: typeof fetch,
): Promise<{ state: LinkedDocumentState; components: ComponentObservation[] }> {
  const state: LinkedDocumentState = { found: links.length > 0, fetched: false, excerpts: [] };
  const components: ComponentObservation[] = [];
  if (!fetchDocuments) return { state, components };
  for (const link of links.slice(0, 2)) {
    const fetched = await fetchDocument(link.url, fetchImpl);
    if (fetched === null) continue;
    // Server headers describe this site only when the document is served from the same site.
    if (relationOf(pageOrigin, new URL(fetched.url).origin) !== "cross_site") {
      components.push(...componentsFromHeaders(fetched.server, fetched.poweredBy));
    }
    const doc = htmlToBlocks(fetched.html);
    state.fetched = true;
    state.excerpts = extractExcerpts(doc, keywords);
    if (doc.title) state.title = doc.title;
    if (state.excerpts.length > 0) break;
  }
  return { state, components };
}

async function wasFocused(tabId: number): Promise<boolean> {
  const status = await getTabStatus(tabId);
  return status.kind !== "idle" && status.focused;
}

async function finish(
  tabId: number,
  assessment: Assessment,
  focused: boolean,
  settings: Settings,
  isCurrent: () => boolean,
): Promise<void> {
  if (!isCurrent()) return;
  await setTabStatus(tabId, { kind: "done", focused, assessment });
  if (focused) await maybeNotify(tabId, assessment, settings);
}

/** Called when the user starts interacting with a sensitive field. */
export async function markFocused(tabId: number): Promise<void> {
  const status = await getTabStatus(tabId);
  if (status.kind === "idle" || status.focused) return;
  const next: TabStatus = { ...status, focused: true };
  await setTabStatus(tabId, next);
  if (next.kind === "done") await maybeNotify(tabId, next.assessment, await loadSettings());
}

async function maybeNotify(tabId: number, assessment: Assessment, settings: Settings): Promise<void> {
  if (!settings.inPageNotice || assessment.level < WarningLevel.CAUTION) return;
  const message: ContentNotice = { type: "show-notice", assessment };
  await ext.tabs.sendMessage(tabId, message, { frameId: 0 }).catch(() => undefined);
}
