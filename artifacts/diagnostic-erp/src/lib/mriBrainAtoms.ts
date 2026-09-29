/**
 * mriBrainAtoms.ts — shared atom plumbing for MRI Brain clinical sub-masters.
 *
 * ONE brain observation model: every sub-master palette tile, starting
 * preset, normal baseline, lesion description and grading input compiles to
 * PendingPathologyPatch atoms that flow through the existing
 * applyMacroBundle / removeMacroBundle / undo machinery. No second store,
 * no second ledger, no new editor.
 *
 * Pure functions only — no React.
 */

import type { PendingPathologyPatch } from "@/lib/zai-workspace/store";

export type BrainAtomSpec = {
  concept: string;
  conflictGroup?: string;
  anatomicalSection?: string;
  findings: string;
  impression?: string;
  recommendation?: string;
  /** Baseline normal sentence this atom supersedes on apply. */
  baselineReplaces?: string;
  laterality?: string;
  level?: string;
  severity?: string;
  state?: string;
  measurement?: string;
  supportsLaterality?: boolean;
  /** "baseline" for protocol-aware normal sentences — the same role a
   * materialized Full Report normal uses, so abnormal same-slot atoms
   * supersede them and the system-normal guard does not treat them as
   * impression-worthy abnormalities. */
  role?: "finding" | "baseline";
};

export const BRAIN_ATOM_SOURCE: PendingPathologyPatch["source"] = "structured-template";

/**
 * Compile atom specs into ledger patches with stable slot identity:
 * re-applying the same tile is idempotent (same-slot noop / update), and
 * every atom of one tile shares a bundleId for atomic apply / remove / undo.
 */
export function brainAtomsToPatches(
  region: string,
  bundleId: string,
  atoms: readonly BrainAtomSpec[],
): PendingPathologyPatch[] {
  return atoms.map((atom, i) => {
    const id = `${bundleId}-${i}`;
    const findings = atom.findings.trim();
    const impression = atom.impression?.trim() || undefined;
    const recommendation = atom.recommendation?.trim() || undefined;
    return {
      id,
      incoming: { findings, impression, recommendation },
      templates: { findings, impression, recommendation },
      ownership: {
        anatomicalSection: atom.anatomicalSection ?? "brain",
        conflictGroup: atom.conflictGroup ?? atom.concept,
        concept: atom.concept,
        baselineReplaces: atom.baselineReplaces ?? "",
        level: atom.level,
        laterality: atom.laterality,
      },
      source: BRAIN_ATOM_SOURCE,
      region,
      concept: atom.concept,
      label: `${atom.concept}${atom.laterality ? ` (${atom.laterality})` : ""}`,
      findingsText: findings,
      bundleId,
      sectionsOwned: impression ? ["findings", "impression"] : ["findings"],
      severity: atom.severity,
      state: atom.state,
      measurement: atom.measurement,
      laterality: atom.laterality,
      level: atom.level,
      supportsLaterality: atom.supportsLaterality ?? Boolean(atom.laterality),
      role: atom.role,
    } satisfies PendingPathologyPatch;
  });
}

export function brainBundleId(kind: string, key: string): string {
  return `bsm-${kind}-${key}`;
}
