/** Assessment result model (DESIGN.md §11, §21, §29). There is no "safe" state. */
import type { SensitiveFieldKind } from "./schema";

export const WarningLevel = {
  NORMAL: 0,
  NOTICE: 1,
  CAUTION: 2,
  VERIFY_BEFORE_INPUT: 3,
} as const;
export type WarningLevel = (typeof WarningLevel)[keyof typeof WarningLevel];

export type AssessmentState =
  | "evaluated"
  | "insufficient_information"
  | "permission_denied"
  | "jev_unavailable"
  | "unsupported_page";

export type FindingId =
  | "insecure_page"
  | "insecure_form_action"
  | "cross_site_form_action"
  | "cross_origin_form_action"
  | "privacy_policy_not_found"
  | "privacy_policy_unreachable"
  | "privacy_collection_unclear"
  | "privacy_purpose_unclear"
  | "privacy_third_party_unclear"
  | "privacy_contact_unclear"
  | "policy_form_misaligned"
  | "operator_not_found"
  | "operator_unclear"
  | "operator_contact_unclear"
  | "data_minimization_concern"
  | "data_minimization_minor"
  | "third_party_scripts_many"
  | "third_party_scripts_some"
  | "maintenance_signals"
  | "outdated_components"
  | "unknown_operator"
  | "unknown_privacy_disclosure"
  | "unknown_policy_alignment"
  | "unknown_data_minimization"
  | "remote_evaluation_disabled"
  | "remote_evaluation_unavailable";

export interface Finding {
  id: FindingId;
  severity: "warn" | "info";
  /** Numeric parameters only; page-derived strings are never stored in findings. */
  count?: number;
  /** Labels built from the bundled lifecycle table (never from page content), e.g. "jQuery 1.x（2016年にサポート終了）". */
  names?: string[];
}

export interface Statuses {
  operator: "confirmed" | "unclear" | "not_found" | "unknown";
  privacyPolicy: "found" | "not_found" | "unreachable";
  formAction: "same_origin" | "same_site" | "cross_site" | "none";
}

export interface Assessment {
  state: Extract<AssessmentState, "evaluated" | "insufficient_information" | "jev_unavailable">;
  level: WarningLevel;
  findings: Finding[];
  statuses: Statuses;
  sensitiveKinds: SensitiveFieldKind[];
  assessedAt: number;
}

export type TabStatus =
  | { kind: "idle" }
  | { kind: "assessing"; focused: boolean }
  | { kind: "done"; focused: boolean; assessment: Assessment };

export type PermissionStatus = "granted" | "denied" | "unsupported";
