/**
 * usgObSection — canonical obstetric report section builder (P5.1).
 *
 * Consolidates OB reporting onto the ONE canonical obstetric engine
 * (`obstetricCalculations`): GA is established once (CRL preferred, else LMP),
 * EDD/EFW/AFI come straight from the engine — no formula or reference chart is
 * reimplemented here. It emits a canonical structured section
 * (`findings_sections`-compatible) plus impression bullets; it does NOT create a
 * second report store and does NOT finalize anything.
 *
 * PCPNDT: this builder NEVER accepts, derives, or emits fetal sex. Nothing here
 * can disclose sex of the foetus.
 *
 * Honesty: missing inputs drop their clause (never guessed). A GA-by-ultrasound
 * vs GA-by-dates discrepancy is surfaced as a descriptive caveat for the
 * radiologist — it is never auto-classified as IUGR/macrosomia/etc.
 */

import {
  establishGa, gaDaysToWeeksDays, calcEddFromEstablishedGa, calcEddFromLmp,
  calcGaDaysFromLmp, calcEfwGrams, calcAfiInterpretation, calcAfiFromQuadrants,
  type AfiInterpretation,
} from "./obstetricCalculations";

export interface ObSectionInput {
  studyDate: string;            // ISO — the "as of" date for GA projection
  lmp?: string | null;          // ISO
  crlMm?: number | null;
  bpdMm?: number | null;
  hcMm?: number | null;
  acMm?: number | null;
  flMm?: number | null;
  fhrBpm?: number | null;
  afiCm?: number | null;
  afiQuadrantsCm?: [number, number, number, number] | null;
  placenta?: string | null;
  presentation?: string | null;
  cardiacActivity?: boolean | null;
  liveGestation?: boolean | null;
  /** Days beyond which a US-vs-dates GA gap is flagged as a caveat. Default 7. */
  gaDiscrepancyToleranceDays?: number;
}

export interface StructuredSection {
  label: string;
  normal: boolean;
  text: string;
}

export interface ObSectionResult {
  section: StructuredSection;
  impression: string[];
  caveats: string[];
  warnings: string[];
  /** Machine-readable values behind the prose (for the editor / audit). */
  computed: {
    gaByUsDays: number | null;
    gaByDatesDays: number | null;
    gaMethod: string | null;
    eddIso: string | null;
    efwGrams: number | null;
    afiCm: number | null;
    afiInterpretation: AfiInterpretation | null;
  };
}

function weeksDays(days: number | null): string | null {
  if (days == null) return null;
  const { weeks, days: d } = gaDaysToWeeksDays(days);
  return `${weeks}w${d}d`;
}

const AFI_LABEL: Record<AfiInterpretation, string> = {
  oligohydramnios: "oligohydramnios",
  borderline_low: "borderline-low liquor",
  normal: "normal liquor volume",
  polyhydramnios: "polyhydramnios",
};

