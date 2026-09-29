/**
 * Content scripts run only on origins the user granted (DESIGN.md §24, §42.3).
 * No static content_scripts are declared, so installing the extension grants no site access.
 */
import { ext } from "../shared/browser";
import type { PermissionStatus } from "../shared/assessment";

const SCRIPT_ID = "privacy-lint-content";
export const ALL_SITES = ["https://*/*", "http://*/*"];

export async function grantedMatchPatterns(): Promise<string[]> {
  const { origins = [] } = await ext.permissions.getAll();
  const patterns = new Set<string>();
  for (const origin of origins) {
    if (origin === "<all_urls>") ALL_SITES.forEach((p) => patterns.add(p));
    else if (/^(https?|\*):\/\//.test(origin)) patterns.add(origin);
  }
  return Array.from(patterns).sort();
}

export async function syncContentScripts(): Promise<void> {
  const matches = await grantedMatchPatterns();
  const registered = await ext.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  const current = registered[0]?.matches?.slice().sort() ?? [];
  if (JSON.stringify(current) === JSON.stringify(matches)) return;

  if (registered.length > 0) await ext.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  if (matches.length === 0) return;
  await ext.scripting.registerContentScripts([
    {
      id: SCRIPT_ID,
      js: ["content.js"],
      matches,
      runAt: "document_idle",
      allFrames: false,
      // Re-registered on every background start-up instead; Firefox and Chrome differ here.
      persistAcrossSessions: false,
    },
  ]);
}

/** Injects the content script into already-open tabs that just became permitted. */
export async function injectIntoPermittedTabs(origins: string[]): Promise<void> {
  const patterns = origins.flatMap((o) => (o === "<all_urls>" ? ALL_SITES : [o]));
  if (patterns.length === 0) return;
  const tabs = await ext.tabs.query({ url: patterns });
  await Promise.all(
    tabs
      .filter((tab) => tab.id !== undefined)
      .map((tab) =>
        ext.scripting.executeScript({ target: { tabId: tab.id! }, files: ["content.js"] }).catch(() => undefined),
      ),
  );
}

export async function permissionFor(url: string | undefined): Promise<{ permission: PermissionStatus; origin?: string }> {
  if (!url) return { permission: "unsupported" };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { permission: "unsupported" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return { permission: "unsupported" };
  const granted = await ext.permissions.contains({ origins: [`${parsed.origin}/*`] });
  return { permission: granted ? "granted" : "denied", origin: parsed.origin };
}
