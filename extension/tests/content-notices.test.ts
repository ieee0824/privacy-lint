// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { ContentMessage, ContentNotice, ContentRequest, FreshObservationResponse } from "../src/shared/messages";

type Listener = (message: ContentNotice | ContentRequest, sender: { id: string }, respond: (value: unknown) => void) => unknown;
const observers: MutationObserver[] = [];
const NativeObserver = MutationObserver;
afterEach(() => {
  observers.forEach(observer => observer.disconnect());
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("rejects old notices after identical form replacement before debounce and reports the new lifecycle", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("performance", { getEntriesByType: () => [] });
  vi.stubGlobal("PerformanceObserver", undefined);
  vi.stubGlobal("MutationObserver", class extends NativeObserver {
    constructor(callback: MutationCallback) { super(callback); observers.push(this); }
  });
  document.body.innerHTML = '<form><input type="email"></form>';
  let listener: Listener | undefined;
  const sendMessage = vi.fn<(message: ContentMessage) => Promise<void>>().mockResolvedValue(undefined);
  const api = (globalThis as unknown as { chrome: Record<string, unknown> }).chrome;
  Object.assign(api, { runtime: { id: "test-extension", sendMessage,
    onMessage: { addListener: (callback: Listener) => { listener = callback; } } } });
  (globalThis as unknown as Record<symbol, boolean>)[Symbol.for("privacy-lint.content-loaded")] = false;
  await import("../src/content/index");
  if (!listener) throw Error("missing content message listener");
  const assessment = { state: "evaluated" as const, level: 2 as const, findings: [],
    statuses: { operator: "confirmed" as const, privacyPolicy: "found" as const, formAction: "same_origin" as const },
    sensitiveKinds: ["email" as const], assessedAt: 0 };
  const initial = sendMessage.mock.calls[0]![0];
  if (initial.type !== "observation") throw Error("missing initial observation");
  listener({ type: "show-notice", assessment, signature: initial.noticeKey }, { id: "test-extension" }, () => {});
  expect(document.getElementById("privacy-lint-notice-host")).not.toBeNull();

  document.body.innerHTML = '<form><input type="email"></form>';
  // Mutation records are classified, but their 400ms report has not run.
  await Promise.resolve();
  listener({ type: "show-notice", assessment, signature: initial.noticeKey }, { id: "test-extension" }, () => {});
  expect(document.getElementById("privacy-lint-notice-host")).toBeNull();
  const current = sendMessage.mock.calls.at(-1)![0];
  if (current.type !== "observation") throw Error("missing replacement observation");
  expect(current.observation).toEqual(initial.observation);
  expect(current.noticeKey).not.toBe(initial.noticeKey);
  expect(current.focused).toBe(false);

  let fresh: FreshObservationResponse | undefined;
  listener({ type: "refresh-observation" }, { id: "test-extension" }, response => { fresh = response as FreshObservationResponse; });
  expect(fresh?.noticeKey).toBe(current.noticeKey);
  listener({ type: "show-notice", assessment, signature: current.noticeKey }, { id: "test-extension" }, () => {});
  expect(document.getElementById("privacy-lint-notice-host")).not.toBeNull();
});
