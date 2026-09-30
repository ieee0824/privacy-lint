import { afterEach, describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { assertNoE2eHooks, browserBuildPlan, buildSettings } from "../scripts/build-plan.mjs";

const root = join(__dirname, "..");
const scratch: string[] = [];
afterEach(() => { for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("pure build plan (#39)", () => {
  it("preserves browser selection and Relay URL priority without environment reads", () => {
    expect(buildSettings([], {})).toEqual({ browsers: ["firefox", "chrome"], relayUrl: "http://127.0.0.1:8787", e2e: false });
    expect(buildSettings(["--browser=all"], {}).browsers).toEqual(["firefox", "chrome"]);
    expect(buildSettings(["--browser=chrome"], {}).browsers).toEqual(["chrome"]);
    expect(buildSettings(["--browser=firefox"], {}).browsers).toEqual(["firefox"]);
    expect(buildSettings([], { PRIVACY_LINT_RELAY_URL: "https://env.example" }).relayUrl).toBe("https://env.example");
    expect(buildSettings(["--relay-url=https://cli.example"], { PRIVACY_LINT_RELAY_URL: "https://env.example" }).relayUrl).toBe("https://cli.example");
    expect(() => buildSettings(["--browser=unknown"], {})).toThrow("browser must");
  });

  it.each(["chrome", "firefox"] as const)("builds normal and E2E plans for %s with owned manifest data", (browser) => {
    const base = { action: { default_title: "Privacy Lint" }, optional_host_permissions: ["https://*/*", "http://*/*"] };
    const override = { background: { scripts: ["background.js"] } };
    const before = structuredClone({ base, override });
    const settings = buildSettings([`--browser=${browser}`], {});
    const normal = browserBuildPlan("/test", browser, settings, base, override, "0.1.0");
    expect(normal).toEqual(browserBuildPlan("/test", browser, settings, base, override, "0.1.0"));
    expect(normal.outdir).toBe(`/test/dist/${browser}`);
    expect(normal.buildOptions.target).toBe(browser === "chrome" ? "chrome120" : "firefox140");
    expect(normal.manifest.host_permissions).toBeUndefined();
    expect(normal.buildOptions.define!.__E2E__).toBe("false");
    const e2e = browserBuildPlan("/test", browser, { ...settings, e2e: true }, base, override, "0.1.0");
    expect(e2e.outdir).toBe(`/test/dist/${browser}-e2e`);
    expect(e2e.manifest.host_permissions).toEqual(["http://*/*", "https://*/*"]);
    (normal.manifest.action as { default_title: string }).default_title = "changed";
    expect({ base, override }).toEqual(before);
    expect((e2e.manifest.action as { default_title: string }).default_title).toBe("Privacy Lint");
  });

  it("keeps the normal-build E2E hook rejection", () => {
    expect(() => assertNoE2eHooks({ "content.js": "clean", "background.js": "clean" })).not.toThrow();
    expect(() => assertNoE2eHooks({ "content.js": "privacy-lint-e2e-dump" })).toThrow("content.js: E2E hook leaked");
  });
});

describe("icon shape refactor (#38)", () => {
  it("generates identical bytes for all four existing PNG sizes", () => {
    const work = mkdtempSync(join(tmpdir(), "privacy-lint-icons-"));
    scratch.push(work);
    mkdirSync(join(work, "scripts"));
    cpSync(join(root, "scripts/gen-icons.mjs"), join(work, "scripts/gen-icons.mjs"));
    execFileSync(process.execPath, [join(work, "scripts/gen-icons.mjs")]);
    for (const size of [16, 32, 48, 128]) {
      const filename = `icon-${size}.png`;
      expect(readFileSync(join(work, "icons", filename))).toEqual(readFileSync(join(root, "icons", filename)));
    }
  });
});
