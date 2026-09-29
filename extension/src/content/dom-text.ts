/**
 * Author-written text extraction.
 *
 * Text nodes inside form controls are skipped entirely, so a <label> that
 * wraps an <input>/<select>/<textarea> contributes only its own caption.
 * Form control state (`.value`, checkedness, selection) is never touched.
 */
import { sanitizeText } from "../privacy/sanitizer";

const SKIPPED_ANCESTORS = new Set(["INPUT", "TEXTAREA", "SELECT", "OPTION", "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);

export function authorText(root: Node, maxLength: number): string {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      for (let p = node.parentElement; p && p !== root.parentElement; p = p.parentElement) {
        if (SKIPPED_ANCESTORS.has(p.tagName)) return NodeFilter.FILTER_REJECT;
        if (p.getAttribute("contenteditable") !== null && p.getAttribute("contenteditable") !== "false") {
          return NodeFilter.FILTER_REJECT;
        }
      }
      return NodeFilter.FILTER_ACCEPT;
    },
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
