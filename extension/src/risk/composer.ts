/**
 * Risk composition in code (DESIGN.md §20, §37). Jev never produces the final level.
 */
import type { Assessment, AssessmentState, Finding, Statuses, WarningLevel } from "../shared/assessment";
import { WarningLevel as Level } from "../shared/assessment";
import type { AssessRequest, AssessResponse, SensitiveFieldKind } from "../shared/schema";
import {
  WEIGHTS,
  confidentScore,
  decidedNoul,
  thirdPartyRisk,
  weightedMean,
  type RiskFeatures,
} from "./features";

export type RemoteResult =
  | { kind: "answered"; answers: AssessResponse["answers"] }
  | { kind: "disabled" }
  | { kind: "unavailable" };

export interface ComposeInput {
  request: AssessRequest;
  actionRelation: Statuses["formAction"];
  actionScheme: "https" | "http" | "other" | "none";
  sensitiveKinds: SensitiveFieldKind[];
  remote: RemoteResult;
  now: number;
}

/** Share of total weight that must be known for the result to count as "evaluated". */
const MIN_KNOWN_WEIGHT = 0.5;

const HIGH_STAKES_KINDS: ReadonlySet<SensitiveFieldKind> = new Set(["password", "payment", "government_id"]);

export function compose(input: ComposeInput): Assessment {
  const { request, remote } = input;
  const w = request.website;
  const answers = remote.kind === "answered" ? remote.answers : {};
  const findings: Finding[] = [];
  const warn = (id: Finding["id"], count?: number) => findings.push(count === undefined ? { id, severity: "warn" } : { id, severity: "warn", count });
  const info = (id: Finding["id"], count?: number) => findings.push(count === undefined ? { id, severity: "info" } : { id, severity: "info", count });

  // --- technical signals (deterministic) ---
  let technical = 0;
  if (w.page.scheme === "http") {
    technical = 1;
    warn("insecure_page");
  }
  if (input.actionScheme === "http" && !(w.page.scheme === "http" && input.actionRelation === "same_origin")) {
    technical = 1;
    warn("insecure_form_action");
  }
  if (input.actionRelation === "cross_site") {
    technical = Math.max(technical, 0.6);
    warn("cross_site_form_action");
  } else if (input.actionRelation === "same_site") {
    technical = Math.max(technical, 0.2);
    info("cross_origin_form_action");
  }

  // --- operator transparency ---
  const operatorId = decidedNoul(answers.operator_identifiable);
  const operatorContact = decidedNoul(answers.operator_contact_available);
  let operatorRisk = weightedMean([
    [operatorId === null ? null : 1 - operatorId, 0.75],
    [operatorContact === null ? null : 1 - operatorContact, 0.25],
  ]);
  let operatorStatus: Statuses["operator"];
  if (operatorId !== null) {
    operatorStatus = operatorId >= 0.5 ? "confirmed" : "unclear";
    if (operatorId < 0.5) warn("operator_unclear");
    if (!w.operatorInfo.found) info("operator_not_found");
  } else if (!w.operatorInfo.found) {
    operatorStatus = "not_found";
    operatorRisk = Math.max(operatorRisk ?? 0, 0.7);
    warn("operator_not_found");
  } else {
    operatorStatus = "unknown";
  }
  if (operatorContact !== null && operatorContact < 0.5) info("operator_contact_unclear");

  // --- privacy disclosure & policy/form alignment ---
  let privacyRisk: number | null;
  let alignmentRisk: number | null;
  let policyStatus: Statuses["privacyPolicy"];
  const policyReadable = w.privacyPolicy.fetched && w.privacyPolicy.excerpts.length > 0;
  if (!w.privacyPolicy.found) {
    policyStatus = "not_found";
    privacyRisk = 1;
    alignmentRisk = 1;
    warn("privacy_policy_not_found");
  } else if (!policyReadable) {
    policyStatus = "unreachable";
    privacyRisk = null;
    alignmentRisk = null;
    info("privacy_policy_unreachable");
  } else {
    policyStatus = "found";
    const purpose = decidedNoul(answers.policy_describes_purpose);
    const collection = decidedNoul(answers.policy_describes_collection);
    const thirdParty = decidedNoul(answers.policy_describes_third_party);
    const contact = decidedNoul(answers.policy_describes_contact);
    privacyRisk = weightedMean([
      [purpose === null ? null : 1 - purpose, 0.4],
      [collection === null ? null : 1 - collection, 0.2],
      [thirdParty === null ? null : 1 - thirdParty, 0.2],
      [contact === null ? null : 1 - contact, 0.2],
    ]);
    if (purpose !== null && purpose < 0.5) warn("privacy_purpose_unclear");
    if (collection !== null && collection < 0.5) warn("privacy_collection_unclear");
    if (thirdParty !== null && thirdParty < 0.5) info("privacy_third_party_unclear");
    if (contact !== null && contact < 0.5) info("privacy_contact_unclear");

    const covers = decidedNoul(answers.policy_covers_form_fields);
    alignmentRisk = covers === null ? null : 1 - covers;
    if (covers !== null && covers < 0.5) warn("policy_form_misaligned");
  }

  // --- data minimization (4-level score, §18.4) ---
  const minimization = confidentScore(answers.data_minimization, 4);
  if (minimization !== null) {
    if (minimization >= 2 / 3 - 0.08) warn("data_minimization_concern");
    else if (minimization >= 1 / 3 - 0.08) info("data_minimization_minor");
  }

  // --- third-party exposure (deterministic) ---
  const scripts = w.thirdParty.scriptOrigins;
  if (scripts >= 10) info("third_party_scripts_many", scripts);
  else if (scripts >= 3) info("third_party_scripts_some", scripts);

  // --- maintenance signals: explanatory only, not weighted ---
  const stale = decidedNoul(answers.maintenance_signals);
  if (stale !== null && stale >= 0.5) info("maintenance_signals");

  const features: RiskFeatures = {
    operatorTransparency: operatorRisk,
    privacyDisclosure: privacyRisk,
    policyFormAlignment: alignmentRisk,
    dataMinimization: minimization,
    thirdPartyExposure: thirdPartyRisk(scripts, w.thirdParty.iframeOrigins),
    technicalSignals: technical,
  };

  // --- aggregate over known features only ---
  let knownWeight = 0;
  let sum = 0;
  for (const key of Object.keys(WEIGHTS) as Array<keyof RiskFeatures>) {
    const value = features[key];
    if (value === null) continue;
    knownWeight += WEIGHTS[key];
    sum += WEIGHTS[key] * value;
  }
  const score = knownWeight > 0 ? sum / knownWeight : 0;
  let level = levelFor(score);

  // --- explicit policy floors ---
  if (w.page.scheme === "http" || input.actionScheme === "http") level = Level.VERIFY_BEFORE_INPUT;
  if (!w.privacyPolicy.found && input.sensitiveKinds.some((k) => HIGH_STAKES_KINDS.has(k))) {
    level = maxLevel(level, Level.CAUTION);
  }
  if (minimization !== null && minimization >= 2 / 3 - 0.08) level = maxLevel(level, Level.CAUTION);
  // A ⚠ item next to "no signs worth noting" would contradict itself.
  if (findings.some((f) => f.severity === "warn")) level = maxLevel(level, Level.NOTICE);

  // --- state: unknown never silently becomes low risk (§19, §29) ---
  let state: AssessmentState;
  if (remote.kind === "unavailable") {
    state = "jev_unavailable";
    info("remote_evaluation_unavailable");
  } else if (remote.kind === "disabled") {
    state = "insufficient_information";
    info("remote_evaluation_disabled");
  } else {
    state = knownWeight >= MIN_KNOWN_WEIGHT ? "evaluated" : "insufficient_information";
    if (features.operatorTransparency === null) info("unknown_operator");
    if (features.privacyDisclosure === null && policyStatus === "found") info("unknown_privacy_disclosure");
    if (features.policyFormAlignment === null && policyStatus === "found") info("unknown_policy_alignment");
    if (features.dataMinimization === null) info("unknown_data_minimization");
  }
  if (state !== "evaluated") level = maxLevel(level, Level.NOTICE);

  return {
    state: state as Assessment["state"],
    level,
    findings: sortFindings(findings),
    statuses: { operator: operatorStatus, privacyPolicy: policyStatus, formAction: input.actionRelation },
    sensitiveKinds: input.sensitiveKinds,
    assessedAt: input.now,
  };
}

export function levelFor(score: number): WarningLevel {
  if (score >= 0.6) return Level.VERIFY_BEFORE_INPUT;
  if (score >= 0.4) return Level.CAUTION;
  if (score >= 0.2) return Level.NOTICE;
  return Level.NORMAL;
}

function maxLevel(a: WarningLevel, b: WarningLevel): WarningLevel {
  return (a > b ? a : b) as WarningLevel;
}

function sortFindings(findings: Finding[]): Finding[] {
  return findings.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "warn" ? -1 : 1));
}
