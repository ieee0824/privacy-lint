/**
 * Toolbar popup (DESIGN.md §10.3, §21). Reasons are shown; the internal score is not.
 * All text is set via textContent (DESIGN.md §33).
 */
import type { Assessment } from "../shared/assessment";
import { ext } from "../shared/browser";
import type { PopupMessage, TabStatusResponse } from "../shared/messages";
import { DISCLAIMER, FIELD_KIND_TEXT, STATUS_TEXT, findingIcon, findingText, headline } from "../risk/findings";

const root = document.getElementById("root")!;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function send<T>(message: PopupMessage): Promise<T> {
  return ext.runtime.sendMessage(message) as Promise<T>;
}

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function render(): Promise<void> {
  const tabId = await activeTabId();
  root.replaceChildren();
  if (tabId === undefined) {
    root.append(el("h2", headline("unsupported_page", 0)));
    return;
  }
  const res = await send<TabStatusResponse | null>({ type: "get-tab-status", tabId });
  if (!res || res.permission === "unsupported") {
    root.append(el("h2", headline("unsupported_page", 0)));
    return;
  }
  if (res.permission === "denied") {
    renderPermissionRequest(res.origin);
    return;
  }

  const status = res.status;
  if (status.kind === "idle") {
    root.append(
      el("h2", "個人情報の入力欄は検出されていません"),
      el("p", "入力欄が表示されると、自動で確認します。", "muted"),
    );
    return;
  }
  if (status.kind === "assessing") {
    root.append(el("h2", "確認しています…"));
    return;
  }
  renderAssessment(status.assessment, tabId);
}

function renderPermissionRequest(origin: string | undefined): void {
  root.append(
    el("h2", headline("permission_denied", 0)),
    el("p", "このサイトのページ構造を読み取る許可がありません。入力された値は許可後も読み取りません。", "muted"),
  );
  if (!origin) return;
  const actions = el("div", undefined, "actions");
  const enable = el("button", "このサイトで有効化", "primary");
  enable.addEventListener("click", () => {
    // Must run synchronously inside the click handler (user-gesture requirement in Firefox).
    ext.permissions.request({ origins: [`${origin}/*`] }).then((granted) => {
      if (granted) setTimeout(() => void render(), 800);
    });
  });
  actions.append(enable);
  root.append(actions);
}

function renderAssessment(a: Assessment, tabId: number): void {
  root.append(el("h2", headline(a.state, a.level)));
  const bar = el("div", undefined, "level-bar");
  bar.dataset.level = String(a.level);
  bar.setAttribute("aria-hidden", "true");
  root.append(bar);

  if (a.findings.length > 0) {
    root.append(el("h3", "確認できた事項"));
    const list = el("ul", undefined, "findings");
    for (const finding of a.findings) {
      const li = el("li", undefined, finding.severity);
      li.append(el("span", findingIcon(finding), "icon"), el("span", findingText(finding)));
      list.append(li);
    }
    root.append(list);
  }

  root.append(el("h3", "観測結果"));
  const dl = el("dl", undefined, "statuses");
  dl.append(
    el("dt", "運営会社情報"),
    el("dd", STATUS_TEXT.operator[a.statuses.operator]),
    el("dt", "プライバシーポリシー"),
    el("dd", STATUS_TEXT.privacyPolicy[a.statuses.privacyPolicy]),
    el("dt", "フォーム送信先"),
    el("dd", STATUS_TEXT.formAction[a.statuses.formAction]),
    el("dt", "求められる情報"),
    el("dd", a.sensitiveKinds.map((k) => FIELD_KIND_TEXT[k]).join("、") || "—"),
  );
  root.append(dl);

  const actions = el("div", undefined, "actions");
  const again = el("button", "再評価");
  again.addEventListener("click", async () => {
    again.disabled = true;
    await send({ type: "reassess", tabId });
    await render();
  });
  actions.append(again);
  root.append(actions);

  root.append(el("p", DISCLAIMER, "small muted disclaimer"));
}

document.getElementById("open-options")!.addEventListener("click", (event) => {
  event.preventDefault();
  void ext.runtime.openOptionsPage();
});

void render();
