/**
 * xrayLsMeasures.ts — every lumbosacral radiographic measurement with the level,
 * the view, the numbering it sits in and the provenance it came from
 * (spec §8, §11, §16; library §8, §10, §11, §12).
 *
 * A number on a film is only interpretable together with where it was taken, how
 * it was obtained and what it was compared against. The seeded XR LS protocol
 * already lists "Vertebral body height" and "Listhesis" as required measurements
 * and offers the quick measurement "Anterolisthesis {value}% of the vertebral
 * body width." — but a bare percentage cannot be audited afterwards, and the
 * seeded one-click phrasing invites a slip percentage nobody measured. So:
 *
 *  - a measurement cannot exist without `level` + `view` + `source`;
 *  - a derived value recomputes from its source measurements and records them
 *    (slip % from translation and vertebral body AP diameter, height loss % from
 *    the measured and reference heights, Meyerding grade from a valid slip %);
 *  - nothing is estimated: an absent input rejects the measurement instead of
 *    substituting a normal value;
 *  - a manual override is explicit and provenanced, never a silent replacement;
 *  - the grade bands come from the shared MEYERDING_GRADES derivation, and the
 *    level is checked against the study's numbering basis, because an L5-S1
 *    translation on an unanchored transitional film is not a fact yet.
 *
 * Pure functions only — no store, no React.
 */
import { MEYERDING_GRADES, meyerdingFromSlipPercent, type MeyerdingGradeId } from "./mriSpineGrading";
import {
  levelIsAtLumbosacralJunction,
  lsVertebraIndex,
  normalizeLsLevel,
} from "./xrayLsLevels";
import { lsNumberingAllowedLevels, type LsNumbering } from "./xrayLsNumbering";
import {
  assessDynamic,
  assessL5S1,
  assessT12L1,
  lsViewAllows,
  missingLsViewLabels,
  XRAY_LS_VIEW_LABELS,
  type XrayLsTechniqueContext,
  type XrayLsViewKey,
} from "./xrayLsViews";
import { lsAtomsToPatches, lsBundleId, type LsAtomSpec } from "./xrayLsAtoms";

export type LsMeasurementKind =
  | "vertebral_height_loss"
  | "listhesis_translation"
  | "cobb_angle"
  | "segmental_angulation"
  | "other";

/** Where the number came from — recorded so a reader can audit it. */
export type LsMeasurementSource = "viewer-caliper" | "manual-entry" | "derived";

export type LsListhesisDirection = "anterolisthesis" | "retrolisthesis" | "lateral translation";

export type LsMeasurement = {
  kind: LsMeasurementKind;
  /** Magnitude in mm for the linear kinds. */
  mm?: number | null;
  /** Magnitude in degrees for the angular kinds. */
  degrees?: number | null;
  /** Slip as a percentage of the vertebral body AP width. */
  slipPercent?: number | null;
  /** Height loss as a percentage of the reference body height. */
  heightLossPercent?: number | null;
  /** Source values a derived percentage was computed from (spec §16). */
  translationMm?: number | null;
  bodyApWidthMm?: number | null;
  measuredHeightMm?: number | null;
  referenceHeightMm?: number | null;
  /** Canonical LS level, e.g. "L4-L5" or "L1". */
  level: string | null | undefined;
  /** Cobb end vertebrae / the displaced vertebra of a listhesis. */
  upperLevel?: string | null;
  lowerLevel?: string | null;
  view: XrayLsViewKey | null | undefined;
  source: LsMeasurementSource;
  /** Radiologist-selected direction; never inferred from the slip itself. */
  direction?: LsListhesisDirection | null;
  /** What a derived value was computed from, in the radiologist's own terms. */
  derivedFrom?: string | null;
  /** Explicit override of a derived figure, stated in the provenance. */
  manualOverride?: boolean;
};

export const LS_MEASUREMENT_LABELS: Record<LsMeasurementKind, string> = {
  vertebral_height_loss: "Vertebral body height loss",
  listhesis_translation: "Listhesis translation",
  cobb_angle: "Cobb angle",
  segmental_angulation: "Segmental angulation",
  other: "Additional measurement",
};

const positive = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0;

const round1 = (v: number) => Math.round(v * 10) / 10;

/** Blocker strings are shown as sentences, while the view labels are words. */
const asSentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Slip percentage from a measured translation and the vertebral body AP diameter
 * it is a fraction of (spec §8: "percentage slip when measured"). Returns null —
 * never a guess — for a missing, zero or impossible input, including a
 * translation larger than the body it is supposed to be a fraction of.
 */
