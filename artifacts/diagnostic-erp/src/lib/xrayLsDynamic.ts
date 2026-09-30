/**
 * xrayLsDynamic.ts — the flexion / extension workflow (spec §9; library §10).
 *
 * Two rules drive this file, and they are the reason it is not just a table of
 * numbers:
 *  1. a dynamic observation only exists when both positions were actually
 *     obtained. Neutral films cannot demonstrate instability, so the whole panel
 *     is closed by `assessDynamic` and an attempt to record a change is rejected
 *     with the reason rather than quietly written;
 *  2. CARE holds no instability threshold. The published numbers (the often-quoted
 *     4 mm translation / 10-15° angulation) are disputed and depend on level,
 *     symptoms and the technique used, so the library is explicit: "Do not apply
 *     an unreviewed hard-coded instability threshold." The model therefore stores
 *     the source measurements, derives the *change* from them arithmetically, and
 *     lets the radiologist select the interpretation. Nothing here can turn a
 *     measurement into a diagnosis by itself.
 *
 * Pure functions only — no store, no React.
 */
import { levelIsAtLumbosacralJunction, normalizeLsLevel } from "./xrayLsLevels";
import { lsNumberingAllowedLevels, type LsNumbering } from "./xrayLsNumbering";
import { assessDynamic, assessL5S1, type XrayLsTechniqueContext } from "./xrayLsViews";
import { lsAtomsToPatches, lsBundleId, type LsAtomSpec } from "./xrayLsAtoms";

export type LsDynamicInterpretation = "none" | "instability" | "motion-limitation" | null;

export type LsDynamicEntry = {
  /** Operated or questioned segment, e.g. "L4-L5". */
  level: string | null | undefined;
  neutralTranslationMm?: number | null;
  flexionTranslationMm?: number | null;
  extensionTranslationMm?: number | null;
  neutralAngulationDeg?: number | null;
  flexionAngulationDeg?: number | null;
  extensionAngulationDeg?: number | null;
  /** Radiologist-selected interpretation; never derived from the numbers. */
  interpretation?: LsDynamicInterpretation;
  note?: string | null;
  source?: "viewer-caliper" | "manual-entry";
};

export const LS_DYNAMIC_INTERPRETATION_OPTIONS: Array<{
  value: "none" | "instability" | "motion-limitation";
  label: string;
}> = [
  { value: "none", label: "No dynamic interpretation selected" },
  { value: "instability", label: "Dynamic instability (radiologist selection)" },
  { value: "motion-limitation", label: "Limited segmental motion (radiologist selection)" },
];

const finite = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

const mm = (v: number | null | undefined) => (finite(v) ? `${v} mm` : null);
const deg = (v: number | null | undefined) => (finite(v) ? `${v} degrees` : null);

/**
 * Change in translation from neutral to one position. Both source values must be
 * present; the derived number is arithmetic on measurements the radiologist
 * entered, never an estimate (spec §16).
 */
export function derivedTranslationChangeMm(
  entry: LsDynamicEntry,
  position: "flexion" | "extension",
): number | null {
  if (!finite(entry.neutralTranslationMm)) return null;
  const value = position === "flexion" ? entry.flexionTranslationMm : entry.extensionTranslationMm;
  if (!finite(value)) return null;
  return Math.round(Math.abs(value - entry.neutralTranslationMm) * 10) / 10;
}

export function derivedAngulationChangeDeg(
  entry: LsDynamicEntry,
  position: "flexion" | "extension",
): number | null {
  if (!finite(entry.neutralAngulationDeg)) return null;
  const value = position === "flexion" ? entry.flexionAngulationDeg : entry.extensionAngulationDeg;
  if (!finite(value)) return null;
  return Math.round(Math.abs(value - entry.neutralAngulationDeg) * 10) / 10;
}

/** The largest translation change across the positions that were measured. */
export function maxTranslationChangeMm(entry: LsDynamicEntry): number | null {
  const changes = [
    derivedTranslationChangeMm(entry, "flexion"),
    derivedTranslationChangeMm(entry, "extension"),
  ].filter((v): v is number => v !== null);
  return changes.length ? Math.max(...changes) : null;
}

