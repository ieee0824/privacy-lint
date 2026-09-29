/**
 * Per-tab status in storage.session: survives service-worker / event-page suspension,
 * is cleared when the browser closes, and is never persisted to disk (DESIGN.md §42.1).
 */
import type { TabStatus, WarningLevel } from "../shared/assessment";
import { WarningLevel as Level } from "../shared/assessment";
import { ext } from "../shared/browser";

const key = (tabId: number) => `tab:${tabId}`;

export async function getTabStatus(tabId: number): Promise<TabStatus> {
  const k = key(tabId);
  return ((await ext.storage.session.get(k))[k] as TabStatus | undefined) ?? { kind: "idle" };
}

export async function setTabStatus(tabId: number, status: TabStatus): Promise<void> {
  await ext.storage.session.set({ [key(tabId)]: status });
  await updateBadge(tabId, status);
}

export async function clearTabStatus(tabId: number): Promise<void> {
  await ext.storage.session.remove(key(tabId));
  await updateBadge(tabId, { kind: "idle" });
}

const BADGE: Record<WarningLevel, { text: string; color: string }> = {
  [Level.NORMAL]: { text: "", color: "#6e7781" },
  [Level.NOTICE]: { text: "i", color: "#0969da" },
  [Level.CAUTION]: { text: "!", color: "#bf8700" },
  [Level.VERIFY_BEFORE_INPUT]: { text: "!!", color: "#bc4c00" },
};

async function updateBadge(tabId: number, status: TabStatus): Promise<void> {
  let text = "";
  let color = "#6e7781";
  if (status.kind === "assessing") {
    text = "…";
  } else if (status.kind === "done") {
    const a = status.assessment;
    ({ text, color } = BADGE[a.level]);
    if (a.state !== "evaluated" && a.level <= Level.NOTICE) {
      text = "?";
      color = "#6e7781";
    }
  }
  try {
    await ext.action.setBadgeText({ tabId, text });
    await ext.action.setBadgeBackgroundColor({ tabId, color });
  } catch {
    // Tab closed in the meantime.
  }
}
