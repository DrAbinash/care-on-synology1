/**
 * brainCanvasSeed.ts — the plan behind "seed unmentioned systems normal".
 *
 * The spine canvases seed empty disc LEVELS; the brain's unit is the system.
 * A report that already names an infarct still owes the reader a sentence
 * about every other system that was imaged — and the only pre-seed surface
 * was the ★ Completely-Normal preset, which asserts ALL ~20 normals at once.
 * The seed button applies the protocol-aware normal sentence to every system
 * NO observation documents yet, in one click — one bundle through the same
 * applyMacroBundle path every tile on this canvas uses, so each seeded system
 * is a ledger row with full provenance, individually correctable.
 *
 * This module is the pure half: given each system's concept and whether an
 * observation already documents it, decide what may be seeded. A documented
 * system is a radiologist decision — never a button. Fail closed: any
 * candidate that is active, or carries a blank concept, never seeds.
 */

export interface BrainSeedCandidate {
  /** Normal-system concept key from the protocol-aware built set. Nullable
   * because ledger patch concepts are — a blank concept simply never seeds. */
  concept: string | null | undefined;
  /** A non-stale ledger observation already carries this concept. */
  active: boolean;
}

export interface BrainSeedPlan {
  /** Concepts that may be seeded with their normal sentence, in built order. */
  seeds: string[];
  /** Systems refused because an observation already documents them. */
  skipped: number;
}

export function planBrainNormalSeed(
  candidates: readonly BrainSeedCandidate[],
): BrainSeedPlan {
  const seeds: string[] = [];
  let skipped = 0;
  for (const c of candidates) {
    const concept = (c.concept ?? "").trim();
    if (concept && !c.active) {
      seeds.push(concept);
    } else {
      skipped++;
    }
  }
  return { seeds, skipped };
}
