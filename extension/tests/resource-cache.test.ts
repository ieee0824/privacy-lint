import { describe, expect, it } from "vitest";
import { assessTab, evaluate } from "../src/background/assessment";
import { DEFAULT_SETTINGS, saveSettings } from "../src/background/settings";
import { getTabStatus } from "../src/background/tab-state";
import type { PageObservation } from "../src/shared/schema";
import { installFakeExtension } from "./helpers/fake-extension";
import { goodAnswers } from "./helpers/fixtures";

describe("resource counts in the assessment cache (#27)", () => {
  it("matches fresh assessment after resources change and reuses equivalent summaries", async () => {
    installFakeExtension();
    const settings = { ...DEFAULT_SETTINGS, remoteEvaluation: true };
    await saveSettings(settings);
    let requests = 0;
    const fetchImpl: typeof fetch = async () => {
      requests++;
      return new Response(JSON.stringify({ schemaVersion: 1, answers: goodAnswers() }), {
        headers: { "content-type": "application/json" },
      });
    };
    const deps = { fetchImpl, now: () => 50 };
    const first: PageObservation = {
      schemaVersion: 1,
      page: { origin: "https://shop.example", scheme: "https", pathClass: "signup", headings: [] },
      form: { method: "post", actionScheme: "https", crossOriginAction: false, fieldCount: 1,
        fields: [{ kind: "email", required: true }], context: [] },
      links: { privacy: [], operator: [] }, resources: [], components: [],
    };
    const second: PageObservation = { ...first, resources: Array.from({ length: 14 }, (_, i) => ({
      origin: `https://tracker${i}.example`, kind: "script",
    })) };
    await assessTab(9127, first, {}, deps);
    await assessTab(9127, second, {}, deps);
    expect(requests).toBe(2);
    const status = await getTabStatus(9127);
    if (status.kind !== "done") throw Error("assessment missing");
    expect(status.assessment.findings).toContainEqual({ id: "third_party_scripts_many", severity: "info", count: 14 });
    await assessTab(9127, { ...second, resources: [...second.resources].reverse() }, {}, deps);
    expect(requests).toBe(2);
    expect(status.assessment).toEqual(await evaluate(second, settings, deps));
  });
});
