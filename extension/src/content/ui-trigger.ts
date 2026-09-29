/**
 * Detects that the user *started interacting* with a sensitive field (DESIGN.md §3.1).
 *
 * Only `focusin` is observed and only the event target's identity is used.
 * No input/change/keydown/beforeinput/paste listener exists in this extension.
 */
import { isSensitive } from "./field-classifier";
import type { ControlRegistry } from "./control-registry";

export function installFocusTrigger(doc: Document, registry: ControlRegistry, onSensitiveFocus: () => void): void {
  let fired = false;
  doc.addEventListener(
    "focusin",
    (event) => {
      if (fired || !(event.target instanceof Element)) return;
      const kind = registry.kindOf(event.target);
      if (kind && isSensitive(kind)) {
        fired = true;
        onSensitiveFocus();
      }
    },
    { capture: true, passive: true },
  );
}
