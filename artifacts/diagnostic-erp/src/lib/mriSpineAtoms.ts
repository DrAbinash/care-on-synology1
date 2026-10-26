/**
 * mriSpineAtoms.ts — shared atom plumbing for spine structured reporting.
 *
 * Mirrors the MRI Brain sub-master atom layer (`mriBrainAtoms.ts`) for the
 * spine regions: every palette tile, preset, level row, measurement and
 * screening selection compiles to `PendingPathologyPatch` atoms that flow
 * through the existing `applyMacroBundle` / `removeMacroBundle` / clinical
 * undo machinery. There is no second ledger and no parallel observation state.
 *
 * Pure functions only — no React, no store instance.
 */

import type { PendingPathologyPatch } from "@/lib/zai-workspace/store";
import type { ObservationRole } from "@/lib/observationSlot";

export type SpineAtomSpec = {
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
  /** "baseline" for normal sentences, "screening" for limited screening prose. */
  role?: ObservationRole;
};

export const SPINE_ATOM_SOURCE: PendingPathologyPatch["source"] = "structured-template";

export function spineAtomsToPatches(
  region: string,
  bundleId: string,
  atoms: readonly SpineAtomSpec[],
): PendingPathologyPatch[] {
  return atoms.map((atom, i) => {
    const id = `${bundleId}-${i}`;
    const findings = atom.findings.trim();
    const impression = atom.impression?.trim() || undefined;
    const recommendation = atom.recommendation?.trim() || undefined;
    const sections: PendingPathologyPatch["sectionsOwned"] = [];
    if (findings) sections.push("findings");
    if (impression) sections.push("impression");
    if (recommendation) sections.push("recommendation");
    return {
      id,
      incoming: { findings, impression, recommendation },
      templates: { findings, impression, recommendation },
      ownership: {
        anatomicalSection: atom.anatomicalSection ?? "lumbar spine",
        conflictGroup: atom.conflictGroup ?? atom.concept,
        concept: atom.concept,
        baselineReplaces: atom.baselineReplaces ?? "",
        level: atom.level,
        laterality: atom.laterality,
      },
      source: SPINE_ATOM_SOURCE,
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

export function spineBundleId(kind: string, key: string): string {
  return `spm-${kind}-${key}`;
}

/**
 * True when this atom set is about to write a `[right/left]`-style group that
 * nothing has answered.
 *
 * Derived from the prose rather than a hand-maintained `requiresSide` flag, so a
 * sentence that gains a side slot cannot silently outrun its own gate: the tile
 * panel refuses the click and names the control that answers it instead of letting
 * a bracket reach a signed report, and no side is ever chosen for the radiologist.
 */
const SIDE_SLOT_RE = /\[(?:right|left|bilateral)(?:\s*\/\s*(?:right|left|bilateral))+\]/i;

export function spineProseAsksForSide(atoms: readonly SpineAtomSpec[]): boolean {
  return atoms.some((atom) =>
    [atom.findings, atom.impression, atom.recommendation].some(
      (text) => !!text && SIDE_SLOT_RE.test(text),
    ),
  );
}
