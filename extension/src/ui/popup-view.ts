import type { PopupMessage, TabStatusResponse } from "../shared/messages";
import { tabStatusKey } from "../background/tab-state";
import { popupModel, type AssessmentModel, type PopupModel } from "./popup-model";

interface Actions {
  grant(origin: string): void;
  reassess(): Promise<void>;
}

function element<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function appendFindings(doc: Document, root: HTMLElement, findings: AssessmentModel["findings"]): void {
  if (findings.length === 0) return;
  const list = element(doc, "ul", undefined, "findings");
  for (const finding of findings) {
    const item = element(doc, "li", undefined, finding.severity);
    item.append(element(doc, "span", finding.icon, "icon"), element(doc, "span", finding.text));
    list.append(item);
  }
  root.append(element(doc, "h3", "確認できた事項"), list);
}

function appendStatuses(doc: Document, root: HTMLElement, statuses: AssessmentModel["statuses"]): void {
  const list = element(doc, "dl", undefined, "statuses");
  for (const status of statuses) list.append(element(doc, "dt", status.label), element(doc, "dd", status.text));
  root.append(element(doc, "h3", "観測結果"), list);
}

function appendReassess(doc: Document, root: HTMLElement, actions: Actions): void {
  const container = element(doc, "div", undefined, "actions");
  const button = element(doc, "button", "再評価");
  button.addEventListener("click", async () => {
    button.disabled = true;
    await actions.reassess();
  });
  container.append(button);
  root.append(container);
}

function appendAssessment(doc: Document, root: HTMLElement, model: AssessmentModel, actions: Actions): void {
  const bar = element(doc, "div", undefined, "level-bar");
  bar.dataset.level = String(model.level);
  bar.setAttribute("aria-hidden", "true");
  root.append(bar);
  appendFindings(doc, root, model.findings);
  appendStatuses(doc, root, model.statuses);
  appendReassess(doc, root, actions);
  root.append(element(doc, "p", model.disclaimer, "small muted disclaimer"));
}

function drawPopup(doc: Document, model: PopupModel, actions: Actions): void {
  const root = doc.getElementById("root")!;
  root.replaceChildren(element(doc, "h2", model.title));
  if (model.kind === "assessment") return appendAssessment(doc, root, model, actions);
  if (model.description) root.append(element(doc, "p", model.description, "muted"));
  if (model.kind !== "permission" || !model.origin) return;
  const origin = model.origin;
  const container = element(doc, "div", undefined, "actions");
  const button = element(doc, "button", "このサイトで有効化", "primary");
  button.addEventListener("click", () => actions.grant(origin));
  container.append(button);
  root.append(container);
}

interface PopupSession {
  tabId?: number;
  revision: number;
  disposed: boolean;
}

async function refreshPopup(doc: Document, api: typeof chrome, state: PopupSession, actions: Actions): Promise<void> {
  if (state.disposed) return;
  const revision = ++state.revision;
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (state.disposed || revision !== state.revision) return;
  state.tabId = tab?.id;
  const response = state.tabId === undefined ? null : await api.runtime.sendMessage({
    type: "get-tab-status", tabId: state.tabId,
  } satisfies PopupMessage).catch(() => null) as TabStatusResponse | null;
  if (state.disposed || revision !== state.revision) return;
  drawPopup(doc, popupModel(response), actions);
}

function popupActions(api: typeof chrome, state: PopupSession, refresh: () => Promise<void>): Actions {
  return {
    grant(origin) {
      // Keep the permission request directly in the click handler's user gesture.
      api.permissions.request({ origins: [`${origin}/*`] }).then((granted) => {
        if (granted) void refresh();
      });
    },
    async reassess() {
      if (state.tabId === undefined) return;
      await api.runtime.sendMessage({ type: "reassess", tabId: state.tabId } satisfies PopupMessage).catch(() => null);
      await refresh();
    },
  };
}

function subscribePopup(api: typeof chrome, state: PopupSession, refresh: () => Promise<void>): () => void {
  const onStorage = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === "session" && state.tabId !== undefined && Object.hasOwn(changes, tabStatusKey(state.tabId))) void refresh();
  };
  const onPermission = () => void refresh();
  const onActivated = () => void refresh();
  const onUpdated = (tabId: number) => { if (tabId === state.tabId) void refresh(); };
  api.storage.onChanged.addListener(onStorage);
  api.permissions.onAdded.addListener(onPermission);
  api.permissions.onRemoved.addListener(onPermission);
  api.tabs.onActivated.addListener(onActivated);
  api.tabs.onUpdated.addListener(onUpdated);
  return () => {
    api.storage.onChanged.removeListener(onStorage);
    api.permissions.onAdded.removeListener(onPermission);
    api.permissions.onRemoved.removeListener(onPermission);
    api.tabs.onActivated.removeListener(onActivated);
    api.tabs.onUpdated.removeListener(onUpdated);
  };
}

export function mountPopup(doc: Document, api: typeof chrome): () => void {
  const state: PopupSession = { revision: 0, disposed: false };
  const refresh = () => refreshPopup(doc, api, state, actions);
  const actions = popupActions(api, state, refresh);
  const unsubscribe = subscribePopup(api, state, refresh);
  const openOptions = (event: Event) => { event.preventDefault(); void api.runtime.openOptionsPage(); };
  const link = doc.getElementById("open-options")!;
  link.addEventListener("click", openOptions);
  const dispose = () => {
    state.disposed = true;
    unsubscribe();
    link.removeEventListener("click", openOptions);
    doc.defaultView?.removeEventListener("pagehide", dispose);
  };
  doc.defaultView?.addEventListener("pagehide", dispose, { once: true });
  void refresh();
  return dispose;
}
