/** Pure build decisions: no file access, environment reads, or esbuild execution. */
import { join } from "node:path";

export function buildSettings(argv, environment) {
  const args = Object.fromEntries(argv.map((arg) => {
    const [key, value] = arg.replace(/^--/, "").split("=");
    return [key, value ?? true];
  }));
  const browsers = !args.browser || args.browser === "all" ? ["firefox", "chrome"] : [args.browser];
  if (browsers.some((browser) => !["chrome", "firefox"].includes(browser))) throw new Error("browser must be chrome, firefox, or all");
  return {
    browsers,
    relayUrl: args["relay-url"] ?? environment.PRIVACY_LINT_RELAY_URL ?? "http://127.0.0.1:8787",
    e2e: Boolean(args.e2e),
  };
}

export function browserBuildPlan(root, browser, settings, baseManifest, browserManifest, version) {
  const outdir = join(root, settings.e2e ? `dist/${browser}-e2e` : `dist/${browser}`);
  const manifest = structuredClone({ ...baseManifest, ...browserManifest, version });
  if (settings.e2e) manifest.host_permissions = ["http://*/*", "https://*/*"];
  return {
    browser,
    e2e: settings.e2e,
    outdir,
    manifest,
    buildOptions: {
      entryPoints: {
        content: join(root, "src/content/index.ts"),
        background: join(root, "src/background/service-worker.ts"),
        popup: join(root, "src/ui/popup.ts"),
        options: join(root, "src/ui/options.ts"),
      },
      outdir,
      bundle: true,
      format: "iife",
      target: browser === "chrome" ? "chrome120" : "firefox140",
      minify: false,
      // Drop E2E branches from normal builds, while keeping generated output readable.
      minifySyntax: true,
      sourcemap: false,
      legalComments: "none",
      define: { __RELAY_URL__: JSON.stringify(settings.relayUrl), __E2E__: JSON.stringify(settings.e2e) },
      logLevel: "warning",
    },
  };
}

export function assertNoE2eHooks(outputTexts) {
  for (const [file, text] of Object.entries(outputTexts)) {
    if (text.includes("e2e-dump")) throw new Error(`${file}: E2E hook leaked into a normal build`);
  }
}
