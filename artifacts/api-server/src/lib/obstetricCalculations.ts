/**
 * obstetricCalculations.ts — the ONE authoritative, pure calculation module
 * for fetal/obstetric ultrasound math (gestational age, EFW, EDD, AFI,
 * Doppler indices, twin discordance). No React, no database, no API calls —
 * deterministic functions in, structured results out.
 *
 * WHY THIS FILE EXISTS: the previous implementation (formerly inline in
 * routes/fetalUsgLevel4.ts) had THREE independently-hand-written GA formula
 * sets across this repo (this file's predecessor, radiologySmartEngine.ts,
 * and usgMeasurementEngine.ts), several of which fed millimetre
 * measurements into cm-calibrated regression coefficients — e.g. a normal
 * 82mm BPD returned "243 weeks," a normal 300mm AC returned "3559 weeks."
 * See docs/usg-reporting-audit/06-measurements-and-calculations.md and
 * docs/usg-reporting/fetal-usg-calculation-correction.md for the full
 * defect history.
 *
 * WHY SOME FORMULAS WERE REMOVED, NOT JUST UNIT-FIXED: cross-checking the
 * old BPD/HC/AC/FL "single parameter → GA" formulas against real clinical
 * BPD/AC/FL-vs-GA reference points (including ones already hard-coded as
 * static reference text elsewhere in FetalUsgLevel4.tsx, e.g. "BPD ~82mm
 * at 32 weeks") showed they were not simply unit-mismatched — even after
 * correcting units, they returned implausible ages (BPD 8.2cm → ~22.8
 * weeks, when 82mm BPD is a normal ~32-week value). Their coefficients do
 * not model the real relationship in any unit. Rather than fabricate NEW
 * replacement polynomial coefficients from memory — the same failure mode
 * this file exists to eliminate — this module follows standard obstetric
 * practice instead: gestational age is ESTABLISHED ONCE (from CRL, the
 * most accurate single measurement, or MSD as an early fallback, or LMP)
 * and held fixed for the pregnancy; later-trimester biometry (BPD/HC/AC/FL)
 * is used for EFW and growth assessment AGAINST that established GA, not
 * to keep re-deriving a new "GA" at every visit. See establishGa() /
 * projectGaForwardDays() below. This is both more clinically correct
 * (repeatedly re-dating from biometry is not standard practice and can
 * make a pregnancy's GA drift inconsistently across visits) and avoids
 * shipping unverified formulas.
 *
 * UNITS: every raw measurement in this codebase's UI/schema is entered and
 * stored in millimetres (mm) except AFI/SDP (cm) and EFW (grams) — this
 * module's public functions accept exactly the unit the UI already
 * collects and documents it in the parameter name/JSDoc, converting
 * internally only where the underlying published formula requires it
 * (explicit conversion, never implicit).
 */

// ─── Structured result types ──────────────────────────────────────────────

export type CalcStatus = "valid" | "warning" | "invalid";

export interface CalculationResult<T> {
  value: T | null;
  status: CalcStatus;
  formulaId: string;
  formulaName: string;
  inputValues: Record<string, number>;
  inputUnits: Record<string, string>;
  warnings: string[];
  error?: string;
}

function ok<T>(value: T, formulaId: string, formulaName: string, inputValues: Record<string, number>, inputUnits: Record<string, string>, warnings: string[] = []): CalculationResult<T> {
  return { value, status: warnings.length > 0 ? "warning" : "valid", formulaId, formulaName, inputValues, inputUnits, warnings };
}

function invalid<T>(formulaId: string, formulaName: string, inputValues: Record<string, number>, inputUnits: Record<string, string>, error: string): CalculationResult<T> {
  return { value: null, status: "invalid", formulaId, formulaName, inputValues, inputUnits, warnings: [], error };
}

// ─── Sanity guardrails ─────────────────────────────────────────────────────

/** True if v is a finite, usable number (rejects NaN, Infinity, non-numbers). */
export function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export interface ValidationRange {
  min: number;
  max: number;
  unit: string;
}

