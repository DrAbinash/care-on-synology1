/**
 * studyRegion — resolve the study region (a radiology_study_tabs.name, e.g.
 * "Brain", "Cervical Spine", "LS Spine") for the study currently open in the
 * Reporting Workspace, from its free-text hint (modality + study description).
 *
 * This is the SINGLE source of the region-matching rule. Both the right-side
 * QuickFindingsPanel (which drives its protocol dropdown) and the workspace
 * (which drives the study-specific Clinical History chips and the near-Technique
 * protocol dropdown) call this, so all three resolve to the same region — no
 * duplicated matching logic and no divergence.
 *
 * Semantics: among the configured regions whose name appears (case-insensitively)
 * as a substring of the hint, the MOST SPECIFIC (longest name) wins; ties are
 * broken by display order (sortOrder), so the result stays deterministic.
 *
 * "Longest wins" is required for multi-modality dispatch: study-tab names are
 * scoped per modality (e.g. the generic "Brain" for MRI alongside "CT Brain
 * Plain" for CT, or "Spine" alongside "CT Cervical Spine"). A plain first-in-
 * sortOrder match would resolve a "CT Brain Plain" study to the shorter, lower-
 * sorted "Brain" region and pull the wrong modality's content. Because a longer
 * region name can only match when the hint literally contains that whole phrase,
 * preferring it is strictly more specific and does not regress the single-match
 * cases (e.g. MRI "Brain" still resolves to "Brain").
 */

/** Classify a study-tab name into a modality family for Study Setup filtering. */
export function regionTabModalityFamily(name: string): "CT" | "XR" | "US" | "GENERIC" {
  const upper = name.trim().toUpperCase();
  if (/^(CT|HRCT)\b/.test(upper)) return "CT";
  if (/^X-RAY\b/.test(upper)) return "XR";
  if (/^(USG|US)\b/.test(upper)) return "US";
  return "GENERIC";
}

/**
 * Filter study-tab / region names for the open study's modality so MRI Study
 * Setup does not show CT / X-Ray / USG chips (and vice versa).
 */
export function filterRegionNamesForModality(
  names: string[],
  modality: string | null | undefined,
): string[] {
  const m = (modality ?? "").trim().toUpperCase();
  if (!m) return names;
  const isMr = m === "MR" || m.startsWith("MR");
  const isCt = m === "CT" || m.startsWith("CT");
  const isUs = m === "US" || m.startsWith("US");
  const isXr =
    m === "CR" || m === "DX" || m === "XR" || m === "XA" || m === "RF"
    || m.includes("X-RAY") || m.includes("XRAY");

  return names.filter((name) => {
    const family = regionTabModalityFamily(name);
    if (isMr) return family === "GENERIC";
    if (isCt) return family === "CT";
    if (isXr) return family === "XR";
    if (isUs) return family === "US" || family === "GENERIC";
    return true;
  });
}

export function matchStudyRegion(
  hint: string | null | undefined,
  orderedRegionNames: string[],
): string | null {
  if (!hint) return null;
  const h = hint.toLowerCase();
  let best: string | null = null;
  for (const name of orderedRegionNames) {
    if (!name || !h.includes(name.toLowerCase())) continue;
    // Strictly-greater keeps the FIRST (lowest sortOrder) region among equal
    // lengths, preserving the original deterministic tie-break.
    if (best === null || name.length > best.length) best = name;
  }
  return best;
}
