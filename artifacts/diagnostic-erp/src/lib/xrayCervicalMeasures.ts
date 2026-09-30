/**
 * xrayCervicalMeasures.ts — every cervical radiographic measurement, with the
 * level, the view and the provenance it came from (spec §8, §13; library §7, §8).
 *
 * Why a module of its own: a number on a film is only interpretable together
 * with where it was taken and how. The seeded XR protocol already lists
 * "Prevertebral soft tissue" as a required measurement and offers the quick
 * measurement "Prevertebral soft tissue {value} mm.", but a bare number cannot
 * be audited after the fact. So a measurement here cannot exist without
 * `level` + `view` + `source`, the record round-trips through the ledger
 * `measurement` field, and every value the system produces is either entered or
 * derived from an entered value — never estimated.
 *
 * The safety rules that shape the file:
 *  - a measurement requires the view it claims (an ADI from a film with no
 *    diagnostic odontoid view is refused, not down-weighted);
 *  - reference ranges are published as data and quoted as context. They never
 *    write a diagnosis: the prevertebral reference comes from the seeded
 *    knowledge pack ("<7 mm at C2, <22 mm at C6") and is only quoted for the two
 *    anchored levels, because the library forbids "a single rigid numeric
 *    threshold across all ages/levels without appropriate context" (library §8);
 *  - a Meyerding grade is derived only from a valid slip percentage and is
 *    labelled as derived in the prose (spec §13).
 *
 * Pure functions only — no store, no React.
 */
import { MEYERDING_GRADES, type MeyerdingGradeId } from "./mriSpineGrading";
import { normalizeCervicalLevel, vertebraIndex } from "./xrayCervicalLevels";
import {
  assessDynamic,
  assessOdontoid,
  cervicalViewAllows,
  missingCervicalViewLabels,
  XRAY_CERVICAL_VIEW_LABELS,
  type XrayCervicalTechniqueContext,
  type XrayCervicalViewKey,
} from "./xrayCervicalViews";
import {
  cervicalAtomsToPatches,
  cervicalBundleId,
  type CervicalAtomSpec,
} from "./xrayCervicalAtoms";

export type CervicalMeasurementKind =
  | "prevertebral_soft_tissue"
  | "atlanto_dental_interval"
  | "listhesis_translation"
  | "segmental_angulation"
  | "cobb_angle";

/** Where the number came from — recorded so a reader can audit it. */
export type CervicalMeasurementSource = "viewer-caliper" | "manual-entry" | "derived";

export type CervicalMeasurement = {
  kind: CervicalMeasurementKind;
  /** Magnitude in mm for the linear kinds. */
  mm?: number | null;
  /** Magnitude in degrees for the angular kinds. */
  degrees?: number | null;
  /** Slip as a percentage of the vertebral body width (listhesis only). */
  slipPercent?: number | null;
  /** Canonical cervical level, e.g. "C5-C6" or "C2". */
  level: string | null | undefined;
  /** End vertebrae of a Cobb measurement (provenance for the angle). */
  upperLevel?: string | null;
  lowerLevel?: string | null;
  view: XrayCervicalViewKey | null | undefined;
  source: CervicalMeasurementSource;
  /** What a derived value was computed from, in the radiologist's own terms. */
  derivedFrom?: string | null;
};

export const CERVICAL_MEASUREMENT_LABELS: Record<CervicalMeasurementKind, string> = {
  prevertebral_soft_tissue: "Prevertebral soft tissue",
  atlanto_dental_interval: "Atlanto-dental interval",
  listhesis_translation: "Listhesis translation",
  segmental_angulation: "Segmental angulation",
  cobb_angle: "Cobb angle",
};

/**
 * The two anchors the seeded cervical knowledge pack publishes
 * ("Prevertebral soft tissue: <7 mm at C2, <22 mm at C6"). Levels between them
 * are deliberately NOT interpolated: an interpolated cut-off would look like
 * data while being an invention, and the library forbids a single rigid
 * threshold across levels/ages (library §8).
 */
export const PREVERTEBRAL_REFERENCE_UPPER_MM: Readonly<Record<string, number>> = {
  C2: 7,
  C6: 22,
};

/** Adults only — paediatric prevertebral limits are not encoded here. */
export const PREVERTEBRAL_ADULT_MAX_AGE_YEARS = 16;

/**
 * The quoted reference for a level, or null when this pack does not publish one
 * (any level other than C2/C6, or a paediatric age). null means "no context
 * sentence", never "normal".
 */