export function maxAngulationChangeDeg(entry: LsDynamicEntry): number | null {
  const changes = [
    derivedAngulationChangeDeg(entry, "flexion"),
    derivedAngulationChangeDeg(entry, "extension"),
  ].filter((v): v is number => v !== null);
  return changes.length ? Math.max(...changes) : null;
}

/** Does this entry carry any measurement at all? Used to hide empty groups. */
export function lsDynamicHasContent(entry: LsDynamicEntry): boolean {
  return (
    finite(entry.neutralTranslationMm) ||
    finite(entry.flexionTranslationMm) ||
    finite(entry.extensionTranslationMm) ||
    finite(entry.neutralAngulationDeg) ||
    finite(entry.flexionAngulationDeg) ||
    finite(entry.extensionAngulationDeg)
  );
}

/**
 * Why this entry cannot be recorded yet — view gating first, then the arithmetic
 * prerequisites, then the interpretation rules.
 */
export function lsDynamicEntryBlockers(
  entry: LsDynamicEntry,
  ctx: XrayLsTechniqueContext,
  numbering?: LsNumbering | null,
): string[] {
  const blockers: string[] = [];

  const gate = assessDynamic(ctx);
  if (!gate.allowed && gate.reason) blockers.push(gate.reason);

  const level = normalizeLsLevel(entry.level ?? null);
  if (!level) blockers.push("Name the segment the measurements belong to (T12-S1).");
  if (level && levelIsAtLumbosacralJunction(level)) {
    const junction = assessL5S1(ctx);
    if (!junction.allowed && junction.reason) blockers.push(junction.reason);
  }
  if (level && numbering) {
    const allowed = lsNumberingAllowedLevels(numbering);
    if (allowed.length && !allowed.includes(level)) {
      blockers.push(
        `${level} cannot be produced by the recorded numbering basis — anchor the numbering before reporting motion at this segment.`,
      );
    }
  }

  if (!lsDynamicHasContent(entry)) {
    blockers.push("Enter at least one measured translation or angulation value.");
  }

  const translationChange = maxTranslationChangeMm(entry);
  const angulationChange = maxAngulationChangeDeg(entry);
  if (
    translationChange === null &&
    angulationChange === null &&
    (finite(entry.flexionTranslationMm) || finite(entry.extensionTranslationMm) ||
      finite(entry.flexionAngulationDeg) || finite(entry.extensionAngulationDeg))
  ) {
    blockers.push(
      "A change can only be derived against a recorded neutral value; add the neutral measurement.",
    );
  }

  // An interpretation may only be carried when the film supports the comparison.
  if (entry.interpretation === "instability") {
    if (!gate.allowed) blockers.push("Dynamic instability cannot be reported on neutral films alone.");
    else if (translationChange === null && angulationChange === null) {
      blockers.push(
        "Instability is selected but no change in translation or angulation has been measured to support it.",
      );
    }
  }
  if (entry.interpretation === "motion-limitation" && !gate.allowed) {
    blockers.push("Motion limitation is selected but both positions were not obtained.");
  }

  return blockers;
}

/** The Findings sentence: the source values, the derived change and the provenance. */
export function lsDynamicSentence(entry: LsDynamicEntry): string {
  const level = normalizeLsLevel(entry.level ?? null) ?? (entry.level ?? "").trim();
  const at = level ? ` at ${level}` : "";

  const translation = [
    mm(entry.neutralTranslationMm) && `neutral ${mm(entry.neutralTranslationMm)}`,
    mm(entry.flexionTranslationMm) && `flexion ${mm(entry.flexionTranslationMm)}`,
    mm(entry.extensionTranslationMm) && `extension ${mm(entry.extensionTranslationMm)}`,
  ]
    .filter(Boolean)
    .join(", ");
  const angulation = [
    deg(entry.neutralAngulationDeg) && `neutral ${deg(entry.neutralAngulationDeg)}`,
    deg(entry.flexionAngulationDeg) && `flexion ${deg(entry.flexionAngulationDeg)}`,
    deg(entry.extensionAngulationDeg) && `extension ${deg(entry.extensionAngulationDeg)}`,
  ]
    .filter(Boolean)
    .join(", ");

  const parts: string[] = [];
  const changeTranslation = maxTranslationChangeMm(entry);
  const changeAngulation = maxAngulationChangeDeg(entry);
  if (translation) {
    parts.push(
      `Translation${at} measures ${translation}${
        changeTranslation === null ? "" : `, a maximum change of ${changeTranslation} mm from neutral`
      }.`,
    );
  }
  if (angulation) {
    parts.push(
      `Segmental angulation${at} measures ${angulation}${
        changeAngulation === null ? "" : `, a maximum change of ${changeAngulation} degrees from neutral`
      }.`,
    );
  }
  if (entry.interpretation === "instability") {
    parts.push(
      `The reporting radiologist interprets${at ? ` ${level}` : " this segment"} as dynamically unstable.`,
    );
  }
  if (entry.interpretation === "motion-limitation") {
    parts.push(`Limited segmental motion${at} is reported by the reporting radiologist.`);
  }
  const note = (entry.note ?? "").trim();
  if (note) parts.push(/[^.]$/.test(note) ? `${note}.` : note);
  return parts.join(" ");
}

