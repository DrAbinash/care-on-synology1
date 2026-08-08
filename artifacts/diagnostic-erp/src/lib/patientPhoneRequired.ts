/** Clinic setting: patient phone mandatory on staff registration forms. */
export function isPatientPhoneProvided(phone: string | null | undefined): boolean {
  return String(phone ?? "").trim().length > 0;
}

export function patientPhoneMeetsRequirement(
  phone: string | null | undefined,
  phoneRequired: boolean,
): boolean {
  if (!phoneRequired) return true;
  return isPatientPhoneProvided(phone);
}
