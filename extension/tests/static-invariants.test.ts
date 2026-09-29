/**
 * Static guards for DESIGN.md §3 / §33 / §38. These are intentionally blunt:
 * a hit means "design review required", not "find a clever workaround".
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
  });
}

/** Code that runs inside web pages. */
const pageSide = [...files(join(root, "src/content")), join(root, "src/ui/warning.ts"), ...files(join(root, "src/privacy"))];
const allSource = files(join(root, "src"));

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function hits(paths: string[], pattern: RegExp): string[] {
  return paths.flatMap((p) => {
    const code = stripComments(readFileSync(p, "utf8"));
    return code.split("\n").flatMap((line, i) => (pattern.test(line) ? [`${relative(root, p)}:${i + 1}: ${line.trim()}`] : []));
  });
}

describe("page-side code never touches user data (§3.1–3.5)", () => {
  it.each([
    ["value reads", /\.value\b|\.valueAs|\bdefaultValue\b|\.checked\b|\.selectedIndex\b|\.selectedOptions\b|\.files\b/],
    ["value attribute", /getAttribute\(\s*["']value["']\s*\)/],
    ["FormData", /\bFormData\b/],
    ["input events", /addEventListener\(\s*["'](input|change|keydown|keyup|keypress|beforeinput|paste|copy|cut)["']/],
    ["cookies", /document\.cookie/],
    ["site storage", /\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b/],
    ["clipboard", /navigator\.clipboard/],
    ["bulk DOM text", /\.outerHTML\b|\.innerText\b|documentElement\.textContent|body\.textContent/],
    ["page messages", /addEventListener\(\s*["']message["']|onmessage\s*=/],
  ])("%s", (_name, pattern) => {
    expect(hits(pageSide, pattern)).toEqual([]);
  });
});

describe("no unsafe sinks anywhere (§33)", () => {
  it.each([
    ["eval", /\beval\s*\(/],
    ["Function constructor", /new\s+Function\s*\(/],
    ["innerHTML / insertAdjacentHTML", /\.innerHTML\s*=|insertAdjacentHTML|outerHTML\s*=|document\.write/],
    ["screenshots", /captureVisibleTab|captureTab/],
    ["webRequest body", /requestBody|onBeforeRequest/],
  ])("%s", (_name, pattern) => {
    expect(hits(allSource, pattern)).toEqual([]);
  });
});

describe("manifest permissions (§24)", () => {
  const forbidden = ["cookies", "history", "clipboardRead", "downloads", "debugger", "nativeMessaging", "webRequest", "tabs", "<all_urls>"];
  for (const name of ["base.json", "chrome.json", "firefox.json"]) {
    it(name, () => {
      const manifest = JSON.parse(readFileSync(join(root, "manifest", name), "utf8"));
      for (const p of manifest.permissions ?? []) expect(forbidden).not.toContain(p);
      expect(manifest.host_permissions).toBeUndefined();
      expect(manifest.content_scripts).toBeUndefined();
    });
  }
});

describe("no Jev credentials in the extension (§3.9)", () => {
  it("does not reference the Jev endpoint or API keys", () => {
    expect(hits(allSource, /api\.typesafe\.ai|TYPESAFE_API_KEY|JEV_API_KEY|systemone/i)).toEqual([]);
  });
});

describe("wording (§3.10, §3.11)", () => {
  it("never labels a site safe, dangerous, fraudulent or vulnerable", () => {
    const ui = [join(root, "src/risk/findings.ts"), join(root, "src/ui/popup.ts"), join(root, "src/ui/warning.ts")];
    const html = ["popup.html", "options.html"].map((f) => join(root, "src/ui", f));
    const text = [...ui, ...html].map((p) => stripComments(readFileSync(p, "utf8"))).join("\n");
    expect(text).not.toMatch(/安全です|安全なサイト|危険(サイト|です|な)|詐欺|脆弱なサイト|\bsafe\b|\bunsafe\b|\bdanger/i);
  });
});
