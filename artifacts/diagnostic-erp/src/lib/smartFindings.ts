/**
 * smartFindings — the Smart Reporting Engine's pure core.
 *
 * It does NOT introduce a new report model. It reuses the EXISTING structured
 * report (`findingsMap`: an anatomically-ordered `Record<sectionLabel,
 * {normal, text}>` seeded from the auto-loaded template) and the EXISTING
 * abnormality renderer (`renderAbnormality`). All this module adds is the
 * deterministic transition:
 *
 *   "given the currently-selected findings (each already rendered to text and
 *    mapped to a template section), rebuild exactly the sections those findings
 *    drive — flipping their baseline normal to the merged abnormal text, and
 *    restoring released sections to normal — while leaving every other section
 *    (and every manual edit elsewhere) untouched."
 *
 * Because each section key already exists in template (anatomical) order,
 * replacement, conflict-resolution (the normal is replaced, not appended) and
 * anatomical ordering all fall out for free. Multiple findings on one section
 * are merged. Findings whose section is not in the template create a section
 * appended after the template ones.
 *
 * This is instant (no AI) and pure (unit-tested below).
 */

export type SectionState = { normal: boolean; text: string };
export type FindingsMap = Record<string, SectionState>;

/** One active finding's contribution to the report. */
export type SmartContribution = {
  /** Template section label this finding maps to (findingsItems[].label). */
  section: string;
  /** The already-rendered abnormal finding text. */
  text: string;
  /** Sort key for a stable merge order when several findings share a section. */
  order: number;
};

/** Merge several finding texts for one section into one block, de-duplicated. */
export function mergeSectionTexts(texts: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of texts) {
    const t = raw.trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out.join("\n");
}

/**
 * Recompute the structured findings map from the active smart-finding
 * contributions.
 *
 * @param current      the current findingsMap (manual edits + order preserved)
 * @param baseline     the loaded template's ordered `{label, normal}` sections
 * @param contributions rendered text of every currently-selected smart finding
 * @param prevManaged  section labels the engine drove on the previous call, so
 *                     sections whose last finding was just removed can be
 *                     restored to their baseline normal (or dropped, if created)
 * @returns the new map (anatomically ordered) and the section labels now managed
 */
export function rebuildSmartSections(
  current: FindingsMap,
  baseline: Array<{ label: string; normal: string }>,
  contributions: SmartContribution[],
  prevManaged: string[],
): { map: FindingsMap; managed: string[] } {
  const baselineNormal = new Map(baseline.map((b) => [b.label, b.normal]));
  const baselineOrder = baseline.map((b) => b.label);

  const bySection = new Map<string, SmartContribution[]>();
  for (const c of contributions) {
    if (!c.section) continue;
    const arr = bySection.get(c.section);
    if (arr) arr.push(c);
    else bySection.set(c.section, [c]);
  }

  const result: FindingsMap = { ...current };

  // Release sections that were managed but no longer have any active finding.
  for (const sec of prevManaged) {
    if (bySection.has(sec)) continue;
    if (baselineNormal.has(sec)) result[sec] = { normal: true, text: baselineNormal.get(sec) ?? "" };
    else delete result[sec];
  }

  // Write each managed section as abnormal with its merged finding text.
  for (const [sec, contribs] of bySection) {
    const text = mergeSectionTexts(
      contribs.slice().sort((a, b) => a.order - b.order).map((c) => c.text),
    );
    result[sec] = { normal: false, text };
  }

  // Keep anatomical order: template sections in template order first, then any
  // created (non-template) sections in their existing insertion order.
  const ordered: FindingsMap = {};
  for (const label of baselineOrder) if (label in result) ordered[label] = result[label];
  for (const label of Object.keys(result)) if (!(label in ordered)) ordered[label] = result[label];

  return { map: ordered, managed: [...bySection.keys()] };
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
