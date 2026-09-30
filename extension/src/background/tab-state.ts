/**
 * Per-tab status in storage.session: survives service-worker / event-page suspension,
 * is cleared when the browser closes, and is never persisted to disk (DESIGN.md §42.1).
 */
import type { TabStatus } from "../shared/assessment";
import { badgeModel } from "../shared/badge-model";
import { ext } from "../shared/browser";

export const tabStatusKey = (tabId: number) => `tab:${tabId}`;

export async function getTabStatus(tabId: number): Promise<TabStatus> {
  const k = tabStatusKey(tabId);
  return ((await ext.storage.session.get(k))[k] as TabStatus | undefined) ?? { kind: "idle" };
}

export async function setTabStatus(tabId: number, status: TabStatus): Promise<void> {
  await ext.storage.session.set({ [tabStatusKey(tabId)]: status });
  await updateBadge(tabId, status);
}

export async function clearTabStatus(tabId: number): Promise<void> {
  await ext.storage.session.remove(tabStatusKey(tabId));
  await updateBadge(tabId, { kind: "idle" });
}

async function updateBadge(tabId: number, status: TabStatus): Promise<void> {
  const { text, color } = badgeModel(status);
  try {
    await ext.action.setBadgeText({ tabId, text });
    await ext.action.setBadgeBackgroundColor({ tabId, color });
  } catch {
    // Tab closed in the meantime.
  }
}
