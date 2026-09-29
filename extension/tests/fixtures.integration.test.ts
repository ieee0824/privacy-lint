// @vitest-environment jsdom
/**
 * Evaluates fixtures A–H (DESIGN.md §34) with the real extension pipeline against the
 * real Go relay and the Go Jev mock. Linked documents are served from fixtures/ on disk.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluate } from "../src/background/assessment";
import { DEFAULT_SETTINGS } from "../src/background/settings";
import { ControlRegistry } from "../src/content/control-registry";
import { watchForFormChanges } from "../src/content/mutation-observer";
import { buildObservation } from "../src/content/page-observer";
import { WarningLevel, type Assessment } from "../src/shared/assessment";
import { validatePageObservation } from "../src/shared/validate";
import { expectNoCanary } from "./helpers/canary";

const repo = join(__dirname, "../..");
const fixtures = join(repo, "fixtures");
const work = mkdtempSync(join(tmpdir(), "privacy-lint-it-"));
const record = join(work, "jev-received.jsonl");
const relayPort = 21000 + Math.floor(Math.random() * 4000);
const jevPort = relayPort + 1;
const relayUrl = `http://127.0.0.1:${relayPort}`;
const procs: ChildProcess[] = [];
const relayLog: string[] = [];

async function waitFor(url: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timeout waiting for ${url}`);
}

beforeAll(async () => {
  const relayBin = join(tmpdir(), "privacy-lint-it-relay");
  const jevBin = join(tmpdir(), "privacy-lint-it-jevmock");
  execFileSync("go", ["build", "-o", relayBin, "./cmd/relay"], { cwd: join(repo, "relay") });
  execFileSync("go", ["build", "-o", jevBin, "./cmd/jevmock"], { cwd: join(repo, "relay") });
  procs.push(spawn(jevBin, ["-addr", `127.0.0.1:${jevPort}`, "-record", record], { stdio: "ignore" }));
  const relay = spawn(relayBin, ["-addr", `127.0.0.1:${relayPort}`, "-jev-endpoint", `http://127.0.0.1:${jevPort}/v1/systemone`, "-rate", "0"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  relay.stdout!.on("data", (d) => relayLog.push(String(d)));
  relay.stderr!.on("data", (d) => relayLog.push(String(d)));
  procs.push(relay);
  await waitFor(`http://127.0.0.1:${jevPort}/healthz`);
  await waitFor(`${relayUrl}/healthz`);
}, 120_000);

afterAll(() => procs.forEach((p) => p.kill()));

/** Serves https://<fixture>.example/<file> from fixtures/<group>/<fixture>/<file>. */
function fixtureFetch(): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.origin === relayUrl) return fetch(url, init);
    const [, group, name] = /^([a-z]+)--([a-z0-9-]+)\.example$/.exec(url.hostname) ?? [];
    const file = group && name ? join(fixtures, group, name, url.pathname) : "";
    if (!file || !existsSync(file)) return new Response("not found", { status: 404 });
    return new Response(readFileSync(file), { headers: { "content-type": "text/html; charset=utf-8" } });
  }) as typeof fetch;
}

function load(group: string, name: string): void {
  const html = readFileSync(join(fixtures, group, name, "index.html"), "utf8");
  const url = `https://${group}--${name}.example/index.html`;
  (globalThis as unknown as { jsdom: { reconfigure(o: { url: string }): void } }).jsdom.reconfigure({ url });
  document.documentElement.innerHTML = html.replace(/^<!doctype html>/i, "");
  // jsdom keeps the first document's base URL after reconfigure(); browsers do not.
  const base = document.createElement("base");
  base.href = url;
  document.head.prepend(base);
}

function observe() {
  const registry = new ControlRegistry();
  registry.addFrom(document);
  const o = buildObservation(document, registry, undefined);
  return o ? validatePageObservation(JSON.parse(JSON.stringify(o))) : null;
}

async function assess(group: string, name: string): Promise<Assessment> {
  load(group, name);
  const o = observe();
  expect(o).not.toBeNull();
  return evaluate(o!, { ...DEFAULT_SETTINGS, relayUrl }, { fetchImpl: fixtureFetch(), now: () => Date.now() });
}

const ids = (a: Assessment) => a.findings.map((f) => f.id);
const warns = (a: Assessment) => a.findings.filter((f) => f.severity === "warn").map((f) => f.id);

