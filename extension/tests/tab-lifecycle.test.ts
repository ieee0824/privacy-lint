/**
 * #14: results of an old page must never be written back after navigation or form removal.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { assessTab, rememberObservation, resetTab } from "../src/background/assessment";
import { getTabStatus } from "../src/background/tab-state";
import type { PageObservation } from "../src/shared/schema";
import { goodAnswers } from "./helpers/fixtures";
import { installFakeExtension, type FakeExtension } from "./helpers/fake-extension";

const observation: PageObservation = {
  schemaVersion: 1,
  page: { origin: "https://shop.example", scheme: "https", pathClass: "checkout", headings: ["購入"] },
  form: {
    method: "post",
    actionScheme: "https",
    crossOriginAction: false,
    fieldCount: 2,
    fields: [
      { kind: "name", required: true },
      { kind: "email", required: true },
    ],
    context: [],
  },
  links: { privacy: [], operator: [] },
  resources: [],
  components: [],
};

/** Relay responses are held until released, to simulate a slow evaluation. */
function slowRelay() {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let calls = 0;
  const fetchImpl = (async (input: RequestInfo | URL) => {
    if (String(input).endsWith("/v1/assess")) {
      calls++;
      await gate;
      return new Response(JSON.stringify({ schemaVersion: 1, answers: goodAnswers() }), {
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, release, calls: () => calls };
}

async function until(fn: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("condition not reached");
}

let fake: FakeExtension;
let tabId = 100;

beforeEach(() => {
  fake = installFakeExtension();
  tabId++;
});

describe("stale assessments (#14)", () => {
  it("a result that finishes after navigation is discarded", async () => {
    const relay = slowRelay();
    const running = assessTab(tabId, observation, {}, { fetchImpl: relay.fetchImpl, now: () => 1 });
    await until(async () => (await getTabStatus(tabId)).kind === "assessing" && relay.calls() === 1);

    await resetTab(tabId); // tabs.onUpdated(status: "loading")
    relay.release();
    await running;

    expect(await getTabStatus(tabId)).toEqual({ kind: "idle" });
    expect(fake.badges.get(tabId)).toBe("");
    // The stale result is not cached either, so it cannot resurface later.
    expect(Array.from(fake.local.keys()).filter((k) => k.startsWith("assessment:"))).toEqual([]);
  });

  it("a newer assessment of the same tab still completes", async () => {
    const relay = slowRelay();
    relay.release();
    await assessTab(tabId, observation, {}, { fetchImpl: relay.fetchImpl, now: () => 1 });
    const status = await getTabStatus(tabId);
    expect(status.kind).toBe("done");
  });

  it("resetTab clears a finished result, its observation and the badge (form removed)", async () => {
    const relay = slowRelay();
    relay.release();
    await rememberObservation(tabId, observation);
    await assessTab(tabId, observation, {}, { fetchImpl: relay.fetchImpl, now: () => 1 });
    expect((await getTabStatus(tabId)).kind).toBe("done");

    await resetTab(tabId); // content script sent "form-gone"
    expect(await getTabStatus(tabId)).toEqual({ kind: "idle" });
    expect(fake.session.has(`obs:${tabId}`)).toBe(false);
    expect(fake.badges.get(tabId)).toBe("");
  });
});
