/**
 * Content script entry. Runs in the ISOLATED world of the top frame only (DESIGN.md §13, §28).
 */
import { ext } from "../shared/browser";
import type { ContentMessage, ContentNotice, ContentRequest } from "../shared/messages";
import { clearNotice, showNotice } from "../ui/warning";
import { ControlRegistry } from "./control-registry";
import { watchForFormChanges } from "./mutation-observer";
import { createReporter } from "./reporter";
import { installFocusTrigger } from "./ui-trigger";
import { watchResourceChanges } from "./resource-observer";

const LOADED = Symbol.for("privacy-lint.content-loaded");

function send(message: ContentMessage): void {
  ext.runtime.sendMessage(message).catch(() => {
    // Background may be restarting; the next DOM change or focus retries.
  });
}

function main(): void {
  const registry = new ControlRegistry();
  registry.addFrom(document);

  const report = createReporter(document, registry, send, performance, () => {
    clearNotice(document);
    if (report.lifecycle() === null) focusTrigger.reset();
  });
  const focusTrigger = installFocusTrigger(document, registry, control => report.focus(control));

  report();
  watchForFormChanges(document, registry, report);
  watchResourceChanges(report);
  window.addEventListener("popstate", report);
  window.addEventListener("hashchange", report);

  ext.runtime.onMessage.addListener((message: ContentNotice | ContentRequest, sender, sendResponse) => {
    if (sender.id !== ext.runtime.id) return false;
    if (message?.type === "refresh-observation") {
      sendResponse(report.refresh());
      return false;
    }
    if (message?.type !== "show-notice") return false;
    report.refresh(true);
    if (!message.signature || message.signature !== report.signature()) return;
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
