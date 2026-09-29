import type { PageObservation } from "./schema";

/**
 * Identity of everything the assessment reads (#16). A change re-triggers the assessment,
 * and it is part of the cache key, so different pages or descriptions never share a result.
 *
 * It is built from the sanitized observation, which by construction holds no user-entered
 * values. Resource origins are left out: ad and analytics loads change them continuously,
 * and they only feed an explanatory count.
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
  ]);
}
