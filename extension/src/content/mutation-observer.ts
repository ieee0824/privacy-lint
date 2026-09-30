/** DOM I/O facts and pure mutation decisions; only affected subtrees are classified. */
import type { ControlRegistry } from "./control-registry";

const CONTROLS = "form, input, textarea, select, label";
const CONTEXT = "h1, h2, h3, legend, label, button, title, footer, form, th, dt, [role=contentinfo]";
const RESOURCES = "script[src], iframe[src], link[href], meta[name=generator], base[href], a[href]";
const RESOURCE_ELEMENTS = "script, iframe, link, meta, base, a";
const ATTRIBUTES = [
  "required", "aria-required", "autocomplete", "type", "name", "placeholder", "aria-label",
  "aria-labelledby", "id", "for", "title", "form", "action", "method", "formaction",
  "formmethod", "disabled", "contenteditable", "src", "href", "rel", "content", "role",
];
const DEBOUNCE_MS = 400;

export interface MutationFacts {
  type: MutationRecord["type"];
  addedControl: boolean;
  addedContext: boolean;
  removed: boolean;
  controlAttribute: boolean;
  contextAttribute: boolean;
  contextText: boolean;
}

export interface MutationDecision {
  report: boolean;
  classifyAdded: boolean;
  classifyTarget: boolean;
}

export function decideMutation(facts: Readonly<MutationFacts>): MutationDecision {
  const report = facts.addedControl || facts.addedContext || facts.removed
    || facts.controlAttribute || facts.contextAttribute || facts.contextText;
  return { report, classifyAdded: facts.addedControl, classifyTarget: facts.controlAttribute };
}

function inContext(el: Element | null): boolean {
  return el?.closest(CONTEXT) != null;
}

function addedFacts(node: Node): { control: boolean; context: boolean } {
  if (node.nodeType !== Node.ELEMENT_NODE) return { control: false, context: inContext(node.parentElement) };
  const el = node as Element;
  const control = el.matches(CONTROLS) || el.querySelector(CONTROLS) !== null;
  const context = inContext(el) || el.querySelector(CONTEXT) !== null
    || el.matches(RESOURCES) || el.querySelector(RESOURCES) !== null;
  return { control, context };
}

function readMutation(record: MutationRecord): MutationFacts {
  const added = Array.from(record.addedNodes, addedFacts);
  const target = record.target.nodeType === Node.ELEMENT_NODE ? record.target as Element : null;
  const attributes = record.type === "attributes";
  return {
    type: record.type,
    addedControl: added.some(node => node.control),
    addedContext: added.some(node => node.context),
    removed: record.removedNodes.length > 0,
    controlAttribute: attributes && target?.matches(CONTROLS) === true,
    contextAttribute: attributes && (target?.matches(`${CONTEXT}, ${RESOURCE_ELEMENTS}`) === true
      || record.attributeName === "contenteditable"),
    contextText: record.type === "characterData" && inContext(record.target.parentElement),
  };
}

function applyMutation(record: MutationRecord, registry: ControlRegistry): boolean {
  const decision = decideMutation(readMutation(record));
  if (decision.classifyAdded) {
    for (const node of Array.from(record.addedNodes)) classifyAddedNode(node, registry);
  }
  if (decision.classifyTarget) registry.reclassify(record.target as Element);
  return decision.report;
}

function classifyAddedNode(node: Node, registry: ControlRegistry): void {
  if (node.nodeType === Node.ELEMENT_NODE) registry.addFrom(node as Element);
}

export function watchForFormChanges(doc: Document, registry: ControlRegistry, onChange: () => void): MutationObserver {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const observer = new MutationObserver(records => {
    const reports = records.map(record => applyMutation(record, registry));
    if (!reports.some(Boolean)) return;
    clearTimeout(timer);
    timer = setTimeout(onChange, DEBOUNCE_MS);
  });
  observer.observe(doc.documentElement, {
    childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTES,
  });
  return observer;
}
