/**
 * Deterministic field classification (DESIGN.md §14).
 * Signals are consulted in priority order: autocomplete → type → name → id → placeholder → label.
 * Input is attribute/label metadata only; values are never part of the signature.
 */
import type { SensitiveFieldKind } from "../shared/schema";

export interface FieldSignals {
  tag: "input" | "textarea" | "select";
  type: string;
  autocomplete?: string;
  name?: string;
  id?: string;
  placeholder?: string;
  label?: string;
}

/** Controls that cannot carry personal data typed by the user, or are search boxes. */
const IGNORED_INPUT_TYPES = new Set([
  "hidden",
  "submit",
  "button",
  "reset",
  "image",
  "checkbox",
  "radio",
  "range",
  "color",
  "search",
]);

export function isClassifiable(signals: FieldSignals): boolean {
  return !(signals.tag === "input" && IGNORED_INPUT_TYPES.has(signals.type));
}

const AUTOCOMPLETE_KINDS: Record<string, SensitiveFieldKind> = {
  name: "name",
  "honorific-prefix": "name",
  "given-name": "name",
  "additional-name": "name",
  "family-name": "name",
  "honorific-suffix": "name",
  nickname: "name",
  email: "email",
  tel: "phone",
  "tel-national": "phone",
  "tel-local": "phone",
  "tel-country-code": "phone",
  "tel-area-code": "phone",
  "tel-extension": "phone",
  "street-address": "address",
  "address-line1": "address",
  "address-line2": "address",
  "address-line3": "address",
  "address-level1": "address",
  "address-level2": "address",
  "address-level3": "address",
  "address-level4": "address",
  "postal-code": "address",
  country: "address",
  "country-name": "address",
  bday: "birthdate",
  "bday-day": "birthdate",
  "bday-month": "birthdate",
  "bday-year": "birthdate",
  "current-password": "password",
  "new-password": "password",
  "cc-name": "payment",
  "cc-given-name": "payment",
  "cc-additional-name": "payment",
  "cc-family-name": "payment",
  "cc-number": "payment",
  "cc-exp": "payment",
  "cc-exp-month": "payment",
  "cc-exp-year": "payment",
  "cc-csc": "payment",
  "cc-type": "payment",
  username: "other_personal",
  "one-time-code": "other_personal",
  organization: "other_personal",
  "organization-title": "other_personal",
  sex: "other_personal",
};

const TYPE_KINDS = new Map<string, SensitiveFieldKind>([
  ["email", "email"],
  ["tel", "phone"],
  ["password", "password"],
]);

// Romanized Japanese names (namae, jusho, denwa …) are common on older sites.
// Order matters: email before address ("email address"), payment/government_id before name
// ("card holder name", "passport number"), other_personal before name ("company name", "username").
const TEXT_RULES: ReadonlyArray<[SensitiveFieldKind, RegExp]> = [
  ["email", /e-?mail|メール|mail_?addr|^mail$|^mail[_-]|[_-]mail$/i],
  ["password", /passw(or)?d|passcode|パスワード|暗証番号/i],
  [
    "payment",
    /card.?(num|no|holder|name)|cc-?(num|name|exp|csc)|credit|cvc|cvv|security.?code|expir|カード|有効期限|セキュリティ.?コード|口座|bank|iban|account.?(number|no)|振込/i,
  ],
  [
    "government_id",
    /my.?number|マイナンバー|個人番号|passport|パスポート|免許|driver.?licen|ssn|social.?security|保険証|在留カード|national.?id|tax.?id/i,
  ],
  ["birthdate", /birth|bday|dob\b|生年月日|誕生日|seinengappi|tanjou?bi/i],
  ["phone", /\btel\b|tel_|_tel|phone|mobile|cell|電話|携帯|\bfax\b|denwa|keitai/i],
  [
    "address",
    /address|addr\b|addr_|street|city|\bzip|postal|post.?code|prefecture|住所|郵便番号|都道府県|市区町村|番地|建物|丁目|ju+sho|yu+bin|todoufuken/i,
  ],
  [
    "other_personal",
    /user.?name|user.?id|login.?id|ユーザー名|ユーザーid|company|organi[sz]ation|会社名|勤務先|職業|occupation|job.?title|gender|\bsex\b|性別|\bage\b|年齢|health|medical|病歴|既往|症状|持病|religion|宗教/i,
  ],
  [
    "name",
    /(^|[\s_\-[\].])(full|first|last|family|given|real|middle|sur)?_?name($|[\s_\-[\].])|firstname|lastname|fullname|surname|氏名|名前|お名前|フリガナ|ふりがな|カナ|\bkana\b|\bsei\b|\bmei\b|o?namae|shimei|furigana/i,
  ],
];

/** Japanese forms often split names into single-character labels. */
const SHORT_NAME_LABEL = /^(姓|名|せい|めい|セイ|メイ)[\s*※(（]*/;

export function classifyField(signals: FieldSignals): SensitiveFieldKind {
  const auto = autocompleteKind(signals.autocomplete);
  if (auto) return auto;

  const byType = signals.tag === "input" ? TYPE_KINDS.get(signals.type) : undefined;
  if (byType) return byType;

  for (const text of [signals.name, signals.id, signals.placeholder, signals.label]) {
    if (!text) continue;
    const kind = textKind(text);
    if (kind) return kind;
  }
  if (signals.label && SHORT_NAME_LABEL.test(signals.label.trim())) return "name";
  if (signals.tag === "input" && signals.type === "date" && signals.label && /生|birth/i.test(signals.label)) {
    return "birthdate";
  }
  return "unknown";
}

function autocompleteKind(autocomplete: string | undefined): SensitiveFieldKind | undefined {
  if (!autocomplete) return undefined;
  // e.g. "section-blue shipping street-address", "billing tel"
  const tokens = autocomplete.toLowerCase().trim().split(/\s+/);
  for (const token of tokens.reverse()) {
    const kind = AUTOCOMPLETE_KINDS[token];
    if (kind) return kind;
  }
  return undefined;
}

function textKind(text: string): SensitiveFieldKind | undefined {
  for (const [kind, pattern] of TEXT_RULES) {
    if (pattern.test(text)) return kind;
  }
  return undefined;
}

export function isSensitive(kind: SensitiveFieldKind): boolean {
  return kind !== "unknown";
}