export function buildObSection(input: ObSectionInput): ObSectionResult {
  const asOf = new Date(input.studyDate);
  const warnings: string[] = [];
  const caveats: string[] = [];
  const impression: string[] = [];

  // GA established once (CRL > LMP), via the canonical engine.
  const established = establishGa({
    crlMm: input.crlMm ?? null,
    lmp: input.lmp ?? null,
    asOfDate: asOf,
  });
  if (established) warnings.push(...established.warnings);
  const gaByUsDays = established?.gaDays ?? null;

  // GA by dates (LMP) — independent, for discrepancy detection only.
  const gaByDatesDays = input.lmp ? calcGaDaysFromLmp(input.lmp, asOf).value : null;

  // EDD: prefer scan-established GA, else LMP.
  let eddIso: string | null = null;
  if (established) {
    const r = calcEddFromEstablishedGa(established.gaDays, input.studyDate);
    eddIso = r.value; warnings.push(...r.warnings);
  } else if (input.lmp) {
    const r = calcEddFromLmp(input.lmp); eddIso = r.value; warnings.push(...r.warnings);
  }

  // EFW from HC/AC/FL.
  let efwGrams: number | null = null;
  if (input.hcMm != null && input.acMm != null && input.flMm != null) {
    const r = calcEfwGrams(input.hcMm, input.acMm, input.flMm);
    efwGrams = r.value; warnings.push(...r.warnings);
  }

  // AFI — accept a direct value or four quadrants.
  let afiCm = input.afiCm ?? null;
  if (afiCm == null && input.afiQuadrantsCm) {
    const q = input.afiQuadrantsCm;
    const r = calcAfiFromQuadrants(q[0], q[1], q[2], q[3]);
    afiCm = r.value; warnings.push(...r.warnings);
  }
  let afiInterpretation: AfiInterpretation | null = null;
  if (afiCm != null) {
    const r = calcAfiInterpretation(afiCm);
    afiInterpretation = r.value; warnings.push(...r.warnings);
  }

  // ── Section prose (biometry, GA, EDD, EFW, liquor). ──
  const lines: string[] = [];
  const biometry: string[] = [];
  if (input.bpdMm != null) biometry.push(`BPD ${input.bpdMm} mm`);
  if (input.hcMm != null) biometry.push(`HC ${input.hcMm} mm`);
  if (input.acMm != null) biometry.push(`AC ${input.acMm} mm`);
  if (input.flMm != null) biometry.push(`FL ${input.flMm} mm`);
  if (input.crlMm != null) biometry.push(`CRL ${input.crlMm} mm`);
  if (biometry.length) lines.push(`Biometry: ${biometry.join(", ")}.`);

  const gaUsStr = weeksDays(gaByUsDays);
  if (gaUsStr) lines.push(`Gestational age by ultrasound: ${gaUsStr} (by ${established?.method?.toUpperCase()}).`);
  const gaDatesStr = weeksDays(gaByDatesDays);
  if (gaDatesStr && !gaUsStr) lines.push(`Gestational age by dates: ${gaDatesStr}.`);
  if (eddIso) lines.push(`Expected date of delivery: ${eddIso}.`);
  if (efwGrams != null) lines.push(`Estimated fetal weight: ${efwGrams} g.`);
  if (input.fhrBpm != null) lines.push(`Fetal heart rate: ${input.fhrBpm} bpm.`);
  if (input.presentation) lines.push(`Presentation: ${input.presentation}.`);
  if (input.placenta) lines.push(`Placenta: ${input.placenta}.`);
  if (afiCm != null) lines.push(`AFI: ${afiCm} cm${afiInterpretation ? ` (${AFI_LABEL[afiInterpretation]})` : ""}.`);

  // ── Impression bullets — descriptive, never a diagnosis the engine can't back. ──
  if (input.liveGestation) {
    const gaForImp = gaUsStr ?? gaDatesStr;
    impression.push(
      `Single live intrauterine gestation${gaForImp ? ` of approximately ${gaForImp}` : ""}${input.cardiacActivity ? " with cardiac activity present" : ""}.`,
    );
  }
  if (afiInterpretation && afiInterpretation !== "normal") {
    impression.push(`Liquor volume: ${AFI_LABEL[afiInterpretation]} (AFI ${afiCm} cm) — correlate clinically.`);
  }

  // ── GA discrepancy caveat (descriptive only). ──
  const tol = input.gaDiscrepancyToleranceDays ?? 7;
  if (gaByUsDays != null && gaByDatesDays != null && Math.abs(gaByUsDays - gaByDatesDays) > tol) {
    caveats.push(
      `Gestational age by ultrasound (${gaUsStr}) differs from age by dates (${gaDatesStr}) ` +
      `by ${Math.abs(gaByUsDays - gaByDatesDays)} days — correlate with clinical dating.`,
    );
  }

  // "Normal" = a live gestation with no abnormal-liquor impression and no caveat.
  const normal = !!input.liveGestation
    && caveats.length === 0
    && impression.every((i) => i.startsWith("Single live"));

  return {
    section: { label: "Obstetric", normal, text: lines.join("\n") },
    impression,
    caveats,
    warnings: [...new Set(warnings)],
    computed: {
      gaByUsDays, gaByDatesDays, gaMethod: established?.method ?? null,
      eddIso, efwGrams, afiCm, afiInterpretation,
    },
  };
}
