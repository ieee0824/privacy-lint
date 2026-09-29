/**
 * Data model shared by content script, background and relay client.
 *
 * Nothing in this file may carry a user-entered value (DESIGN.md §3.1).
 * Every string that originates from a web page is untrusted, length-limited
 * and passed through the sanitizer before it leaves the extension.
 */

export const SCHEMA_VERSION = 1;

export type SensitiveFieldKind =
  | "name"
  | "email"
  | "phone"
  | "address"
  | "birthdate"
  | "password"
  | "payment"
  | "government_id"
  | "other_personal"
  | "unknown";

export const SENSITIVE_FIELD_KINDS: readonly SensitiveFieldKind[] = [
  "name",
  "email",
  "phone",
  "address",
  "birthdate",
  "password",
  "payment",
  "government_id",
  "other_personal",
  "unknown",
];

export type Scheme = "https" | "http" | "other";

export type PathClass =
  | "checkout"
  | "signup"
  | "login"
  | "contact"
  | "reservation"
  | "newsletter"
  | "account"
  | "application"
  | "other";

export const PATH_CLASSES: readonly PathClass[] = [
  "checkout",
  "signup",
  "login",
  "contact",
  "reservation",
  "newsletter",
  "account",
  "application",
  "other",
];

export type ResourceKind =
  | "script"
  | "iframe"
  | "xhr"
  | "fetch"
  | "image"
  | "font"
  | "stylesheet"
  | "other";

export const RESOURCE_KINDS: readonly ResourceKind[] = [
  "script",
  "iframe",
  "xhr",
  "fetch",
  "image",
  "font",
  "stylesheet",
  "other",
];

export type FormMethod = "get" | "post" | "dialog" | "none" | "other";

export const FORM_METHODS: readonly FormMethod[] = ["get", "post", "dialog", "none", "other"];

/** Structural description of one form control. Never includes its value. */
export interface FieldDescriptor {
  kind: SensitiveFieldKind;
  /** Visible label text, sanitized and truncated. */
  label?: string;
  required: boolean;
}

export interface FormObservation {
  method: FormMethod;
  /** Origin of the submission target, when one can be determined. */
  actionOrigin?: string;
  actionScheme: Scheme | "none";
  crossOriginAction: boolean;
  fieldCount: number;
  fields: FieldDescriptor[];
  /** Short author-provided texts around the form: legend, submit button, nearby heading. */
  context: string[];
}

export interface DocumentLink {
  /** origin + pathname only; query string and fragment removed. */
  url: string;
  text: string;
}

export interface ResourceOrigin {
  origin: string;
  kind: ResourceKind;
}

/**
 * Software components whose support status is known (see risk/component-lifecycle.ts).
 * Only these fixed IDs and a numeric version ever leave the detector; never the URL it came from.
 */
export const COMPONENT_IDS = [
  "jquery",
  "bootstrap",
  "angularjs",
  "vue",
  "wordpress",
  "drupal",
  "php",
  "apache",
  "iis",
] as const;

export type ComponentId = (typeof COMPONENT_IDS)[number];

export interface ComponentObservation {
  id: ComponentId;
  /** Numeric dotted version, e.g. "1.8.3". */
  version: string;
}

/** Content script → background. Produced only when a sensitive field was detected. */
export interface PageObservation {
  schemaVersion: number;
  page: {
    origin: string;
    scheme: Scheme;
    pathClass: PathClass;
    title?: string;
    headings: string[];
    footer?: string;
  };
  form: FormObservation;
  links: {
    privacy: DocumentLink[];
    operator: DocumentLink[];
  };
  resources: ResourceOrigin[];
  components: ComponentObservation[];
}

export interface LinkedDocumentState {
  found: boolean;
  fetched: boolean;
  title?: string;
  excerpts: string[];
}

/**
 * Background → relay. This is the only payload that leaves the browser.
 * Relay places it under `state.website` and never lets it influence question text.
 */
export interface AssessRequest {
  schemaVersion: number;
  website: {
    page: {
      origin: string;
      scheme: Scheme;
      pathClass: PathClass;
      title?: string;
      headings: string[];
      footer?: string;
    };
    form: {
      method: FormMethod;
      crossOriginAction: boolean;
      crossSiteAction: boolean;
      fields: FieldDescriptor[];
      context: string[];
    };
    privacyPolicy: LinkedDocumentState;
    operatorInfo: LinkedDocumentState;
    thirdParty: {
      totalOrigins: number;
      scriptOrigins: number;
      iframeOrigins: number;
    };
  };
}

export const QUESTION_IDS = [
  "operator_identifiable",
  "operator_contact_available",
  "policy_describes_collection",
  "policy_describes_purpose",
  "policy_describes_third_party",
  "policy_describes_contact",
  "policy_covers_form_fields",
  "data_minimization",
  "maintenance_signals",
] as const;

export type QuestionId = (typeof QUESTION_IDS)[number];

export type JevAnswer =
  | { type: "noul"; noul: number }
  | { type: "score"; score: number; confidence: number; probabilities: Record<string, number> }
  | { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> };

export interface AssessResponse {
  schemaVersion: number;
  answers: Partial<Record<QuestionId, JevAnswer>>;
}

export const LIMITS = {
  shortText: 120,
  labelText: 60,
  footerText: 300,
  excerptText: 280,
  excerptsPerDocument: 12,
  headings: 5,
  contextTexts: 6,
  fields: 40,
  links: 3,
  resources: 300,
  components: 30,
  urlLength: 2048,
} as const;
