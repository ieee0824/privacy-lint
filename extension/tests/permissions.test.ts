import { describe, expect, it, vi } from "vitest";
import { normalizeMatchPatterns, registrationPlan, syncContentScripts } from "../src/background/permissions";

describe("pure content script registration plan (#48)", () => {
  it("normalizes all-sites, per-site and absent grants deterministically", () => {
    const origins = Object.freeze(["https://b.example/*", "<all_urls>", "https://b.example/*", "file:///*", "https://a.example/*"]);
    const expected = ["http://*/*", "https://*/*", "https://a.example/*", "https://b.example/*"];
    expect(normalizeMatchPatterns(origins)).toEqual(expected);
    expect(normalizeMatchPatterns(origins)).toEqual(expected);
    expect(normalizeMatchPatterns([])).toEqual([]);
    expect(normalizeMatchPatterns(["*://a.example/*"])).toEqual(["*://a.example/*"]);
  });

  it("keeps matching registration and plans remove-before-register changes", () => {
    const registered = Object.freeze([{ matches: Object.freeze(["https://b.example/*", "https://a.example/*"]) }]);
    const origins = Object.freeze(["https://a.example/*", "https://b.example/*"]);
    expect(registrationPlan(origins, registered)).toEqual({ kind: "keep" });
    expect(registrationPlan([], registered)).toEqual({ kind: "change", unregister: true, registration: null });
    expect(registrationPlan([], [])).toEqual({ kind: "keep" });
    const plan = registrationPlan(["https://new.example/*"], registered);
    expect(plan.kind).toBe("change");
    if (plan.kind !== "change") throw new Error("expected change");
    expect(plan.registration).toEqual({ id: "privacy-lint-content", js: ["content.js"], matches: ["https://new.example/*"], runAt: "document_idle", allFrames: false });
    plan.registration!.matches![0] = "https://modified.example/*";
    expect(registrationPlan(["https://new.example/*"], registered)).not.toEqual(plan);
    expect(registered[0]!.matches).toEqual(["https://b.example/*", "https://a.example/*"]);
  });

  it("serializes overlapping startup/add/remove syncs and observes the latest grant", async () => {
    const operations: string[] = [];
    let origins = ["https://added.example/*"];
    let registered: chrome.scripting.RegisteredContentScript[] = [{ id: "privacy-lint-content", js: ["content.js"], matches: ["https://old.example/*"] }];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    Object.assign(chrome, {
      permissions: { getAll: async () => ({ origins: [...origins] }) },
      scripting: {
        getRegisteredContentScripts: async () => structuredClone(registered),
        unregisterContentScripts: async () => { operations.push("unregister"); await gate; registered = []; },
        registerContentScripts: async (scripts: chrome.scripting.RegisteredContentScript[]) => { operations.push("register"); registered = structuredClone(scripts); },
      },
    });
    const startup = syncContentScripts();
    await vi.waitFor(() => expect(operations).toEqual(["unregister"]));
    const added = syncContentScripts();
    origins = [];
    const removed = syncContentScripts();
    release();
    await Promise.all([startup, added, removed]);
    expect(operations).toEqual(["unregister", "register", "unregister"]);
    expect(registered).toEqual([]);
  });
});
