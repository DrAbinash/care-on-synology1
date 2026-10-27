/**
 * mriDorsoLumbarJunction.ts — the ledger-bound rule that keeps the
 * thoracolumbar junction a single observation (dorso-lumbar spec §6).
 *
 * The junction is the one level both halves of a Dorso-Lumbar examination can
 * legitimately write to, and the ledger identifies a slot by
 * region + concept + level + laterality. Two consequences follow, and they are
 * why this file exists rather than a convention inside the canvas:
 *
 *   - A patch carries its own region, and that region wins over the study's
 *     reporting region. So a thoracic-domain tile ("Dorsal Spine") and a
 *     lumbar-domain tile ("LS Spine") describing the same junction finding would
 *     sit in two different slots and both survive.
 *   - Level spellings are not normalized consistently: "T12-L1" and "D12-L1"
 *     agree, but a reversed "L1-T12" normalizes to "L1-D12" and becomes a third
 *     identity.
 *
 * The rule is therefore applied where every observation enters the ledger —
 * `observationFromPending` in the workspace store — so presets, macros,
 * quick-select, AI proposals, imported observations and restored drafts cannot
 * bypass it. Anything that still ends up non-canonical (a draft saved before
 * this composition was recognised, for example) is surfaced by
 * `dorsolumbarJunctionWarnings` instead of being silently rewritten.
 *
 * Pure functions only — no store, no React.
 */

import {
  JUNCTION_LEDGER_REGION,
  JUNCTION_LEVEL,
  canonicalDorsoLumbarLevel,
} from "./mriDorsoLumbarCoverage";
import { isDorsoLumbarDedicated, type StudyComposition } from "./mriDorsoLumbarCatalog";
import { normalizeLevel } from "./observationSlot";

export type DorsoLumbarOwnershipInput = {
  region?: string | null;
  level?: string | null;
  anatomicalSection?: string | null;
};

const JUNCTION_ONCE_SENTENCE = "A Dorso-Lumbar study owns the thoracolumbar junction once; review and merge them.";

export type DorsoLumbarCanonicalOwnership = {
  region: string;
  level: string;
  anatomicalSection: string;
  /** True when this row sits at the thoracolumbar bridge. */
  junction: boolean;
  /** True when the canonical form differs from what the caller supplied. */
  changed: boolean;
};

/**
 * Force one identity per level inside a dedicated Dorso-Lumbar composition.
 *
 * Outside that composition this returns the input untouched: a dedicated dorsal
 * or LS study keeps exactly the ownership it has always had.
 */
export function canonicalizeDorsoLumbarOwnership(
  input: DorsoLumbarOwnershipInput,
  composition: StudyComposition | null | undefined,
): DorsoLumbarCanonicalOwnership {
  const region = (input.region ?? "").trim();
  const level = (input.level ?? "").trim();
  const section = (input.anatomicalSection ?? "").trim();

  const passthrough: DorsoLumbarCanonicalOwnership = {
    region,
    level,
    anatomicalSection: section,
    junction: false,
    changed: false,
  };
  if (!isDorsoLumbarDedicated(composition)) return passthrough;

  const canonical = canonicalDorsoLumbarLevel(level || section);
  if (!canonical) return passthrough;

  const nextSection = section && sameLevel(section, level || section) ? canonical.key : section;
  const next: DorsoLumbarCanonicalOwnership = {
    region: canonical.ledgerRegion,
    level: level ? canonical.key : level,
    anatomicalSection: nextSection,
    junction: canonical.junction,
    changed:
      region !== canonical.ledgerRegion
      || Boolean(level && normalizeLevel(level) !== normalizeLevel(canonical.key))
      || (Boolean(nextSection) && nextSection !== section),
  };
  return next;
}

function sameLevel(raw: string, against: string): boolean {
  const a = normalizeLevel(raw);
  return Boolean(a) && a === normalizeLevel(against);
}

type LedgerRow = {
  observation?: {
    region?: string | null;
    level?: string | null;
    anatomicalSection?: string | null;
    concept?: string | null;
  } | null;
  ownership?: { anatomicalSection?: string | null; concept?: string | null } | null;
};

/**
 * Junction rows that escaped canonicalization, and junction concepts recorded
 * more than once. Reported, never repaired: the radiologist decides which
 * finding stands.
 *
 * Two distinct shapes matter. A row outside the canonical junction region came
 * from a draft saved before this composition was recognised, and it will drift
 * out of sync with the same finding entered normally. A concept that occupies
 * more than one region is the duplicate the single-identity rule exists to stop.
 */
export function dorsolumbarJunctionWarnings(
  rows: LedgerRow[],
  composition: StudyComposition | null | undefined,
): string[] {
  if (!isDorsoLumbarDedicated(composition)) return [];

  type JunctionRow = { concept: string; region: string };
  const junction: JunctionRow[] = [];
  for (const row of rows) {
    const level = row.observation?.level ?? row.ownership?.anatomicalSection ?? "";
    if (!canonicalDorsoLumbarLevel(level)?.junction) continue;
    junction.push({
      concept: String(row.observation?.concept ?? row.ownership?.concept ?? "junction finding"),
      region: (row.observation?.region ?? "").trim() || JUNCTION_LEDGER_REGION,
    });
  }
  if (junction.length === 0) return [];

  const regionsByConcept = new Map<string, Set<string>>();
  for (const row of junction) {
    const seen = regionsByConcept.get(row.concept) ?? new Set<string>();
    seen.add(row.region);
    regionsByConcept.set(row.concept, seen);
  }

  const warnings: string[] = [];
  const split = [...regionsByConcept.entries()]
    .filter(([, regions]) => regions.size > 1)
    .map(([concept, regions]) => `${concept} (${[...regions].join(", ")})`);
  if (split.length > 0) {
    warnings.push(
      `Junction ownership: ${split.length} T12-L1 finding${split.length === 1 ? "" : "s"} `
      + `exists under more than one region — ${split.join("; ")}. `
      + JUNCTION_ONCE_SENTENCE,
    );
  }
  const stray = [...new Set(junction
    .filter((row) => row.region !== JUNCTION_LEDGER_REGION)
    .map((row) => `${row.concept} (${row.region})`))];
  if (stray.length > 0) {
    warnings.push(
      `Junction ownership: ${stray.join("; ")} sits outside the canonical `
      + `${JUNCTION_LEDGER_REGION} junction slot. `
      + JUNCTION_ONCE_SENTENCE,
    );
  }
  return warnings;
}

/**
 * The canonical slot a junction finding must occupy, for UI hints and tests.
 *
 * `level` is the spelling the radiologist sees and `storedLevel` is what the
 * ledger holds — every level written through `buildCanonicalObservation` passes
 * through `normalizeLevel`, which letters a dorsal vertebra `D`. Since the report
 * took up the `D` lettering the two are the same string, and they are kept as two
 * fields because a level that arrives as `T12-L1` still normalizes to `D12-L1`:
 * the pair documents that authoring and storage are separate steps even when one
 * letter makes them look identical.
 */
export function dorsolumbarJunctionSlot(): { region: string; level: string; storedLevel: string } {
  return {
    region: JUNCTION_LEDGER_REGION,
    level: JUNCTION_LEVEL,
    storedLevel: normalizeLevel(JUNCTION_LEVEL),
  };
}
