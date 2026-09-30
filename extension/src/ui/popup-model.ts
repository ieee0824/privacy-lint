/** Display decisions are values; DOM construction and browser APIs live in popup-view. */
import type { Assessment, WarningLevel } from "../shared/assessment";
import type { TabStatusResponse } from "../shared/messages";
import { DISCLAIMER, FIELD_KIND_TEXT, STATUS_TEXT, findingIcon, findingText, headline } from "../risk/findings";

export interface AssessmentModel {
  kind: "assessment";
  title: string;
  level: WarningLevel;
  findings: Array<{ text: string; icon: string; severity: "warn" | "info" }>;
  statuses: Array<{ label: string; text: string }>;
  disclaimer: string;
}

export type PopupModel =
  | { kind: "message"; title: string; description?: string }
  | { kind: "permission"; title: string; description: string; origin?: string }
  | AssessmentModel;

export function assessmentModel(a: Readonly<Assessment>): AssessmentModel {
  return {
    kind: "assessment",
    title: headline(a.state, a.level),
    level: a.level,
    findings: a.findings.map((f) => ({ text: findingText(f), icon: findingIcon(f), severity: f.severity })),
    statuses: [
      { label: "運営会社情報", text: STATUS_TEXT.operator[a.statuses.operator] },
      { label: "プライバシーポリシー", text: STATUS_TEXT.privacyPolicy[a.statuses.privacyPolicy] },
      { label: "フォーム送信先", text: STATUS_TEXT.formAction[a.statuses.formAction] },
      { label: "求められる情報", text: a.sensitiveKinds.map((k) => FIELD_KIND_TEXT[k]).join("、") || "—" },
    ],
    disclaimer: DISCLAIMER,
  };
}

export function popupModel(response: Readonly<TabStatusResponse> | null): PopupModel {
  if (!response || response.permission === "unsupported") return { kind: "message", title: headline("unsupported_page", 0) };
  if (response.permission === "denied") return {
    kind: "permission",
    title: headline("permission_denied", 0),
    description: "このサイトのページ構造を読み取る許可がありません。入力された値は許可後も読み取りません。",
    origin: response.origin,
  };
  const status = response.status;
  if (status.kind === "idle") return {
    kind: "message",
    title: "個人情報の入力欄は検出されていません",
    description: "入力欄が表示されると、自動で確認します。",
  };
  if (status.kind === "assessing") return { kind: "message", title: "確認しています…" };
  return assessmentModel(status.assessment);
}
