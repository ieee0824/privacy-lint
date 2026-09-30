/**
 * Assessment pipeline (DESIGN.md §12, §17):
 *   observation → linked-document excerpts → sanitized request → relay/Jev → code composition.
 */
import type { Assessment, Statuses } from "../shared/assessment";
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
import { validatePageObservation } from "../shared/validate";
import { compose, type RemoteResult } from "../risk/composer";
import { cacheKeyInput, clearCache, getCached, putCached, sha256Hex } from "./cache";
import { fetchDocument } from "./document-fetcher";
import { OPERATOR_KEYWORDS, PRIVACY_KEYWORDS, extractExcerpts, htmlToBlocks } from "./document-text";
import { relationOf, summarizeThirdParty } from "./network-observer";
import { requestAssessment } from "./relay-client";
import { evaluationFingerprint, loadSettings, type Settings } from "./settings";
import { clearTabStatus, getTabStatus, setTabStatus } from "./tab-state";
import { initialEvaluationState, transitionEvaluation, type EvaluationState, type RunIdentity } from "./assessment-state";

export interface Deps {
  fetchImpl: typeof fetch;
  now: () => number;
}

const defaultDeps: Deps = { fetchImpl: (...args) => fetch(...args), now: () => Date.now() };

interface Execution {
  tabId: number;
  run: RunIdentity;
  controller: AbortController;
  signature: string;
}
const states = new Map<number, EvaluationState>();
const executions = new Map<number, Execution>();
const tabWrites = new Map<number, Promise<unknown>>();
let cacheWrites: Promise<unknown> = Promise.resolve();
let lifecycleEpoch = 0;
const observationKey = (tabId: number) => `obs:${tabId}`;

function stateFor(tabId: number): EvaluationState {
  const stored = states.get(tabId);
  if (stored) return stored;
  const initial = initialEvaluationState();
  states.set(tabId, initial);
  return initial;
}

function begin(tabId: number, observation: PageObservation, focused: boolean): Execution {
  executions.get(tabId)?.controller.abort();
  const next = transitionEvaluation(stateFor(tabId), { type: "start", focused }).state;
  states.set(tabId, next);
  const execution = { tabId, run: next.run, controller: new AbortController(), signature: observationSignature(observation) };
  executions.set(tabId, execution);
  return execution;
}

function isCurrent(execution: Execution): boolean {
  return states.get(execution.tabId)?.run === execution.run && !execution.controller.signal.aborted;
}

