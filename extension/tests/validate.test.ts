import { describe, expect, it } from "vitest";
import { validateAssessRequest, validateAssessResponse, validatePageObservation } from "../src/shared/validate";
import { request } from "./helpers/fixtures";

const observation = () => ({
  schemaVersion: 1,
  page: { origin: "https://a.example", scheme: "https", pathClass: "other", headings: [] },
  form: { method: "post", actionScheme: "https", crossOriginAction: false, fieldCount: 1, fields: [{ kind: "email", required: false }], context: [] },
  links: { privacy: [{ url: "https://a.example/privacy", text: "Privacy" }], operator: [] },
  resources: [{ origin: "https://cdn.example", kind: "script" }],
  components: [{ id: "jquery", version: "1.8.3" }],
});

describe("validatePageObservation", () => {
  it("accepts a well-formed observation", () => {
    expect(() => validatePageObservation(observation())).not.toThrow();
  });

  it("rejects unexpected keys (e.g. a smuggled value)", () => {
    const o = observation() as Record<string, any>;
    o.form.fields[0].value = "taro@example.com";
    expect(() => validatePageObservation(o)).toThrow(/unexpected key value/);
  });

  it("rejects unknown components and non-numeric versions", () => {
    const a = observation() as Record<string, any>;
    a.components[0].id = "react";
    expect(() => validatePageObservation(a)).toThrow();
    const b = observation() as Record<string, any>;
    b.components[0].version = "https://cdn.example/jquery-1.8.3.js";
    expect(() => validatePageObservation(b)).toThrow();
  });

  it("rejects URLs with query strings", () => {
    const o = observation();
    o.links.privacy[0]!.url = "https://a.example/privacy?token=abc";
    expect(() => validatePageObservation(o)).toThrow();
  });

  it("rejects non-origin resources and oversized text", () => {
    const o = observation();
    o.resources[0]!.origin = "https://cdn.example/lib.js";
    expect(() => validatePageObservation(o)).toThrow();
    const p = observation() as Record<string, any>;
    p.page.title = "x".repeat(500);
    expect(() => validatePageObservation(p)).toThrow(/too long/);
  });
});

describe("validateAssessRequest", () => {
  it("accepts the fixture request", () => {
    expect(validateAssessRequest(request())).toEqual(request());
  });
});

describe("validateAssessResponse", () => {
  it("accepts typed answers and ignores the model field", () => {
    const res = validateAssessResponse({
      schemaVersion: 1,
      model: "jev-1.13.0",
      answers: { operator_identifiable: { type: "noul", noul: 0.9 } },
    });
    expect(res.answers.operator_identifiable).toEqual({ type: "noul", noul: 0.9 });
  });

  it("rejects out-of-range probabilities and unknown question ids", () => {
    expect(() => validateAssessResponse({ schemaVersion: 1, answers: { operator_identifiable: { type: "noul", noul: 2 } } })).toThrow();
    expect(() => validateAssessResponse({ schemaVersion: 1, answers: { is_safe: { type: "noul", noul: 1 } } })).toThrow();
  });
});
