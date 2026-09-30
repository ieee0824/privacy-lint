import { beforeEach, describe, expect, it } from "vitest";
import type { Assessment } from "../src/shared/assessment";
import { SCHEMA_VERSION } from "../src/shared/schema";
import { cacheValidity, expiredCacheKeys, getCached, pruneExpired, ttlFor, type CachedAssessment } from "../src/background/cache";
import { installFakeExtension } from "./helpers/fake-extension";

const assessment = (state: Assessment["state"] = "evaluated", level: Assessment["level"] = 0): Assessment => ({
  state, level, assessedAt: 1000, findings: [], sensitiveKinds: ["email"],
  statuses: { operator: "confirmed", privacyPolicy: "found", formAction: "same_origin" },
});
const entry = (a = assessment()): CachedAssessment => ({
  originHash: "key", assessedAt: a.assessedAt, schemaVersion: SCHEMA_VERSION,
  findings: a.findings, warningLevel: a.level, assessment: a,
});

beforeEach(() => installFakeExtension());

describe("pure cache policy (#46)", () => {
  it.each([assessment(), assessment("evaluated", 1), assessment("evaluated", 2), assessment("insufficient_information")])("preserves the inclusive TTL boundary", (a) => {
    const cached = entry(a);
    const before = structuredClone(cached);
    const atBoundary = cached.assessedAt + ttlFor(a)!;
    expect(cacheValidity(cached, atBoundary)).toBe("valid");
    expect(cacheValidity(cached, atBoundary + 1)).toBe("expired");
    expect(cacheValidity(cached, atBoundary)).toBe("valid");
    expect(cached).toEqual(before);
  });

  it("distinguishes incompatible and uncacheable entries without mutation", () => {
    const incompatible = { ...entry(), schemaVersion: SCHEMA_VERSION + 1 };
    expect(cacheValidity(incompatible, 1000)).toBe("incompatible");
    expect(cacheValidity(entry(assessment("jev_unavailable")), 1000)).toBe("not-cacheable");
  });

  it("reads and pruning share all invalidation rules", async () => {
    const fake = installFakeExtension();
    const samples = {
      valid: entry(), expired: { ...entry(), assessedAt: -100000000 },
      incompatible: { ...entry(), schemaVersion: SCHEMA_VERSION + 1 },
      unavailable: entry(assessment("jev_unavailable")),
    };
    for (const [key, value] of Object.entries(samples)) fake.local.set(`assessment:${key}`, value);
    fake.local.set("settings", { remoteEvaluation: false });
    const snapshot = Object.fromEntries(fake.local);
    expect(expiredCacheKeys(snapshot, 1000)).toEqual(["assessment:expired", "assessment:incompatible", "assessment:unavailable"]);
    for (const key of Object.keys(samples)) expect(await getCached(key, 1000)).toEqual(key === "valid" ? samples.valid.assessment : null);
    expect(Array.from(fake.local.keys())).toEqual(["assessment:valid", "settings"]);
    for (const [key, value] of Object.entries(samples)) fake.local.set(`assessment:${key}`, value);
    await pruneExpired(1000);
    expect(Array.from(fake.local.keys())).toEqual(["assessment:valid", "settings"]);
  });
});