export function slipPercentFromTranslation(
  translationMm: number | null | undefined,
  bodyApWidthMm: number | null | undefined,
): number | null {
  if (!positive(translationMm) || !positive(bodyApWidthMm)) return null;
  if (translationMm > bodyApWidthMm) return null;
  return round1((translationMm / bodyApWidthMm) * 100);
}

/**
 * Height loss percentage from the measured body height and its reference
 * (spec §10: "Vertebral height loss percentage when measured"). The reference is
 * an input, not an assumption: no adjacent-level or age-normed height is invented
 * here, and a body taller than its reference yields null rather than a negative
 * fracture.
 */
export function heightLossPercentFromHeights(
  measuredHeightMm: number | null | undefined,
  referenceHeightMm: number | null | undefined,
): number | null {
  if (!positive(measuredHeightMm) || !positive(referenceHeightMm)) return null;
  if (measuredHeightMm >= referenceHeightMm) return null;
  return round1(((referenceHeightMm - measuredHeightMm) / referenceHeightMm) * 100);
}

export function meyerdingLabel(grade: MeyerdingGradeId | null | undefined): string | null {
  if (!grade) return null;
  const found = MEYERDING_GRADES.find((g) => g.id === grade);
  return found ? `Meyerding grade ${found.roman}` : null;
}

/**
 * Can this measurement be recorded on the views and numbering the study actually
 * has? A measurement taken on a view that was not performed, of a junction that
 * was not covered, or at a level the recorded numbering cannot produce, is
 * rejected outright (spec §2, §8, §11, §16).
 */
export function lsMeasurementBlockers(
  m: LsMeasurement,
  ctx: XrayLsTechniqueContext,
  numbering?: LsNumbering | null,
): string[] {
  const blockers: string[] = [];
  const level = normalizeLsLevel(m.level ?? null);
  if (!level) blockers.push("A lumbosacral measurement must name a thoracolumbosacral level (T12-S1).");

  if (!m.view) {
    blockers.push("A lumbosacral measurement must name the view it was taken on.");
  } else if (!lsViewAllows(ctx, m.view)) {
    blockers.push(
      `${asSentence(XRAY_LS_VIEW_LABELS[m.view])} not recorded as performed, so the measurement cannot be supported.`,
    );
  }

  const hasNumber =
    positive(m.mm) ||
    positive(m.degrees) ||
    (typeof m.slipPercent === "number" && Number.isFinite(m.slipPercent) && m.slipPercent > 0) ||
    (typeof m.heightLossPercent === "number" && Number.isFinite(m.heightLossPercent) && m.heightLossPercent > 0);
  if (!hasNumber) {
    blockers.push("Enter a measured value; nothing is estimated on the radiologist's behalf.");
  }

  // Coverage of the segment being measured (spec §2, §5).
  if (level && levelIsAtLumbosacralJunction(level)) {
    const gate = assessL5S1(ctx);
    if (!gate.allowed && gate.reason) blockers.push(gate.reason);
  }
  if (level === "T12-L1") {
    const gate = assessT12L1(ctx);
    if (!gate.allowed && gate.reason) blockers.push(gate.reason);
  }

  // A positional measurement is a dynamic claim.
  if ((m.view === "flexion" || m.view === "extension") && m.kind !== "cobb_angle") {
    const gate = assessDynamic(ctx);
    if (!gate.allowed && gate.reason) blockers.push(gate.reason);
  }

  if (m.kind === "vertebral_height_loss") {
    const vertebra = normalizeLsLevel(m.level ?? null);
    if (vertebra && vertebra.includes("-")) {
      blockers.push("Height loss is measured on a vertebral body, not on a disc level.");
    }
    const derived = positive(m.measuredHeightMm) && positive(m.referenceHeightMm);
    if (!positive(m.heightLossPercent) && !derived) {
      blockers.push(
        "Record either the measured and reference body heights, or a height-loss percentage you have measured.",
      );
    }
  }

  if (m.kind === "listhesis_translation") {
    const derived = positive(m.translationMm) && positive(m.bodyApWidthMm);
    if (!positive(m.slipPercent) && !derived) {
      blockers.push(
        "A slip percentage must be measured directly or derived from a translation and the vertebral body AP diameter.",
      );
    }
    if (m.slipPercent !== null && m.slipPercent !== undefined && (m.slipPercent <= 0 || m.slipPercent > 100)) {
      blockers.push(`"${m.slipPercent}%" is not a possible slip percentage of the vertebral body width.`);
    }
    const upper = normalizeLsLevel(m.upperLevel ?? null);
    const lower = normalizeLsLevel(m.lowerLevel ?? null);
    if (m.upperLevel && m.lowerLevel && (!upper || !lower)) {
      blockers.push("The displaced vertebrae must be thoracolumbosacral levels.");
    } else if (upper && lower) {
      const ui = lsVertebraIndex(upper);
      const li = lsVertebraIndex(lower);
      if (ui !== null && li !== null && ui >= li) {
        blockers.push(`"${m.upperLevel} over ${m.lowerLevel}" is not a vertebra over the one directly below it.`);
      }
    }
  }

  if (m.kind === "cobb_angle") {
    const upper = normalizeLsLevel(m.upperLevel ?? null);
    const lower = normalizeLsLevel(m.lowerLevel ?? null);
    if (!upper || !lower) {
      blockers.push("A Cobb angle must name the upper and lower end vertebrae it was measured between.");
    } else {
      const ui = lsVertebraIndex(upper);
      const li = lsVertebraIndex(lower);
      if (ui === null || li === null || li <= ui) {
        blockers.push(`"${m.upperLevel} to ${m.lowerLevel}" is not an upward-to-downward span.`);
      }
    }
    if (!positive(m.degrees)) {
      blockers.push("A Cobb angle must be deliberately measured; no angle is inferred from prose.");
    }
  }

  // Numbering safety: the level must be producible by the recorded scheme.
  if (numbering && level) {
    const allowed = lsNumberingAllowedLevels(numbering);
    if (allowed.length && !allowed.includes(level)) {
      blockers.push(
        `${level} cannot be produced by the recorded numbering basis — anchor the numbering (designated L5) before measuring at this level.`,
      );
    }
  }

  return blockers;
}

