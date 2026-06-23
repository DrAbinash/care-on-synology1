export type AgeUnit = "years" | "months" | "days";

export function formatAge(patient: { dateOfBirth: string; ageValue?: number | null; ageUnit?: string | null }): string {
  const { dateOfBirth, ageValue, ageUnit } = patient;

  if (ageValue != null && ageUnit) {
    if (ageUnit === "years") return ageValue > 0 ? `${ageValue} Yrs` : "";
    if (ageUnit === "months") return `${ageValue} Mo`;
    if (ageUnit === "days") return `${ageValue} D`;
  }

  if (!dateOfBirth) return "";
  const dob = new Date(dateOfBirth);
  if (isNaN(dob.getTime())) return "";
  const now = new Date();
  let y = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) y--;
  return y > 0 ? `${y} Yrs` : "";
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

  if (ageValue != null && ageUnit) {
    if (ageUnit === "years") return ageValue > 0 ? `${ageValue} Yrs` : "";
    if (ageUnit === "months") return `${ageValue} Mo`;
    if (ageUnit === "days") return `${ageValue} D`;
  }

  if (!dateOfBirth) return "";
  const dob = new Date(dateOfBirth);
  if (isNaN(dob.getTime())) return "";
  const now = new Date();
  let y = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) y--;
  return y > 0 ? `${y} Yrs` : "";
}

export function formatAgeNumeric(patient: { dateOfBirth?: string | null; ageValue?: number | null; ageUnit?: string | null }): number {
  const { dateOfBirth, ageValue, ageUnit } = patient;

  if (ageValue != null && ageUnit) {
    if (ageUnit === "years") return ageValue;
    if (ageUnit === "months") return Math.floor(ageValue / 12);
    if (ageUnit === "days") return Math.floor(ageValue / 365);
  }

  if (!dateOfBirth) return 0;
  const dob = new Date(dateOfBirth);
  if (isNaN(dob.getTime())) return 0;
  return Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000));
}
