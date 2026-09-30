/**
 * Author-written text extraction.
 *
 * Text nodes inside form controls are skipped entirely, so a <label> that
 * wraps an <input>/<select>/<textarea> contributes only its own caption.
 * Form control state (`.value`, checkedness, selection) is never touched.
 */
import { sanitizeText } from "../privacy/sanitizer";

const SKIPPED_ANCESTORS = new Set(["INPUT", "TEXTAREA", "SELECT", "OPTION", "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);

/** Attribute facts are collected before any text is read. False stops inheritance. */
export function editableFromAttributes(attributes: readonly (string | null)[]): boolean {
  const setting = attributes.find(raw => raw !== null && /^(|true|false|plaintext-only)$/i.test(raw));
  return setting !== undefined && setting !== null && setting.toLowerCase() !== "false";
}

function readableTextNode(node: Node): boolean {
  const attributes: (string | null)[] = [];
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    if (SKIPPED_ANCESTORS.has(parent.tagName)) return false;
    attributes.push(parent.getAttribute("contenteditable"));
  }
  return !editableFromAttributes(attributes);
}

export function authorText(root: Node, maxLength: number): string {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: node => readableTextNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
  });
  const parts: string[] = [];
  let length = 0;
  // Stop collecting once there is clearly enough text, to bound work on huge nodes.
  const budget = maxLength * 4;
  for (let n = walker.nextNode(); n && length < budget; n = walker.nextNode()) {
    const text = n.nodeValue ?? "";
    parts.push(text);
    length += text.length;
  }
  return sanitizeText(parts.join(" "), maxLength);
}

export function attrText(el: Element, name: string, maxLength: number): string | undefined {
  const raw = el.getAttribute(name);
  if (!raw) return undefined;
  const text = sanitizeText(raw, maxLength);
  return text || undefined;
}
