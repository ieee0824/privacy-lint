/**
 * Strict runtime validation for data crossing a trust boundary:
 * content script → background, background → relay, relay → background (DESIGN.md §17).
 * Unknown keys are rejected so nothing unexpected can ride along.
 */
import type {
  AssessRequest,
  AssessResponse,
  DocumentLink,
  FieldDescriptor,
  FormObservation,
  JevAnswer,
  PageObservation,
  ResourceOrigin,
} from "./schema";
import {
  FORM_METHODS,
  LIMITS,
  PATH_CLASSES,
  QUESTION_IDS,
  RESOURCE_KINDS,
  SCHEMA_VERSION,
  SENSITIVE_FIELD_KINDS,
} from "./schema";
import { isOrigin } from "../privacy/url-sanitizer";

export class ValidationError extends Error {}

type Obj = Record<string, unknown>;

function fail(path: string, why: string): never {
  throw new ValidationError(`${path}: ${why}`);
}

function obj(v: unknown, path: string, allowed: readonly string[]): Obj {
  if (typeof v !== "object" || v === null || Array.isArray(v)) fail(path, "expected object");
  for (const key of Object.keys(v)) {
    if (!allowed.includes(key)) fail(path, `unexpected key ${key}`);
  }
  return v as Obj;
}

function str(v: unknown, path: string, max: number): string {
  if (typeof v !== "string") fail(path, "expected string");
  if (Array.from(v).length > max) fail(path, "too long");
  return v;
}

function optStr(v: unknown, path: string, max: number): string | undefined {
  return v === undefined ? undefined : str(v, path, max);
}

function bool(v: unknown, path: string): boolean {
  if (typeof v !== "boolean") fail(path, "expected boolean");
  return v;
}

function int(v: unknown, path: string, max: number): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > max) fail(path, "expected bounded integer");
  return v;
}

function num(v: unknown, path: string, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) fail(path, "expected bounded number");
  return v;
}

function oneOf<T extends string>(v: unknown, path: string, values: readonly T[]): T {
  if (typeof v !== "string" || !values.includes(v as T)) fail(path, "unexpected value");
  return v as T;
}

function arr<T>(v: unknown, path: string, max: number, item: (x: unknown, p: string) => T): T[] {
  if (!Array.isArray(v)) fail(path, "expected array");
  if (v.length > max) fail(path, "too many items");
  return v.map((x, i) => item(x, `${path}[${i}]`));
}

function origin(v: unknown, path: string): string {
  const s = str(v, path, 300);
  if (!isOrigin(s)) fail(path, "not an origin");
  return s;
}

function httpUrl(v: unknown, path: string): string {
  const s = str(v, path, LIMITS.urlLength);
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    fail(path, "not a URL");
  }
  if (!(url.protocol === "https:" || url.protocol === "http:") || url.search || url.hash) {
    fail(path, "must be http(s) without query or fragment");
  }
  return s;
}

const SCHEMES = ["https", "http", "other"] as const;

function field(v: unknown, p: string): FieldDescriptor {
  const o = obj(v, p, ["kind", "label", "required"]);
  const f: FieldDescriptor = {
    kind: oneOf(o.kind, `${p}.kind`, SENSITIVE_FIELD_KINDS),
    required: bool(o.required, `${p}.required`),
  };
  const label = optStr(o.label, `${p}.label`, LIMITS.labelText);
  if (label !== undefined) f.label = label;
  return f;
}

function text(max: number) {
  return (v: unknown, p: string) => str(v, p, max);
}

function schemaVersion(v: unknown, p: string): number {
  if (v !== SCHEMA_VERSION) fail(p, "unsupported schema version");
  return SCHEMA_VERSION;
}

export function validatePageObservation(v: unknown): PageObservation {
  const o = obj(v, "observation", ["schemaVersion", "page", "form", "links", "resources"]);
  const page = obj(o.page, "page", ["origin", "scheme", "pathClass", "title", "headings", "footer"]);
  const form = obj(o.form, "form", [
    "method",
    "actionOrigin",
    "actionScheme",
    "crossOriginAction",
    "fieldCount",
    "fields",
    "context",
  ]);
  const links = obj(o.links, "links", ["privacy", "operator"]);
  const link = (x: unknown, p: string): DocumentLink => {
    const l = obj(x, p, ["url", "text"]);
    return { url: httpUrl(l.url, `${p}.url`), text: str(l.text, `${p}.text`, LIMITS.labelText) };
  };
  const resource = (x: unknown, p: string): ResourceOrigin => {
    const r = obj(x, p, ["origin", "kind"]);
    return { origin: origin(r.origin, `${p}.origin`), kind: oneOf(r.kind, `${p}.kind`, RESOURCE_KINDS) };
  };

  const formObs: FormObservation = {
    method: oneOf(form.method, "form.method", FORM_METHODS),
    actionScheme: oneOf(form.actionScheme, "form.actionScheme", [...SCHEMES, "none"] as const),
    crossOriginAction: bool(form.crossOriginAction, "form.crossOriginAction"),
    fieldCount: int(form.fieldCount, "form.fieldCount", 1000),
    fields: arr(form.fields, "form.fields", LIMITS.fields, field),
    context: arr(form.context, "form.context", LIMITS.contextTexts, text(LIMITS.shortText)),
  };
  if (form.actionOrigin !== undefined) formObs.actionOrigin = origin(form.actionOrigin, "form.actionOrigin");

  const pageObs: PageObservation["page"] = {
    origin: origin(page.origin, "page.origin"),
    scheme: oneOf(page.scheme, "page.scheme", SCHEMES),
    pathClass: oneOf(page.pathClass, "page.pathClass", PATH_CLASSES),
    headings: arr(page.headings, "page.headings", LIMITS.headings, text(LIMITS.shortText)),
  };
  const title = optStr(page.title, "page.title", LIMITS.shortText);
  if (title !== undefined) pageObs.title = title;
  const footer = optStr(page.footer, "page.footer", LIMITS.footerText);
  if (footer !== undefined) pageObs.footer = footer;

  return {
    schemaVersion: schemaVersion(o.schemaVersion, "schemaVersion"),
    page: pageObs,
    form: formObs,
    links: {
      privacy: arr(links.privacy, "links.privacy", LIMITS.links, link),
      operator: arr(links.operator, "links.operator", LIMITS.links, link),
    },
    resources: arr(o.resources, "resources", LIMITS.resources, resource),
  };
}

