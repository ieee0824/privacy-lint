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

/**
 * Everything that determines the outcome is part of the key: the page's observation
 * signature (#16) and the result-affecting settings (#15).
 */
export function cacheKeyInput(origin: string, observationSignature: string, settingsFingerprint: string): string {
  return `${origin}\n${observationSignature}\n${settingsFingerprint}`;
}

export type CacheValidity = "valid" | "expired" | "incompatible" | "not-cacheable";

/** Shared policy for reads and pruning; the expiry boundary remains inclusive. */
export function cacheValidity(entry: Readonly<CachedAssessment>, now: number): CacheValidity {
  if (entry.schemaVersion !== SCHEMA_VERSION) return "incompatible";
  const ttl = ttlFor(entry.assessment);
  if (ttl === null) return "not-cacheable";
  return now - entry.assessedAt > ttl ? "expired" : "valid";
}

export function expiredCacheKeys(entries: Readonly<Record<string, unknown>>, now: number): string[] {
  return Object.entries(entries)
    .filter(([key]) => key.startsWith(PREFIX))
    .filter(([, entry]) => cacheValidity(entry as CachedAssessment, now) !== "valid")
    .map(([key]) => key);
}

export async function getCached(keyHash: string, now: number): Promise<Assessment | null> {
  const key = PREFIX + keyHash;
  const entry = (await ext.storage.local.get(key))[key] as CachedAssessment | undefined;
  if (!entry) return null;
  if (cacheValidity(entry, now) === "valid") return entry.assessment;
  await ext.storage.local.remove(key);
  return null;
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
  const expired = expiredCacheKeys(all, now);
  if (expired.length) await ext.storage.local.remove(expired);
}

export async function clearCache(): Promise<void> {
  const all = await ext.storage.local.get(null);
  const keys = Object.keys(all).filter((key) => key.startsWith(PREFIX));
  if (keys.length) await ext.storage.local.remove(keys);
}
