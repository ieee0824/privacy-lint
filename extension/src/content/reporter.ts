/** Explicit reporting state; DOM reads and message delivery stay at the boundary. */
import type { ContentMessage, FreshObservationResponse } from "../shared/messages";
import type { PageObservation } from "../shared/schema";
import { observationSignature } from "../shared/signature";
import type { ControlRegistry } from "./control-registry";
import { buildObservation } from "./page-observer";

export interface ReporterState {
  documentId: string;
  href: string;
  signature: string;
  noticeKey: string;
  revision: number;
  lifecycle: number | null;
  focused: boolean;
}
export interface ReporterEvent {
  href: string;
  lifecycle: number | null;
  observation: PageObservation | null;
  focused: boolean;
}
export interface ReporterTransition {
  state: ReporterState;
  message?: ContentMessage;
  clearNotice: boolean;
}

export function initialReporterState(documentId = ""): ReporterState {
  return { documentId, href: "", signature: "", noticeKey: "", revision: 0, lifecycle: null, focused: false };
}

/** Random identity stays inside extension messages; HTTP pages may lack randomUUID. */
function createDocumentId(random: Crypto): string {
  if (typeof random.randomUUID === "function") return random.randomUUID();
  return Array.from(random.getRandomValues(new Uint32Array(4)), word => word.toString(16)).join("-");
}

export function transitionReporter(previous: Readonly<ReporterState>, event: Readonly<ReporterEvent>): ReporterTransition {
  const changedPage = previous.href !== event.href || previous.lifecycle !== event.lifecycle;
  const signature = event.observation ? observationSignature(event.observation) : "";
  const focused = event.focused || (!changedPage && previous.focused);
  const clearNotice = changedPage || signature !== previous.signature;
  const revision = previous.revision + Number(clearNotice);
  const noticeKey = signature ? JSON.stringify([previous.documentId, event.lifecycle, revision]) : "";
  const state = { documentId: previous.documentId, href: event.href, signature, noticeKey, revision, lifecycle: event.lifecycle, focused };
  if (!event.observation) {
    return { state: { ...state, focused: false }, clearNotice, message: previous.signature ? { type: "form-gone" } : undefined };
  }
  if (!clearNotice && focused === previous.focused) return { state, clearNotice };
  return { state, clearNotice, message: { type: "observation", observation: event.observation, focused, noticeKey } };
}

export interface Reporter {
  (): void;
  focus(control: Element): void;
  signature(): string;
  lifecycle(): number | null;
  refresh(deliver?: boolean): FreshObservationResponse;
}

export function createReporter(
  doc: Document,
  registry: ControlRegistry,
  send: (message: ContentMessage) => void,
  perf?: Pick<Performance, "getEntriesByType">,
  onLifecycleChange: () => void = () => {},
): Reporter {
  let state = initialReporterState(createDocumentId(crypto));
  const run = (focused = false, deliver = true): FreshObservationResponse => {
    registry.prune();
    registry.refresh();
    const observation = buildObservation(doc, registry, perf);
    const event = { href: doc.URL, lifecycle: observation ? registry.lifecycle() : null, observation, focused };
    const transition = transitionReporter(state, event);
    state = transition.state;
    if (transition.clearNotice) onLifecycleChange();
    if (deliver && transition.message) send(transition.message);
    return { observation, focused: state.focused, noticeKey: state.noticeKey };
  };
  return Object.assign(() => run(), {
    focus: (control: Element) => { registry.activate(control); run(true); },
    signature: () => state.noticeKey,
    lifecycle: () => state.lifecycle,
    refresh: (deliver = false) => run(false, deliver),
  });
}
