/** Focus target identity only; no input values or input events are read. */
import { isSensitive } from "./field-classifier";
import type { ControlRegistry } from "./control-registry";
import type { SensitiveFieldKind } from "../shared/schema";

export interface FocusState { href: string; lifecycle: number | null }
export interface FocusEventFacts extends FocusState { kind?: SensitiveFieldKind }

export function transitionFocus(previous: Readonly<FocusState>, event: Readonly<FocusEventFacts>): { state: FocusState; notify: boolean } {
  if (!event.kind || !isSensitive(event.kind)) return { state: { ...previous }, notify: false };
  const state = { href: event.href, lifecycle: event.lifecycle };
  const notify = previous.href !== event.href || previous.lifecycle !== event.lifecycle;
  return { state, notify };
}

export interface FocusTrigger { reset(): void }

export function installFocusTrigger(
  doc: Document,
  registry: ControlRegistry,
  onSensitiveFocus: (control: Element) => void,
): FocusTrigger {
  let state: FocusState = { href: "", lifecycle: null };
  doc.addEventListener("focusin", event => {
    if (!(event.target instanceof Element)) return;
    const control = event.target;
    registry.reclassify(control);
    const kind = registry.kindOf(control);
    if (!kind || !isSensitive(kind)) return;
    registry.activate(control);
    const next = transitionFocus(state, { href: doc.URL, lifecycle: registry.lifecycle(), kind });
    state = next.state;
    if (next.notify) onSensitiveFocus(control);
  }, { capture: true, passive: true });
  return { reset: () => { state = { href: "", lifecycle: null }; } };
}
