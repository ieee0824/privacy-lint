import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acceptObservation, assessTab, evaluationSettingsChanged, forgetTab, reassessCurrentTab, rememberObservation, resetTab } from "../src/background/assessment";
import { DEFAULT_SETTINGS, saveSettings } from "../src/background/settings";
import { getTabStatus } from "../src/background/tab-state";
import type { PageObservation } from "../src/shared/schema";
import { goodAnswers } from "./helpers/fixtures";
import { installFakeExtension, type FakeExtension } from "./helpers/fake-extension";

const observation: PageObservation = {
  schemaVersion: 1,
  page: { origin: "https://shop.example", scheme: "https", pathClass: "checkout", headings: [] },
  form: { method: "post", actionScheme: "https", crossOriginAction: false, fieldCount: 1,
    fields: [{ kind: "email", required: true }], context: [] },
  links: { privacy: [{ url: "https://shop.example/privacy", text: "Privacy" }], operator: [] },
  resources: [], components: [],
};

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
const answer = () => new Response(JSON.stringify({ schemaVersion: 1, answers: goodAnswers() }));
const policy = () => new Response("<p>利用目的はサービス提供です。</p>", { headers: { "content-type": "text/html" } });
let fake: FakeExtension;
let tabId = 800;
beforeEach(() => { fake = installFakeExtension(); tabId++; });
afterEach(async () => { await resetTab(tabId); forgetTab(tabId); vi.unstubAllGlobals(); });

