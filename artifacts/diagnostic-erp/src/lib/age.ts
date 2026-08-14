export type AgeUnit = "years" | "months" | "days";

/** Placeholder DOB used when registration left age blank (`1900-01-01`). */
export const SENTINEL_DOB = "1900-01-01";
const MAX_PLAUSIBLE_YEARS = 120;

export function isSentinelDob(dateOfBirth: string | null | undefined): boolean {
  const s = String(dateOfBirth ?? "").trim();
  if (!s) return false;
  return s === SENTINEL_DOB || s.startsWith("1900-01-01") || /^19000101/.test(s.replace(/\D/g, ""));
}

export function isPlausibleAgeYears(years: number): boolean {
  return Number.isFinite(years) && years > 0 && years <= MAX_PLAUSIBLE_YEARS;
}

function yearsFromDob(dateOfBirth: string): number | null {
  if (isSentinelDob(dateOfBirth)) return null;
  const dob = new Date(dateOfBirth);
  if (isNaN(dob.getTime())) return null;
  const now = new Date();
  let y = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) y--;
  if (!isPlausibleAgeYears(y)) return null;
  return y;
}

export function formatAge(patient: { dateOfBirth: string; ageValue?: number | null; ageUnit?: string | null }): string {
  const { dateOfBirth, ageValue, ageUnit } = patient;

  // Only commit to the (ageValue, ageUnit) path when it will produce a real
  // string — a stored value of 0 (from a blank field on registration) must
  // fall through to dateOfBirth instead of short-circuiting to "".
  if (ageValue != null && ageValue > 0 && ageUnit) {
    if (ageUnit === "years") {
      return isPlausibleAgeYears(ageValue) ? `${ageValue} Yrs` : "";
    }
    if (ageUnit === "months") return `${ageValue} Mo`;
    if (ageUnit === "days") return `${ageValue} D`;
  }

  if (!dateOfBirth) return "";
  const y = yearsFromDob(dateOfBirth);
  return y != null ? `${y} Yrs` : "";
}

export function computeDateOfBirth(value: number, unit: AgeUnit): string {
  const now = new Date();
  if (unit === "years") {
    const birthYear = now.getFullYear() - value;
    return `${birthYear}-01-01`;
  }
  if (unit === "months") {
    const d = new Date(now.getFullYear(), now.getMonth() - value, now.getDate());
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  const d = new Date(now.getTime() - value * 24 * 3600 * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function formatAgeForPrint(patient: { dateOfBirth?: string | null; ageValue?: number | null; ageUnit?: string | null }): string {
  const { dateOfBirth, ageValue, ageUnit } = patient;

  // Only commit to the (ageValue, ageUnit) path when it will produce a real
  // string — a stored value of 0 (from a blank field on registration) must
  // fall through to dateOfBirth instead of short-circuiting to "".
  if (ageValue != null && ageValue > 0 && ageUnit) {
    if (ageUnit === "years") {
      return isPlausibleAgeYears(ageValue) ? `${ageValue} Yrs` : "";
    }
    if (ageUnit === "months") return `${ageValue} Mo`;
    if (ageUnit === "days") return `${ageValue} D`;
  }

  if (!dateOfBirth) return "";
  const y = yearsFromDob(dateOfBirth);
  return y != null ? `${y} Yrs` : "";
}

export function formatAgeNumeric(patient: { dateOfBirth?: string | null; ageValue?: number | null; ageUnit?: string | null }): number {
  const { dateOfBirth, ageValue, ageUnit } = patient;

  if (ageValue != null && ageUnit) {
    if (ageUnit === "years") return isPlausibleAgeYears(ageValue) ? ageValue : 0;
    if (ageUnit === "months") return Math.floor(ageValue / 12);
    if (ageUnit === "days") return Math.floor(ageValue / 365);
  }

  if (!dateOfBirth) return 0;
  return yearsFromDob(dateOfBirth) ?? 0;
}
