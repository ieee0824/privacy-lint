// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Assessment } from "../src/shared/assessment";
import type { PopupMessage, TabStatusResponse } from "../src/shared/messages";
import { mountPopup } from "../src/ui/popup-view";

function event<Args extends unknown[]>() {
  const listeners = new Set<(...args: Args) => void>();
  return {
    addListener: (listener: (...args: Args) => void) => { listeners.add(listener); },
    removeListener: (listener: (...args: Args) => void) => { listeners.delete(listener); },
    emit: (...args: Args) => { for (const listener of listeners) listener(...args); },
    size: () => listeners.size,
  };
}

const assessment: Assessment = {
  state: "evaluated", level: 2, assessedAt: 1000, findings: [{ id: "insecure_page", severity: "warn" }],
  statuses: { operator: "confirmed", privacyPolicy: "found", formAction: "same_origin" }, sensitiveKinds: ["email"],
};

function browserFake() {
  let response: TabStatusResponse = { permission: "granted", status: { kind: "assessing", focused: false } };
  let active = 11;
  const storage = event<[Record<string, chrome.storage.StorageChange>, string]>();
  const added = event<[]>();
  const removed = event<[]>();
  const activated = event<[]>();
  const updated = event<[number]>();
  const api = {
    tabs: { query: vi.fn(async () => [{ id: active }]), onActivated: activated, onUpdated: updated },
    runtime: {
      sendMessage: vi.fn(async (message: PopupMessage) => message.type === "get-tab-status" ? structuredClone(response) : { ok: true }),
      openOptionsPage: vi.fn(async () => {}),
    },
    storage: { onChanged: storage },
    permissions: { onAdded: added, onRemoved: removed, request: vi.fn(async () => { response.permission = "granted"; added.emit(); return true; }) },
  };
  return { api, storage, added, removed, activated, updated, setResponse: (next: TabStatusResponse) => { response = next; }, setActive: (id: number) => { active = id; } };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

let dispose: (() => void) | undefined;
beforeEach(() => { document.body.innerHTML = '<main id="root"></main><a id="open-options">設定</a>'; vi.useFakeTimers(); });
afterEach(() => { dispose?.(); dispose = undefined; vi.useRealTimers(); });

describe("live popup state (#28)", () => {
  it("updates assessing → done and form removal, while ignoring another tab", async () => {
    const fake = browserFake();
    dispose = mountPopup(document, fake.api as unknown as typeof chrome);
    await flush();
    expect(document.querySelector("h2")!.textContent).toBe("確認しています…");
    const requests = fake.api.runtime.sendMessage.mock.calls.length;
    fake.storage.emit({ "tab:12": { newValue: { kind: "done" } } }, "session");
    await flush();
    expect(fake.api.runtime.sendMessage.mock.calls.length).toBe(requests);
    fake.setResponse({ permission: "granted", status: { kind: "done", focused: false, assessment } });
    fake.storage.emit({ "tab:11": { newValue: { kind: "done" } } }, "session");
    await flush();
    expect(document.querySelector("h2")!.textContent).toBe("入力前に確認をおすすめします");
    expect(document.querySelector(".level-bar")!.getAttribute("data-level")).toBe("2");
    fake.setResponse({ permission: "granted", status: { kind: "idle" } });
    fake.storage.emit({ "tab:11": { oldValue: { kind: "done" } } }, "session");
    await flush();
    expect(document.querySelector("h2")!.textContent).toBe("個人情報の入力欄は検出されていません");
  });

  it("updates a slow assessment after granting access and handles permission removal", async () => {
    const fake = browserFake();
    fake.setResponse({ permission: "denied", origin: "https://example.com", status: { kind: "idle" } });
    dispose = mountPopup(document, fake.api as unknown as typeof chrome);
    await flush();
    document.querySelector("button")!.click();
    await flush();
    expect(fake.api.permissions.request).toHaveBeenCalledWith({ origins: ["https://example.com/*"] });
    fake.setResponse({ permission: "granted", status: { kind: "assessing", focused: false } });
    fake.storage.emit({ "tab:11": { newValue: { kind: "assessing" } } }, "session");
    await flush();
    await vi.advanceTimersByTimeAsync(1500);
    expect(document.querySelector("h2")!.textContent).toBe("確認しています…");
    fake.setResponse({ permission: "granted", status: { kind: "done", focused: false, assessment } });
    fake.storage.emit({ "tab:11": { newValue: { kind: "done" } } }, "session");
    await flush();
    expect(document.querySelector("h2")!.textContent).toBe("入力前に確認をおすすめします");
    fake.setResponse({ permission: "denied", origin: "https://example.com", status: { kind: "idle" } });
    fake.removed.emit();
    await flush();
    expect(document.querySelector("button")!.textContent).toBe("このサイトで有効化");
  });

  it("discards older pending responses and unsubscribes when the popup closes", async () => {
    const fake = browserFake();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    fake.api.runtime.sendMessage.mockImplementationOnce(async () => {
      await gate;
      return { permission: "granted", status: { kind: "assessing", focused: false } };
    });
    dispose = mountPopup(document, fake.api as unknown as typeof chrome);
    await flush();
    fake.setResponse({ permission: "granted", status: { kind: "done", focused: false, assessment } });
    fake.storage.emit({ "tab:11": { newValue: { kind: "done" } } }, "session");
    await flush();
    release();
    await flush();
    expect(document.querySelector("h2")!.textContent).toBe("入力前に確認をおすすめします");
    const requests = fake.api.runtime.sendMessage.mock.calls.length;
    window.dispatchEvent(new Event("pagehide"));
    expect([fake.storage, fake.added, fake.removed, fake.activated, fake.updated].map((port) => port.size())).toEqual([0, 0, 0, 0, 0]);
    fake.storage.emit({ "tab:11": { newValue: { kind: "done" } } }, "session");
    await flush();
    expect(fake.api.runtime.sendMessage.mock.calls.length).toBe(requests);
  });
});
