/**
 * Minimal HTML → text extraction for linked documents (privacy policy, operator page).
 *
 * Runs in the background, where Chrome's service worker has no DOMParser (DESIGN.md §42.1).
 * The output is only ever used as data: it is never rendered as HTML or executed.
 * Only short keyword-matching excerpts leave this module (DESIGN.md §3.7, §16).
 */
import { LIMITS } from "../shared/schema";
import { sanitizeText } from "../privacy/sanitizer";

const MAX_HTML = 1_500_000;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  copy: "©",
  reg: "®",
  yen: "¥",
};

export interface DocumentText {
  title?: string;
  blocks: string[];
}

export function htmlToBlocks(html: string): DocumentText {
  let s = html.slice(0, MAX_HTML);
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(s);
  s = s
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg|head|iframe|object)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/?(p|div|li|ul|ol|dl|dt|dd|h[1-6]|tr|td|th|table|section|article|header|footer|main|nav|aside|address|blockquote|pre)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, " ");
  const blocks = decodeEntities(s)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 2);
  const doc: DocumentText = { blocks };
  const title = titleMatch ? sanitizeText(decodeEntities(titleMatch[1] ?? ""), LIMITS.shortText) : "";
  if (title) doc.title = title;
  return doc;
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (match, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " ";
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

export const PRIVACY_KEYWORDS =
  /利用目的|目的|第三者|提供|委託|共同利用|収集|取得|開示|訂正|削除|利用停止|問い?合わ?せ|窓口|安全管理|クッキー|cookie|アクセス解析|保存期間|purpose|third[- ]part|collect|share|disclos|contact|retention|analytics|process/i;

export const OPERATOR_KEYWORDS =
  /会社名|商号|社名|運営|事業者|販売業者|代表者|責任者|所在地|住所|電話|連絡先|メール|設立|資本金|法人|株式会社|合同会社|有限会社|一般社団法人|company|operator|address|contact|representative|registered|incorporat|\binc\b|\bllc\b|\bltd\b|gmbh/i;

const DATE_KEYWORDS = /改定|制定|更新|施行|最終|updated|effective|revised|last modified|copyright|©/i;
const YEAR = /(19|20)\d{2}/;

export function extractExcerpts(doc: DocumentText, keywords: RegExp): string[] {
  const out: string[] = [];
  let total = 0;
  const push = (text: string) => {
    const clean = sanitizeText(text, LIMITS.excerptText);
    if (!clean || out.includes(clean)) return;
    out.push(clean);
    total += clean.length;
  };

  const blocks = doc.blocks;
  for (let i = 0; i < blocks.length && out.length < LIMITS.excerptsPerDocument - 2 && total < 3000; i++) {
    const block = blocks[i]!;
    if (!keywords.test(block)) continue;
    // Short matching blocks are usually headings; include the paragraph that follows.
    push(block.length < 40 && blocks[i + 1] ? `${block} ${blocks[i + 1]}` : block);
  }
  // Dated statements (revision dates, copyright) feed the maintenance-signal question (§18.5).
  for (const block of blocks) {
    if (out.length >= LIMITS.excerptsPerDocument) break;
    if (DATE_KEYWORDS.test(block) && YEAR.test(block) && block.length < 200) push(block);
  }
  return out;
}
