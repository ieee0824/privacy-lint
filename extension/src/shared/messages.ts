/** Runtime message contracts between extension contexts. */
import type { Assessment, PermissionStatus, TabStatus } from "./assessment";
import type { PageObservation } from "./schema";

export type ContentMessage =
  | { type: "observation"; observation: PageObservation }
  /** The user started interacting with a sensitive field. Carries no value (DESIGN.md §3.1). */
  | { type: "sensitive-focus" };

export type ContentNotice = { type: "show-notice"; assessment: Assessment };

export type PopupMessage =
  | { type: "get-tab-status"; tabId: number }
  | { type: "reassess"; tabId: number }
  | { type: "clear-cache" };

export interface TabStatusResponse {
  permission: PermissionStatus;
  origin?: string;
  status: TabStatus;
}
