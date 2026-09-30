/**
 * xrayCervicalDynamic.ts — flexion / extension reporting (spec §10, library §11).
 *
 * The three constraints that make this a module rather than a tile:
 *  1. it activates only when BOTH positions were performed (assessDynamic in
 *     xrayCervicalViews), so a neutral film can never carry a dynamic claim;
 *  2. the inter-position change is DERIVED from the two recorded values — the
 *     radiologist enters what they measured in each position, the arithmetic is
 *     shown and auditable (spec §13);
 *  3. instability is a radiologist selection. There is deliberately no threshold
 *     in this file. The commonly quoted 3.5 mm translation / 11 degree angular
 *     figures are contested and unvalidated for the cervical spine, so applying
 *     them automatically would be exactly the "questionable unreviewed
 *     threshold" the spec forbids. The words are available to the radiologist;
 *     they are never generated from a number.
 *
 * Pure functions only — no store, no React.
 */
import { normalizeCervicalLevel } from "./xrayCervicalLevels";
import {
  cervicalAtomsToPatches,
  cervicalBundleId,
  type CervicalAtomSpec,
} from "./xrayCervicalAtoms";
import {
  assessDynamic,
  c7t1Visualized,
  type XrayCervicalTechniqueContext,
} from "./xrayCervicalViews";

export type CervicalDynamicInterpretation = "instability" | "stable" | null;

export type CervicalDynamicEntry = {
  /** Segment, e.g. "C5-C6". A single vertebra is not a motion segment. */
  level: string | null | undefined;
  /** Anterior displacement measured in flexion, in mm. */
  flexionTranslationMm?: number | null;
  /** Anterior displacement measured in extension, in mm. */
  extensionTranslationMm?: number | null;
  /** Segmental angulation measured in flexion, in degrees. */
  flexionAngulationDeg?: number | null;
  /** Segmental angulation measured in extension, in degrees. */
  extensionAngulationDeg?: number | null;
  /** Free-text limitation of movement, in the radiologist's words. */
  rangeLimitation?: string | null;
  /**
   * Radiologist-selected reading. `null` means "no interpretation given", which
   * is the default and the safest state; nothing here infers it.
   */
  interpretation?: CervicalDynamicInterpretation;
};

const finitePositive = (n: number | null | undefined): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= 0;

/** Inter-position change, computed from the two recorded measurements. */
export function derivedTranslationChangeMm(entry: CervicalDynamicEntry): number | null {
  const f = entry.flexionTranslationMm;
  const e = entry.extensionTranslationMm;
  if (!finitePositive(f) || !finitePositive(e)) return null;
  return Math.round(Math.abs(f - e) * 10) / 10;
}

export function derivedAngulationChangeDeg(entry: CervicalDynamicEntry): number | null {
  const f = entry.flexionAngulationDeg;
  const e = entry.extensionAngulationDeg;
  if (!finitePositive(f) || !finitePositive(e)) return null;
  return Math.round(Math.abs(f - e) * 10) / 10;
}

/** Which measurements a row actually carries — an empty row is not an observation. */
export function cervicalDynamicHasContent(entry: CervicalDynamicEntry): boolean {
  return Boolean(
    finitePositive(entry.flexionTranslationMm) ||
      finitePositive(entry.extensionTranslationMm) ||
      finitePositive(entry.flexionAngulationDeg) ||
      finitePositive(entry.extensionAngulationDeg) ||
      (entry.rangeLimitation ?? "").trim() ||
      entry.interpretation,
  );
}

export type CervicalDynamicRejection = { entry: CervicalDynamicEntry; reasons: string[] };

export function cervicalDynamicEntryBlockers(
  entry: CervicalDynamicEntry,
  ctx: XrayCervicalTechniqueContext,
): string[] {
  const reasons: string[] = [];
  const level = normalizeCervicalLevel(entry.level ?? null);
  if (!level) reasons.push("A dynamic measurement must name a cervical motion segment (C1-C2 to C7-T1).");
  else if (!level.includes("-")) reasons.push(`"${entry.level}" is a vertebra, not a motion segment.`);
  if (!cervicalDynamicHasContent(entry)) reasons.push("Nothing is recorded for this level.");
  if (
    (finitePositive(entry.flexionTranslationMm) || finitePositive(entry.extensionTranslationMm)) &&
    !(finitePositive(entry.flexionTranslationMm) && finitePositive(entry.extensionTranslationMm))
  ) {
    reasons.push(
      "Translation is a comparison between positions — record both the flexion and the extension value at this level.",
    );
  }
  return reasons;
}

