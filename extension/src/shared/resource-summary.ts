/** Pure site classification and the resource counts used by assessment and identity. */
import { getDomain } from "tldts";
import type { ResourceOrigin } from "./schema";

export type SiteRelation = "same_origin" | "same_site" | "cross_site";
export interface ThirdPartySummary {
  totalOrigins: number;
  scriptOrigins: number;
  iframeOrigins: number;
}

export function siteOf(origin: string): string {
  const host = new URL(origin).hostname;
  return getDomain(host, { allowPrivateDomains: true }) ?? host;
}

export function relationOf(pageOrigin: string, otherOrigin: string): SiteRelation {
  if (pageOrigin === otherOrigin) return "same_origin";
  return siteOf(pageOrigin) === siteOf(otherOrigin) ? "same_site" : "cross_site";
}

export function summarizeThirdParty(pageOrigin: string, resources: readonly ResourceOrigin[]): ThirdPartySummary {
  const thirdParty = resources.filter(r => relationOf(pageOrigin, r.origin) === "cross_site");
  const sites = (kind?: ResourceOrigin["kind"]) => new Set(
    thirdParty.filter(r => kind === undefined || r.kind === kind).map(r => siteOf(r.origin)),
  ).size;
  return { totalOrigins: sites(), scriptOrigins: sites("script"), iframeOrigins: sites("iframe") };
}