/** Validates the outbound payload right before it is sent (defence in depth). */
export function validateAssessRequest(v: unknown): AssessRequest {
  const o = obj(v, "request", ["schemaVersion", "website"]);
  const w = obj(o.website, "website", ["page", "form", "privacyPolicy", "operatorInfo", "thirdParty"]);
  const page = obj(w.page, "website.page", ["origin", "scheme", "pathClass", "title", "headings", "footer"]);
  const form = obj(w.form, "website.form", ["method", "crossOriginAction", "crossSiteAction", "fields", "context"]);
  const tp = obj(w.thirdParty, "website.thirdParty", ["totalOrigins", "scriptOrigins", "iframeOrigins"]);
  const doc = (x: unknown, p: string) => {
    const d = obj(x, p, ["found", "fetched", "title", "excerpts"]);
    const out: AssessRequest["website"]["privacyPolicy"] = {
      found: bool(d.found, `${p}.found`),
      fetched: bool(d.fetched, `${p}.fetched`),
      excerpts: arr(d.excerpts, `${p}.excerpts`, LIMITS.excerptsPerDocument, text(LIMITS.excerptText)),
    };
    const t = optStr(d.title, `${p}.title`, LIMITS.shortText);
    if (t !== undefined) out.title = t;
    return out;
  };

  const pageOut: AssessRequest["website"]["page"] = {
    origin: origin(page.origin, "website.page.origin"),
    scheme: oneOf(page.scheme, "website.page.scheme", SCHEMES),
    pathClass: oneOf(page.pathClass, "website.page.pathClass", PATH_CLASSES),
    headings: arr(page.headings, "website.page.headings", LIMITS.headings, text(LIMITS.shortText)),
  };
  const title = optStr(page.title, "website.page.title", LIMITS.shortText);
  if (title !== undefined) pageOut.title = title;
  const footer = optStr(page.footer, "website.page.footer", LIMITS.footerText);
  if (footer !== undefined) pageOut.footer = footer;

  return {
    schemaVersion: schemaVersion(o.schemaVersion, "schemaVersion"),
    website: {
      page: pageOut,
      form: {
        method: oneOf(form.method, "website.form.method", FORM_METHODS),
        crossOriginAction: bool(form.crossOriginAction, "website.form.crossOriginAction"),
        crossSiteAction: bool(form.crossSiteAction, "website.form.crossSiteAction"),
        fields: arr(form.fields, "website.form.fields", LIMITS.fields, field),
        context: arr(form.context, "website.form.context", LIMITS.contextTexts, text(LIMITS.shortText)),
      },
      privacyPolicy: doc(w.privacyPolicy, "website.privacyPolicy"),
      operatorInfo: doc(w.operatorInfo, "website.operatorInfo"),
      thirdParty: {
        totalOrigins: int(tp.totalOrigins, "website.thirdParty.totalOrigins", LIMITS.resources),
        scriptOrigins: int(tp.scriptOrigins, "website.thirdParty.scriptOrigins", LIMITS.resources),
        iframeOrigins: int(tp.iframeOrigins, "website.thirdParty.iframeOrigins", LIMITS.resources),
      },
    },
  };
}

function probabilities(v: unknown, p: string): Record<string, number> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) fail(p, "expected object");
  const out: Record<string, number> = {};
  for (const [k, x] of Object.entries(v).slice(0, 255)) out[str(k, p, 64)] = num(x, `${p}.${k}`, 0, 1);
  return out;
}

function answer(v: unknown, p: string): JevAnswer {
  const t = (v as Obj | null)?.type;
  if (t === "noul") {
    const o = obj(v, p, ["type", "noul"]);
    return { type: "noul", noul: num(o.noul, `${p}.noul`, 0, 1) };
  }
  if (t === "score") {
    const o = obj(v, p, ["type", "score", "confidence", "probabilities", "legend"]);
    return {
      type: "score",
      score: num(o.score, `${p}.score`, 0, 10),
      confidence: num(o.confidence, `${p}.confidence`, 0, 1),
      probabilities: probabilities(o.probabilities, `${p}.probabilities`),
    };
  }
  if (t === "choice") {
    const o = obj(v, p, ["type", "choice", "confidence", "probabilities"]);
    return {
      type: "choice",
      choice: str(o.choice, `${p}.choice`, 64),
      confidence: num(o.confidence, `${p}.confidence`, 0, 1),
      probabilities: probabilities(o.probabilities, `${p}.probabilities`),
    };
  }
  fail(p, "unknown answer type");
}

export function validateAssessResponse(v: unknown): AssessResponse {
  const o = obj(v, "response", ["schemaVersion", "model", "answers"]);
  const answersIn = obj(o.answers, "answers", QUESTION_IDS);
  const answers: AssessResponse["answers"] = {};
  for (const id of QUESTION_IDS) {
    if (answersIn[id] !== undefined) answers[id] = answer(answersIn[id], `answers.${id}`);
  }
  return { schemaVersion: schemaVersion(o.schemaVersion, "schemaVersion"), answers };
}
