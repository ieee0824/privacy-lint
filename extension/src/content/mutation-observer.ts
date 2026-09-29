/**
 * SPA support (DESIGN.md §27): only nodes added after start-up are classified.
 */
import type { ControlRegistry } from "./control-registry";

const RELEVANT = "form, input, textarea, select, label";
const DEBOUNCE_MS = 400;

export function watchForFormChanges(doc: Document, registry: ControlRegistry, onChange: () => void): MutationObserver {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending = false;

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of Array.from(record.addedNodes)) {
        if (!(node instanceof Element)) continue;
        if (!node.matches(RELEVANT) && !node.querySelector(RELEVANT)) continue;
        registry.addFrom(node);
        pending = true;
      }
      if (record.removedNodes.length > 0) pending = true;
    }
    if (!pending) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      pending = false;
      onChange();
    }, DEBOUNCE_MS);
  });
  observer.observe(doc.documentElement, { childList: true, subtree: true });
  return observer;
}
