/** User settings (DESIGN.md §25). Stored in storage.local; contains no browsing data. */
import { ext } from "../shared/browser";

export interface Settings {
  /** Privacy Relay endpoint. Changing it is the explicit developer opt-in of DESIGN.md §3.9. */
  relayUrl: string;
  /** Optional bearer token for a private relay deployment. Not a Jev API key. */
  relayCredential: string;
  /** Send extracted, sanitized excerpts to the relay for Jev evaluation. */
  remoteEvaluation: boolean;
  /** Show a non-blocking notice when the user starts typing into a sensitive field. */
  inPageNotice: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  relayUrl: __RELAY_URL__,
  relayCredential: "",
  remoteEvaluation: true,
  inPageNotice: true,
};

export const SETTINGS_KEY = "settings";
const KEY = SETTINGS_KEY;

/**
 * The settings that change an assessment's outcome (#15). `inPageNotice` only affects display.
 * The relay endpoint and credential matter only while remote evaluation is on.
 * Used inside a SHA-256 cache key, so the credential is never stored in plain text.
 */
export function evaluationFingerprint(settings: Partial<Settings> | undefined): string {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  return JSON.stringify(s.remoteEvaluation ? [true, s.relayUrl, s.relayCredential] : [false]);
}

export async function loadSettings(): Promise<Settings> {
  const stored = (await ext.storage.local.get(KEY))[KEY] as Partial<Settings> | undefined;
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await ext.storage.local.set({ [KEY]: settings });
}