const sentenceFromEntry = (entry: CervicalDynamicEntry, level: string): string => {
  const parts: string[] = [];
  const fT = entry.flexionTranslationMm;
  const eT = entry.extensionTranslationMm;
  const change = derivedTranslationChangeMm(entry);
  if (finitePositive(fT) && finitePositive(eT)) {
    parts.push(
      `At ${level}, anterior translation measures ${fT} mm in flexion and ${eT} mm in extension (inter-position change ${change} mm, derived from these values).`,
    );
  } else if (finitePositive(fT)) {
    parts.push(`At ${level}, anterior translation measures ${fT} mm in flexion.`);
  } else if (finitePositive(eT)) {
    parts.push(`At ${level}, anterior translation measures ${eT} mm in extension.`);
  }

  const fA = entry.flexionAngulationDeg;
  const eA = entry.extensionAngulationDeg;
  const angChange = derivedAngulationChangeDeg(entry);
  if (finitePositive(fA) && finitePositive(eA)) {
    parts.push(
      `Segmental angulation at ${level} measures ${fA} degrees in flexion and ${eA} degrees in extension (change ${angChange} degrees, derived).`,
    );
  } else if (finitePositive(fA)) {
    parts.push(`Segmental angulation at ${level} measures ${fA} degrees in flexion.`);
  } else if (finitePositive(eA)) {
    parts.push(`Segmental angulation at ${level} measures ${eA} degrees in extension.`);
  }

  const limitation = (entry.rangeLimitation ?? "").trim();
  if (limitation) parts.push(`Range of motion: ${limitation}`);

  if (entry.interpretation === "instability") {
    parts.push(`Dynamic instability at ${level} is the radiologist's interpretation of these findings.`);
  } else if (entry.interpretation === "stable") {
    parts.push(`No dynamic instability is attributed to ${level}.`);
  }

  return parts.join(" ");
};

export type CervicalDynamicResult = {
  bundleId: string;
  observations: ReturnType<typeof cervicalAtomsToPatches>;
  rejected: CervicalDynamicRejection[];
  /** Why nothing was written at all — the gate reason from xrayCervicalViews. */
  blockedReason?: string;
};

/**
 * Compile dynamic entries into ledger atoms.
 *
 * Every emitted sentence names the level and both positions, and carries the
 * measurement provenance in the ledger `measurement` field. If the study has no
 * flexion AND no extension recorded, nothing is written — a neutral-film report
 * cannot be given a dynamic diagnosis (spec §10, §15).
 */
export function buildCervicalDynamicAtoms(
  opts: {
    region?: string;
    ctx: XrayCervicalTechniqueContext;
    entries: CervicalDynamicEntry[];
    bundleId?: string;
  },
): CervicalDynamicResult {
  const region = opts.region ?? "Cervical Spine";
  const bundleId = opts.bundleId ?? cervicalBundleId("dynamic", "cervical");

  const gate = assessDynamic(opts.ctx);
  if (!gate.allowed) {
    return {
      bundleId,
      observations: cervicalAtomsToPatches(region, bundleId, []),
      rejected: opts.entries.map((entry) => ({ entry, reasons: [gate.reason ?? "Dynamic views not performed."] })),
      blockedReason: gate.reason,
    };
  }

  const atoms: CervicalAtomSpec[] = [];
  const rejected: CervicalDynamicRejection[] = [];

  for (const entry of opts.entries) {
    const blockers = cervicalDynamicEntryBlockers(entry, opts.ctx);
    if (blockers.length) {
      rejected.push({ entry, reasons: blockers });
      continue;
    }
    const level = normalizeCervicalLevel(entry.level ?? null) as string;
    const findings = sentenceFromEntry(entry, level);
    const change = derivedTranslationChangeMm(entry);
    const angChange = derivedAngulationChangeDeg(entry);
    const provenance = [
      `flexion ${entry.flexionTranslationMm ?? ""} mm`,
      `extension ${entry.extensionTranslationMm ?? ""} mm`,
      change !== null ? `change ${change} mm (derived)` : "",
      entry.flexionAngulationDeg != null ? `flexion ${entry.flexionAngulationDeg} deg` : "",
      entry.extensionAngulationDeg != null ? `extension ${entry.extensionAngulationDeg} deg` : "",
      angChange !== null ? `angulation change ${angChange} deg (derived)` : "",
      "view flexion + extension",
      "source manual-entry",
    ]
      .filter(Boolean)
      .join(" | ");

    atoms.push({
      concept: "cervical_dynamic_translation",
      conflictGroup: "cervical_dynamic_translation",
      anatomicalSection: "alignment",
      findings,
      impression:
        entry.interpretation === "instability"
          ? `Dynamic translation at ${level} on flexion-extension views; interpretation selected by the radiologist.`
          : undefined,
      level,
      measurement: provenance,
      severity: entry.interpretation === "instability" ? "moderate" : undefined,
      // Both positions are named inside the sentence, so no view prefix is
      // added — "On the neutral view, …" would contradict a flexion finding.
      state: entry.interpretation ?? undefined,
    });
  }

  return {
    bundleId,
    observations: cervicalAtomsToPatches(region, bundleId, atoms),
    rejected,
  };
}

/**
 * The lower levels cannot be measured when the film does not reach them — a
 * C7-T1 dynamic row on a study that stops at C6 is refused by the same adequacy
 * logic that gates the tiles.
 */
export function dynamicLevelIsVisualized(
  entry: CervicalDynamicEntry,
  ctx: XrayCervicalTechniqueContext,
): boolean {
  const level = normalizeCervicalLevel(entry.level ?? null);
  if (!level) return false;
  if (!level.includes("T1")) return true;
  return c7t1Visualized(ctx);
}
