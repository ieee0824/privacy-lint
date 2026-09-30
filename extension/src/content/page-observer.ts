/** Builds the sanitized PageObservation for the top frame (DESIGN.md §16). */
import type { PageObservation } from "../shared/schema";
import { LIMITS, SCHEMA_VERSION } from "../shared/schema";
import { classifyPath, schemeOf } from "../privacy/url-sanitizer";
import { sanitizeText } from "../privacy/sanitizer";
import { authorText } from "./dom-text";
import { discoverLinks } from "./document-links";
import { observeForm } from "./form-scanner";
import { collectComponents } from "./component-scanner";
import { collectResourceOrigins } from "./resource-scanner";
import type { ControlRegistry } from "./control-registry";

export function buildObservation(
  doc: Document,
  registry: ControlRegistry,
  perf?: Pick<Performance, "getEntriesByType">,
): PageObservation | null {
  const group = registry.selectedGroup();
  if (!group) return null;

  const pageUrl = new URL(doc.URL);
  const page: PageObservation["page"] = {
    origin: pageUrl.origin,
    scheme: schemeOf(pageUrl),
    pathClass: classifyPath(pageUrl.pathname),
    headings: Array.from(doc.querySelectorAll("h1, h2"))
      .slice(0, LIMITS.headings)
      .map((h) => authorText(h, LIMITS.shortText))
      .filter(Boolean),
  };
  const title = sanitizeText(doc.title ?? "", LIMITS.shortText);
  if (title) page.title = title;
  const footerEl = doc.querySelector("footer, [role=contentinfo]");
  const footer = footerEl ? authorText(footerEl, LIMITS.footerText) : "";
  if (footer) page.footer = footer;

  return {
    schemaVersion: SCHEMA_VERSION,
    page,
    form: observeForm(group, pageUrl),
    links: discoverLinks(doc),
    resources: collectResourceOrigins(doc, perf),
    components: collectComponents(doc, perf),
  };
}
