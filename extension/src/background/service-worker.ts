/**
 * Background entry: Chrome service worker / Firefox event page (DESIGN.md §42.1).
 * All listeners are registered synchronously at top level so events wake the background.
 */
import { ext } from "../shared/browser";
import type { ContentMessage, PopupMessage, TabStatusResponse } from "../shared/messages";
import { validatePageObservation } from "../shared/validate";
import { assessTab, forgetObservation, markFocused, recallObservation, rememberObservation } from "./assessment";
import { clearCache, pruneExpired } from "./cache";
import { injectIntoPermittedTabs, permissionFor, syncContentScripts } from "./permissions";
import { clearTabStatus, getTabStatus } from "./tab-state";

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
    await rememberObservation(tabId, observation);
    await assessTab(tabId, observation);
  } else if (message.type === "sensitive-focus") {
    await markFocused(tabId);
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
      const observation = await recallObservation(message.tabId);
      if (observation) await assessTab(message.tabId, observation, { force: true });
      return { ok: observation !== null };
    }
    case "clear-cache":
      await clearCache();
      return { ok: true };
  }
}

ext.runtime.onMessage.addListener((message: unknown, sender: Sender, sendResponse: (r: unknown) => void) => {
  if (!isFromOwnExtension(sender) || typeof message !== "object" || message === null) return false;
  const type = (message as { type?: unknown }).type;

  if (sender.tab && (type === "observation" || type === "sensitive-focus")) {
    handleContent(message as ContentMessage, sender).catch(() => undefined);
    return false;
  }
  if (isFromExtensionPage(sender) && (type === "get-tab-status" || type === "reassess" || type === "clear-cache")) {
    handlePopup(message as PopupMessage).then(sendResponse, () => sendResponse(null));
    return true;
  }
  return false;
});

ext.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    clearTabStatus(tabId).catch(() => undefined);
    forgetObservation(tabId).catch(() => undefined);
  }
});

ext.tabs.onRemoved.addListener((tabId) => {
  clearTabStatus(tabId).catch(() => undefined);
  forgetObservation(tabId).catch(() => undefined);
});

ext.permissions.onAdded.addListener(async (permissions) => {
  await syncContentScripts();
  await injectIntoPermittedTabs(permissions.origins ?? []);
});

ext.permissions.onRemoved.addListener(() => {
  syncContentScripts().catch(() => undefined);
});

ext.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") ext.runtime.openOptionsPage().catch(() => undefined);
});

ext.runtime.onStartup.addListener(() => {
  pruneExpired(Date.now()).catch(() => undefined);
});

// Idempotent; covers install, browser start-up and background wake-ups alike.
syncContentScripts().catch(() => undefined);
