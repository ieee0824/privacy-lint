/** Options / onboarding page. */
import { ext } from "../shared/browser";
import type { PopupMessage } from "../shared/messages";
import { ALL_SITES } from "../background/permissions";
import { loadSettings, saveSettings, type Settings } from "../background/settings";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = $("status");

async function renderAccess(): Promise<void> {
  const all = await ext.permissions.contains({ origins: ALL_SITES });
  const { origins = [] } = await ext.permissions.getAll();
  const sites = origins.filter((o) => !ALL_SITES.includes(o) && o !== "<all_urls>");
  $("access-state").textContent = all
    ? "現在: すべてのサイトで有効"
    : sites.length > 0
      ? `現在: ${sites.length} サイトで有効`
      : "現在: どのサイトでも有効になっていません";
}

async function load(): Promise<void> {
  const s = await loadSettings();
  $<HTMLInputElement>("relayUrl").value = s.relayUrl;
  $<HTMLInputElement>("relayCredential").value = s.relayCredential;
  $<HTMLInputElement>("remoteEvaluation").checked = s.remoteEvaluation;
  $<HTMLInputElement>("inPageNotice").checked = s.inPageNotice;
  await renderAccess();
}

$("grant-all").addEventListener("click", () => {
  // Called directly from the click handler to satisfy the user-gesture requirement.
  ext.permissions.request({ origins: ALL_SITES }).then(renderAccess, renderAccess);
});

$("revoke-all").addEventListener("click", async () => {
  const { origins = [] } = await ext.permissions.getAll();
  if (origins.length) await ext.permissions.remove({ origins });
  await renderAccess();
});

$("save").addEventListener("click", async () => {
  const relayUrl = $<HTMLInputElement>("relayUrl").value.trim();
  try {
    const url = new URL(relayUrl);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname))) {
      throw new Error("insecure");
    }
  } catch {
    status.textContent = "Relay URL は https（または localhost の http）で指定してください。";
    return;
  }
  const settings: Settings = {
    relayUrl,
    relayCredential: $<HTMLInputElement>("relayCredential").value.trim(),
    remoteEvaluation: $<HTMLInputElement>("remoteEvaluation").checked,
    inPageNotice: $<HTMLInputElement>("inPageNotice").checked,
  };
  await saveSettings(settings);
  status.textContent = "保存しました。";
});

$("clear-cache").addEventListener("click", async () => {
  await ext.runtime.sendMessage({ type: "clear-cache" } satisfies PopupMessage);
  status.textContent = "評価キャッシュを削除しました。";
});

void load();
