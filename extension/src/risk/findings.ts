/**
 * User-facing wording (DESIGN.md §10.3, §21).
 *
 * Wording rules (§3.10, §3.11): never say "safe", "dangerous", "fraud" or
 * "vulnerable"; describe what could or could not be confirmed.
 */
import type { AssessmentState, Finding, FindingId, Statuses, WarningLevel } from "../shared/assessment";
import type { SensitiveFieldKind } from "../shared/schema";

const FINDING_TEXT: Record<FindingId, (f: Finding) => string> = {
  insecure_page: () => "このページはHTTPSで保護されていません",
  insecure_form_action: () => "フォームの送信先がHTTPSではありません",
  cross_site_form_action: () => "フォームの送信先が現在のサイトとは異なるドメインです",
  cross_origin_form_action: () => "フォームの送信先が同じサイト内の別のホストです",
  privacy_policy_not_found: () => "プライバシーポリシーへのリンクが見つかりませんでした",
  privacy_policy_unreachable: () => "プライバシーポリシーの内容を取得できませんでした",
  privacy_collection_unclear: () => "収集する個人情報の説明を確認できませんでした",
  privacy_purpose_unclear: () => "個人情報の利用目的を十分確認できませんでした",
  privacy_third_party_unclear: () => "第三者提供についての説明を確認できませんでした",
  privacy_contact_unclear: () => "個人情報に関する問い合わせ窓口を確認できませんでした",
  policy_form_misaligned: () => "プライバシーポリシーがこのフォームで求められる情報に触れているか確認できませんでした",
  operator_not_found: () => "運営者情報のページが見つかりませんでした",
  operator_unclear: () => "サービスの運営主体を明確に確認できませんでした",
  operator_contact_unclear: () => "運営者への連絡手段を確認できませんでした",
  data_minimization_concern: () => "ページ上の説明に対して、求められる個人情報が多い可能性があります",
  data_minimization_minor: () => "求められる個人情報がやや多めです",
  third_party_scripts_many: (f) => `${f.count ?? 0}種類の外部サービスのスクリプトがこのページで動作しています`,
  third_party_scripts_some: (f) => `${f.count ?? 0}種類の外部サービスのスクリプトがこのページで動作しています`,
  maintenance_signals: () => "利用者向けの文書が長期間更新されていない兆候があります",
  outdated_components: (f) =>
    `提供元のサポートが終了した版のソフトウェアが使われています: ${(f.names ?? []).join("、")}`,
  unknown_operator: () => "運営者情報については判断に十分な情報が得られませんでした",
  unknown_privacy_disclosure: () => "プライバシーポリシーの内容については判断に十分な情報が得られませんでした",
  unknown_policy_alignment: () => "ポリシーとフォームの対応については判断に十分な情報が得られませんでした",
  unknown_data_minimization: () => "入力項目の妥当性については判断に十分な情報が得られませんでした",
  remote_evaluation_disabled: () => "文書内容の評価（外部送信）は設定で無効になっています",
  remote_evaluation_unavailable: () => "文書内容の評価サービスに接続できませんでした",
};

export function findingText(finding: Finding): string {
  return FINDING_TEXT[finding.id](finding);
}

export function findingIcon(finding: Finding): string {
  return finding.severity === "warn" ? "⚠" : "ℹ";
}

const LEVEL_HEADLINE: Record<WarningLevel, string> = {
  0: "特に注意を促す兆候は確認できませんでした",
  1: "念のため確認できる事項があります",
  2: "入力前に確認をおすすめします",
  3: "個人情報を入力する前に追加確認をおすすめします",
};

export function headline(state: AssessmentState, level: WarningLevel): string {
  if (state === "jev_unavailable") return "現在評価できません";
  if (state === "permission_denied") return "このサイトでは評価が有効になっていません";
  if (state === "unsupported_page") return "このページは評価の対象外です";
  if (state === "insufficient_information" && level <= 1) return "判断に十分な情報が得られませんでした";
  return LEVEL_HEADLINE[level];
}

export const DISCLAIMER =
  "これはサイトの脆弱性や悪意を確認したという意味ではありません。観測できなかった問題が存在しないことも意味しません。";

export const STATUS_TEXT = {
  operator: {
    confirmed: "確認できました",
    unclear: "明確には確認できませんでした",
    not_found: "見つかりませんでした",
    unknown: "判断できませんでした",
  },
  privacyPolicy: {
    found: "見つかりました",
    not_found: "見つかりませんでした",
    unreachable: "リンクはありますが取得できませんでした",
  },
  formAction: {
    same_origin: "このサイト",
    same_site: "同じサイト内の別ホスト",
    cross_site: "別のドメイン",
    none: "特定できませんでした",
  },
} satisfies { [K in keyof Statuses]: Record<Statuses[K], string> };

export const FIELD_KIND_TEXT: Record<SensitiveFieldKind, string> = {
  "name": "氏名",
  "email": "メールアドレス",
  "phone": "電話番号",
  "address": "住所",
  "birthdate": "生年月日",
  "password": "パスワード",
  "payment": "決済情報",
  "government_id": "本人確認情報",
  "other_personal": "その他の個人情報",
  "unknown": "不明",
};
