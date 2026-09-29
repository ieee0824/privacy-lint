/**
 * SPA support (DESIGN.md §27). Only nodes added after start-up are classified; the whole
 * document is not rescanned. Besides added/removed form controls, changes to what the
 * assessment reads — headings, labels, legends, buttons, the title, the footer, and
 * control attributes such as `required` — schedule a new report (#16).
 * Text inside form controls is never inspected: only the fact that something changed.
 */
import type { ControlRegistry } from "./control-registry";

const CONTROLS = "form, input, textarea, select, label";
const CONTEXT = "h1, h2, h3, legend, label, button, title, footer, form";
const ATTRIBUTES = ["required", "aria-required", "autocomplete", "type", "name", "placeholder", "aria-label", "action", "method", "formaction"];
const DEBOUNCE_MS = 400;

export function watchForFormChanges(doc: Document, registry: ControlRegistry, onChange: () => void): MutationObserver {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending = false;

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "childList") {
        for (const node of Array.from(record.addedNodes)) {
          if (node.nodeType !== Node.ELEMENT_NODE) {
            if (inContext(node.parentElement)) pending = true;
            continue;
          }
          const el = node as Element;
          if (el.matches(CONTROLS) || el.querySelector(CONTROLS)) {
            registry.addFrom(el);
            pending = true;
          } else if (inContext(el) || el.querySelector(CONTEXT)) {
            pending = true;
          }
        }
        if (record.removedNodes.length > 0) pending = true;
      } else if (record.type === "attributes") {
        if (record.target.nodeType === Node.ELEMENT_NODE && (record.target as Element).matches(`${CONTROLS}, button`)) pending = true;
      } else if (record.type === "characterData") {
        if (inContext(record.target.parentElement)) pending = true;
      }
    }
    if (!pending) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      pending = false;
      onChange();
    }, DEBOUNCE_MS);
  });
  observer.observe(doc.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ATTRIBUTES,
  });
  return observer;
}

function inContext(el: Element | null): boolean {
  return el?.closest(CONTEXT) != null;
}