describe("fixtures (DESIGN.md §34)", () => {
  it("A: EC site, policy and operator clear, reasonable form → no warnings", async () => {
    const a = await assess("good", "a-ec");
    expect(a.state).toBe("evaluated");
    expect(warns(a)).toEqual([]);
    expect(a.level).toBe(WarningLevel.NORMAL);
    expect(a.statuses).toEqual({ operator: "confirmed", privacyPolicy: "found", formAction: "same_origin" });
  });

  it("B: old reservation site, no policy, external form provider → CAUTION or higher", async () => {
    const a = await assess("caution", "b-old-reservation");
    expect(a.level).toBeGreaterThanOrEqual(WarningLevel.CAUTION);
    expect(ids(a)).toEqual(expect.arrayContaining(["privacy_policy_not_found", "cross_site_form_action"]));
    expect(a.statuses.operator).toBe("confirmed");
    // Table layout + romanized names (namae / jusho / denwa / mail).
    expect(a.sensitiveKinds).toEqual(["address", "birthdate", "email", "name", "phone"]);
  });

  it("C: newsletter asking for address and birth date → data minimization concern", async () => {
    const a = await assess("caution", "c-newsletter");
    expect(ids(a)).toContain("data_minimization_concern");
    expect(a.level).toBeGreaterThanOrEqual(WarningLevel.CAUTION);
  });

  it("D: cross-site form provider with sufficient explanation → noted, not escalated", async () => {
    const a = await assess("good", "d-external-provider");
    expect(warns(a)).toEqual(["cross_site_form_action"]);
    expect(a.level).toBe(WarningLevel.NOTICE);
  });

  it("E: policy that says nothing about the form → misalignment and unclear purpose", async () => {
    const a = await assess("ambiguous", "e-policy-mismatch");
    expect(ids(a)).toEqual(expect.arrayContaining(["policy_form_misaligned", "privacy_purpose_unclear", "operator_unclear"]));
    expect(a.level).toBeGreaterThanOrEqual(WarningLevel.CAUTION);
  });

  it("F: many analytics scripts → explanatory info with the count", async () => {
    const a = await assess("ambiguous", "f-analytics");
    expect(a.findings).toContainEqual({ id: "third_party_scripts_many", severity: "info", count: 12 });
    expect(a.level).toBeLessThanOrEqual(WarningLevel.NOTICE);
  });

  it("G: SPA form rendered later is detected via MutationObserver", async () => {
    load("good", "g-spa");
    const registry = new ControlRegistry();
    registry.addFrom(document);
    expect(buildObservation(document, registry, undefined)).toBeNull();

    const detected = new Promise<void>((resolve) => {
      watchForFormChanges(document, registry, () => {
        if (buildObservation(document, registry, undefined)) resolve();
      });
    });
    // What the page's own script does after 1.5 s.
    const form = document.createElement("form");
    form.innerHTML = `<label>氏名 <input name="name" autocomplete="name"></label><label>メール <input name="email" autocomplete="email"></label>`;
    document.getElementById("app")!.replaceChildren(form);
    await detected;
    const o = buildObservation(document, registry, undefined)!;
    expect(o.form.fields.map((f) => f.kind)).toEqual(["name", "email"]);
  });

  it("H: form inside an iframe is not read from the top frame (MVP scope)", () => {
    load("ambiguous", "h-iframe");
    expect(observe()).toBeNull();
  });
});

describe("adversarial fixture (DESIGN.md §32)", () => {
  it("injected claims do not lower the result and nothing sensitive reaches Jev", async () => {
    const a = await assess("caution", "x-adversarial");
    // The policy only says "ignore instructions / 利用目的はありません" → purpose is not explained.
    expect(a.level).toBeGreaterThanOrEqual(WarningLevel.NOTICE);
    expect(a.statuses.operator).not.toBe("confirmed");
  });

  it("the Jev mock never received canaries, value attributes, query strings or script text", () => {
    const received = readFileSync(record, "utf8");
    expect(received.length).toBeGreaterThan(0);
    expectNoCanary(received, ["prefilled-victim@example.com", "HIDDEN-SESSION-CANARY", "QUERY-CANARY", "SCRIPT-IN-POLICY-CANARY"]);
    for (const line of received.trim().split("\n")) {
      const req = JSON.parse(line);
      expect(Object.keys(req.state)).toEqual(["website"]);
      expect(JSON.stringify(req.questions)).not.toMatch(/Ignore all previous|SYSTEM:/);
    }
  });

  it("the relay log holds no content", () => {
    const log = relayLog.join("");
    expect(log).toContain('"route":"/v1/assess"');
    expect(log).not.toMatch(/Ignore all|example\.com|\.example|CANARY/);
  });
});