/**
 * Generic clinical-plausibility check for a single raw measurement.
 * Returns null (valid, no warning) or a human-readable warning string.
 * Does NOT throw and does NOT block saving a draft — callers decide.
 */
export function checkMeasurementRange(name: string, value: number, range: ValidationRange): string | null {
  if (!isFiniteNumber(value)) return `${name} is not a valid number`;
  if (value < 0) return `${name} cannot be negative`;
  if (value === 0) return `${name} of 0 ${range.unit} is not a valid measurement — leave blank if not measured`;
  if (value < range.min || value > range.max) {
    return `${name} = ${value} ${range.unit} is outside the plausible range (${range.min}-${range.max} ${range.unit}) — please re-check`;
  }
  return null;
}

// ─── Unit normalization ────────────────────────────────────────────────────

/** Explicit mm → cm conversion. Never call this implicitly. */
export function mmToCm(mm: number): number {
  return mm / 10;
}

// ─── CRL → gestational age (Robinson & Fleming, 1975) ──────────────────────
// GA(days) = 8.052 * sqrt(CRL_mm) + 23.73
// The standard, near-universally cited first-trimester dating formula.
// Valid CRL range per the original study and standard clinical use: 10-84mm
// (~6w0d - ~14w0d). Outside this range CRL dating is not considered reliable.

const CRL_VALID_RANGE: ValidationRange = { min: 10, max: 84, unit: "mm" };

export function calcGaDaysFromCrl(crlMm: number): CalculationResult<number> {
  const inputValues = { crlMm };
  const inputUnits = { crlMm: "mm" };
  const formulaId = "crl-robinson-fleming-1975";
  const formulaName = "Robinson & Fleming (1975) CRL dating";
  if (!isFiniteNumber(crlMm) || crlMm <= 0) {
    return invalid(formulaId, formulaName, inputValues, inputUnits, "CRL must be a positive number");
  }
  const days = 8.052 * Math.sqrt(crlMm) + 23.73;
  const warnings: string[] = [];
  const rangeWarning = checkMeasurementRange("CRL", crlMm, CRL_VALID_RANGE);
  if (rangeWarning) warnings.push(`${rangeWarning} — CRL dating is only validated for 10-84mm; result may be unreliable outside this range.`);
  return ok(Math.round(days), formulaId, formulaName, inputValues, inputUnits, warnings);
}

// ─── MSD → gestational age (early pregnancy, before CRL is measurable) ─────
// GA(days) = MSD_mm + 30 — a simple, widely-used clinical rule of thumb for
// dating before a fetal pole/CRL is visible. Deliberately imprecise and
// narrow-range; CRL dating should be preferred the moment it's available.

const MSD_VALID_RANGE: ValidationRange = { min: 2, max: 10, unit: "mm" };

export function calcGaDaysFromMsd(msdMm: number): CalculationResult<number> {
  const inputValues = { msdMm };
  const inputUnits = { msdMm: "mm" };
  const formulaId = "msd-rule-of-thumb";
  const formulaName = "MSD + 30 days (early dating rule of thumb)";
  if (!isFiniteNumber(msdMm) || msdMm <= 0) {
    return invalid(formulaId, formulaName, inputValues, inputUnits, "MSD must be a positive number");
  }
  const days = msdMm + 30;
  const warnings = ["MSD dating is a rough early estimate — use CRL dating instead as soon as a fetal pole is measurable."];
  const rangeWarning = checkMeasurementRange("MSD", msdMm, MSD_VALID_RANGE);
  if (rangeWarning) warnings.push(`${rangeWarning} — MSD dating is only validated for 2-10mm.`);
  return ok(Math.round(days), formulaId, formulaName, inputValues, inputUnits, warnings);
}

// ─── LMP → gestational age (Naegele-based, days since LMP) ─────────────────