describe("assessment persistence and cancellation", () => {
  it("navigation during observation storage prevents both stale observation and evaluation (#25)", async () => {
    const started = deferred();
    const gate = deferred();
    const storage = chrome.storage.session;
    const original = storage.set;
    storage.set = (async (items: Record<string, unknown>) => {
      if (Object.hasOwn(items, `obs:${tabId}`)) { started.release(); await gate.promise; }
      return original(items);
    }) as typeof storage.set;
    const fetchImpl = vi.fn(async () => answer()) as unknown as typeof fetch;
    const running = acceptObservation(tabId, observation, {}, { fetchImpl, now: () => 1 });
    await started.promise;
    const resetting = resetTab(tabId);
    gate.release();
    await Promise.all([running, resetting]);
    expect(fake.session.has(`obs:${tabId}`)).toBe(false);
    expect(await getTabStatus(tabId)).toEqual({ kind: "idle" });
    expect(fake.badges.get(tabId)).toBe("");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reset is serialized after an already-started status write and clears its badge", async () => {
    const started = deferred();
    const gate = deferred();
    const storage = chrome.storage.session;
    const original = storage.set;
    storage.set = (async (items: Record<string, unknown>) => {
      if (Object.hasOwn(items, `tab:${tabId}`)) { started.release(); await gate.promise; }
      return original(items);
    }) as typeof storage.set;
    const fetchImpl = vi.fn(async () => answer()) as unknown as typeof fetch;
    const running = assessTab(tabId, observation, {}, { fetchImpl, now: () => 1 });
    await started.promise;
    const resetting = resetTab(tabId);
    gate.release();
    await Promise.all([running, resetting]);
    expect(await getTabStatus(tabId)).toEqual({ kind: "idle" });
    expect(fake.badges.get(tabId)).toBe("");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("disabling remote evaluation while documents load prevents a later POST, even before the change listener (#21)", async () => {
    const started = deferred();
    const gate = deferred();
    let posts = 0;
    const fetchImpl = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/v1/assess")) { posts++; return answer(); }
      started.release(); await gate.promise; return policy();
    }) as typeof fetch;
    const running = acceptObservation(tabId, observation, { focused: true }, { fetchImpl, now: () => 1 });
    await started.promise;
    await saveSettings({ ...DEFAULT_SETTINGS, remoteEvaluation: false });
    gate.release();
    await running;
    expect(posts).toBe(0);
    expect([...fake.local.keys()].filter((key) => key.startsWith("assessment:"))).toEqual([]);
    vi.stubGlobal("fetch", vi.fn(async () => answer()));
    await evaluationSettingsChanged();
    expect(await getTabStatus(tabId)).toMatchObject({ kind: "done", focused: true,
      assessment: { state: "insufficient_information" } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a focus arriving with the first observation is retained and notified", async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => String(input).endsWith("/v1/assess") ? answer() : policy()) as typeof fetch;
    await acceptObservation(tabId, { ...observation, form: { ...observation.form, actionScheme: "http" } },
      { focused: true }, { fetchImpl, now: () => 1 });
    expect(await getTabStatus(tabId)).toMatchObject({ kind: "done", focused: true });
    expect(fake.notices).toEqual([tabId]);
  });

  it("manual re-evaluation uses fresh content before the next mutation report (#27)", async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, remoteEvaluation: false });
    await rememberObservation(tabId, observation);
    const fresh = { ...observation, form: { ...observation.form, actionScheme: "http" }, resources:
      Array.from({ length: 14 }, (_, i) => ({ origin: `https://tracker${i}.test`, kind: "script" as const })) };
    chrome.tabs.sendMessage = vi.fn(async () => ({ observation: fresh, focused: true })) as typeof chrome.tabs.sendMessage;
    chrome.tabs.get = vi.fn(async () => ({ id: tabId, url: "https://shop.example/checkout" })) as unknown as typeof chrome.tabs.get;
    expect(await reassessCurrentTab(tabId)).toBe(true);
    const status = await getTabStatus(tabId);
    expect(status.kind).toBe("done");
    if (status.kind !== "done") throw new Error("no result");
    expect(status.focused).toBe(true);
    expect(status.assessment.findings).toContainEqual({ id: "third_party_scripts_many", severity: "info", count: 14 });
    expect(status.assessment.findings.map((finding) => finding.id)).toContain("insecure_form_action");
    expect(fake.session.get(`obs:${tabId}`)).toEqual(fresh);
  });

  it("an explicit fresh null clears a disappeared form instead of using its stored observation", async () => {
    await rememberObservation(tabId, observation);
    chrome.tabs.sendMessage = vi.fn(async () => ({ observation: null, focused: false })) as typeof chrome.tabs.sendMessage;
    expect(await reassessCurrentTab(tabId)).toBe(false);
    expect(fake.session.has(`obs:${tabId}`)).toBe(false);
    expect(await getTabStatus(tabId)).toEqual({ kind: "idle" });
  });

  it("navigation while requesting a fresh observation prevents stale re-evaluation", async () => {
    const gate = deferred();
    chrome.tabs.sendMessage = vi.fn(async () => {
      await gate.promise;
      return { observation, focused: true };
    }) as typeof chrome.tabs.sendMessage;
    const running = reassessCurrentTab(tabId);
    await resetTab(tabId);
    gate.release();
    expect(await running).toBe(false);
    expect(await getTabStatus(tabId)).toEqual({ kind: "idle" });
  });

  it("settings changes refresh persisted pages after background state has been suspended", async () => {
    await rememberObservation(tabId, observation);
    forgetTab(tabId);
    await saveSettings({ ...DEFAULT_SETTINGS, remoteEvaluation: false });
    vi.stubGlobal("fetch", vi.fn(async () => answer()));
    await evaluationSettingsChanged();
    expect(await getTabStatus(tabId)).toMatchObject({ kind: "done", assessment: { state: "insufficient_information" } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("settings restart retains the newest observation while its persistence is pending", async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, remoteEvaluation: false });
    await acceptObservation(tabId, observation);
    const started = deferred();
    const gate = deferred();
    let held = false;
    const storage = chrome.storage.session;
    const original = storage.set;
    storage.set = (async (items: Record<string, unknown>) => {
      if (Object.hasOwn(items, `obs:${tabId}`) && !held) { held = true; started.release(); await gate.promise; }
      return original(items);
    }) as typeof storage.set;
    const newest = { ...observation, links: { privacy: [], operator: [] },
      form: { ...observation.form, fields: [{ kind: "password" as const, required: true }] } };
    const postedKinds: string[][] = [];
    vi.stubGlobal("fetch", async (_input: unknown, init: RequestInit) => {
      postedKinds.push(JSON.parse(String(init.body)).website.form.fields.map((field: { kind: string }) => field.kind));
      return answer();
    });
    const accepting = acceptObservation(tabId, newest);
    await started.promise;
    await saveSettings({ ...DEFAULT_SETTINGS, remoteEvaluation: true });
    const changing = evaluationSettingsChanged();
    gate.release();
    await Promise.all([accepting, changing]);
    expect(postedKinds).toEqual([["password"]]);
    expect(await getTabStatus(tabId)).toMatchObject({ kind: "done", assessment: { sensitiveKinds: ["password"] } });
    expect(fake.session.get(`obs:${tabId}`)).toEqual(newest);
  });

  it("closing one suspended tab does not prevent settings refresh of another tab", async () => {
    const otherTabId = tabId + 10_000;
    await rememberObservation(tabId, observation);
    await rememberObservation(otherTabId, observation);
    forgetTab(tabId);
    forgetTab(otherTabId);
    await saveSettings({ ...DEFAULT_SETTINGS, remoteEvaluation: false });
    const started = deferred();
    const gate = deferred();
    const storage = chrome.storage.session;
    const original = storage.get;
    storage.get = (async (keys: string | string[] | null) => {
      const result = await original(keys);
      if (keys === null) { started.release(); await gate.promise; }
      return result;
    }) as typeof storage.get;
    const changing = evaluationSettingsChanged();
    await started.promise;
    await resetTab(tabId);
    forgetTab(tabId);
    gate.release();
    await changing;
    expect(await getTabStatus(tabId)).toEqual({ kind: "idle" });
    expect(await getTabStatus(otherTabId)).toMatchObject({ kind: "done", assessment: { state: "insufficient_information" } });
    await resetTab(otherTabId);
    forgetTab(otherTabId);
  });
});