export function prevertebralReferenceUpperMm(
  level: string | null | undefined,
  ageYears?: number | null,
): number | null {
  if (typeof ageYears === "number" && Number.isFinite(ageYears) && ageYears < PREVERTEBRAL_ADULT_MAX_AGE_YEARS) {
    return null;
  }
  const one = normalizeCervicalLevel(level ?? null);
  if (!one) return null;
  return PREVERTEBRAL_REFERENCE_UPPER_MM[one] ?? null;
}

/** Classic atlanto-dental interval upper limits, adult / paediatric. */
export const ADI_UPPER_NORMAL_MM = { adult: 3, paediatric: 5 } as const;

export function adiUpperNormalMm(ageYears?: number | null): number {
  return typeof ageYears === "number" && Number.isFinite(ageYears) && ageYears < PREVERTEBRAL_ADULT_MAX_AGE_YEARS
    ? ADI_UPPER_NORMAL_MM.paediatric
    : ADI_UPPER_NORMAL_MM.adult;
}

/**
 * Meyerding grade derived from a measured slip percentage.
 *
 * Reuses MEYERDING_GRADES from mriSpineGrading.ts — the grade bands are a
 * geometric classification of displacement, not an MRI conclusion. Returns null
 * for a missing or impossible percentage rather than guessing grade I, and null
 * at 0% because "no listhesis" is a different statement from a graded listhesis.
 */
export function meyerdingFromSlipPercent(
  slipPercent: number | null | undefined,
): MeyerdingGradeId | null {
  if (slipPercent === null || slipPercent === undefined || !Number.isFinite(slipPercent)) return null;
  if (slipPercent <= 0 || slipPercent > 100) return null;
  if (slipPercent < 25) return "I";
  if (slipPercent < 50) return "II";
  if (slipPercent < 75) return "III";
  return "IV";
}

export function meyerdingLabel(grade: MeyerdingGradeId | null | undefined): string | null {
  if (!grade) return null;
  const found = MEYERDING_GRADES.find((g) => g.id === grade);
  return found ? `Meyerding grade ${found.roman}` : null;
}

export type MeasurementRejection = { reason: string };

/**
 * Can this measurement be recorded on the views that were actually obtained?
 * A measurement taken on a view that was not performed, or on an inadequately
 * visualized odontoid, is rejected outright — spec §2, §8, §13.
 */
export function cervicalMeasurementBlockers(
  m: CervicalMeasurement,
  ctx: XrayCervicalTechniqueContext,
): string[] {
  const blockers: string[] = [];
  const level = normalizeCervicalLevel(m.level ?? null);
  if (!level) blockers.push("A cervical measurement must name a cervical level (C1-T1).");
  if (!m.view) {
    blockers.push("A cervical measurement must name the view it was taken on.");
  } else if (!cervicalViewAllows(ctx, m.view)) {
    blockers.push(
      `${XRAY_CERVICAL_VIEW_LABELS[m.view]} not recorded as performed, so the measurement cannot be supported.`,
    );
  }

  const hasNumber =
    (typeof m.mm === "number" && Number.isFinite(m.mm) && m.mm > 0) ||
    (typeof m.degrees === "number" && Number.isFinite(m.degrees) && m.degrees > 0) ||
    (typeof m.slipPercent === "number" && Number.isFinite(m.slipPercent) && m.slipPercent > 0);
  if (!hasNumber) blockers.push("Enter a measured value; nothing is estimated on the radiologist's behalf.");

  if (m.kind === "atlanto_dental_interval") {
    const gate = assessOdontoid(ctx);
    if (!gate.allowed && gate.reason) blockers.push(gate.reason);
  }
  if (m.kind === "listhesis_translation" && (m.view === "flexion" || m.view === "extension")) {
    const gate = assessDynamic(ctx);
    if (!gate.allowed && gate.reason) blockers.push(gate.reason);
  }
  if (m.kind === "cobb_angle") {
    const upper = normalizeCervicalLevel(m.upperLevel ?? null);
    const lower = normalizeCervicalLevel(m.lowerLevel ?? null);
    if (!upper || !lower) {
      blockers.push("A Cobb angle must name the upper and lower end vertebrae it was measured between.");
    } else {
      const ui = vertebraIndex(upper);
      const li = vertebraIndex(lower);
      if (ui === null || li === null || li <= ui) {
        blockers.push(`"${m.upperLevel} to ${m.lowerLevel}" is not an upward-to-downward cervical span.`);
      }
    }
  }
  return blockers;
}

