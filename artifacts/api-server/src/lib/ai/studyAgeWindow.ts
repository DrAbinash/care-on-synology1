/**
 * Overnight AI study-age eligibility windows.
 *
 * Today = IST calendar day (clinic timezone).
 * Last 24 hours / 48 hours / 3 days / 7 days = rolling wall-clock from `now`.
 * These are intentionally not the same: a study from 11pm yesterday is in
 * Last 24 hours but not in Today after midnight IST.
 */
import { todayIST } from "../istDate";

export const STUDY_AGE_WINDOWS = [
  "all",
  "today",
  "last_24h",
  "last_48h",
  "last_3d",
  "last_7d",
  "custom",
] as const;

export type StudyAgeWindow = (typeof STUDY_AGE_WINDOWS)[number];

export function parseStudyAgeWindow(v: unknown): StudyAgeWindow {
  const s = typeof v === "string" ? v : "";
  return (STUDY_AGE_WINDOWS as readonly string[]).includes(s) ? (s as StudyAgeWindow) : "all";
}

/** DICOM Study Date (YYYYMMDD / YYYY-MM-DD) or ISO instant → Date, else null. */
export function parseStudyDateInstant(studyDate: string | Date | null | undefined): Date | null {
  if (!studyDate) return null;
  if (studyDate instanceof Date) return Number.isNaN(studyDate.getTime()) ? null : studyDate;
  const raw = studyDate.trim();
  if (!raw) return null;
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) {
    const d = new Date(`${compact[1]}-${compact[2]}-${compact[3]}T00:00:00+05:30`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const dashed = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dashed && raw.length <= 10) {
    const d = new Date(`${dashed[1]}-${dashed[2]}-${dashed[3]}T00:00:00+05:30`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function asDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const raw = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const d = new Date(`${raw}T00:00:00+05:30`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function endOfIstDay(isoDay: string): Date {
  const start = new Date(`${isoDay}T00:00:00+05:30`);
  return new Date(start.getTime() + 24 * 3600_000);
}

/**
 * Instant used for age checks.
 * Calendar windows (today / custom date range) prefer DICOM study date.
 * Rolling windows prefer received/created time (more precise than date-only).
 */
export function resolveStudyAgeInstant(opts: {
  window: StudyAgeWindow;
  studyDate?: string | Date | null;
  createdAt?: Date | string | null;
}): Date | null {
  const study = parseStudyDateInstant(opts.studyDate);
  const created = asDate(opts.createdAt);
  if (opts.window === "today" || opts.window === "custom") return study ?? created;
  return created ?? study;
}

export interface StudyAgeBounds {
  window: StudyAgeWindow;
  /** Inclusive lower bound, or null when unbounded. */
  from: Date | null;
  /** Exclusive upper bound, or null when unbounded. */
  to: Date | null;
  /** IST calendar day YYYY-MM-DD when window is `today`. */
  todayIst?: string;
}

export function resolveStudyAgeBounds(opts: {
  window: StudyAgeWindow | string | null | undefined;
  now?: Date;
  customFrom?: Date | string | null;
  customTo?: Date | string | null;
}): StudyAgeBounds {
  const window = parseStudyAgeWindow(opts.window);
  const now = opts.now ?? new Date();
  if (window === "all") return { window, from: null, to: null };
  if (window === "today") {
    const day = todayIST(now);
    return {
      window,
      from: new Date(`${day}T00:00:00+05:30`),
      to: endOfIstDay(day),
      todayIst: day,
    };
  }
  if (window === "custom") {
    const from = asDate(opts.customFrom);
    const toRaw = asDate(opts.customTo);
    const looksDateOnly = typeof opts.customTo === "string" && /^\d{4}-\d{2}-\d{2}$/.test(opts.customTo.trim());
    const to = looksDateOnly && typeof opts.customTo === "string"
      ? endOfIstDay(opts.customTo.trim())
      : toRaw
        ? new Date(toRaw.getTime() + 1)
        : null;
    return { window, from, to };
  }
  const hours =
    window === "last_24h" ? 24
      : window === "last_48h" ? 48
        : window === "last_3d" ? 72
          : 168;
  return { window, from: new Date(now.getTime() - hours * 3600_000), to: now };
}

export function isInstantInStudyAgeWindow(instant: Date | null, bounds: StudyAgeBounds): boolean {
  if (bounds.window === "all") return true;
  if (!instant) return false;
  const t = instant.getTime();
  if (bounds.from && t < bounds.from.getTime()) return false;
  if (bounds.to && t >= bounds.to.getTime()) return false;
  return true;
}

export function isStudyInAgeWindow(opts: {
  window: StudyAgeWindow | string | null | undefined;
  studyDate?: string | Date | null;
  createdAt?: Date | string | null;
  now?: Date;
  customFrom?: Date | string | null;
  customTo?: Date | string | null;
}): boolean {
  const bounds = resolveStudyAgeBounds({
    window: opts.window,
    now: opts.now,
    customFrom: opts.customFrom,
    customTo: opts.customTo,
  });
  const instant = resolveStudyAgeInstant({
    window: bounds.window,
    studyDate: opts.studyDate,
    createdAt: opts.createdAt,
  });
  return isInstantInStudyAgeWindow(instant, bounds);
}
