import type { PageObservation } from "./schema";

/** Changes in this signature trigger a new assessment; it is also part of the cache key. */
export function observationSignature(o: PageObservation): string {
  const kinds = Array.from(new Set(o.form.fields.map((f) => f.kind))).sort();
  return JSON.stringify([
    kinds,
    o.form.actionOrigin ?? "",
    o.form.method,
    o.links.privacy.map((l) => l.url),
    o.links.operator.map((l) => l.url),
  ]);
}
