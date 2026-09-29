import { describe, expect, it } from "vitest";
import { compose, levelFor, type ComposeInput } from "../src/risk/composer";
import { WarningLevel } from "../src/shared/assessment";
import { decidedNoul, confidentScore } from "../src/risk/features";
import { goodAnswers, noul, request, score } from "./helpers/fixtures";

function input(partial: Partial<ComposeInput> = {}): ComposeInput {
  return {
    request: request(),
    actionRelation: "same_origin",
    actionScheme: "https",
    sensitiveKinds: ["address", "email", "name"],
    remote: { kind: "answered", answers: goodAnswers() },
    now: 1000,
    ...partial,
  };
}

const ids = (a: ReturnType<typeof compose>) => a.findings.map((f) => f.id);

describe("confidence gating (§19)", () => {
  it("treats undecided noul answers as unknown", () => {
    expect(decidedNoul(noul(0.5))).toBeNull();
    expect(decidedNoul(noul(0.7))).toBeNull();
    expect(decidedNoul(noul(0.8))).toBe(0.8);
    expect(decidedNoul(noul(0.1))).toBe(0.1);
    expect(decidedNoul(undefined)).toBeNull();
  });

  it("treats low-confidence scores as unknown", () => {
    expect(confidentScore(score(3, 0.3), 4)).toBeNull();
    expect(confidentScore(score(3, 0.8), 4)).toBe(1);
  });
});

describe("compose", () => {
  it("clear good case → NORMAL, evaluated, no warnings", () => {
    const a = compose(input());
    expect(a.state).toBe("evaluated");
    expect(a.level).toBe(WarningLevel.NORMAL);
    expect(a.findings.filter((f) => f.severity === "warn")).toEqual([]);
    expect(a.statuses).toEqual({ operator: "confirmed", privacyPolicy: "found", formAction: "same_origin" });
  });

  it("missing privacy policy with a cross-site form provider → at least CAUTION (fixture B)", () => {
    const a = compose(
      input({
        request: request({ policy: { found: false, fetched: false, excerpts: [] } }),
        actionRelation: "cross_site",
      }),
    );
    expect(a.level).toBeGreaterThanOrEqual(WarningLevel.CAUTION);
    expect(ids(a)).toEqual(expect.arrayContaining(["privacy_policy_not_found", "cross_site_form_action"]));
  });

  it("excessive data request → CAUTION floor (fixture C)", () => {
    const a = compose(input({ remote: { kind: "answered", answers: { ...goodAnswers(), data_minimization: score(2.6) } } }));
    expect(a.level).toBeGreaterThanOrEqual(WarningLevel.CAUTION);
    expect(ids(a)).toContain("data_minimization_concern");
  });

  it("policy that ignores the form → finding (fixture E)", () => {
    const answers = { ...goodAnswers(), policy_covers_form_fields: noul(0.05), policy_describes_purpose: noul(0.1) };
    const a = compose(input({ remote: { kind: "answered", answers } }));
    expect(ids(a)).toEqual(expect.arrayContaining(["policy_form_misaligned", "privacy_purpose_unclear"]));
    expect(a.level).toBeGreaterThanOrEqual(WarningLevel.NOTICE);
  });

  it("many third-party scripts are explanatory info, not a warning (fixture F)", () => {
    const a = compose(input({ request: request({ scripts: 14 }) }));
    const finding = a.findings.find((f) => f.id === "third_party_scripts_many");
    expect(finding).toEqual({ id: "third_party_scripts_many", severity: "info", count: 14 });
  });

  it("http page with personal data → VERIFY_BEFORE_INPUT", () => {
    const a = compose(input({ request: request({ scheme: "http" }) }));
    expect(a.level).toBe(WarningLevel.VERIFY_BEFORE_INPUT);
    expect(ids(a)).toContain("insecure_page");
  });

  it("password field without a privacy policy → at least CAUTION", () => {
    const a = compose(
      input({
        request: request({ policy: { found: false, fetched: false, excerpts: [] } }),
        sensitiveKinds: ["email", "password"],
        remote: { kind: "answered", answers: { operator_identifiable: noul(0.9), data_minimization: score(0) } },
      }),
    );
    expect(a.level).toBeGreaterThanOrEqual(WarningLevel.CAUTION);
  });
});

describe("unknown is never silently low risk (§19, §29)", () => {
  it("relay failure → jev_unavailable, never NORMAL", () => {
    const a = compose(input({ remote: { kind: "unavailable" } }));
    expect(a.state).toBe("jev_unavailable");
    expect(a.level).toBeGreaterThanOrEqual(WarningLevel.NOTICE);
    expect(ids(a)).toContain("remote_evaluation_unavailable");
  });

  it("remote evaluation disabled → insufficient_information", () => {
    const a = compose(input({ remote: { kind: "disabled" } }));
    expect(a.state).toBe("insufficient_information");
    expect(a.level).toBeGreaterThanOrEqual(WarningLevel.NOTICE);
  });

  it("all answers undecided → insufficient_information with explicit unknown findings", () => {
    const answers = Object.fromEntries(Object.keys(goodAnswers()).map((k) => [k, noul(0.5)]));
    const a = compose(input({ remote: { kind: "answered", answers } }));
    expect(a.state).toBe("insufficient_information");
    expect(a.level).toBeGreaterThanOrEqual(WarningLevel.NOTICE);
    expect(ids(a)).toEqual(
      expect.arrayContaining(["unknown_operator", "unknown_privacy_disclosure", "unknown_policy_alignment", "unknown_data_minimization"]),
    );
  });

  it("unreadable policy is unknown, not 'explained'", () => {
    const a = compose(input({ request: request({ policy: { found: true, fetched: false, excerpts: [] } }) }));
    expect(a.statuses.privacyPolicy).toBe("unreachable");
    expect(ids(a)).toContain("privacy_policy_unreachable");
  });
});

describe("levelFor", () => {
  it("maps score bands", () => {
    expect(levelFor(0.1)).toBe(0);
    expect(levelFor(0.3)).toBe(1);
    expect(levelFor(0.5)).toBe(2);
    expect(levelFor(0.8)).toBe(3);
  });
});
