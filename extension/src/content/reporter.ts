/**
 * Decides what the content script tells the background about the page's sensitive form.
 *
 * - A new or changed form → "observation" (deduplicated by signature).
 * - A previously reported form that is no longer present, including after same-document
 *   navigation to a page without one → "form-gone", so stale results are cleared (#14).
 */
import type { ContentMessage } from "../shared/messages";
import { observationSignature } from "../shared/signature";
import type { ControlRegistry } from "./control-registry";
import { buildObservation } from "./page-observer";

export function createReporter(
  doc: Document,
  registry: ControlRegistry,
  send: (message: ContentMessage) => void,
  perf?: Pick<Performance, "getEntriesByType">,
): () => void {
  let lastSignature = "";
  let lastHref = doc.URL;
  let reported = false;

  return () => {
    // Same-document navigation (SPA routing): report again even if the form looks the same.
    if (doc.URL !== lastHref) {
      lastHref = doc.URL;
      lastSignature = "";
    }
    registry.prune();
    const observation = buildObservation(doc, registry, perf);
    if (!observation) {
      if (reported) send({ type: "form-gone" });
      reported = false;
      lastSignature = "";
      return;
    }
    const signature = observationSignature(observation);
    if (signature === lastSignature) return;
    lastSignature = signature;
    reported = true;
    send({ type: "observation", observation });
  };
}
