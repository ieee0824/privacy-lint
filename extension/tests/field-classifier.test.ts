import { describe, expect, it } from "vitest";
import { classifyField, isClassifiable, type FieldSignals } from "../src/content/field-classifier";

const f = (s: Partial<FieldSignals>): FieldSignals => ({ tag: "input", type: "text", ...s });

describe("classifyField", () => {
  it.each([
    [f({ autocomplete: "name" }), "name"],
    [f({ autocomplete: "shipping street-address" }), "address"],
    [f({ autocomplete: "section-a billing tel" }), "phone"],
    [f({ autocomplete: "cc-number" }), "payment"],
    [f({ autocomplete: "bday" }), "birthdate"],
    [f({ autocomplete: "current-password" }), "password"],
    [f({ type: "email" }), "email"],
    [f({ type: "tel" }), "phone"],
    [f({ type: "password" }), "password"],
    [f({ name: "real_name", placeholder: "氏名" }), "name"],
    [f({ name: "mail_address" }), "email"],
    [f({ name: "email_address" }), "email"],
    [f({ name: "zip" }), "address"],
    [f({ label: "郵便番号" }), "address"],
    [f({ label: "生年月日" }), "birthdate"],
    [f({ label: "マイナンバー" }), "government_id"],
    [f({ label: "カード番号" }), "payment"],
    [f({ name: "company_name" }), "other_personal"],
    [f({ name: "username" }), "other_personal"],
    [f({ label: "勤務先" }), "other_personal"],
    [f({ label: "姓" }), "name"],
    [f({ label: "メイ" }), "name"],
    [f({ label: "お名前（フリガナ）" }), "name"],
    [f({ name: "namae" }), "name"],
    [f({ name: "jusho" }), "address"],
    [f({ name: "juusho" }), "address"],
    [f({ name: "denwa" }), "phone"],
    [f({ name: "mail" }), "email"],
    [f({ name: "seinengappi" }), "birthdate"],
    [f({ name: "q", placeholder: "キーワード" }), "unknown"],
    [f({ name: "gmail_filter" }), "unknown"],
    [f({ name: "quantity" }), "unknown"],
    [f({ tag: "textarea", type: "textarea", label: "お問い合わせ内容" }), "unknown"],
  ] as const)("%o → %s", (signals, expected) => {
    expect(classifyField(signals)).toBe(expected);
  });

  it("autocomplete takes priority over misleading names", () => {
    expect(classifyField(f({ autocomplete: "email", name: "phone" }))).toBe("email");
  });

  it("ignores controls that cannot hold typed personal data", () => {
    for (const type of ["hidden", "submit", "checkbox", "radio", "search"]) {
      expect(isClassifiable(f({ type }))).toBe(false);
    }
    expect(isClassifiable(f({ type: "text" }))).toBe(true);
  });
});
