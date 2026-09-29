/**
 * Privacy Relay client (DESIGN.md §3.9, §22).
 * The extension holds no Jev credentials; it only knows the relay URL.
 */
import type { AssessRequest, AssessResponse } from "../shared/schema";
import { validateAssessRequest, validateAssessResponse } from "../shared/validate";
import type { Settings } from "./settings";

const TIMEOUT_MS = 20000;

export async function requestAssessment(
  settings: Pick<Settings, "relayUrl" | "relayCredential">,
  request: AssessRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<AssessResponse | null> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (settings.relayCredential) headers.Authorization = `Bearer ${settings.relayCredential}`;
  try {
    // Re-validate right before sending: nothing outside the schema can leave the browser.
    const body = JSON.stringify(validateAssessRequest(request));
    const res = await fetchImpl(new URL("/v1/assess", settings.relayUrl).href, {
      method: "POST",
      headers,
      body,
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return validateAssessResponse(await res.json());
  } catch {
    return null;
  }
}