/**
 * Canonical, parseable provenance string for the ledger `measurement` field.
 * `|` separators keep it readable in the observation inspector and machine
 * readable for validation.
 */
export function formatLsMeasurement(m: LsMeasurement): string {
  const level = normalizeLsLevel(m.level ?? null) ?? (m.level ?? "").trim();
  const value = measurementValue(m);
  const bits = [
    LS_MEASUREMENT_LABELS[m.kind],
    value.trim(),
    level ? `level ${level}` : "",
    m.view ? `view ${XRAY_LS_VIEW_LABELS[m.view]}` : "",
    `source ${m.source}`,
    m.direction ? `direction ${m.direction}` : "",
    m.derivedFrom ? `derived from ${m.derivedFrom}` : "",
    sourceValuesBit(m),
    m.kind === "cobb_angle" && m.upperLevel && m.lowerLevel
      ? `span ${normalizeLsLevel(m.upperLevel) ?? m.upperLevel} to ${normalizeLsLevel(m.lowerLevel) ?? m.lowerLevel}`
      : "",
    m.manualOverride ? "override manual" : "",
  ].filter(Boolean);
  return bits.join(" | ");
}

const measurementValue = (m: LsMeasurement): string => {
  if (typeof m.heightLossPercent === "number" && Number.isFinite(m.heightLossPercent) && m.heightLossPercent > 0) {
    return `${m.heightLossPercent}%`;
  }
  if (typeof m.slipPercent === "number" && Number.isFinite(m.slipPercent) && m.slipPercent > 0) {
    return `${m.slipPercent}%`;
  }
  if (positive(m.degrees)) return `${m.degrees} deg`;
  if (positive(m.mm)) return `${m.mm} mm`;
  return "";
};

/** The numbers a derived value was computed from, so the reader can re-do it. */
function sourceValuesBit(m: LsMeasurement): string {
  const bits: string[] = [];
  if (positive(m.translationMm)) bits.push(`translation ${m.translationMm} mm`);
  if (positive(m.bodyApWidthMm)) bits.push(`body AP ${m.bodyApWidthMm} mm`);
  if (positive(m.measuredHeightMm)) bits.push(`measured height ${m.measuredHeightMm} mm`);
  if (positive(m.referenceHeightMm)) bits.push(`reference height ${m.referenceHeightMm} mm`);
  return bits.length ? `sources ${bits.join(", ")}` : "";
}

