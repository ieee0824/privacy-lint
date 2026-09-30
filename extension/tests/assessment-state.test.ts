import { describe, expect, it } from "vitest";
import { initialEvaluationState, transitionEvaluation } from "../src/background/assessment-state";
import { assembleRequest } from "../src/background/assessment";
import type { Assessment } from "../src/shared/assessment";
import type { PageObservation } from "../src/shared/schema";

const assessment: Assessment = {
  state: "evaluated", level: 0, findings: [], assessedAt: 1, sensitiveKinds: ["email"],
  statuses: { operator: "confirmed", privacyPolicy: "found", formAction: "same_origin" },
};
const observation: PageObservation = {
  schemaVersion: 1,
  page: { origin: "https://shop.example", scheme: "https", pathClass: "checkout", headings: ["購入"] },
  form: { method: "post", actionScheme: "https", actionOrigin: "https://shop.example", crossOriginAction: false,
    fieldCount: 1, fields: [{ kind: "email", required: true }], context: ["注文"] },
  links: { privacy: [], operator: [] }, resources: [], components: [],
};

describe("explicit evaluation transitions", () => {
  it("start, focus, cache and reset are deterministic and do not mutate the input", () => {
    const initial = Object.freeze(initialEvaluationState());
    const event = { type: "start", focused: false } as const;
    const first = transitionEvaluation(initial, event);
    expect(first).toEqual(transitionEvaluation(initial, event));
    expect(initial.status).toEqual({ kind: "idle" });
    const focused = transitionEvaluation(first.state, { type: "focus" });
    expect(first.state.status).toEqual({ kind: "assessing", focused: false });
    const cached = transitionEvaluation(focused.state, { type: "cached", run: first.state.run, assessment });
    expect(cached.operations).toEqual(["publish", "notify"]);
    expect(cached.state.status).toEqual({ kind: "done", focused: true, assessment });
    const reset = transitionEvaluation(cached.state, { type: "reset" });
    const oldResult = { type: "result", run: first.state.run, assessment } as const;
    expect(transitionEvaluation(reset.state, oldResult).operations).toEqual([]);
    const newer = transitionEvaluation(reset.state, event);
    expect(transitionEvaluation(newer.state, oldResult).operations).toEqual([]);
    const changed = transitionEvaluation(newer.state, { type: "settings-changed" });
    expect(changed.state.status).toEqual({ kind: "idle" });
    expect(transitionEvaluation(changed.state, { type: "result", run: newer.state.run, assessment }).operations).toEqual([]);
  });

  it("assembles requests without I/O or mutable aliases to inputs", () => {
    const doc = { state: { found: true, fetched: true, title: "Policy", excerpts: ["目的"] }, components: [] };
    const original = structuredClone({ observation, doc });
    const first = assembleRequest(observation, doc, doc);
    expect(first).toEqual(assembleRequest(observation, doc, doc));
    first.request.website.form.fields[0]!.required = false;
    first.request.website.privacyPolicy.excerpts.push("changed");
    first.request.website.page.headings.push("changed");
    expect({ observation, doc }).toEqual(original);
    expect(assembleRequest(observation, doc, doc).request.website.form.fields[0]!.required).toBe(true);
  });
});
