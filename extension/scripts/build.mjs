// Builds dist/<browser>/ from one source tree (DESIGN.md §42).
// node scripts/build.mjs [--browser=chrome|firefox|all] [--relay-url=URL] [--e2e]
import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { assertNoE2eHooks, browserBuildPlan, buildSettings } from "./build-plan.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readJson(path) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

function copyAssets(outdir) {
  for (const file of ["popup.html", "options.html", "ui.css"]) cpSync(join(root, "src/ui", file), join(outdir, file));
  cpSync(join(root, "icons"), join(outdir, "icons"), { recursive: true });
}

function verifyNormalOutput(outdir) {
  const texts = Object.fromEntries(["content.js", "background.js"].map((file) => [file, readFileSync(join(outdir, file), "utf8")]));
  assertNoE2eHooks(texts);
}

async function executePlan(plan) {
  rmSync(plan.outdir, { recursive: true, force: true });
  mkdirSync(plan.outdir, { recursive: true });
  await build(plan.buildOptions);
  copyAssets(plan.outdir);
  if (!plan.e2e) verifyNormalOutput(plan.outdir);
  writeFileSync(join(plan.outdir, "manifest.json"), JSON.stringify(plan.manifest, null, 2) + "\n");
  console.log(`built ${plan.outdir}`);
}

async function main() {
  const settings = buildSettings(process.argv.slice(2), process.env);
  const baseManifest = readJson("manifest/base.json");
  const { version } = readJson("package.json");
  for (const browser of settings.browsers) {
    const browserManifest = readJson(`manifest/${browser}.json`);
    const plan = browserBuildPlan(root, browser, settings, baseManifest, browserManifest, version);
    await executePlan(plan);
  }
}

await main();
