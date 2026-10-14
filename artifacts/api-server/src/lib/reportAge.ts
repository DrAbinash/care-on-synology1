/**
 * The age a durable report may print.
 *
 * Three server paths derived a patient's age inline, all of them from
 * `Date.now()`:
 *
 *   • routes/patient-reports.ts — the signed-report builder, so re-printing a
 *     2025 examination in 2027 printed a 2027 age on a document whose signature
 *     is from 2025;
 *   • routes/radiology-report-generator.ts `formatMasterAge` — the draft preview;
 *   • lib/pacsArchive.ts — the archive payload.
 *
 * All three also ignored the `1900-01-01` sentinel the registration form writes
 * when no date of birth was ever collected, so a patient with no known DOB
 * printed as 126 years old. That is a fabricated clinical value on a signed
 * document, and it is the reason this module exists rather than a fourth inline
 * derivation.
 *
 * The rule: a report names the age AT THE EXAMINATION, evaluated against a date
 * the caller supplies. `Date.now()` is never read here. When no reliable date of
 * birth exists, the answer is "" — the caller omits the row rather than
 * inventing a number ("Do not fabricate age when reliable data are
 * unavailable").
 *
 * There is a client twin (`diagnostic-erp/src/lib/age.ts`) that answers a
 * different question — how old is this patient NOW, for the live registration
 * and workspace surfaces, where today IS the correct as-of date. The two are not
 * merged: `@workspace/report-quality` is the only package both sides import and
 * it owns clinical report-content rules, not demographics, and moving the
 * client's helper would touch a surface this change has no reason to touch.
 */

/** Placeholder DOB written by registration when age was left blank. */
export const SENTINEL_DOB = "1900-01-01";

const MAX_PLAUSIBLE_YEARS = 120;

export function isSentinelDob(dateOfBirth: unknown): boolean {
  const s = typeof dateOfBirth === "string" ? dateOfBirth.trim() : dateOfBirth == null ? "" : String(dateOfBirth);
  if (!s) return false;
  return s.startsWith(SENTINEL_DOB) || /^19000101/.test(s.replace(/\D/g, ""));
}

export function isPlausibleAgeYears(years: number): boolean {
  return Number.isFinite(years) && years > 0 && years <= MAX_PLAUSIBLE_YEARS;
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const s = String(value).trim();
  if (!s || isSentinelDob(s)) return null;
  // A bare YYYY-MM-DD is read as LOCAL midnight. `new Date("2025-01-10")` is
  // UTC midnight, which in any negative-offset zone is still the 9th — and a
  // patient whose birthday is the 10th would print a year younger.
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Whole years between a date of birth and an as-of date, or null when either is
 * unusable. Birthday-aware: a patient born 1980-01-10 examined on 2025-01-10 is
 * 45, not 44.
 */
export function ageYearsBetween(
  dateOfBirth: string | Date | null | undefined,
  asOf: string | Date | null | undefined,
): number | null {
  const dob = toDate(dateOfBirth);
  const when = toDate(asOf);
  if (!dob || !when) return null;
  if (when.getTime() < dob.getTime()) return null;
  let years = when.getFullYear() - dob.getFullYear();
  const monthDelta = when.getMonth() - dob.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && when.getDate() < dob.getDate())) years--;
  return isPlausibleAgeYears(years) ? years : null;
}

/** The unit suffix a printed age carries, matching the client's vocabulary. */
function formatDocumentedAge(ageValue: number, ageUnit: string | null | undefined): string {
  if (ageUnit === "years") return isPlausibleAgeYears(ageValue) ? `${ageValue} Yrs` : "";
  if (ageUnit === "months") return ageValue > 0 ? `${ageValue} Mo` : "";
  if (ageUnit === "days") return ageValue > 0 ? `${ageValue} D` : "";
  return "";
}

/**
 * DICOM PatientAge / `radiology_worklist.age` text — "045Y", "45", "18M", "10D"
 * — normalised to the same display vocabulary. Returns null when the text does
 * not state an age, so the caller can fall through rather than print "".
 */
export function formatDocumentedStudyAge(raw: unknown): string | null {
  const s = typeof raw === "string" ? raw.trim() : raw == null ? "" : String(raw).trim();
  if (!s) return null;
  const m = /^(\d{1,3})\s*([ymdYMD]?)\s*(?:yrs?|years?|months?|mos?|days?)?$/i.exec(s);
  if (!m) return null;
  const value = Number(m[1]);
  const unit = (m[2] ?? "").toLowerCase();
  if (unit === "m") return value > 0 ? `${value} Mo` : null;
  if (unit === "d") return value > 0 ? `${value} D` : null;
  return isPlausibleAgeYears(value) ? `${value} Yrs` : null;
}

export interface AgeAtExaminationInput {
  dateOfBirth?: string | Date | null;
  /** Registration's documented age — a value with no date attached. */
  ageValue?: number | null;
  ageUnit?: string | null;
  /** The age the study row itself recorded at examination time. */
  documentedAge?: string | null;
  /**
   * The examination date. Required in spirit: without it there is no "age at
   * examination" to compute, and this function refuses rather than quietly
   * falling back to the render instant.
   */
  asOf?: string | Date | null;
}

/**
 * The age display for a durable report: the age at `asOf`, or "" when nothing
 * reliable supports one.
 *
 * Precedence, and why:
 *
 *   1. date of birth evaluated AT `asOf` — the only field that can be evaluated
 *      against an examination date, so the only one that stays correct when the
 *      report is reprinted years later;
 *   2. registration's documented (ageValue, ageUnit) — recorded once, with no
 *      date attached, so it is the age as of registration rather than as of the
 *      examination. Used only when there is no usable date of birth;
 *   3. the study row's own age text — what the modality recorded at scan time.
 *      Last, because it is the least curated, but it is still an observed value
 *      and beats printing nothing.
 *
 * Never `Date.now()`. A report with none of the three prints no age at all.
 */
export function formatAgeAtExamination(input: AgeAtExaminationInput): string {
  const fromDob = ageYearsBetween(input.dateOfBirth, input.asOf);
  if (fromDob != null) return `${fromDob} Yrs`;

  const ageValue = Number(input.ageValue);
  if (input.ageValue != null && Number.isFinite(ageValue) && ageValue > 0 && input.ageUnit) {
    const documented = formatDocumentedAge(ageValue, String(input.ageUnit));
    if (documented) return documented;
  }

  return formatDocumentedStudyAge(input.documentedAge) ?? "";
}
