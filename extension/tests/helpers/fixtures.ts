import type { AssessRequest, AssessResponse, JevAnswer } from "../../src/shared/schema";
import { SCHEMA_VERSION } from "../../src/shared/schema";

export function request(overrides: {
  scheme?: "https" | "http";
  policy?: Partial<AssessRequest["website"]["privacyPolicy"]>;
  operator?: Partial<AssessRequest["website"]["operatorInfo"]>;
  scripts?: number;
} = {}): AssessRequest {
  return {
    schemaVersion: SCHEMA_VERSION,
    website: {
      page: { origin: "https://shop.example", scheme: overrides.scheme ?? "https", pathClass: "checkout", headings: ["購入手続き"] },
      form: {
        method: "post",
        crossOriginAction: false,
        crossSiteAction: false,
        fields: [
          { kind: "name", required: true, label: "氏名" },
          { kind: "email", required: true, label: "メール" },
          { kind: "address", required: true, label: "住所" },
        ],
        context: ["購入する"],
      },
      privacyPolicy: { found: true, fetched: true, excerpts: ["利用目的: 商品の発送のため"], ...overrides.policy },
      operatorInfo: { found: true, fetched: true, excerpts: ["販売業者: 株式会社サンプル"], ...overrides.operator },
      thirdParty: { totalOrigins: overrides.scripts ?? 1, scriptOrigins: overrides.scripts ?? 1, iframeOrigins: 0 },
    },
  };
}

export const noul = (p: number): JevAnswer => ({ type: "noul", noul: p });
export const score = (s: number, confidence = 0.9): JevAnswer => ({
  type: "score",
  score: s,
  confidence,
  probabilities: { "0": 0.25, "1": 0.25, "2": 0.25, "3": 0.25 },
});

export function goodAnswers(): AssessResponse["answers"] {
  return {
    operator_identifiable: noul(0.95),
    operator_contact_available: noul(0.9),
    policy_describes_collection: noul(0.9),
    policy_describes_purpose: noul(0.95),
    policy_describes_third_party: noul(0.9),
    policy_describes_contact: noul(0.9),
    policy_covers_form_fields: noul(0.9),
    data_minimization: score(0.2),
    maintenance_signals: noul(0.1),
  };
}
