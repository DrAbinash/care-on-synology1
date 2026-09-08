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

/**
 * True for Impression-level contradiction / mismatch warnings only.
 * Deliberately excludes pathology vocabulary (stenosis, moderate, severe, …)
 * so a duplicate-line warning that *quotes* findings text cannot lock the
 * accordion into auto-reveal.
 */
export function isImpressionContradictionWarning(warning: string): boolean {
  return /contradict|mismatch|laterality/i.test(warning);
}

/**
 * Stable key for the current auto-reveal need set. Empty when nothing needs
 * attention. Used to edge-trigger reveal (once per need set), not continuously.
 */
export function revealNeedKey(need: readonly ReportSectionId[]): string {
  return need.length === 0 ? "" : [...need].sort().join(",");
}

/**
 * Decide whether to forcibly open a section for a new validation blocker.
 *
 * Returns `null` when:
 * - nothing needs reveal, or
 * - this need set was already auto-revealed (user may navigate away / collapse), or
 * - the user is already viewing one of the sections that need attention.
 *
 * Collapsed sections still surface blockers via `collapsedWarning` — auto-reveal
 * must not fight progressive accordion clicks.
 */
export function nextAutoRevealSection(opts: {
  need: readonly ReportSectionId[];
  currentActive: ReportSectionId | null;
  alreadyRevealedKey: string;
}): ReportSectionId | null {
  const key = revealNeedKey(opts.need);
  if (!key) return null;
  if (key === opts.alreadyRevealedKey) return null;
  if (opts.currentActive && opts.need.includes(opts.currentActive)) return null;
  return opts.need.includes("impression") ? "impression" : opts.need[0]!;
}
