/**
 * Clinic peak hours — IST 08:00–16:00 (matches api-server clinicPeakHours).
 * Browser-side copy: skip MRI DICOMweb prefetch so Orthanc can take USG C-STORE.
 */

export const CLINIC_PEAK_TZ = "Asia/Kolkata";
export const DEFAULT_PEAK_START_MIN = 8 * 60;
export const DEFAULT_PEAK_END_MIN = 16 * 60;

export function istMinutesOfDay(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: CLINIC_PEAK_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

/** True 08:00 inclusive – 16:00 exclusive IST. */
export function isClinicPeakHours(now: Date = new Date()): boolean {
  const mins = istMinutesOfDay(now);
  return mins >= DEFAULT_PEAK_START_MIN && mins < DEFAULT_PEAK_END_MIN;
}
