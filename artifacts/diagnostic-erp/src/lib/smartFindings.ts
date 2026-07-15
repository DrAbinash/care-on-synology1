/**
 * smartFindings — the Smart Reporting Engine's pure core.
 *
 * It does NOT introduce a new report model. It reuses the EXISTING structured
 * report (`findingsMap`: an anatomically-ordered `Record<sectionLabel,
 * {normal, text}>` seeded from the auto-loaded template), the EXISTING
 * abnormality renderer (`renderAbnormality`), and the EXISTING exact-remove /
 * dedupe-merge text primitives (`mergeBlock`/`removeBlock`).
 *
 * A finding drives one section. Selecting it replaces that section's baseline
 * normal with the finding text; a second finding on the same section merges in;
 * deselecting removes exactly that finding's contribution and restores the
 * normal when the section empties. Because the section key already exists in
 * template order, replacement, conflict-resolution and anatomical ordering all
 * fall out for free.
 *
 * Crucially, the per-finding contribution is applied with the SAME
 * exact-remove/dedupe-merge used by the free-text engine, so a radiologist's
 * manual edit to a section is never silently overwritten (removeBlock only
 * strips an exact previously-inserted sentence; mergeBlock never duplicates).
 */

import { mergeBlock, removeBlock } from "./quickFindingsMerge";

export type SectionState = { normal: boolean; text: string };
export type FindingsMap = Record<string, SectionState>;

/**
 * Update one structured section for a single finding whose contribution changes
 * from `prevText` (what it last put there, or null) to `nextText` (its new
 * text, or null when deselected).
 *
 * @param current       the section's current state (undefined if not present)
 * @param baselineNormal the template's normal text for this section, or
 *                       undefined for a created (non-template) section
 * @returns the new section state, or null to drop a created section that has
 *          emptied out
 */
export function applySectionContribution(
  current: SectionState | undefined,
  baselineNormal: string | undefined,
  prevText: string | null,
  nextText: string | null,
): SectionState | null {
  // Start from the current ABNORMAL text (a normal/absent section contributes
  // no prior text — the finding replaces the normal).
  let text = current && !current.normal ? current.text : "";
  if (prevText) text = removeBlock(text, prevText); // exact — manual edits survive
  const add = (nextText ?? "").trim();
  if (add) text = mergeBlock(text, add);            // dedupe-merge
  if (text.trim()) return { normal: false, text };
  if (baselineNormal !== undefined) return { normal: true, text: baselineNormal };
  return null; // created section with nothing left → drop it
}

/**
 * Given a finding's conflict group and the currently-selected findings, return
 * the ids that must be de-selected because they share the same non-empty group
 * within the same study (mutual exclusion, e.g. Fazekas grade 1 vs 2).
 */
export function conflictingSelections(
  selecting: { id: number; studyType: string; conflictGroup: string },
  selected: Array<{ id: number; studyType: string; conflictGroup: string }>,
): number[] {
  const group = (selecting.conflictGroup ?? "").trim();
  if (!group) return [];
  return selected
    .filter(
      (f) =>
        f.id !== selecting.id &&
        f.studyType === selecting.studyType &&
        (f.conflictGroup ?? "").trim() === group,
    )
    .map((f) => f.id);
}
