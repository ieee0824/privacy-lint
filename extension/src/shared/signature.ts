import type { PageObservation } from "./schema";
import { summarizeThirdParty } from "./resource-summary";

/**
 * Identity of everything the assessment reads (#16). A change re-triggers the assessment,
 * and it is part of the cache key, so different pages or descriptions never share a result.
 *
 * It is built from the sanitized observation, which by construction holds no user-entered
 * values. Resources contribute the same site counts that assessment uses; URL order
 * and loads within the same site do not trigger another assessment.
 */
export function observationSignature(o: PageObservation): string {
  return JSON.stringify([
    o.page.origin,
    o.page.scheme,
    o.page.pathClass,
    o.page.title ?? "",
    o.page.headings,
    o.page.footer ?? "",
    o.form.method,
    o.form.actionOrigin ?? "",
    o.form.actionScheme,
    o.form.fields.map((f) => [f.kind, f.label ?? "", f.required]),
    o.form.context,
    o.links.privacy.map((l) => l.url),
    o.links.operator.map((l) => l.url),
    o.components.map((c) => `${c.id}@${c.version}`).sort(),
    summarizeThirdParty(o.page.origin, o.resources),
  ]);
}
