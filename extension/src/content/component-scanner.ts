/**
 * Collects versioned components referenced by the page (DESIGN.md §44).
 * Reads resource URLs and <meta name="generator"> only; never page JavaScript state (no MAIN world, §13).
 */
import type { ComponentObservation } from "../shared/schema";
import { LIMITS } from "../shared/schema";
import { componentFromGenerator, componentFromUrl, dedupeComponents } from "../shared/component-patterns";

export function collectComponents(
  doc: Document,
  perf: Pick<Performance, "getEntriesByType"> | undefined,
): ComponentObservation[] {
  const found: ComponentObservation[] = [];
  const add = (c: ComponentObservation | null) => {
    if (c) found.push(c);
  };

  const urls = new Set<string>();
  for (const el of Array.from(doc.querySelectorAll("script[src]")).slice(0, 500)) urls.add(el.getAttribute("src") ?? "");
  for (const el of Array.from(doc.querySelectorAll('link[rel~="stylesheet"][href]')).slice(0, 300)) urls.add(el.getAttribute("href") ?? "");
  for (const entry of (perf?.getEntriesByType("resource") ?? []).slice(0, 1000)) urls.add(entry.name);
  for (const raw of urls) {
    if (!raw) continue;
    try {
      add(componentFromUrl(new URL(raw, doc.baseURI).href));
    } catch {
      // not a URL
    }
  }

  for (const meta of Array.from(doc.querySelectorAll('meta[name="generator" i]')).slice(0, 5)) {
    add(componentFromGenerator((meta.getAttribute("content") ?? "").slice(0, 100)));
  }
  return dedupeComponents(found, LIMITS.components);
}
