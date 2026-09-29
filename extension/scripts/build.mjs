// Builds dist/<browser>/ from one TypeScript source tree (DESIGN.md §42).
//   node scripts/build.mjs [--browser=chrome|firefox|all] [--relay-url=URL] [--e2e]
// --e2e grants host permissions statically so automated browsers need no permission prompt.
import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }),
);
const browsers = !args.browser || args.browser === "all" ? ["firefox", "chrome"] : [args.browser];
const relayUrl = args["relay-url"] ?? process.env.PRIVACY_LINT_RELAY_URL ?? "http://127.0.0.1:8787";
const e2e = Boolean(args.e2e);
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const readJson = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));

for (const browser of browsers) {
  const out = join(root, e2e ? `dist/${browser}-e2e` : `dist/${browser}`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  await build({
    entryPoints: {
      content: join(root, "src/content/index.ts"),
      background: join(root, "src/background/service-worker.ts"),
      popup: join(root, "src/ui/popup.ts"),
      options: join(root, "src/ui/options.ts"),
    },
    outdir: out,
    bundle: true,
    format: "iife",
    target: browser === "chrome" ? "chrome120" : "firefox140",
    minify: false,
    // Removes `if (__E2E__)` branches from normal builds while keeping output readable.
    minifySyntax: true,
    sourcemap: false,
    legalComments: "none",
    define: { __RELAY_URL__: JSON.stringify(relayUrl), __E2E__: JSON.stringify(e2e) },
    logLevel: "warning",
  });

  for (const file of ["popup.html", "options.html", "ui.css"]) cpSync(join(root, "src/ui", file), join(out, file));
  cpSync(join(root, "icons"), join(out, "icons"), { recursive: true });

  if (!e2e) {
    for (const file of ["content.js", "background.js"]) {
      if (readFileSync(join(out, file), "utf8").includes("e2e-dump")) {
        throw new Error(`${file}: E2E hook leaked into a normal build`);
      }
    }
  }

  const manifest = { ...readJson("manifest/base.json"), ...readJson(`manifest/${browser}.json`), version: pkg.version };
  if (e2e) manifest.host_permissions = ["http://*/*", "https://*/*"];
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`built ${out}`);
}