export type ParsedLsMeasurement = {
  label: string;
  value: string;
  level: string | null;
  view: string | null;
  source: string | null;
  direction: string | null;
  derivedFrom: string | null;
  sources: string | null;
  span: string | null;
  manualOverride: boolean;
};

/** Read formatLsMeasurement() back — provenance survives save/reopen. */
export function parseLsMeasurement(raw: string | null | undefined): ParsedLsMeasurement | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  const parts = t.split("|").map((p) => p.trim());
  const read = (prefix: string): string | null => {
    const hit = parts.find((p) => p.startsWith(prefix));
    return hit ? hit.slice(prefix.length).trim() || null : null;
  };
  return {
    label: parts[0] ?? "",
    value: parts[1] && !parts[1].startsWith("level") ? parts[1] : "",
    level: read("level "),
    view: read("view "),
    source: read("source "),
    direction: read("direction "),
    derivedFrom: read("derived from "),
    sources: read("sources "),
    span: read("span "),
    manualOverride: parts.includes("override manual"),
  };
}

/**
 * The measurement sentence. It states the number, the level, the view and what
 * the number was computed from — and never a diagnostic verdict, which is why
 * "unstable", "burst" and "loosening" are absent from this file.
 */
export function lsMeasurementSentence(m: LsMeasurement): string {
  const level = normalizeLsLevel(m.level ?? null) ?? (m.level ?? "").trim();
  const view = m.view ? XRAY_LS_VIEW_LABELS[m.view] : "";
  const on = view ? ` on the ${view} view` : "";
  const at = level ? ` at ${level}` : "";
  const override = m.manualOverride
    ? " The value is a radiologist override of the derived figure."
    : "";

  switch (m.kind) {
    case "vertebral_height_loss": {
      const pct = m.heightLossPercent ?? null;
      const body = level || "the vertebra";
      const sources =
        positive(m.measuredHeightMm) && positive(m.referenceHeightMm)
          ? ` (measured ${m.measuredHeightMm} mm against a reference height of ${m.referenceHeightMm} mm)`
          : "";
      return `Loss of height of ${body}${on} is approximately ${pct}% of the vertebral body height${sources}.${override}`;
    }
    case "listhesis_translation": {
      const grade = meyerdingFromSlipPercent(m.slipPercent ?? null);
      const pair =
        m.upperLevel && m.lowerLevel
          ? ` of ${normalizeLsLevel(m.upperLevel) ?? m.upperLevel} over ${
              normalizeLsLevel(m.lowerLevel) ?? m.lowerLevel
            }`
          : "";
      const word = m.direction === "retrolisthesis" ? "Posterior displacement" : m.direction === "anterolisthesis" ? "Anterior displacement" : "Displacement";
      const sources =
        positive(m.translationMm) && positive(m.bodyApWidthMm)
          ? ` (${m.translationMm} mm against a vertebral body AP diameter of ${m.bodyApWidthMm} mm)`
          : "";
      const hasSlip = positive(m.slipPercent);
      const valueText = hasSlip
        ? `${m.slipPercent}% of the vertebral body width`
        : positive(m.mm)
          ? `${m.mm} mm`
          : "an unmeasured distance";
      const gradeSentence = hasSlip
        ? `${meyerdingLabel(grade)} derived from the measured slip.`
        : "No grade is assigned without a valid slip percentage of the measured vertebral body AP diameter.";
      return [
        `${word}${pair}${at}${on} measures ${valueText}${sources}.`,
        gradeSentence,
        override.trim(),
      ]
        .filter(Boolean)
        .join(" ");
    }
    case "cobb_angle": {
      const upper = normalizeLsLevel(m.upperLevel ?? null) ?? m.upperLevel ?? "";
      const lower = normalizeLsLevel(m.lowerLevel ?? null) ?? m.lowerLevel ?? "";
      return `Cobb angle measured between ${upper} and ${lower} is ${m.degrees} degrees${on}.${override}`;
    }
    case "segmental_angulation":
      return `Segmental angulation${at} measures ${m.degrees} degrees${on}.${override}`;
    case "other":
    default:
      return `${LS_MEASUREMENT_LABELS[m.kind]}${at}${on} measures ${measurementValue(m)}.${override}`;
  }
}

export type LsMeasureInput = {
  region?: string;
  bundleId?: string;
  measurements: LsMeasurement[];
};

