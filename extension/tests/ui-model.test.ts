import { describe, expect, it } from "vitest";
import { badgeModel } from "../src/shared/badge-model";
import type { Assessment, TabStatus } from "../src/shared/assessment";
import { assessmentModel, popupModel } from "../src/ui/popup-model";
import { DISCLAIMER, headline } from "../src/risk/findings";

const assessment = (level: Assessment["level"] = 0, state: Assessment["state"] = "evaluated"): Assessment => ({
  state, level, assessedAt: 1000, sensitiveKinds: ["email", "password"],
  findings: [{ id: "insecure_page", severity: "warn" }, { id: "third_party_scripts_many", severity: "info", count: 14 }],
  statuses: { operator: "confirmed", privacyPolicy: "found", formAction: "same_origin" },
});

describe("pure badge display (#47)", () => {
  it.each<[TabStatus, string]>([[{ kind: "idle" }, ""], [{ kind: "assessing", focused: false }, "…"], ...(["", "i", "!", "!!"] as const).map((text, level) => [{ kind: "done", focused: false, assessment: assessment(level as Assessment["level"]) }, text] as [TabStatus, string])])("preserves each state and level", (status, text) => {
    const before = structuredClone(status);
    expect(badgeModel(status).text).toBe(text);
    expect(badgeModel(status)).toEqual(badgeModel(status));
    expect(status).toEqual(before);
  });

  it("uses ? for unavailable or insufficient results below CAUTION", () => {
    expect(badgeModel({ kind: "done", focused: false, assessment: assessment(1, "insufficient_information") })).toEqual({ text: "?", color: "#6e7781" });
    expect(badgeModel({ kind: "done", focused: false, assessment: assessment(2, "jev_unavailable") }).text).toBe("!");
    const first = badgeModel({ kind: "done", focused: false, assessment: assessment(2) });
    first.text = "changed";
    expect(badgeModel({ kind: "done", focused: false, assessment: assessment(2) }).text).toBe("!");
  });
});

describe("pure popup display (#47)", () => {
  it("preserves unsupported, permission, idle and assessing wording", () => {
    expect(popupModel(null).title).toBe(headline("unsupported_page", 0));
    expect(popupModel({ permission: "denied", origin: "https://example.com", status: { kind: "idle" } })).toMatchObject({ kind: "permission", origin: "https://example.com" });
    expect(popupModel({ permission: "granted", status: { kind: "idle" } }).title).toBe("個人情報の入力欄は検出されていません");
    expect(popupModel({ permission: "granted", status: { kind: "assessing", focused: false } }).title).toBe("確認しています…");
  });

  it.each([0, 1, 2, 3] as const)("preserves level %i, finding order, statuses and disclaimer", (level) => {
    const input = assessment(level);
    const before = structuredClone(input);
    const model = assessmentModel(input);
    expect(model.title).toBe(headline(input.state, level));
    expect(model.findings.map((f) => f.severity)).toEqual(["warn", "info"]);
    expect(model.findings[1]!.text).toContain("14種類");
    expect(model.statuses[3]!.text).toBe("メールアドレス、パスワード");
    expect(model.disclaimer).toBe(DISCLAIMER);
    expect(model).toEqual(assessmentModel(input));
    model.findings[0]!.text = "changed";
    model.statuses[0]!.text = "changed";
    expect(input).toEqual(before);
    expect(assessmentModel(input)).not.toEqual(model);
  });
});
