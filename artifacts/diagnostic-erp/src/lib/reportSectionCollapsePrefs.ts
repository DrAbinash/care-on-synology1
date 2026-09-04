/**
 * Per-device collapse preferences for optional report sections.
 * Findings / Impression stay preferred expanded; History / Technique /
 * Recommendation may remember a collapsed preference.
 */

import type { ReportSectionId } from "@/lib/reportSectionAccordion";

export const REPORT_SECTION_COLLAPSE_PREFS_KEY = "care_report_section_collapse_prefs";

/** Sections that may remember "prefer collapsed when inactive". */
export const COLLAPSIBLE_OPTIONAL_SECTIONS = [
  "history",
  "technique",
  "recommendation",
] as const satisfies readonly ReportSectionId[];

export type CollapsibleOptionalSection = (typeof COLLAPSIBLE_OPTIONAL_SECTIONS)[number];

export type ReportSectionCollapsePrefs = {
  /** Last preferred active section (defaults to findings). */
  preferredActive: ReportSectionId;
  /** true = prefer collapsed when not forced open by validation. */
  collapsed: Partial<Record<CollapsibleOptionalSection, boolean>>;
};

const DEFAULT_PREFS: ReportSectionCollapsePrefs = {
  preferredActive: "findings",
  collapsed: {
    history: true,
    technique: true,
    recommendation: true,
  },
};

function isSectionId(v: unknown): v is ReportSectionId {
  return (
    typeof v === "string"
    && [
      "demography",
      "refDoctor",
      "region",
      "history",
      "technique",
      "findings",
      "impression",
      "recommendation",
      "report",
    ].includes(v)
  );
}

export function readReportSectionCollapsePrefs(
  storage: Pick<Storage, "getItem"> | null | undefined,
): ReportSectionCollapsePrefs {
  try {
    const raw = storage?.getItem(REPORT_SECTION_COLLAPSE_PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS, collapsed: { ...DEFAULT_PREFS.collapsed } };
    const parsed = JSON.parse(raw) as Partial<ReportSectionCollapsePrefs>;
    const preferredActive = isSectionId(parsed.preferredActive)
      ? parsed.preferredActive
      : DEFAULT_PREFS.preferredActive;
    const collapsed: ReportSectionCollapsePrefs["collapsed"] = {
      ...DEFAULT_PREFS.collapsed,
    };
    for (const id of COLLAPSIBLE_OPTIONAL_SECTIONS) {
      const v = parsed.collapsed?.[id];
      if (typeof v === "boolean") collapsed[id] = v;
    }
    return { preferredActive, collapsed };
  } catch {
    return { ...DEFAULT_PREFS, collapsed: { ...DEFAULT_PREFS.collapsed } };
  }
}

export function writeReportSectionCollapsePrefs(
  storage: Pick<Storage, "setItem"> | null | undefined,
  prefs: ReportSectionCollapsePrefs,
): void {
  try {
    storage?.setItem(REPORT_SECTION_COLLAPSE_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* private mode / quota */
  }
}

export function isCollapsibleOptionalSection(
  id: ReportSectionId,
): id is CollapsibleOptionalSection {
  return (COLLAPSIBLE_OPTIONAL_SECTIONS as readonly string[]).includes(id);
}

/**
 * When collapsing an optional section, remember that preference.
 * Opening Findings/Impression updates preferredActive.
 */
export function prefsAfterSectionActivate(
  prev: ReportSectionCollapsePrefs,
  nextActive: ReportSectionId | null,
  previousActive: ReportSectionId | null,
): ReportSectionCollapsePrefs {
  const next: ReportSectionCollapsePrefs = {
    preferredActive: nextActive && (nextActive === "findings" || nextActive === "impression")
      ? nextActive
      : prev.preferredActive,
    collapsed: { ...prev.collapsed },
  };
  if (previousActive && isCollapsibleOptionalSection(previousActive) && nextActive !== previousActive) {
    next.collapsed[previousActive] = true;
  }
  if (nextActive && isCollapsibleOptionalSection(nextActive)) {
    next.collapsed[nextActive] = false;
  }
  return next;
}

/**
 * Sections that must auto-reveal because they carry a validation / stale warning.
 */
export function sectionsRequiringReveal(flags: {
  impressionNeedsRefresh?: boolean;
  impressionHasContradiction?: boolean;
  recommendationCritical?: boolean;
  historyEmptyBlocking?: boolean;
  techniqueEmptyBlocking?: boolean;
}): ReportSectionId[] {
  const out: ReportSectionId[] = [];
  if (flags.impressionNeedsRefresh || flags.impressionHasContradiction) out.push("impression");
  if (flags.recommendationCritical) out.push("recommendation");
  if (flags.historyEmptyBlocking) out.push("history");
  if (flags.techniqueEmptyBlocking) out.push("technique");
  return out;
}