/** Provenance string carried on the ledger observation. */
export function formatLsDynamicProvenance(entry: LsDynamicEntry): string {
  const level = normalizeLsLevel(entry.level ?? null) ?? (entry.level ?? "").trim();
  return [
    "Dynamic assessment",
    level ? `level ${level}` : "",
    "view flexion + extension",
    `source ${entry.source ?? "manual-entry"}`,
    maxTranslationChangeMm(entry) !== null
      ? `derived from neutral/flexion/extension translation (${
          [entry.neutralTranslationMm, entry.flexionTranslationMm, entry.extensionTranslationMm]
            .filter((v) => finite(v))
            .join(", ")
        } mm)`
      : "",
    maxAngulationChangeDeg(entry) !== null
      ? `derived from neutral/flexion/extension angulation (${
          [entry.neutralAngulationDeg, entry.flexionAngulationDeg, entry.extensionAngulationDeg]
            .filter((v) => finite(v))
            .join(", ")
        } degrees)`
      : "",
    entry.interpretation && entry.interpretation !== "none"
      ? `interpretation ${entry.interpretation} (radiologist-selected)`
      : "",
  ]
    .filter(Boolean)
    .join(" | ");
}

export type LsDynamicResult = {
  bundleId: string;
  observations: ReturnType<typeof lsAtomsToPatches>;
  rejected: Array<{ entry: LsDynamicEntry; reasons: string[] }>;
  /** Why the whole panel is closed; null when both positions are recorded. */
  blockedReason: string | null;
};

/**
 * One bundle per dynamic group, so removing the dynamic assessment removes every
 * entry with it and manual protection still applies entry by entry.
 */
export function buildLsDynamicAtoms(opts: {
  region?: string;
  ctx: XrayLsTechniqueContext;
  numbering?: LsNumbering | null;
  entries: LsDynamicEntry[];
  bundleId?: string;
}): LsDynamicResult {
  const region = opts.region ?? "Lumbar Spine";
  const bundleId = opts.bundleId ?? lsBundleId("dynamic", "ls");
  const gate = assessDynamic(opts.ctx);
  const atoms: LsAtomSpec[] = [];
  const rejected: LsDynamicResult["rejected"] = [];

  opts.entries.forEach((entry, i) => {
    const blockers = lsDynamicEntryBlockers(entry, opts.ctx, opts.numbering ?? null);
    if (blockers.length) {
      rejected.push({ entry, reasons: blockers });
      return;
    }
    const level = normalizeLsLevel(entry.level ?? null) ?? undefined;
    atoms.push({
      concept: "ls_dynamic_assessment",
      conflictGroup: `ls_dynamic_assessment_${i}`,
      anatomicalSection: "alignment",
      findings: lsDynamicSentence(entry),
      level,
      // The dynamic statement is a paired-position observation, not a single
      // projection claim, so no view token is attached to the label.
      impression:
        entry.interpretation === "instability"
          ? `Dynamic instability${level ? ` at ${level}` : ""}, as selected by the reporting radiologist.`
          : undefined,
      severity: entry.interpretation === "instability" ? "high" : undefined,
      measurement: formatLsDynamicProvenance(entry),
    });
  });

  return {
    bundleId,
    observations: lsAtomsToPatches(region, bundleId, atoms),
    rejected,
    blockedReason: gate.allowed ? null : gate.reason ?? null,
  };
}
