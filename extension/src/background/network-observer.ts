/**
 * First/third-party classification of observed resource origins (DESIGN.md §6, §15).
 * "Third party" means a different registrable domain (eTLD+1), not merely another host.
 */
import { getDomain } from "tldts";
import type { ResourceOrigin } from "../shared/schema";

export type SiteRelation = "same_origin" | "same_site" | "cross_site";

export function siteOf(origin: string): string {
  const host = new URL(origin).hostname;
  return getDomain(host, { allowPrivateDomains: true }) ?? host;
}

export function relationOf(pageOrigin: string, otherOrigin: string): SiteRelation {
  if (pageOrigin === otherOrigin) return "same_origin";
  return siteOf(pageOrigin) === siteOf(otherOrigin) ? "same_site" : "cross_site";
}

export interface ThirdPartySummary {
  totalOrigins: number;
  scriptOrigins: number;
  iframeOrigins: number;
}

export function summarizeThirdParty(pageOrigin: string, resources: ResourceOrigin[]): ThirdPartySummary {
  const all = new Set<string>();
  const scripts = new Set<string>();
  const iframes = new Set<string>();
  for (const r of resources) {
    if (relationOf(pageOrigin, r.origin) !== "cross_site") continue;
    const site = siteOf(r.origin);
    all.add(site);
    if (r.kind === "script") scripts.add(site);
    if (r.kind === "iframe") iframes.add(site);
  }
  return { totalOrigins: all.size, scriptOrigins: scripts.size, iframeOrigins: iframes.size };
}
