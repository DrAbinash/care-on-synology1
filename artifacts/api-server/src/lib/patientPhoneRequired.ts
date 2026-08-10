import { db, clinicSettingsTable } from "@workspace/db";

/** True when clinic_settings.patient_phone_required is on (default true). */
export async function isClinicPatientPhoneRequired(): Promise<boolean> {
  try {
    const [row] = await db
      .select({ patientPhoneRequired: clinicSettingsTable.patientPhoneRequired })
      .from(clinicSettingsTable)
      .limit(1);
    return row?.patientPhoneRequired ?? true;
  } catch {
    // Schema lag / missing column — keep historical default (required).
    return true;
  }
}

export function phoneLooksPresent(phone: string | null | undefined): boolean {
  return String(phone ?? "").trim().length > 0;
}