export type LsMeasureResult = {
  bundleId: string;
  observations: ReturnType<typeof lsAtomsToPatches>;
  /** Measurements refused, with the reason — nothing is silently dropped. */
  rejected: Array<{ measurement: LsMeasurement; reasons: string[] }>;
};

const MEASUREMENT_CONCEPT: Record<LsMeasurementKind, string> = {
  vertebral_height_loss: "ls_height_loss_measurement",
  listhesis_translation: "ls_listhesis_measurement",
  cobb_angle: "ls_cobb_angle",
  segmental_angulation: "ls_segmental_angulation",
  other: "ls_other_measurement",
};

const MEASUREMENT_SECTION: Record<LsMeasurementKind, string> = {
  vertebral_height_loss: "vertebral bodies",
  listhesis_translation: "alignment",
  cobb_angle: "alignment",
  segmental_angulation: "alignment",
  other: "vertebral bodies",
};

/**
 * Measurements become ordinary ledger atoms that carry `measurement`, so they
 * take part in slot identity, provenance, manual protection and undo like every
 * other observation. A measurement the recorded views or numbering cannot
 * support is returned as `rejected` with its reasons instead of being written.
 *
 * Derived values are computed here, once, from the inputs — the canvas never
 * pre-bakes a percentage, so re-measuring recomputes rather than editing prose.
 */
export function buildLsMeasureAtoms(
  input: LsMeasureInput,
  ctx: XrayLsTechniqueContext,
  numbering?: LsNumbering | null,
): LsMeasureResult {
  const region = input.region ?? "Lumbar Spine";
  const bundleId = input.bundleId ?? lsBundleId("measures", "ls");
  const atoms: LsAtomSpec[] = [];
  const rejected: LsMeasureResult["rejected"] = [];

  for (const raw of input.measurements) {
    const m: LsMeasurement = { ...raw };
    const derivedBits: string[] = [];
    if (m.kind === "listhesis_translation" && !positive(m.slipPercent)) {
      const slip = slipPercentFromTranslation(m.translationMm, m.bodyApWidthMm);
      if (slip !== null) {
        m.slipPercent = slip;
        derivedBits.push(`slip % from translation ${m.translationMm} mm / body AP ${m.bodyApWidthMm} mm`);
      }
    }
    if (m.kind === "vertebral_height_loss" && !positive(m.heightLossPercent)) {
      const loss = heightLossPercentFromHeights(m.measuredHeightMm, m.referenceHeightMm);
      if (loss !== null) {
        m.heightLossPercent = loss;
        derivedBits.push(
          `height loss % from ${m.measuredHeightMm} mm against reference ${m.referenceHeightMm} mm`,
        );
      }
    }
    const measurement: LsMeasurement = derivedBits.length
      ? { ...m, source: "derived", derivedFrom: [m.derivedFrom, ...derivedBits].filter(Boolean).join("; ") }
      : m;

    const blockers = lsMeasurementBlockers(measurement, ctx, numbering ?? null);
    if (blockers.length) {
      rejected.push({ measurement, reasons: blockers });
      continue;
    }
    const level = normalizeLsLevel(measurement.level ?? null) ?? undefined;
    const grade =
      measurement.kind === "listhesis_translation"
        ? meyerdingFromSlipPercent(measurement.slipPercent ?? null)
        : null;
    atoms.push({
      concept: MEASUREMENT_CONCEPT[measurement.kind],
      conflictGroup: MEASUREMENT_CONCEPT[measurement.kind],
      anatomicalSection: MEASUREMENT_SECTION[measurement.kind],
      findings: lsMeasurementSentence(measurement),
      level,
      view: measurement.view ?? undefined,
      // A measurement is metadata, not an abnormality: no impression line, so
      // the radiologist's interpretation still has to be written or selected.
      impression: undefined,
      severity: undefined,
      measurement: formatLsMeasurement(measurement),
      ...(grade ? { state: `meyerding ${grade} (derived)` } : {}),
    });
  }

  return { bundleId, observations: lsAtomsToPatches(region, bundleId, atoms), rejected };
}

/** Missing views, for the canvas hint line. */
export function lsMeasurementViewHint(
  m: LsMeasurement,
  ctx: XrayLsTechniqueContext,
): string {
  if (!m.view) return "Choose the view this measurement was taken on.";
  const missing = missingLsViewLabels(ctx, [m.view]);
  return missing.length ? `Record the ${missing.join(" and ")} view first.` : "";
}