/**
 * Canonical, parseable provenance string for the ledger `measurement` field.
 * `|` separators keep it readable in the observation inspector and machine
 * readable for validation.
 */
export function formatCervicalMeasurement(m: CervicalMeasurement): string {
  const level = normalizeCervicalLevel(m.level ?? null) ?? (m.level ?? "").trim();
  const value =
    typeof m.slipPercent === "number" && Number.isFinite(m.slipPercent) && m.slipPercent > 0
      ? `${m.slipPercent}%`
      : typeof m.degrees === "number" && Number.isFinite(m.degrees) && m.degrees > 0
        ? `${m.degrees} deg`
        : `${m.mm ?? ""} mm`;
  const bits = [
    CERVICAL_MEASUREMENT_LABELS[m.kind],
    value.trim(),
    level ? `level ${level}` : "",
    m.view ? `view ${XRAY_CERVICAL_VIEW_LABELS[m.view]}` : "",
    `source ${m.source}`,
    m.derivedFrom ? `derived from ${m.derivedFrom}` : "",
    m.kind === "cobb_angle" && m.upperLevel && m.lowerLevel
      ? `span ${normalizeCervicalLevel(m.upperLevel) ?? m.upperLevel}-${normalizeCervicalLevel(m.lowerLevel) ?? m.lowerLevel}`
      : "",
  ].filter(Boolean);
  return bits.join(" | ");
}

export type ParsedCervicalMeasurement = {
  label: string;
  value: string;
  level: string | null;
  view: string | null;
  source: string | null;
  derivedFrom: string | null;
  span: string | null;
};

/** Read formatCervicalMeasurement() back — provenance survives save/reopen. */
export function parseCervicalMeasurement(raw: string | null | undefined): ParsedCervicalMeasurement | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  const parts = t.split("|").map((p) => p.trim());
  const label = parts[0] ?? "";
  const read = (prefix: string): string | null => {
    const hit = parts.find((p) => p.startsWith(prefix));
    return hit ? hit.slice(prefix.length).trim() || null : null;
  };
  const value = parts[1] && !parts[1].startsWith("level") ? parts[1] : "";
  return {
    label,
    value,
    level: read("level "),
    view: read("view "),
    source: read("source "),
    derivedFrom: read("derived from "),
    span: read("span "),
  };
}

const valuePhrase = (m: CervicalMeasurement): string => {
  if (typeof m.slipPercent === "number" && Number.isFinite(m.slipPercent) && m.slipPercent > 0) {
    return `${m.slipPercent}% of the vertebral body width`;
  }
  if (typeof m.degrees === "number" && Number.isFinite(m.degrees) && m.degrees > 0) {
    return `${m.degrees} degrees`;
  }
  return `${m.mm} mm`;
};

/**
 * The measurement sentence. It states the number, the level and the view — and
 * the published reference as context — but never a diagnostic verdict, which is
 * why "swelling", "instability" and "loosening" are absent from this file.
 */
export function cervicalMeasurementSentence(m: CervicalMeasurement, ageYears?: number | null): string {
  const level = normalizeCervicalLevel(m.level ?? null) ?? (m.level ?? "").trim();
  const view = m.view ? XRAY_CERVICAL_VIEW_LABELS[m.view] : "";
  const on = view ? ` on the ${view} view` : "";
  switch (m.kind) {
    case "prevertebral_soft_tissue": {
      const ref = prevertebralReferenceUpperMm(level, ageYears);
      const at = level ? ` at ${level}` : "";
      const quoted = ref && PREVERTEBRAL_REFERENCE_UPPER_MM[level ?? ""] ? `; the published upper limit at ${level} is ${ref} mm in adults.` : ".";
      return `Prevertebral soft tissue measures ${valuePhrase(m)}${at}${on}${quoted}`;
    }
    case "atlanto_dental_interval": {
      const upper = adiUpperNormalMm(ageYears);
      const group =
        typeof ageYears === "number" && ageYears < PREVERTEBRAL_ADULT_MAX_AGE_YEARS
          ? "in children"
          : "in adults";
      return `Atlanto-dental interval measures ${valuePhrase(m)}${on}; the upper limit of normal is ${upper} mm ${group}.`;
    }
    case "listhesis_translation": {
      const grade = meyerdingFromSlipPercent(m.slipPercent ?? null);
      const at = level ? ` at ${level}` : "";
      return `Displacement${at}${on} measures ${valuePhrase(m)}.${
        grade ? ` ${meyerdingLabel(grade)} derived from the measured slip.` : ""
      }`;
    }
    case "segmental_angulation":
      return `Segmental angulation at ${level ?? "the measured segment"} measures ${valuePhrase(m)}${on}.`;
    case "cobb_angle": {
      const upper = normalizeCervicalLevel(m.upperLevel ?? null) ?? m.upperLevel ?? "";
      const lower = normalizeCervicalLevel(m.lowerLevel ?? null) ?? m.lowerLevel ?? "";
      return `Cobb angle between ${upper} and ${lower} measures ${valuePhrase(m)}${on}.`;
    }
    default:
      return `${CERVICAL_MEASUREMENT_LABELS[m.kind]} ${valuePhrase(m)}${on}.`;
  }
}

