import type { BuildOptions } from "esbuild";

export interface BuildSettings {
  browsers: Array<"chrome" | "firefox">;
  relayUrl: string;
  e2e: boolean;
}

export interface BrowserBuildPlan {
  browser: "chrome" | "firefox";
  e2e: boolean;
  outdir: string;
  manifest: Record<string, unknown>;
  buildOptions: BuildOptions;
}

export function buildSettings(argv: readonly string[], environment: Readonly<Record<string, string | undefined>>): BuildSettings;
export function browserBuildPlan(root: string, browser: "chrome" | "firefox", settings: Readonly<BuildSettings>, baseManifest: Readonly<Record<string, unknown>>, browserManifest: Readonly<Record<string, unknown>>, version: string): BrowserBuildPlan;
export function assertNoE2eHooks(outputTexts: Readonly<Record<string, string>>): void;
