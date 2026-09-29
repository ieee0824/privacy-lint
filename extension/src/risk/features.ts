/**
 * Risk features and confidence gating (DESIGN.md §19, §20, §43).
 *
 * Every feature is a risk in [0, 1] (higher = more reason to verify) or `null`
 * when it cannot be determined. `null` is never replaced by 0.
 */
import type { JevAnswer } from "../shared/schema";

export interface RiskFeatures {
  operatorTransparency: number | null;
  privacyDisclosure: number | null;
  policyFormAlignment: number | null;
  dataMinimization: number | null;
  thirdPartyExposure: number;
  technicalSignals: number;
}

/** Initial hypothesis from DESIGN.md §20; tuned against fixtures, not a fixed spec. */
export const WEIGHTS: Record<keyof RiskFeatures, number> = {
  operatorTransparency: 0.2,
  privacyDisclosure: 0.25,
  policyFormAlignment: 0.2,
  dataMinimization: 0.2,
  thirdPartyExposure: 0.1,
  technicalSignals: 0.05,
};

/** Choice / Score answers below this confidence are treated as unknown. */
export const CONFIDENCE_THRESHOLD = 0.5;

/**
 * Noul answers carry no confidence (§43); values within this distance of 0.5
 * mean the model is undecided and are treated as unknown.
 */
export const NOUL_UNDECIDED_BAND = 0.25;

/** Probability of "yes" when the model is decided, otherwise null. */
export function decidedNoul(answer: JevAnswer | undefined): number | null {
  if (answer?.type !== "noul") return null;
  return Math.abs(answer.noul - 0.5) < NOUL_UNDECIDED_BAND ? null : answer.noul;
}

/** Score normalized to [0, 1] when confidence is sufficient, otherwise null. */
export function confidentScore(answer: JevAnswer | undefined, levels: number): number | null {
  if (answer?.type !== "score" || answer.confidence < CONFIDENCE_THRESHOLD) return null;
  return Math.min(1, Math.max(0, answer.score / (levels - 1)));
}

/** Weighted mean over the entries whose value is known; null when none are. */
export function weightedMean(entries: Array<[value: number | null, weight: number]>): number | null {
  let sum = 0;
  let weight = 0;
  for (const [value, w] of entries) {
    if (value === null) continue;
    sum += value * w;
    weight += w;
  }
  return weight > 0 ? sum / weight : null;
}

export function thirdPartyRisk(scriptOrigins: number, iframeOrigins: number): number {
  const base =
    scriptOrigins === 0 ? 0 : scriptOrigins <= 2 ? 0.2 : scriptOrigins <= 5 ? 0.4 : scriptOrigins <= 10 ? 0.7 : 1;
  return Math.min(1, base + Math.min(iframeOrigins, 4) * 0.05);
}
