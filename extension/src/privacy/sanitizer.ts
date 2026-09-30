/**
 * Redacts identifier-like substrings from page-derived text (DESIGN.md §17).
 *
 * This is a second line of defence. The first is that extractors never read
 * user-entered values at all; what reaches this function is author-written
 * page text (labels, headings, policy excerpts) which may still embed
 * contact details, tokens or IDs.
 */

const JWT = /\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]{5,}/g;
const URL_LIKE = /\bhttps?:\/\/[^\s"'<>]+/gi;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
// Digits with common separators, including the dash variants NFKC leaves alone
// (U+2010–2015, U+2212 minus, U+30FC prolonged sound mark). The digit count decides what it is.
const DIGIT_RUN = /\+?\d[\d \-().\u2010-\u2015\u2212\u30fc]{6,}\d/g;
const MIXED_ID = /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}\b/g;
const HEX_ID = /\b[0-9a-fA-F]{16,}\b/g;

export function sanitizeText(input: string, maxLength: number): string {
  let text = input.normalize("NFKC").replace(/\s+/g, " ").trim();
  text = text.replace(JWT, "[token]");
  text = text.replace(URL_LIKE, "[url]");
  text = text.replace(EMAIL, "[email]");
  text = text.replace(DIGIT_RUN, redactDigitRun);
  text = text.replace(MIXED_ID, "[token]");
  text = text.replace(HEX_ID, "[token]");
  return truncate(text, maxLength);
}

function redactDigitRun(match: string): string {
  const digits = match.replace(/\D/g, "");
  if (digits.length >= 13 && digits.length <= 19 && passesLuhn(digits)) return "[card]";
  if (digits.length >= 10 && digits.length <= 15) return "[phone]";
  if (digits.length >= 8) return "[number]";
  return match;
}

export function passesLuhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    sum += luhnDigit(digits.charCodeAt(i) - 48, double);
    double = !double;
  }
  return sum % 10 === 0;
}

function luhnDigit(digit: number, double: boolean): number {
  if (!double) return digit;
  const doubled = digit * 2;
  return doubled > 9 ? doubled - 9 : doubled;
}

function truncate(text: string, maxLength: number): string {
  const chars = Array.from(text);
  if (chars.length <= maxLength) return text;
  return chars.slice(0, maxLength - 1).join("") + "…";
}