export type CervicalMeasureInput = {
  region?: string;
  bundleId?: string;
  ageYears?: number | null;
  measurements: CervicalMeasurement[];
};

export type CervicalMeasureResult = {
  bundleId: string;
  observations: ReturnType<typeof cervicalAtomsToPatches>;
  /** Measurements refused, with the reason — nothing is silently dropped. */
  rejected: Array<{ measurement: CervicalMeasurement; reasons: string[] }>;
};

const MEASUREMENT_CONCEPT: Record<CervicalMeasurementKind, string> = {
  prevertebral_soft_tissue: "prevertebral_soft_tissue",
  atlanto_dental_interval: "atlanto_dental_interval",
  listhesis_translation: "cervical_listhesis_measurement",
  segmental_angulation: "cervical_angulation",
  cobb_angle: "cervical_cobb_angle",
};

const MEASUREMENT_SECTION: Record<CervicalMeasurementKind, string> = {
  prevertebral_soft_tissue: "soft tissues",
  atlanto_dental_interval: "craniocervical junction",
  listhesis_translation: "alignment",
  segmental_angulation: "alignment",
  cobb_angle: "alignment",
};

/**
 * Measurements become ordinary ledger atoms that carry `measurement`, so they
 * take part in slot identity, provenance, manual protection and undo like every
 * other observation (spec §13). A measurement that the recorded views cannot
 * support is returned as `rejected` with its reasons instead of being written.
 */
export function buildCervicalMeasureAtoms(
  input: CervicalMeasureInput,
  ctx: XrayCervicalTechniqueContext,
): CervicalMeasureResult {
  const region = input.region ?? "Cervical Spine";
  const bundleId = input.bundleId ?? cervicalBundleId("measures", "cervical");
  const atoms: CervicalAtomSpec[] = [];
  const rejected: CervicalMeasureResult["rejected"] = [];

  for (const m of input.measurements) {
    const blockers = cervicalMeasurementBlockers(m, ctx);
    if (blockers.length) {
      rejected.push({ measurement: m, reasons: blockers });
      continue;
    }
    const level = normalizeCervicalLevel(m.level ?? null) ?? undefined;
    const grade = m.kind === "listhesis_translation" ? meyerdingFromSlipPercent(m.slipPercent ?? null) : null;
    atoms.push({
      concept: MEASUREMENT_CONCEPT[m.kind],
      conflictGroup: MEASUREMENT_CONCEPT[m.kind],
      anatomicalSection: MEASUREMENT_SECTION[m.kind],
      findings: cervicalMeasurementSentence(m, input.ageYears ?? null),
      level,
      view: m.view ?? undefined,
      // A measurement is metadata, not an abnormality: no impression line, so
      // the radiologist's interpretation still has to be written or selected.
      impression: undefined,
      severity: undefined,
      measurement: formatCervicalMeasurement(m),
      ...(grade ? { state: `meyerding ${grade} (derived)` } : {}),
    });
  }

  return { bundleId, observations: cervicalAtomsToPatches(region, bundleId, atoms), rejected };
}

/** Missing views, for the canvas hint line. */
export function cervicalMeasurementViewHint(
  m: CervicalMeasurement,
  ctx: XrayCervicalTechniqueContext,
): string {
  if (!m.view) return "Choose the view this measurement was taken on.";
  const missing = missingCervicalViewLabels(ctx, [m.view]);
  return missing.length ? `Record the ${missing.join(" and ")} view first.` : "";
}
