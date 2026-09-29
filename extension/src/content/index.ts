/**
 * Content script entry. Runs in the ISOLATED world of the top frame only (DESIGN.md §13, §28).
 */
import { ext } from "../shared/browser";
import type { ContentMessage, ContentNotice } from "../shared/messages";
import { showNotice } from "../ui/warning";
import { ControlRegistry } from "./control-registry";
import { watchForFormChanges } from "./mutation-observer";
import { observationSignature } from "../shared/signature";
import { buildObservation } from "./page-observer";
import { installFocusTrigger } from "./ui-trigger";

const LOADED = Symbol.for("privacy-lint.content-loaded");

function send(message: ContentMessage): void {
  ext.runtime.sendMessage(message).catch(() => {
    // Background may be restarting; the next DOM change or focus retries.
  });
}

function main(): void {
  const registry = new ControlRegistry();
  registry.addFrom(document);

  let lastSignature = "";
  let lastHref = location.href;
  const report = () => {
    // Same-document navigation (SPA routing) clears the tab status in the background.
    if (location.href !== lastHref) {
      lastHref = location.href;
      lastSignature = "";
    }
    registry.prune();
    const observation = buildObservation(document, registry, performance);
    if (!observation) return;
    const signature = observationSignature(observation);
    if (signature === lastSignature) return;
    lastSignature = signature;
    send({ type: "observation", observation });
  };

  report();
  watchForFormChanges(document, registry, report);
  installFocusTrigger(document, registry, () => send({ type: "sensitive-focus" }));

  ext.runtime.onMessage.addListener((message: ContentNotice, sender) => {
    if (sender.id !== ext.runtime.id || message?.type !== "show-notice") return;
    showNotice(document, message.assessment);
  });
}

/** E2E-only: lets the test page read extension storage where WebDriver BiDi cannot (Firefox). */
function installE2eHook(): void {
  document.addEventListener("privacy-lint-e2e-dump", () => {
    ext.runtime.sendMessage({ type: "e2e-dump" }).then((dump) => {
      document.documentElement.setAttribute("data-privacy-lint-e2e-dump", JSON.stringify(dump));
    });
  });
}

const scope = globalThis as unknown as Record<symbol, boolean>;
if (window.top === window && !scope[LOADED]) {
  scope[LOADED] = true;
  main();
  if (__E2E__) installE2eHook();
}