/** Serialize short storage/badge operations, never the network evaluation. */
function writeTab<T>(tabId: number, operation: () => Promise<T>): Promise<T> {
  const previous = tabWrites.get(tabId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  tabWrites.set(tabId, next);
  void next.finally(() => { if (tabWrites.get(tabId) === next) tabWrites.delete(tabId); }).catch(() => undefined);
  return next;
}

function writeCache<T>(operation: () => Promise<T>): Promise<T> {
  const next = cacheWrites.catch(() => undefined).then(operation);
  cacheWrites = next;
  return next;
}

export async function rememberObservation(tabId: number, observation: PageObservation): Promise<void> {
  await ext.storage.session.set({ [observationKey(tabId)]: observation });
}

export async function recallObservation(tabId: number): Promise<PageObservation | null> {
  const k = observationKey(tabId);
  return ((await ext.storage.session.get(k))[k] as PageObservation | undefined) ?? null;
}

/** A storage read must not start work for a document invalidated while it was pending. */
export async function recallCurrentObservation(tabId: number): Promise<PageObservation | null> {
  const run = stateFor(tabId).run;
  const observation = await recallObservation(tabId);
  return states.get(tabId)?.run === run ? observation : null;
}

/** Explicit re-evaluation reads the DOM now, even while mutation reports are debounced. */
export async function reassessCurrentTab(tabId: number): Promise<boolean> {
  const run = stateFor(tabId).run;
  const fresh: unknown = await ext.tabs.sendMessage(tabId, { type: "refresh-observation" }, { frameId: 0 })
    .catch(() => undefined);
  if (states.get(tabId)?.run !== run) return false;
  if (fresh === undefined) {
    const observation = await recallCurrentObservation(tabId);
    if (!observation || states.get(tabId)?.run !== run) return false;
    await assessTab(tabId, observation, { force: true });
    return true;
  }
  if (typeof fresh !== "object" || fresh === null || !("observation" in fresh)) return false;
  if (fresh.observation === null) {
    await resetTab(tabId);
    return false;
  }
  const observation = validatePageObservation(fresh.observation);
  const tab = await ext.tabs.get(tabId).catch(() => null);
  if (!tab?.url || new URL(tab.url).origin !== observation.page.origin || states.get(tabId)?.run !== run) return false;
  await acceptObservation(tabId, observation, { focused: "focused" in fresh && fresh.focused === true, force: true });
  return true;
}

export async function forgetObservation(tabId: number): Promise<void> {
  await ext.storage.session.remove(observationKey(tabId));
}

/** Reserve the run before the first await, including observation persistence (#25). */
export async function acceptObservation(tabId: number, observation: PageObservation,
  options: { focused?: boolean; force?: boolean } = {}, deps: Deps = defaultDeps): Promise<void> {
  const execution = begin(tabId, observation, options.focused === true);
  await writeTab(tabId, async () => {
    if (isCurrent(execution)) await rememberObservation(tabId, observation);
  });
  if (isCurrent(execution)) await executeAssessment(execution, observation, options, deps);
}

export async function resetTab(tabId: number): Promise<void> {
  lifecycleEpoch++;
  executions.get(tabId)?.controller.abort();
  executions.delete(tabId);
  states.set(tabId, transitionEvaluation(stateFor(tabId), { type: "reset" }).state);
  await writeTab(tabId, async () => {
    await Promise.all([clearTabStatus(tabId), forgetObservation(tabId)]);
  });
}

export function forgetTab(tabId: number): void {
  executions.delete(tabId);
  states.delete(tabId);
}

/** Invalidate synchronously, then clear queued old cache writes and re-evaluate current pages. */
export async function evaluationSettingsChanged(): Promise<void> {
  const active = [...executions.values()];
  for (const execution of active) {
    execution.controller.abort();
    states.set(execution.tabId, transitionEvaluation(stateFor(execution.tabId), { type: "settings-changed" }).state);
  }
  const snapshot = new Map([...states].map(([tabId, state]) => [tabId, state.run]));
  const snapshotEpoch = lifecycleEpoch;
  const persisted = await ext.storage.session.get(null);
  await writeCache(clearCache);
  const restarts = active.map(restartAfterSettings);
  for (const [key, observation] of Object.entries(persisted)) {
    if (!/^obs:\d+$/.test(key)) continue;
    const tabId = Number(key.slice(4));
    if (active.some((execution) => execution.tabId === tabId) || states.get(tabId)?.run !== snapshot.get(tabId)) continue;
    if (!snapshot.has(tabId) && snapshotEpoch !== lifecycleEpoch) continue;
    restarts.push(assessTab(tabId, observation as PageObservation, { force: true }));
  }
  await Promise.all(restarts);
}

async function restartAfterSettings(previous: Execution): Promise<void> {
  const observation = await recallObservation(previous.tabId);
  if (!observation || executions.get(previous.tabId) !== previous) return;
  await assessTab(previous.tabId, observation, { force: true });
}

export async function assessTab(tabId: number, observation: PageObservation,
  options: { force?: boolean } = {}, deps: Deps = defaultDeps): Promise<void> {
  const execution = begin(tabId, observation, stateFor(tabId).status.kind !== "idle" && wasStateFocused(tabId));
  const stored = await getTabStatus(tabId);
  if (isCurrent(execution) && stored.kind !== "idle" && stored.focused) {
    states.set(tabId, transitionEvaluation(stateFor(tabId), { type: "focus" }).state);
  }
  await executeAssessment(execution, observation, options, deps);
}

function wasStateFocused(tabId: number): boolean {
  const status = stateFor(tabId).status;
  return status.kind !== "idle" && status.focused;
}

async function executeAssessment(execution: Execution, observation: PageObservation,
  options: { force?: boolean }, deps: Deps): Promise<void> {
  const settings = await loadSettings();
  if (!isCurrent(execution)) return;
  const keyHash = await sha256Hex(cacheKeyInput(observation.page.origin, execution.signature, evaluationFingerprint(settings)));
  const cached = options.force ? null : await getCached(keyHash, deps.now());
  if (cached) return publish(execution, cached, settings, "cached");
  await writeTab(execution.tabId, async () => {
    if (isCurrent(execution)) await setTabStatus(execution.tabId, stateFor(execution.tabId).status);
  });
  if (!isCurrent(execution)) return;
  const fetchImpl = guardedFetch(execution, settings, deps.fetchImpl);
  const assessment = await evaluate(observation, settings, { ...deps, fetchImpl });
  if (!await canExecute(execution, settings)) return;
  await writeCache(async () => {
    if (await canExecute(execution, settings)) await putCached(keyHash, assessment);
  });
  await publish(execution, assessment, settings, "result");
}

async function canExecute(execution: Execution, settings: Settings): Promise<boolean> {
  const currentSettings = await loadSettings();
  return isCurrent(execution) && evaluationFingerprint(currentSettings) === evaluationFingerprint(settings);
}

function guardedFetch(execution: Execution, settings: Settings, fetchImpl: typeof fetch): typeof fetch {
  return async (input, init) => {
    if (!await canExecute(execution, settings)) throw new DOMException("Assessment cancelled", "AbortError");
    const signals = [execution.controller.signal];
    if (init?.signal) signals.push(init.signal);
    return fetchImpl(input, { ...init, signal: AbortSignal.any(signals) });
  };
}

async function publish(execution: Execution, assessment: Assessment, settings: Settings,
  type: "cached" | "result"): Promise<void> {
  await writeTab(execution.tabId, async () => {
    if (!await canExecute(execution, settings)) return;
    const transition = transitionEvaluation(stateFor(execution.tabId), { type, run: execution.run, assessment });
    states.set(execution.tabId, transition.state);
    if (!transition.operations.includes("publish")) return;
    await setTabStatus(execution.tabId, transition.state.status);
    if (isCurrent(execution) && transition.operations.includes("notify")) {
      await notifyCurrent(execution, assessment);
    }
  });
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

export interface LinkedDocumentResult {
  state: LinkedDocumentState;
  components: ComponentObservation[];
}
export interface PreparedRequest {
  request: AssessRequest;
  actionRelation: Statuses["formAction"];
  components: ComponentObservation[];
}

export async function buildRequest(o: PageObservation, fetchDocuments: boolean, fetchImpl: typeof fetch): Promise<PreparedRequest> {
  const [policy, operator] = await Promise.all([
    readLinkedDocument(o.page.origin, o.links.privacy, PRIVACY_KEYWORDS, fetchDocuments, fetchImpl),
    readLinkedDocument(o.page.origin, o.links.operator, OPERATOR_KEYWORDS, fetchDocuments, fetchImpl),
  ]);
  return assembleRequest(o, policy, operator);
}

/** Only already-sanitized observations and fetched document data enter this pure builder. */
export function assembleRequest(o: PageObservation, policy: LinkedDocumentResult, operator: LinkedDocumentResult): PreparedRequest {
  const actionRelation = o.form.actionOrigin ? relationOf(o.page.origin, o.form.actionOrigin) : "none";
  const page: AssessRequest["website"]["page"] = {
    origin: o.page.origin, scheme: o.page.scheme, pathClass: o.page.pathClass, headings: [...o.page.headings],
  };
  if (o.page.title) page.title = o.page.title;
  if (o.page.footer) page.footer = o.page.footer;
  return structuredClone({
    actionRelation,
    components: dedupeComponents([...o.components, ...policy.components, ...operator.components], LIMITS.components),
    request: {
      schemaVersion: SCHEMA_VERSION,
      website: {
        page,
        form: {
          method: o.form.method, crossOriginAction: o.form.crossOriginAction,
          crossSiteAction: actionRelation === "cross_site", fields: o.form.fields, context: o.form.context,
        },
        privacyPolicy: policy.state, operatorInfo: operator.state,
        thirdParty: summarizeThirdParty(o.page.origin, o.resources),
      },
    },
  });
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

/** Called when the user starts interacting with a sensitive field. */
export async function markFocused(tabId: number): Promise<void> {
  const execution = executions.get(tabId);
  if (!execution) {
    const observation = await recallCurrentObservation(tabId);
    if (observation) await acceptObservation(tabId, observation, { focused: true });
    return;
  }
  await writeTab(tabId, async () => {
    if (!execution || !isCurrent(execution)) return;
    const transition = transitionEvaluation(stateFor(tabId), { type: "focus" });
    states.set(tabId, transition.state);
    if (!transition.operations.includes("publish")) return;
    await setTabStatus(tabId, transition.state.status);
    if (isCurrent(execution) && transition.state.status.kind === "done" && transition.operations.includes("notify")) {
      await notifyCurrent(execution, transition.state.status.assessment);
    }
  });
}

async function notifyCurrent(execution: Execution, assessment: Assessment): Promise<void> {
  const settings = await loadSettings();
  if (isCurrent(execution)) await maybeNotify(execution.tabId, assessment, settings, execution.signature);
}

async function maybeNotify(tabId: number, assessment: Assessment, settings: Settings, signature: string): Promise<void> {
  if (!settings.inPageNotice || assessment.level < WarningLevel.CAUTION) return;
  const message: ContentNotice & { signature: string } = { type: "show-notice", assessment, signature };
  await ext.tabs.sendMessage(tabId, message, { frameId: 0 }).catch(() => undefined);
}
