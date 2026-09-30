import type { TabStatus, WarningLevel } from "./assessment";
import { WarningLevel as Level } from "./assessment";

export interface BadgeModel {
  text: string;
  color: string;
}

const BADGE: Record<WarningLevel, Readonly<BadgeModel>> = {
  [Level.NORMAL]: { text: "", color: "#6e7781" },
  [Level.NOTICE]: { text: "i", color: "#0969da" },
  [Level.CAUTION]: { text: "!", color: "#bf8700" },
  [Level.VERIFY_BEFORE_INPUT]: { text: "!!", color: "#bc4c00" },
};

export function badgeModel(status: Readonly<TabStatus>): BadgeModel {
  if (status.kind === "idle") return { text: "", color: "#6e7781" };
  if (status.kind === "assessing") return { text: "…", color: "#6e7781" };
  const a = status.assessment;
  if (a.state !== "evaluated" && a.level <= Level.NOTICE) return { text: "?", color: "#6e7781" };
  return { ...BADGE[a.level] };
}
