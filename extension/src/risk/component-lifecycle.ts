/**
 * Support lifecycle of well-known components (DESIGN.md §44).
 *
 * This is a maintenance signal, not a vulnerability database: it answers only
 * "has the vendor stopped supporting this release line?". It never maps versions
 * to CVEs and the UI never calls a site vulnerable (§3.11, §35).
 *
 * Only lines with a published, unambiguous end of support are listed. Lines that
 * are missing are treated as "unknown", not as "supported".
 */
import type { ComponentId, ComponentObservation } from "../shared/schema";

/** When this table was last reviewed. Update together with the entries. */
export const LIFECYCLE_DATA_AS_OF = "2026-06";

interface ReleaseLine {
  /** Matches when the observed version starts with this prefix ("1" matches 1.x, "7.4" matches 7.4.x). */
  line: string;
  /** End of vendor support (YYYY-MM-DD). */
  endOfSupport: string;
}

interface Component {
  name: string;
  lines: ReleaseLine[];
}

export const COMPONENTS: Record<ComponentId, Component> = {
  jquery: {
    name: "jQuery",
    // Development of 1.x / 2.x ended with the jQuery 3.0 release.
    lines: [
      { line: "1", endOfSupport: "2016-06-09" },
      { line: "2", endOfSupport: "2016-06-09" },
    ],
  },
  bootstrap: {
    name: "Bootstrap",
    lines: [
      { line: "2", endOfSupport: "2013-08-19" },
      { line: "3", endOfSupport: "2019-07-24" },
      { line: "4", endOfSupport: "2023-01-01" },
    ],
  },
  angularjs: {
    name: "AngularJS",
    lines: [{ line: "1", endOfSupport: "2021-12-31" }],
  },
  vue: {
    name: "Vue",
    lines: [
      { line: "1", endOfSupport: "2016-09-30" },
      { line: "2", endOfSupport: "2023-12-31" },
    ],
  },
  wordpress: {
    name: "WordPress",
    // Security backports for 3.7–4.0 ended in December 2022.
    lines: ["3.7", "3.8", "3.9", "4.0"].map((line) => ({ line, endOfSupport: "2022-12-01" })),
  },
  drupal: {
    name: "Drupal",
    lines: [
      { line: "6", endOfSupport: "2016-02-24" },
      { line: "7", endOfSupport: "2025-01-05" },
      { line: "8", endOfSupport: "2021-11-02" },
      { line: "9", endOfSupport: "2023-11-01" },
    ],
  },
  php: {
    name: "PHP",
    lines: [
      { line: "4", endOfSupport: "2008-08-08" },
      { line: "5", endOfSupport: "2018-12-31" },
      { line: "7.0", endOfSupport: "2019-01-10" },
      { line: "7.1", endOfSupport: "2019-12-01" },
      { line: "7.2", endOfSupport: "2020-11-30" },
      { line: "7.3", endOfSupport: "2021-12-06" },
      { line: "7.4", endOfSupport: "2022-11-28" },
      { line: "8.0", endOfSupport: "2023-11-26" },
      { line: "8.1", endOfSupport: "2025-12-31" },
      { line: "8.2", endOfSupport: "2026-12-31" },
    ],
  },
  apache: {
    name: "Apache HTTP Server",
    lines: [
      { line: "1.3", endOfSupport: "2010-02-03" },
      { line: "2.0", endOfSupport: "2013-07-10" },
      { line: "2.2", endOfSupport: "2017-07-11" },
    ],
  },
  iis: {
    name: "IIS",
    // Tied to the Windows Server release it ships with.
    lines: [
      { line: "6", endOfSupport: "2015-07-14" },
      { line: "7", endOfSupport: "2020-01-14" },
      { line: "8", endOfSupport: "2023-10-10" },
    ],
  },
};

export interface LifecycleStatus {
  id: ComponentId;
  name: string;
  line: string;
  endOfSupport: string;
  /** Whole days since end of support; negative when support is still running. */
  daysSinceEnd: number;
}

const DAY = 24 * 60 * 60 * 1000;

function matchesLine(version: string, line: string): boolean {
  return version === line || version.startsWith(`${line}.`);
}

/** The matching release line, or null when the version is unlisted (unknown, not "supported"). */
export function lifecycleOf(component: ComponentObservation, now: number): LifecycleStatus | null {
  const entry = COMPONENTS[component.id];
  // Longest prefix wins ("7.4" before "7").
  const line = entry.lines
    .filter((l) => matchesLine(component.version, l.line))
    .sort((a, b) => b.line.length - a.line.length)[0];
  if (!line) return null;
  const end = Date.parse(`${line.endOfSupport}T00:00:00Z`);
  return {
    id: component.id,
    name: entry.name,
    line: line.line,
    endOfSupport: line.endOfSupport,
    daysSinceEnd: Math.floor((now - end) / DAY),
  };
}

/** Components whose release line is past its end of support, most overdue first. */
export function unsupportedComponents(components: ComponentObservation[], now: number): LifecycleStatus[] {
  const seen = new Set<string>();
  return components
    .map((c) => lifecycleOf(c, now))
    .filter((s): s is LifecycleStatus => s !== null && s.daysSinceEnd > 0)
    .filter((s) => (seen.has(`${s.id}@${s.line}`) ? false : (seen.add(`${s.id}@${s.line}`), true)))
    .sort((a, b) => b.daysSinceEnd - a.daysSinceEnd);
}
