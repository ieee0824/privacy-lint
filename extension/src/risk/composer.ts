/**
 * Risk composition in code (DESIGN.md §20, §37). Jev never produces the final level.
 */
import type { Assessment, AssessmentState, Finding, Statuses, WarningLevel } from "../shared/assessment";
import { WarningLevel as Level } from "../shared/assessment";
import type { AssessRequest, AssessResponse, ComponentObservation, SensitiveFieldKind } from "../shared/schema";
import { unsupportedComponents, type LifecycleStatus } from "./component-lifecycle";
import {
  WEIGHTS,
  componentRisk,
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
  /** Versioned components seen on the page or in same-site response headers (DESIGN.md §44). */
  components: ComponentObservation[];
  remote: RemoteResult;
  now: number;
}

/** Share of total weight that must be known for the result to count as "evaluated". */
const MIN_KNOWN_WEIGHT = 0.5;

const HIGH_STAKES_KINDS: ReadonlySet<SensitiveFieldKind> = new Set(["password", "payment", "government_id"]);

export function compose(input: ComposeInput): Assessment {
  const technical = technicalAspect(input);
  const operator = operatorAspect(input);
  const policy = policyAspect(input);
  const minimization = minimizationAspect(input);
  const exposure = exposureAspect(input);
  const components = componentAspect(input);
  const findings = [...technical.findings, ...operator.findings, ...policy.findings,
    ...minimization.findings, ...exposure.findings, ...components.findings, ...maintenanceAspect(input).findings];
  const features: RiskFeatures = {
    operatorTransparency: operator.risk, privacyDisclosure: policy.privacyRisk,
    policyFormAlignment: policy.alignmentRisk, dataMinimization: minimization.risk,
    thirdPartyExposure: exposure.risk, technicalSignals: technical.risk,
    componentMaintenance: components.risk,
  };
  const { score, knownWeight } = aggregate(features);
  const state = assessmentState(input.remote, knownWeight, features, policy.status);
  const level = applyFloors(input, levelFor(score), minimization.risk, findings, state.state);
  return {
    state: state.state, level, findings: sortFindings([...findings, ...state.findings]),
    statuses: { operator: operator.status, privacyPolicy: policy.status, formAction: input.actionRelation },
    sensitiveKinds: [...input.sensitiveKinds], assessedAt: input.now,
  };
}

function finding(severity: Finding["severity"], id: Finding["id"], count?: number): Finding {
  return count === undefined ? { id, severity } : { id, severity, count };
}

function technicalAspect(input: ComposeInput) {
  const w = input.request.website;
  const findings: Finding[] = [];
  // --- technical signals (deterministic) ---
  let technical = 0;
  if (w.page.scheme === "http") {
    technical = 1;
    findings.push(finding("warn", "insecure_page"));
  }
  if (input.actionScheme === "http" && !(w.page.scheme === "http" && input.actionRelation === "same_origin")) {
    technical = 1;
    findings.push(finding("warn", "insecure_form_action"));
  }
  if (input.actionRelation === "cross_site") {
    technical = Math.max(technical, 0.6);
    findings.push(finding("warn", "cross_site_form_action"));
  } else if (input.actionRelation === "same_site") {
    technical = Math.max(technical, 0.2);
    findings.push(finding("info", "cross_origin_form_action"));
  }

  return { risk: technical, findings };
}

function operatorAspect(input: ComposeInput) {
  const w = input.request.website;
  const answers = input.remote.kind === "answered" ? input.remote.answers : {};
  const findings: Finding[] = [];
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
    if (operatorId < 0.5) findings.push(finding("warn", "operator_unclear"));
    if (!w.operatorInfo.found) findings.push(finding("info", "operator_not_found"));
  } else if (!w.operatorInfo.found) {
    operatorStatus = "not_found";
    operatorRisk = Math.max(operatorRisk ?? 0, 0.7);
    findings.push(finding("warn", "operator_not_found"));
  } else {
    operatorStatus = "unknown";
  }
  if (operatorContact !== null && operatorContact < 0.5) findings.push(finding("info", "operator_contact_unclear"));

  return { risk: operatorRisk, status: operatorStatus, findings };
}

function policyAspect(input: ComposeInput) {
  const policy = input.request.website.privacyPolicy;
  if (!policy.found) return { status: "not_found" as const, privacyRisk: 1, alignmentRisk: 1,
    findings: [{ id: "privacy_policy_not_found", severity: "warn" } as Finding] };
  if (!policy.fetched || policy.excerpts.length === 0) return { status: "unreachable" as const,
    privacyRisk: null, alignmentRisk: null,
    findings: [{ id: "privacy_policy_unreachable", severity: "info" } as Finding] };
  return readablePolicyAspect(input);
}

