/**
 * Clinic peak hours — IST 08:00–16:00 by default.
 *
 * During this window the desk is billing and USG machines C-STORE into Orthanc.
 * Background MRI warm-cache (Orthanc series/preview walks) and DICOM auto-pull
 * (C-MOVE) compete for the same Orthanc + NAS I/O and starve those paths.
 *
 * Override with CLINIC_PEAK_HOURS_START / CLINIC_PEAK_HOURS_END (HH:MM, IST).
 * Disable with CLINIC_PEAK_HOURS=false.
 */

import { istHourMinute } from "./istDate";

export const DEFAULT_PEAK_START = "08:00";
export const DEFAULT_PEAK_END = "16:00";

function parseHm(raw: string, fallbackMinutes: number): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m) return fallbackMinutes;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 23 || min < 0 || min > 59) {
    return fallbackMinutes;
  }
  return h * 60 + min;
}

export function clinicPeakWindowMinutes(): { start: number; end: number } {
  return {
    start: parseHm(process.env.CLINIC_PEAK_HOURS_START ?? DEFAULT_PEAK_START, 8 * 60),
    end: parseHm(process.env.CLINIC_PEAK_HOURS_END ?? DEFAULT_PEAK_END, 16 * 60),
  };
}

/**
 * True during the clinic billing window (default 08:00 inclusive – 16:00 exclusive IST).
 * Overnight wrap is supported if start > end (e.g. 22:00–06:00).
 */
export function isClinicPeakHours(now: Date = new Date()): boolean {
  if (process.env.CLINIC_PEAK_HOURS === "false" || process.env.CLINIC_PEAK_HOURS === "0") {
    return false;
  }
  const { start, end } = clinicPeakWindowMinutes();
  const { hour, minute } = istHourMinute(now);
  const mins = hour * 60 + minute;
  if (start === end) return false;
  if (start < end) return mins >= start && mins < end;
  return mins >= start || mins < end;
}

export function clinicPeakHoursLabel(): string {
  const start = process.env.CLINIC_PEAK_HOURS_START ?? DEFAULT_PEAK_START;
  const end = process.env.CLINIC_PEAK_HOURS_END ?? DEFAULT_PEAK_END;
  return `${start}–${end} IST`;
}
