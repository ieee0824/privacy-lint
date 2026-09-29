/**
 * Form structure extraction (DESIGN.md §4, §5).
 *
 * INVARIANT: this module reads attributes and author-written text only.
 * It must never access `.value`, `.checked`, `.selectedIndex`, `.files`,
 * `FormData`, or the `value` attribute of any control (DESIGN.md §3.1, §3.2).
 */
import type { FieldDescriptor, FormMethod, FormObservation, Scheme, SensitiveFieldKind } from "../shared/schema";
import { LIMITS } from "../shared/schema";
import { originOf, parseHttpUrl, schemeOf } from "../privacy/url-sanitizer";
import { attrText, authorText } from "./dom-text";
import { classifyField, isClassifiable, isSensitive, type FieldSignals } from "./field-classifier";

export const CONTROL_SELECTOR = "input, textarea, select";

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

export interface ClassifiedControl {
  element: Control;
  descriptor: FieldDescriptor;
}

export interface FormGroup {
  /** The owning <form>, or null for controls rendered without one (common in SPAs). */
  form: HTMLFormElement | null;
  controls: ClassifiedControl[];
}

export function describeControl(el: Control): ClassifiedControl | null {
  const signals = signalsOf(el);
  if (!isClassifiable(signals)) return null;
  const descriptor: FieldDescriptor = {
    kind: classifyField(signals),
    required: el.hasAttribute("required") || el.getAttribute("aria-required") === "true",
  };
  if (signals.label) descriptor.label = signals.label;
  return { element: el, descriptor };
}

function signalsOf(el: Control): FieldSignals {
  const tag = el.tagName.toLowerCase() as FieldSignals["tag"];
  const type = tag === "input" ? (el.getAttribute("type") ?? "text").toLowerCase().trim() : tag;
  const signals: FieldSignals = { tag, type };
  const autocomplete = el.getAttribute("autocomplete");
  if (autocomplete) signals.autocomplete = autocomplete;
  const name = el.getAttribute("name");
  if (name) signals.name = name.slice(0, 100);
  const id = el.getAttribute("id");
  if (id) signals.id = id.slice(0, 100);
  const placeholder = attrText(el, "placeholder", LIMITS.labelText);
  if (placeholder) signals.placeholder = placeholder;
  const label = labelOf(el);
  if (label) signals.label = label;
  return signals;
}

function labelOf(el: Control): string | undefined {
  const labels = el.labels;
  if (labels && labels.length > 0) {
    const text = authorText(labels[0]!, LIMITS.labelText);
    if (text) return text;
  }
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const target = el.ownerDocument.getElementById(labelledBy.split(/\s+/)[0] ?? "");
    if (target) {
      const text = authorText(target, LIMITS.labelText);
      if (text) return text;
    }
  }
  return attrText(el, "aria-label", LIMITS.labelText) ?? attrText(el, "title", LIMITS.labelText) ?? layoutLabelOf(el);
}

/**
 * Table / definition-list layouts without <label>:
 * <tr><th>お名前</th><td><input></td></tr> or <dt>住所</dt><dd><input></dd>.
 */
function layoutLabelOf(el: Control): string | undefined {
  const cell = el.closest("td, dd");
  if (!cell) return undefined;
  const previous = cell.previousElementSibling;
  if (!previous || !/^(TH|TD|DT)$/.test(previous.tagName)) return undefined;
  return authorText(previous, LIMITS.labelText) || undefined;
}

/** The group asking for the widest range of personal data, if any asks for some. */
export function primarySensitiveGroup(groups: FormGroup[]): FormGroup | null {
  let best: FormGroup | null = null;
  let bestScore = 0;
  for (const group of groups) {
    const kinds = sensitiveKinds(group);
    const score = kinds.length * 10 + group.controls.filter((c) => isSensitive(c.descriptor.kind)).length;
    if (kinds.length > 0 && score > bestScore) {
      best = group;
      bestScore = score;
    }
  }
  return best;
}

export function sensitiveKinds(group: FormGroup): SensitiveFieldKind[] {
  const kinds = new Set<SensitiveFieldKind>();
  for (const c of group.controls) {
    if (isSensitive(c.descriptor.kind)) kinds.add(c.descriptor.kind);
  }
  return Array.from(kinds).sort();
}

export function observeForm(group: FormGroup, pageUrl: URL): FormObservation {
  const form = group.form;
  const target = submissionTarget(form, pageUrl);
  const observation: FormObservation = {
    method: methodOf(form),
    actionScheme: target.scheme,
    crossOriginAction: target.origin !== undefined && target.origin !== pageUrl.origin,
    fieldCount: group.controls.length,
    fields: group.controls.slice(0, LIMITS.fields).map((c) => c.descriptor),
    context: formContext(form, group),
  };
  if (target.origin) observation.actionOrigin = target.origin;
  return observation;
}

function methodOf(form: HTMLFormElement | null): FormMethod {
  if (!form) return "none";
  const method = (form.getAttribute("method") ?? "get").toLowerCase().trim();
  return method === "get" || method === "post" || method === "dialog" ? method : "other";
}

function submissionTarget(
  form: HTMLFormElement | null,
  pageUrl: URL,
): { origin?: string; scheme: Scheme | "none" } {
  if (!form) return { scheme: "none" };
  // A submit button's formaction overrides the form's action.
  const submitter = form.querySelector("button[formaction], input[formaction]");
  const raw = submitter?.getAttribute("formaction") ?? form.getAttribute("action") ?? "";
  let url: URL;
  try {
    url = new URL(raw || pageUrl.href, form.ownerDocument.baseURI);
  } catch {
    return { scheme: "other" };
  }
  const scheme = schemeOf(url);
  const origin = parseHttpUrl(url.href) ? originOf(url.href) ?? undefined : undefined;
  return origin ? { origin, scheme } : { scheme };
}

function formContext(form: HTMLFormElement | null, group: FormGroup): string[] {
  const texts: string[] = [];
  const container: Element | null = form ?? group.controls[0]?.element.parentElement ?? null;
  if (!container) return texts;

  for (const legend of Array.from(container.querySelectorAll("legend")).slice(0, 2)) {
    texts.push(authorText(legend, LIMITS.shortText));
  }
  const submit = container.querySelector('button[type="submit"], button:not([type])');
  if (submit) texts.push(authorText(submit, LIMITS.shortText));
  const ariaLabel = form ? attrText(form, "aria-label", LIMITS.shortText) : undefined;
  if (ariaLabel) texts.push(ariaLabel);

  const section = container.closest("section, article, main, [role=main], dialog");
  const heading = section?.querySelector("h1, h2, h3");
  if (heading) texts.push(authorText(heading, LIMITS.shortText));

  return Array.from(new Set(texts.filter(Boolean))).slice(0, LIMITS.contextTexts);
}
