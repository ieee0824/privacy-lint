/**
 * Privacy policy / operator information link discovery (DESIGN.md §7, §8).
 */
import type { DocumentLink } from "../shared/schema";
import { LIMITS } from "../shared/schema";
import { stripUrl } from "../privacy/url-sanitizer";
import { attrText, authorText } from "./dom-text";

interface LinkRule {
  text: RegExp;
  href: RegExp;
  weight: number;
}

const PRIVACY_RULES: LinkRule[] = [
  { text: /プライバシー\s*ポリシー|個人情報(保護)?(方針|指針)|privacy\s*(policy|notice|statement)/i, href: /privacy/i, weight: 10 },
  { text: /個人情報の(取り?扱|取扱)|個人情報について|プライバシー|privacy/i, href: /kojin|personal-?info|privacy/i, weight: 6 },
];

const OPERATOR_RULES: LinkRule[] = [
  { text: /特定商取引|特商法|会社概要|運営会社|運営者(情報)?|事業者(情報)?|企業情報|会社情報|imprint|impressum|legal\s*notice/i, href: /tokusho|tokutei|law|legal|company|corporate|imprint|impressum|operator/i, weight: 10 },
  { text: /about\s*us|^about$|company|corporate|私たちについて|当社について/i, href: /about|company|corporate/i, weight: 6 },
  { text: /お?問い?合わ?せ|contact/i, href: /contact|inquiry|toiawase/i, weight: 3 },
];

export interface DiscoveredLinks {
  privacy: DocumentLink[];
  operator: DocumentLink[];
}

export function discoverLinks(doc: Document): DiscoveredLinks {
  const privacy: Array<DocumentLink & { weight: number }> = [];
  const operator: Array<DocumentLink & { weight: number }> = [];
  const anchors = Array.from(doc.querySelectorAll("a[href]")).slice(0, 3000);

  for (const a of anchors) {
    const href = a.getAttribute("href") ?? "";
    const url = stripUrl(href, doc.baseURI);
    if (!url) continue;
    const text = authorText(a, LIMITS.labelText) || attrText(a, "aria-label", LIMITS.labelText) || "";
    const path = new URL(url).pathname;

    const pw = score(PRIVACY_RULES, text, path);
    if (pw > 0) privacy.push({ url, text, weight: pw });
    const ow = score(OPERATOR_RULES, text, path);
    if (ow > 0) operator.push({ url, text, weight: ow });
  }
  return { privacy: best(privacy), operator: best(operator) };
}

function score(rules: LinkRule[], text: string, path: string): number {
  let max = 0;
  for (const rule of rules) {
    if (rule.text.test(text)) max = Math.max(max, rule.weight);
    else if (rule.href.test(path)) max = Math.max(max, rule.weight - 2);
  }
  return max;
}

function best(links: Array<DocumentLink & { weight: number }>): DocumentLink[] {
  const seen = new Set<string>();
  return links
    .sort((a, b) => b.weight - a.weight)
    .filter((l) => (seen.has(l.url) ? false : (seen.add(l.url), true)))
    .slice(0, LIMITS.links)
    .map(({ url, text }) => ({ url, text }));
}
