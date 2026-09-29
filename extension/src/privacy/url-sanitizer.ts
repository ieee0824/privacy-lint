/**
 * URL handling (DESIGN.md §23).
 * Query strings and fragments are dropped everywhere; only origin and a coarse
 * path classification are ever sent outside the browser.
 */
import type { PathClass, Scheme } from "../shared/schema";

export function schemeOf(url: URL): Scheme {
  if (url.protocol === "https:") return "https";
  if (url.protocol === "http:") return "http";
  return "other";
}

export function parseHttpUrl(raw: string, base?: string): URL | null {
  try {
    const url = new URL(raw, base);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

/** origin + pathname. Used for fetching linked documents; never sent to the relay. */
export function stripUrl(raw: string, base?: string): string | null {
  const url = parseHttpUrl(raw, base);
  if (!url) return null;
  return url.origin + url.pathname;
}

export function originOf(raw: string, base?: string): string | null {
  return parseHttpUrl(raw, base)?.origin ?? null;
}

const PATH_RULES: ReadonlyArray<[PathClass, RegExp]> = [
  ["checkout", /checkout|cart|payment|purchase|order|kessai|購入|決済/i],
  ["signup", /sign-?up|register|registration|join|entry|touroku|登録|新規/i],
  ["login", /log-?in|sign-?in|auth|session/i],
  ["reservation", /reserv|booking|book|yoyaku|予約/i],
  ["newsletter", /newsletter|subscribe|mail-?magazine|merumaga|メルマガ/i],
  ["contact", /contact|inquiry|enquiry|toiawase|support|問い?合わせ/i],
  ["application", /apply|application|moushikomi|申し?込/i],
  ["account", /account|profile|mypage|my-page|settings|会員/i],
];

export function classifyPath(pathname: string): PathClass {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // keep raw pathname
  }
  for (const [cls, pattern] of PATH_RULES) {
    if (pattern.test(decoded)) return cls;
  }
  return "other";
}

const ORIGIN_PATTERN = /^https?:\/\/[a-z0-9.-]+(?::\d{1,5})?$|^https?:\/\/\[[0-9a-f:.]+\](?::\d{1,5})?$/i;

export function isOrigin(value: string): boolean {
  return value.length <= 300 && ORIGIN_PATTERN.test(value);
}
