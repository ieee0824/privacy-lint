/**
 * Resource origin collection (DESIGN.md §6, §42.4).
 *
 * Uses the Resource Timing API and <script>/<iframe> src attributes instead of
 * webRequest, so no extra permission is needed and request headers/bodies are
 * structurally out of reach. Only origin + initiator kind is kept.
 */
import type { ResourceKind, ResourceOrigin } from "../shared/schema";
import { LIMITS } from "../shared/schema";
import { originOf } from "../privacy/url-sanitizer";

const INITIATOR_KINDS: Record<string, ResourceKind> = {
  script: "script",
  iframe: "iframe",
  subdocument: "iframe",
  frame: "iframe",
  xmlhttprequest: "xhr",
  fetch: "fetch",
  beacon: "other",
  img: "image",
  image: "image",
  css: "stylesheet",
  link: "stylesheet",
  font: "font",
};

export function collectResourceOrigins(doc: Document, perf: Pick<Performance, "getEntriesByType"> | undefined): ResourceOrigin[] {
  const seen = new Map<string, ResourceOrigin>();
  const add = (url: string, kind: ResourceKind) => {
    const origin = originOf(url, doc.baseURI);
    if (!origin) return;
    const key = `${kind} ${origin}`;
    if (!seen.has(key) && seen.size < LIMITS.resources) seen.set(key, { origin, kind });
  };

  for (const entry of perf?.getEntriesByType("resource") ?? []) {
    const timing = entry as PerformanceResourceTiming;
    add(timing.name, INITIATOR_KINDS[timing.initiatorType] ?? "other");
  }
  for (const el of Array.from(doc.querySelectorAll("script[src]")).slice(0, 500)) {
    add(el.getAttribute("src") ?? "", "script");
  }
  for (const el of Array.from(doc.querySelectorAll("iframe[src]")).slice(0, 100)) {
    add(el.getAttribute("src") ?? "", "iframe");
  }
  return Array.from(seen.values());
}
