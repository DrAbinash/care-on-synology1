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
 * Semantics match the panel's original behaviour: first configured region whose
 * name appears (case-insensitively) as a substring of the hint wins. Pass the
 * region names in display order (sortOrder) so the first match is deterministic.
 */
export function matchStudyRegion(
  hint: string | null | undefined,
  orderedRegionNames: string[],
): string | null {
  if (!hint) return null;
  const h = hint.toLowerCase();
  return orderedRegionNames.find((name) => name && h.includes(name.toLowerCase())) ?? null;
}
