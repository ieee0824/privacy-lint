/** Explicit reporting state; DOM reads and message delivery stay at the boundary. */
import type { ContentMessage, FreshObservationResponse } from "../shared/messages";
import type { PageObservation } from "../shared/schema";
import { observationSignature } from "../shared/signature";
import type { ControlRegistry } from "./control-registry";
import { buildObservation } from "./page-observer";

export interface ReporterState {
  href: string;
  signature: string;
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

export function initialReporterState(): ReporterState {
  return { href: "", signature: "", lifecycle: null, focused: false };
}

export function transitionReporter(previous: Readonly<ReporterState>, event: Readonly<ReporterEvent>): ReporterTransition {
  const changedPage = previous.href !== event.href || previous.lifecycle !== event.lifecycle;
  const signature = event.observation ? observationSignature(event.observation) : "";
  const focused = event.focused || (!changedPage && previous.focused);
  const state = { href: event.href, signature, lifecycle: event.lifecycle, focused };
  const clearNotice = changedPage || signature !== previous.signature;
  if (!event.observation) {
    return { state: { ...state, focused: false }, clearNotice, message: previous.signature ? { type: "form-gone" } : undefined };
  }
  if (!clearNotice && focused === previous.focused) return { state, clearNotice };
  return { state, clearNotice, message: { type: "observation", observation: event.observation, focused } };
}

export interface Reporter {
  (): void;
  focus(control: Element): void;
  signature(): string;
  lifecycle(): number | null;
  refresh(): FreshObservationResponse;
}

export function createReporter(
  doc: Document,
  registry: ControlRegistry,
  send: (message: ContentMessage) => void,
  perf?: Pick<Performance, "getEntriesByType">,
  onLifecycleChange: () => void = () => {},
): Reporter {
  let state = initialReporterState();
  const run = (focused = false, deliver = true): FreshObservationResponse => {
    registry.prune();
    registry.refresh();
    const observation = buildObservation(doc, registry, perf);
    const event = { href: doc.URL, lifecycle: observation ? registry.lifecycle() : null, observation, focused };
    const transition = transitionReporter(state, event);
    state = transition.state;
    if (transition.clearNotice) onLifecycleChange();
    if (deliver && transition.message) send(transition.message);
    return { observation, focused: state.focused };
  };
  return Object.assign(() => run(), {
    focus: (control: Element) => { registry.activate(control); run(true); },
    signature: () => state.signature,
    lifecycle: () => state.lifecycle,
    refresh: () => run(false, false),
  });
}
