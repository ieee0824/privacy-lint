// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { best } from "../src/content/document-links";
import { compose, sortFindings, type ComposeInput } from "../src/risk/composer";
import type { Finding } from "../src/shared/assessment";
import { validateAssessRequest, validatePageObservation } from "../src/shared/validate";
import { goodAnswers, request } from "./helpers/fixtures";

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

describe("immutable refactoring inputs", () => {
  it("link and finding sorts accept frozen arrays, keep stable ties and do not change order", () => {
    const links = freeze([
      { url: "https://a.example/low", text: "low", weight: 1 },
      { url: "https://a.example/high", text: "first", weight: 10 },
      { url: "https://a.example/tie", text: "second", weight: 10 },
      { url: "https://a.example/high", text: "duplicate", weight: 2 },
    ]);
    const original = structuredClone(links);
    expect(best(links)).toEqual([
      { url: "https://a.example/high", text: "first" }, { url: "https://a.example/tie", text: "second" },
      { url: "https://a.example/low", text: "low" },
    ]);
    expect(links).toEqual(original);
    const findings: Finding[] = freeze([
      { id: "unknown_operator", severity: "info" }, { id: "insecure_page", severity: "warn" },
      { id: "insecure_form_action", severity: "warn" }, { id: "maintenance_signals", severity: "info" },
    ]);
    expect(sortFindings(findings).map((f) => f.id)).toEqual([
      "insecure_page", "insecure_form_action", "unknown_operator", "maintenance_signals",
    ]);
    expect(findings[0]!.id).toBe("unknown_operator");
  });

  it("compose is deterministic on deeply frozen inputs and owns returned sensitive kinds", () => {
    const input: ComposeInput = freeze({ request: request(), actionRelation: "same_origin", actionScheme: "https",
      sensitiveKinds: ["email"], components: [], remote: { kind: "answered", answers: goodAnswers() }, now: 1 });
    const original = structuredClone(input);
    const result = compose(input);
    expect(result).toEqual(compose(input));
    result.sensitiveKinds.push("password");
    expect(input).toEqual(original);
    expect(compose(input).sensitiveKinds).toEqual(["email"]);
  });

  it("validators preserve error paths and produce fresh structures without changing input", () => {
    const input = freeze(request());
    expect(validateAssessRequest(input)).toEqual(validateAssessRequest(input));
    const result = validateAssessRequest(input);
    result.website.form.fields[0]!.label = "changed";
    expect(input.website.form.fields[0]!.label).toBe("氏名");
    const observation = freeze({ schemaVersion: 1, page: input.website.page,
      form: { method: "post", actionScheme: "https", crossOriginAction: false, fieldCount: 1,
        fields: [{ kind: "email", required: false }], context: [] },
      links: { privacy: [], operator: [] }, resources: [], components: [] });
    const validated = validatePageObservation(observation);
    validated.page.headings.push("changed");
    expect(observation.page.headings).toEqual(["購入手続き"]);
    expect(() => validatePageObservation({ ...observation, form: { ...observation.form, fieldCount: -1 } }))
      .toThrow("form.fieldCount: expected bounded integer");
    expect(() => validateAssessRequest({ ...input, website: { ...input.website,
      form: { ...input.website.form, crossSiteAction: "false" } } }))
      .toThrow("website.form.crossSiteAction: expected boolean");
  });
});
