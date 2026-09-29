/**
 * #15 / #16: cached results are keyed by every evaluation input, including settings.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { assessTab } from "../src/background/assessment";
import { evaluationFingerprint, saveSettings, DEFAULT_SETTINGS } from "../src/background/settings";
import type { PageObservation } from "../src/shared/schema";
import { goodAnswers } from "./helpers/fixtures";
import { installFakeExtension } from "./helpers/fake-extension";

const observation = (headings = ["購入"]): PageObservation => ({
  schemaVersion: 1,
  page: { origin: "https://shop.example", scheme: "https", pathClass: "checkout", headings },
  form: {
    method: "post",
    actionScheme: "https",
    crossOriginAction: false,
    fieldCount: 1,
    fields: [{ kind: "email", required: true }],
    context: [],
  },
  links: { privacy: [], operator: [] },
  resources: [],
  components: [],
});

function relay() {
  const urls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/v1/assess")) {
      urls.push(new URL(url).origin);
      return new Response(JSON.stringify({ schemaVersion: 1, answers: goodAnswers() }), {
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, urls };
}

let tabId = 500;
beforeEach(() => {
  installFakeExtension();
  tabId++;
});

describe("cache key includes result-affecting settings (#15)", () => {
  it("enabling remote evaluation does not reuse the result computed without it", async () => {
    const r = relay();
    await saveSettings({ ...DEFAULT_SETTINGS, remoteEvaluation: false });
    await assessTab(tabId, observation(), {}, { fetchImpl: r.fetchImpl, now: () => 1 });
    expect(r.urls).toEqual([]);

    await saveSettings({ ...DEFAULT_SETTINGS, remoteEvaluation: true });
    await assessTab(tabId, observation(), {}, { fetchImpl: r.fetchImpl, now: () => 2 });
    expect(r.urls).toHaveLength(1);
  });

  it("changing the relay does not reuse the previous relay's result", async () => {
    const r = relay();
    await saveSettings({ ...DEFAULT_SETTINGS, relayUrl: "https://relay-a.example" });
    await assessTab(tabId, observation(), {}, { fetchImpl: r.fetchImpl, now: () => 1 });
    await saveSettings({ ...DEFAULT_SETTINGS, relayUrl: "https://relay-b.example" });
    await assessTab(tabId, observation(), {}, { fetchImpl: r.fetchImpl, now: () => 2 });
    expect(r.urls).toEqual(["https://relay-a.example", "https://relay-b.example"]);
  });

  it("unchanged settings and inputs still hit the cache", async () => {
    const r = relay();
    await saveSettings({ ...DEFAULT_SETTINGS });
    await assessTab(tabId, observation(), {}, { fetchImpl: r.fetchImpl, now: () => 1 });
    await saveSettings({ ...DEFAULT_SETTINGS, inPageNotice: false });
    await assessTab(tabId, observation(), {}, { fetchImpl: r.fetchImpl, now: () => 2 });
    expect(r.urls).toHaveLength(1);
  });

  it("fingerprint ignores display-only settings and the relay while remote evaluation is off", () => {
    expect(evaluationFingerprint({ inPageNotice: false })).toBe(evaluationFingerprint({}));
    expect(evaluationFingerprint({ remoteEvaluation: false, relayUrl: "https://x.example" })).toBe(
      evaluationFingerprint({ remoteEvaluation: false }),
    );
    expect(evaluationFingerprint({ relayCredential: "abc" })).not.toBe(evaluationFingerprint({}));
  });
});

describe("cache key includes page inputs (#16)", () => {
  it("another page on the same origin with a different purpose is evaluated anew", async () => {
    const r = relay();
    await saveSettings({ ...DEFAULT_SETTINGS });
    await assessTab(tabId, observation(["購入"]), {}, { fetchImpl: r.fetchImpl, now: () => 1 });
    await assessTab(tabId, observation(["メルマガ登録"]), {}, { fetchImpl: r.fetchImpl, now: () => 2 });
    expect(r.urls).toHaveLength(2);
  });
});
