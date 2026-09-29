/**
 * Assessment cache (DESIGN.md §25, §26).
 * Keys are SHA-256 hashes; no origin or URL is stored in plain text.
 */
import type { Assessment, Finding, WarningLevel } from "../shared/assessment";
import { WarningLevel as Level } from "../shared/assessment";
import { SCHEMA_VERSION } from "../shared/schema";
import { ext } from "../shared/browser";

export interface CachedAssessment {
  originHash: string;
  assessedAt: number;
  schemaVersion: number;
  findings: Finding[];
  warningLevel: WarningLevel;
  assessment: Assessment;
}

const PREFIX = "assessment:";
const HOUR = 60 * 60 * 1000;

/** TTL by outcome; `null` means "do not cache". Values are operational defaults (§26). */
export function ttlFor(assessment: Assessment): number | null {
  if (assessment.state === "jev_unavailable") return null;
  if (assessment.state === "insufficient_information") return 1 * HOUR;
  if (assessment.level >= Level.CAUTION) return 6 * HOUR;
  if (assessment.level === Level.NOTICE) return 12 * HOUR;
  return 24 * HOUR;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The form signature is part of the key: minimization depends on the specific form. */
export function cacheKeyInput(origin: string, formSignature: string): string {
  return `${origin}\n${formSignature}`;
}

export async function getCached(keyHash: string, now: number): Promise<Assessment | null> {
  const key = PREFIX + keyHash;
  const entry = (await ext.storage.local.get(key))[key] as CachedAssessment | undefined;
  if (!entry || entry.schemaVersion !== SCHEMA_VERSION) return null;
  const ttl = ttlFor(entry.assessment);
  if (ttl === null || now - entry.assessedAt > ttl) {
    await ext.storage.local.remove(key);
    return null;
  }
  return entry.assessment;
}

export async function putCached(keyHash: string, assessment: Assessment): Promise<void> {
  if (ttlFor(assessment) === null) return;
  const entry: CachedAssessment = {
    originHash: keyHash,
    assessedAt: assessment.assessedAt,
    schemaVersion: SCHEMA_VERSION,
    findings: assessment.findings,
    warningLevel: assessment.level,
    assessment,
  };
  await ext.storage.local.set({ [PREFIX + keyHash]: entry });
}

export async function pruneExpired(now: number): Promise<void> {
  const all = await ext.storage.local.get(null);
  const expired = Object.entries(all)
    .filter(([key]) => key.startsWith(PREFIX))
    .filter(([, value]) => {
      const entry = value as CachedAssessment;
      const ttl = ttlFor(entry.assessment);
      return entry.schemaVersion !== SCHEMA_VERSION || ttl === null || now - entry.assessedAt > ttl;
    })
    .map(([key]) => key);
  if (expired.length) await ext.storage.local.remove(expired);
}

export async function clearCache(): Promise<void> {
  const all = await ext.storage.local.get(null);
  const keys = Object.keys(all).filter((key) => key.startsWith(PREFIX));
  if (keys.length) await ext.storage.local.remove(keys);
}
