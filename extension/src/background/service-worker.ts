/**
 * Background entry: Chrome service worker / Firefox event page (DESIGN.md §42.1).
 * All listeners are registered synchronously at top level so events wake the background.
 */
import { ext } from "../shared/browser";
import type { ContentMessage, PopupMessage, TabStatusResponse } from "../shared/messages";
import { validatePageObservation } from "../shared/validate";
import { acceptObservation, evaluationSettingsChanged, forgetTab, markFocused, reassessCurrentTab, resetTab } from "./assessment";
import { clearCache, pruneExpired } from "./cache";
import { grantedMatchPatterns, injectIntoPermittedTabs, permissionFor, syncContentScripts } from "./permissions";
import { SETTINGS_KEY, evaluationFingerprint, type Settings } from "./settings";
import { getTabStatus } from "./tab-state";

type Sender = chrome.runtime.MessageSender;

function isFromOwnExtension(sender: Sender): boolean {
  return sender.id === ext.runtime.id;
}

function isFromExtensionPage(sender: Sender): boolean {
  return isFromOwnExtension(sender) && !sender.tab && (sender.url ?? "").startsWith(ext.runtime.getURL(""));
}

async function handleContent(message: ContentMessage, sender: Sender): Promise<void> {
  const tabId = sender.tab?.id;
  if (tabId === undefined || sender.frameId !== 0) return;
  if (message.type === "observation") {
    const observation = validatePageObservation(message.observation);
    // The observation must describe the page that sent it.
    if (!sender.url || new URL(sender.url).origin !== observation.page.origin) return;
    await acceptObservation(tabId, observation, { focused: (message as { focused?: unknown }).focused === true });
  } else if (message.type === "sensitive-focus") {
    await markFocused(tabId);
  } else if (message.type === "form-gone") {
    await resetTab(tabId);
  }
}

async function handlePopup(message: PopupMessage): Promise<TabStatusResponse | { ok: boolean }> {
  switch (message.type) {
    case "get-tab-status": {
      const tab = await ext.tabs.get(message.tabId);
      const { permission, origin } = await permissionFor(tab.url);
      const response: TabStatusResponse = { permission, status: await getTabStatus(message.tabId) };
      if (origin) response.origin = origin;
      return response;
    }
    case "reassess": {
      return { ok: await reassessCurrentTab(message.tabId) };
    }
    case "clear-cache":
      await clearCache();
      return { ok: true };
  }
}

ext.runtime.onMessage.addListener((message: unknown, sender: Sender, sendResponse: (r: unknown) => void) => {
  if (!isFromOwnExtension(sender) || typeof message !== "object" || message === null) return false;
  const type = (message as { type?: unknown }).type;

  if (sender.tab && (type === "observation" || type === "sensitive-focus" || type === "form-gone")) {
    handleContent(message as ContentMessage, sender).catch(() => undefined);
    return false;
  }
  if (__E2E__ && sender.tab && type === "e2e-dump") {
    Promise.all([ext.storage.local.get(null), ext.storage.session.get(null)]).then(
      ([local, session]) => sendResponse({ local, session }),
      () => sendResponse(null),
    );
    return true;
  }
  if (isFromExtensionPage(sender) && (type === "get-tab-status" || type === "reassess" || type === "clear-cache")) {
    handlePopup(message as PopupMessage).then(sendResponse, () => sendResponse(null));
    return true;
  }
  return false;
});

ext.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // A new document is loading: any running or finished assessment belongs to the old page.
  if (changeInfo.status === "loading") resetTab(tabId).catch(() => undefined);
});

ext.tabs.onRemoved.addListener((tabId) => {
  resetTab(tabId)
    .catch(() => undefined)
    .finally(() => forgetTab(tabId));
});

ext.permissions.onAdded.addListener(async (permissions) => {
  await syncContentScripts();
  await injectIntoPermittedTabs(permissions.origins ?? []);
});

ext.permissions.onRemoved.addListener(() => {
  syncContentScripts().catch(() => undefined);
});

ext.runtime.onInstalled.addListener(async (details) => {
  // Tabs that were already open do not get newly registered content scripts on their own.
  await syncContentScripts().catch(() => undefined);
  await injectIntoPermittedTabs(await grantedMatchPatterns()).catch(() => undefined);
  if (details.reason !== "install") return;
  // Onboarding: explain what is read and sent, and let the user grant site access.
  ext.runtime
    .openOptionsPage()
    .catch(() => ext.tabs.create({ url: ext.runtime.getURL("options.html") }))
    .catch(() => undefined);
});

// Results computed under other settings must not be reused (#15). The fingerprint is also
// part of the cache key; clearing additionally drops entries that can no longer be hit.
ext.storage.onChanged.addListener((changes, areaName) => {
  const change = changes[SETTINGS_KEY];
  if (areaName !== "local" || !change) return;
  const before = evaluationFingerprint(change.oldValue as Partial<Settings> | undefined);
  const after = evaluationFingerprint(change.newValue as Partial<Settings> | undefined);
  if (before !== after) evaluationSettingsChanged().catch(() => undefined);
});

ext.runtime.onStartup.addListener(() => {
  pruneExpired(Date.now()).catch(() => undefined);
});

// Idempotent; covers install, browser start-up and background wake-ups alike.
syncContentScripts().catch(() => undefined);