function readablePolicyAspect(input: ComposeInput) {
  const answers = input.remote.kind === "answered" ? input.remote.answers : {};
  const findings: Finding[] = [];
  const purpose = decidedNoul(answers.policy_describes_purpose);
  const collection = decidedNoul(answers.policy_describes_collection);
  const thirdParty = decidedNoul(answers.policy_describes_third_party);
  const contact = decidedNoul(answers.policy_describes_contact);
  const privacyRisk = weightedMean([
    [purpose === null ? null : 1 - purpose, 0.4],
    [collection === null ? null : 1 - collection, 0.2],
    [thirdParty === null ? null : 1 - thirdParty, 0.2],
    [contact === null ? null : 1 - contact, 0.2],
  ]);
  if (purpose !== null && purpose < 0.5) findings.push(finding("warn", "privacy_purpose_unclear"));
  if (collection !== null && collection < 0.5) findings.push(finding("warn", "privacy_collection_unclear"));
  if (thirdParty !== null && thirdParty < 0.5) findings.push(finding("info", "privacy_third_party_unclear"));
  if (contact !== null && contact < 0.5) findings.push(finding("info", "privacy_contact_unclear"));

  const covers = decidedNoul(answers.policy_covers_form_fields);
  const alignmentRisk = covers === null ? null : 1 - covers;
  if (covers !== null && covers < 0.5) findings.push(finding("warn", "policy_form_misaligned"));
  return { status: "found" as const, privacyRisk, alignmentRisk, findings };
}

function minimizationAspect(input: ComposeInput) {
  const answers = input.remote.kind === "answered" ? input.remote.answers : {};
  const findings: Finding[] = [];
  // --- data minimization (4-level score, §18.4) ---
  const minimization = confidentScore(answers.data_minimization, 4);
  if (minimization !== null) {
    if (minimization >= 2 / 3 - 0.08) findings.push(finding("warn", "data_minimization_concern"));
    else if (minimization >= 1 / 3 - 0.08) findings.push(finding("info", "data_minimization_minor"));
  }

  return { risk: minimization, findings };
}

function exposureAspect(input: ComposeInput) {
  const w = input.request.website;
  const findings: Finding[] = [];
  // --- third-party exposure (deterministic) ---
  const scripts = w.thirdParty.scriptOrigins;
  if (scripts >= 10) findings.push(finding("info", "third_party_scripts_many", scripts));
  else if (scripts >= 3) findings.push(finding("info", "third_party_scripts_some", scripts));

  return { risk: thirdPartyRisk(scripts, w.thirdParty.iframeOrigins), findings };
}

function componentAspect(input: ComposeInput) {
  const findings: Finding[] = [];
  // --- component maintenance (deterministic, bundled lifecycle table) ---
  const unsupported = unsupportedComponents(input.components, input.now);
  const componentMaintenance = componentRisk(input.components.length, unsupported[0]?.daysSinceEnd ?? null);
  if (unsupported.length > 0) {
    findings.push({
      id: "outdated_components",
      severity: unsupported[0]!.daysSinceEnd >= 365 ? "warn" : "info",
      names: unsupported.slice(0, 4).map(componentLabel),
    });
  }

  return { risk: componentMaintenance, findings };
}

function maintenanceAspect(input: ComposeInput) {
  const answers = input.remote.kind === "answered" ? input.remote.answers : {};
  const findings: Finding[] = [];
  // --- maintenance signals: explanatory only, not weighted ---
  const stale = decidedNoul(answers.maintenance_signals);
  if (stale !== null && stale >= 0.5) findings.push(finding("info", "maintenance_signals"));

  return { findings };
}

function aggregate(features: RiskFeatures) {
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

  return { score, knownWeight };
}

function applyFloors(input: ComposeInput, initial: WarningLevel, minimization: number | null,
  findings: readonly Finding[], state: AssessmentState): WarningLevel {
  const w = input.request.website;
  let level = initial;
  // --- explicit policy floors ---
  if (w.page.scheme === "http" || input.actionScheme === "http") level = Level.VERIFY_BEFORE_INPUT;
  if (!w.privacyPolicy.found && input.sensitiveKinds.some((k) => HIGH_STAKES_KINDS.has(k))) {
    level = maxLevel(level, Level.CAUTION);
  }
  if (minimization !== null && minimization >= 2 / 3 - 0.08) level = maxLevel(level, Level.CAUTION);
  // A ⚠ item next to "no signs worth noting" would contradict itself.
  if (findings.some((f) => f.severity === "warn")) level = maxLevel(level, Level.NOTICE);

  if (state !== "evaluated") level = maxLevel(level, Level.NOTICE);
  return level;
}

function assessmentState(remote: RemoteResult, knownWeight: number, features: RiskFeatures,
  policyStatus: Statuses["privacyPolicy"]) {
  const findings: Finding[] = [];
  // --- state: unknown never silently becomes low risk (§19, §29) ---
  let state: AssessmentState;
  if (remote.kind === "unavailable") {
    state = "jev_unavailable";
    findings.push(finding("info", "remote_evaluation_unavailable"));
  } else if (remote.kind === "disabled") {
    state = "insufficient_information";
    findings.push(finding("info", "remote_evaluation_disabled"));
  } else {
    state = knownWeight >= MIN_KNOWN_WEIGHT ? "evaluated" : "insufficient_information";
    if (features.operatorTransparency === null) findings.push(finding("info", "unknown_operator"));
    if (features.privacyDisclosure === null && policyStatus === "found") findings.push(finding("info", "unknown_privacy_disclosure"));
    if (features.policyFormAlignment === null && policyStatus === "found") findings.push(finding("info", "unknown_policy_alignment"));
    if (features.dataMinimization === null) findings.push(finding("info", "unknown_data_minimization"));
  }

  return { state, findings };
}

function componentLabel(s: LifecycleStatus): string {
  const line = s.line.includes(".") ? s.line : `${s.line}.x`;
  return `${s.name} ${line}（${s.endOfSupport.slice(0, 4)}年にサポート終了）`;
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

export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "warn" ? -1 : 1));
}
