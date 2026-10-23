/**
 * spineCanvasSeed.ts — the plan behind "seed empty levels normal".
 *
 * A completely normal MRI spine study still costs one open + one chip + one
 * Apply per disc level (5 lumbar, 6 cervical, up to 12 dorsal). The seed
 * button applies a normal disc observation to every level that is STILL
 * EMPTY, in one click — each seed goes through the canvas' own onApplyLevel
 * path (per-level bundle, canonical ledger, own observation identity), so a
 * seeded level is indistinguishable from a manually applied one and can be
 * corrected or removed the same way.
 *
 * This module is the pure half: given each disc level's display kind — the
 * SAME derivation the level blocks render from — decide what may be seeded.
 * Everything that already carries structure is skipped: structured (has
 * observations), stale (was structured, prose has moved on), conflict
 * (competing observations), and template-narrative (the radiologist's own
 * prose references the level). A correction is a radiologist decision, never
 * a button. Fail closed: any display kind other than exactly "empty" never
 * seeds.
 */

export interface SpineSeedCandidate {
  /** Region key — the coverage identity (what setCoverageMark expects). */
  key: string;
  /** Level label — the apply identity (what buildXLevelApplyBundle expects). */
  label: string;
  /** Display kind from the canvas' own level-block derivation. */
  displayKind: string;
}

export interface SpineSeedEntry {
  key: string;
  label: string;
}

export interface SpineSeedPlan {
  /** Levels that may be seeded with a normal disc observation, in order. */
  seeds: SpineSeedEntry[];
  /** Candidates refused because they already carry structure or prose. */
  skipped: number;
}

/** The single display kind that seeds. Everything else fails closed. */
const SEEDABLE_KIND = "empty";

export function planSpineNormalSeed(
  candidates: readonly SpineSeedCandidate[],
): SpineSeedPlan {
  const seeds: SpineSeedEntry[] = [];
  let skipped = 0;
  for (const c of candidates) {
    if (c.displayKind === SEEDABLE_KIND) {
      seeds.push({ key: c.key, label: c.label });
    } else {
      skipped++;
    }
  }
  return { seeds, skipped };
}