export function calcGaDaysFromLmp(lmpDate: string, asOfDate: Date): CalculationResult<number> {
  const inputValues: Record<string, number> = {};
  const inputUnits: Record<string, string> = {};
  const formulaId = "lmp-elapsed-days";
  const formulaName = "Days elapsed since LMP";
  const d = new Date(lmpDate);
  if (isNaN(d.getTime())) {
    return invalid(formulaId, formulaName, inputValues, inputUnits, "LMP is not a valid date");
  }
  if (d.getTime() > asOfDate.getTime()) {
    return invalid(formulaId, formulaName, inputValues, inputUnits, "LMP date is in the future relative to the study date");
  }
  const days = Math.floor((asOfDate.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  const warnings: string[] = [];
  if (days > 320) warnings.push("LMP-derived gestational age exceeds 45 weeks — please confirm the LMP date.");
  return ok(days, formulaId, formulaName, inputValues, inputUnits, warnings);
}

/** EDD via Naegele's rule: LMP + 280 days. Timezone-safe (UTC date-only arithmetic). */
export function calcEddFromLmp(lmpDate: string): CalculationResult<string> {
  const formulaId = "naegele-edd";
  const formulaName = "Naegele's rule (LMP + 280 days)";
  const d = new Date(`${lmpDate}T00:00:00.000Z`);
  if (isNaN(d.getTime())) {
    return invalid(formulaId, formulaName, {}, {}, "LMP is not a valid date");
  }
  const edd = new Date(d.getTime());
  edd.setUTCDate(edd.getUTCDate() + 280);
  return ok(edd.toISOString().split("T")[0], formulaId, formulaName, {}, {});
}

/** EDD derived from an established total-days GA and the date it was measured (dating-scan EDD). */
export function calcEddFromEstablishedGa(establishedGaDays: number, establishedDate: string): CalculationResult<string> {
  const formulaId = "dating-scan-edd";
  const formulaName = "EDD from established gestational age";
  const d = new Date(`${establishedDate}T00:00:00.000Z`);
  if (isNaN(d.getTime())) {
    return invalid(formulaId, formulaName, { establishedGaDays }, { establishedGaDays: "days" }, "establishedDate is not a valid date");
  }
  if (!isFiniteNumber(establishedGaDays) || establishedGaDays <= 0) {
    return invalid(formulaId, formulaName, { establishedGaDays }, { establishedGaDays: "days" }, "establishedGaDays must be a positive number");
  }
  const daysRemaining = 280 - establishedGaDays;
  const edd = new Date(d.getTime());
  edd.setUTCDate(edd.getUTCDate() + daysRemaining);
  return ok(edd.toISOString().split("T")[0], formulaId, formulaName, { establishedGaDays }, { establishedGaDays: "days" });
}

// ─── GA total-days ↔ weeks/days display conversion ─────────────────────────

export function gaDaysToWeeksDays(totalDays: number): { weeks: number; days: number } {
  const weeks = Math.floor(totalDays / 7);
  const days = totalDays % 7;
  return { weeks, days };
}

// ─── Establishing GA once, and projecting it forward ───────────────────────
// Standard obstetric practice: gestational age is established at the
// EARLIEST reliable measurement (CRL preferred, MSD as an early fallback,
// LMP if no scan-based dating exists yet) and then held fixed — later
// visits project that established GA forward by elapsed calendar days,
// rather than re-deriving a new GA from second/third-trimester biometry.

export type GaMethod = "crl" | "msd" | "lmp" | "manual";

export interface EstablishGaInput {
  crlMm?: number | null;
  msdMm?: number | null;
  lmp?: string | null;
  manualGaDays?: number | null;
  asOfDate: Date;
}

export interface EstablishedGa {
  gaDays: number;
  method: GaMethod;
  warnings: string[];
}

/**
 * Picks the single most reliable dating source available, in clinical
 * preference order: CRL > MSD > LMP > manual override. Returns null if none
 * are usable — callers should prompt for manual GA entry in that case
 * rather than silently defaulting to anything.
 */
export function establishGa(input: EstablishGaInput): EstablishedGa | null {
  if (isFiniteNumber(input.crlMm) && input.crlMm! > 0) {
    const r = calcGaDaysFromCrl(input.crlMm!);
    if (r.value !== null) return { gaDays: r.value, method: "crl", warnings: r.warnings };
  }
  if (isFiniteNumber(input.msdMm) && input.msdMm! > 0) {
    const r = calcGaDaysFromMsd(input.msdMm!);
    if (r.value !== null) return { gaDays: r.value, method: "msd", warnings: r.warnings };
  }
  if (input.lmp) {
    const r = calcGaDaysFromLmp(input.lmp, input.asOfDate);
    if (r.value !== null) return { gaDays: r.value, method: "lmp", warnings: r.warnings };
  }
  if (isFiniteNumber(input.manualGaDays) && input.manualGaDays! > 0) {
    return { gaDays: Math.round(input.manualGaDays!), method: "manual", warnings: ["Gestational age was entered manually — no CRL, MSD, or LMP was available to establish it automatically."] };
  }
  return null;
}

/**
 * Projects a previously-established GA forward to a later date using plain
 * calendar-day arithmetic — this is not a clinical formula, just addition,
 * and is always safe once a GA has genuinely been established.
 */
export function projectGaForwardDays(establishedGaDays: number, establishedDate: string, asOfDate: Date): number {
  const established = new Date(`${establishedDate}T00:00:00.000Z`);
  const elapsedMs = asOfDate.getTime() - established.getTime();
  const elapsedDays = Math.round(elapsedMs / (1000 * 60 * 60 * 24));
  return establishedGaDays + elapsedDays;
}

// ─── EFW — Hadlock (1985) HC + AC + FL formula ──────────────────────────────
// log10(EFW_g) = 1.326 + 0.0107*HC_cm + 0.0438*AC_cm + 0.158*FL_cm
//                - 0.00326*AC_cm*FL_cm
// This exact formula (same coefficients, same three parameters) was already
// present in this codebase and IS a genuine, correctly-transcribed,
// published Hadlock EFW equation — the only defect was that HC/AC/FL are
// collected in mm and were never converted to cm before being applied here.

const HC_VALID_RANGE: ValidationRange = { min: 50, max: 400, unit: "mm" };
const AC_VALID_RANGE: ValidationRange = { min: 50, max: 400, unit: "mm" };
const FL_VALID_RANGE: ValidationRange = { min: 10, max: 90, unit: "mm" };

export function calcEfwGrams(hcMm: number, acMm: number, flMm: number): CalculationResult<number> {
  const inputValues = { hcMm, acMm, flMm };
  const inputUnits = { hcMm: "mm", acMm: "mm", flMm: "mm" };
  const formulaId = "efw-hadlock-1985-hc-ac-fl";
  const formulaName = "Hadlock (1985) EFW — HC, AC, FL";
  if (![hcMm, acMm, flMm].every((v) => isFiniteNumber(v) && v > 0)) {
    return invalid(formulaId, formulaName, inputValues, inputUnits, "HC, AC, and FL are all required and must be positive numbers");
  }
  const warnings: string[] = [];
  for (const [name, v, range] of [["HC", hcMm, HC_VALID_RANGE], ["AC", acMm, AC_VALID_RANGE], ["FL", flMm, FL_VALID_RANGE]] as const) {
    const w = checkMeasurementRange(name, v, range);
    if (w) warnings.push(w);
  }
  const hcCm = mmToCm(hcMm);
  const acCm = mmToCm(acMm);
  const flCm = mmToCm(flMm);
  const log10Efw = 1.326 + 0.0107 * hcCm + 0.0438 * acCm + 0.158 * flCm - 0.00326 * acCm * flCm;
  const efw = Math.pow(10, log10Efw);
  if (!isFiniteNumber(efw) || efw <= 0) {
    return invalid(formulaId, formulaName, inputValues, inputUnits, "EFW calculation produced a non-finite or non-positive result");
  }
  if (efw < 50 || efw > 6000) {
    warnings.push(`Calculated EFW (${Math.round(efw)}g) is outside the plausible 50-6000g range — please re-check HC/AC/FL.`);
  }
  return ok(Math.round(efw * 100) / 100, formulaId, formulaName, inputValues, inputUnits, warnings);
}

// ─── AFI — amniotic fluid index ─────────────────────────────────────────────

/** Proper 4-quadrant AFI: the sum of the deepest vertical pocket in each of four uterine quadrants (cm). Never treats a missing quadrant as zero. */
export function calcAfiFromQuadrants(q1Cm: number, q2Cm: number, q3Cm: number, q4Cm: number): CalculationResult<number> {
  const inputValues = { q1Cm, q2Cm, q3Cm, q4Cm };
  const inputUnits = { q1Cm: "cm", q2Cm: "cm", q3Cm: "cm", q4Cm: "cm" };
  const formulaId = "afi-4-quadrant-sum";
  const formulaName = "AFI — sum of 4 quadrant deepest vertical pockets";
  const quads = [q1Cm, q2Cm, q3Cm, q4Cm];
  if (!quads.every(isFiniteNumber)) {
    return invalid(formulaId, formulaName, inputValues, inputUnits, "All four quadrant measurements are required to compute AFI — a missing quadrant is not treated as zero");
  }
  if (quads.some((v) => v < 0)) {
    return invalid(formulaId, formulaName, inputValues, inputUnits, "Quadrant measurements cannot be negative");
  }
  const afi = quads.reduce((a, b) => a + b, 0);
  return ok(Math.round(afi * 10) / 10, formulaId, formulaName, inputValues, inputUnits);
}

export type AfiInterpretation = "oligohydramnios" | "borderline_low" | "normal" | "polyhydramnios";

/** Standard AFI interpretation bands (cm): <5 oligohydramnios, 5-24 normal (5-8 often flagged borderline-low), >24 polyhydramnios. */
export function calcAfiInterpretation(afiCm: number): CalculationResult<AfiInterpretation> {
  const inputValues = { afiCm };
  const inputUnits = { afiCm: "cm" };
  const formulaId = "afi-interpretation-standard";
  const formulaName = "Standard AFI interpretation bands";
  if (!isFiniteNumber(afiCm) || afiCm < 0) {
    return invalid(formulaId, formulaName, inputValues, inputUnits, "AFI must be a non-negative number");
  }
  let value: AfiInterpretation;
  const warnings: string[] = [];
  if (afiCm < 5) value = "oligohydramnios";
  else if (afiCm < 8) { value = "borderline_low"; warnings.push("AFI is in the borderline-low range (5-8cm) — correlate clinically."); }
  else if (afiCm <= 24) value = "normal";
  else value = "polyhydramnios";
  return ok(value, formulaId, formulaName, inputValues, inputUnits, warnings);
}

// ─── Cervical length interpretation ─────────────────────────────────────────

export type CervicalLengthInterpretation = "short_cervix" | "borderline" | "normal";

/**
 * Standard short-cervix screening threshold: <25mm is the widely-cited
 * (ACOG/SMFM-consistent) cut-off, clinically validated as a mid-trimester
 * (roughly 16-24 week) screening measurement. Outside that GA window the
 * same numeric threshold is returned but flagged as advisory-only, since
 * the 25mm cut-off was not validated for dating outside that window.
 */
export function calcCervicalLengthInterpretation(clMm: number, gaWeeksAtMeasurement?: number | null): CalculationResult<CervicalLengthInterpretation> {
  const inputValues = { clMm };
  const inputUnits = { clMm: "mm" };
  const formulaId = "cervical-length-25mm-threshold";
  const formulaName = "Short-cervix screening threshold (25mm)";
  if (!isFiniteNumber(clMm) || clMm < 0) {
    return invalid(formulaId, formulaName, inputValues, inputUnits, "Cervical length must be a non-negative number");
  }
  let value: CervicalLengthInterpretation;
  const warnings: string[] = [];
  if (clMm < 25) value = "short_cervix";
  else if (clMm < 30) value = "borderline";
  else value = "normal";
  if (isFiniteNumber(gaWeeksAtMeasurement) && (gaWeeksAtMeasurement! < 16 || gaWeeksAtMeasurement! > 24)) {
    warnings.push("This screening threshold is validated for the 16-24 week window — interpret with caution outside it.");
  }
  return ok(value, formulaId, formulaName, inputValues, inputUnits, warnings);
}

// ─── Doppler indices ─────────────────────────────────────────────────────────

/** Pourcelot Resistive Index: RI = (PSV - EDV) / PSV. */
export function calcRi(psv: number, edv: number): CalculationResult<number> {
  const inputValues = { psv, edv };
  const inputUnits = { psv: "cm/s", edv: "cm/s" };
  const formulaId = "ri-pourcelot";
  const formulaName = "Pourcelot Resistive Index";
  if (!isFiniteNumber(psv) || !isFiniteNumber(edv)) {
    return invalid(formulaId, formulaName, inputValues, inputUnits, "PSV and EDV must both be valid numbers");
  }
  if (psv <= 0) {
    return invalid(formulaId, formulaName, inputValues, inputUnits, "PSV must be positive (division by zero)");
  }
  if (edv < 0) {
    return invalid(formulaId, formulaName, inputValues, inputUnits, "EDV cannot be negative");
  }
  const ri = (psv - edv) / psv;
  const warnings: string[] = [];
  if (ri < 0 || ri > 1) warnings.push(`RI = ${ri.toFixed(2)} is outside the physiological 0-1 range — please re-check PSV/EDV.`);
  return ok(Math.round(ri * 100) / 100, formulaId, formulaName, inputValues, inputUnits, warnings);
}

/** Pulsatility Index: PI = (PSV - EDV) / TAMV (time-averaged mean velocity). Requires TAMV — never fabricated from PSV/EDV alone. */
export function calcPi(psv: number, edv: number, tamv: number): CalculationResult<number> {
  const inputValues = { psv, edv, tamv };
  const inputUnits = { psv: "cm/s", edv: "cm/s", tamv: "cm/s" };
  const formulaId = "pi-standard";
  const formulaName = "Pulsatility Index";
  if (!isFiniteNumber(psv) || !isFiniteNumber(edv) || !isFiniteNumber(tamv)) {
    return invalid(formulaId, formulaName, inputValues, inputUnits, "PSV, EDV, and TAMV must all be valid numbers");
  }
  if (tamv <= 0) {
    return invalid(formulaId, formulaName, inputValues, inputUnits, "TAMV must be positive (division by zero) — PI cannot be calculated from PSV/EDV alone");
  }
  const pi = (psv - edv) / tamv;
  const warnings: string[] = [];
  if (pi < 0 || pi > 5) warnings.push(`PI = ${pi.toFixed(2)} is outside the typical 0-5 range — please re-check inputs.`);
  return ok(Math.round(pi * 100) / 100, formulaId, formulaName, inputValues, inputUnits, warnings);
}

/** S/D ratio: PSV / EDV. */
export function calcSdRatio(psv: number, edv: number): CalculationResult<number> {
  const inputValues = { psv, edv };
  const inputUnits = { psv: "cm/s", edv: "cm/s" };
  const formulaId = "sd-ratio";
  const formulaName = "Systolic/Diastolic ratio";
  if (!isFiniteNumber(psv) || !isFiniteNumber(edv)) {
    return invalid(formulaId, formulaName, inputValues, inputUnits, "PSV and EDV must both be valid numbers");
  }
  if (edv <= 0) {
    return invalid(formulaId, formulaName, inputValues, inputUnits, "EDV must be positive (division by zero)");
  }
  const sd = psv / edv;
  return ok(Math.round(sd * 100) / 100, formulaId, formulaName, inputValues, inputUnits);
}

/**
 * S/D ratio derived from RI via the exact algebraic identity RI = 1 - EDV/PSV
 * = 1 - 1/(S/D)  ⇒  S/D = 1/(1-RI). Pure algebra on the same PSV/EDV pair —
 * not a separate clinical formula — so safe to auto-derive when only one of
 * RI/S-D was entered for the same vessel.
 */
export function calcSdFromRi(ri: number): CalculationResult<number> {
  const inputValues = { ri };
  const inputUnits = { ri: "ratio" };
  const formulaId = "sd-from-ri-identity";
  const formulaName = "S/D derived from RI (algebraic identity)";
  if (!isFiniteNumber(ri)) {
    return invalid(formulaId, formulaName, inputValues, inputUnits, "RI must be a valid number");
  }
  if (ri >= 1 || ri < 0) {
    return invalid(formulaId, formulaName, inputValues, inputUnits, "RI must be in [0, 1) for S/D to be derivable (RI=1 implies EDV=0, S/D undefined)");
  }
  const sd = 1 / (1 - ri);
  return ok(Math.round(sd * 100) / 100, formulaId, formulaName, inputValues, inputUnits);
}

/** CPR — Cerebroplacental Ratio: MCA-PI ÷ UA-PI. Both inputs must be PI values (not RI) of the same vessel type for the ratio to be meaningful. */
export function calcCpr(mcaPi: number, uaPi: number): CalculationResult<number> {
  const inputValues = { mcaPi, uaPi };
  const inputUnits = { mcaPi: "ratio", uaPi: "ratio" };
  const formulaId = "cpr-mca-ua";
  const formulaName = "Cerebroplacental Ratio (MCA-PI / UA-PI)";
  if (!isFiniteNumber(mcaPi) || !isFiniteNumber(uaPi)) {
    return invalid(formulaId, formulaName, inputValues, inputUnits, "MCA-PI and UA-PI must both be valid numbers");
  }
  if (uaPi <= 0) {
    return invalid(formulaId, formulaName, inputValues, inputUnits, "UA-PI must be positive (division by zero)");
  }
  if (mcaPi < 0) {
    return invalid(formulaId, formulaName, inputValues, inputUnits, "MCA-PI cannot be negative");
  }
  const cpr = mcaPi / uaPi;
  const warnings: string[] = [];
  if (cpr < 0.4 || cpr > 3) warnings.push(`CPR = ${cpr.toFixed(2)} is outside the typical 0.4-3.0 range — please re-check MCA-PI/UA-PI.`);
  return ok(Math.round(cpr * 100) / 100, formulaId, formulaName, inputValues, inputUnits, warnings);
}

// ─── Twin growth discordance ─────────────────────────────────────────────────

/** Discordance % = (larger EFW - smaller EFW) / larger EFW × 100. Never guesses which twin is larger; never swaps A/B. */
export function calcTwinDiscordancePercent(efwAGrams: number, efwBGrams: number): CalculationResult<number> {
  const inputValues = { efwAGrams, efwBGrams };
  const inputUnits = { efwAGrams: "g", efwBGrams: "g" };
  const formulaId = "twin-discordance-percent";
  const formulaName = "Twin EFW discordance percentage";
  if (!isFiniteNumber(efwAGrams) || !isFiniteNumber(efwBGrams)) {
    return invalid(formulaId, formulaName, inputValues, inputUnits, "Both twins' EFW are required to compute discordance");
  }
  if (efwAGrams <= 0 || efwBGrams <= 0) {
    return invalid(formulaId, formulaName, inputValues, inputUnits, "EFW values must be positive");
  }
  const larger = Math.max(efwAGrams, efwBGrams);
  const smaller = Math.min(efwAGrams, efwBGrams);
  const discordance = ((larger - smaller) / larger) * 100;
  const warnings: string[] = [];
  if (discordance > 20) warnings.push(`Discordance ${discordance.toFixed(1)}% exceeds 20% — associated with increased risk, correlate clinically.`);
  return ok(Math.round(discordance * 10) / 10, formulaId, formulaName, inputValues, inputUnits, warnings);
}
