/**
 * Night-window suppression for
 * GET /api/internal/reporting-studio/worklist.
 *
 * That one route is the expensive pull in the ERP: a page of up to 500
 * radiology_worklist rows through five joins, plus the bill-desk and billing
 * status resolution per row. Studios poll it on a fixed interval (measured in
 * production: twice every 5 minutes, ~24 pulls/hour, around the clock), and a
 * refused pull costs nothing — no query, no bridge_sync_log row.
 *
 * Pure helpers — unit-tested like reportingStudioWorklistIncremental (no Express / DB).
 */

/** Asia/Kolkata is UTC+05:30 with no DST, so IST is arithmetic, not a TZ lookup. */
export const IST_OFFSET_MINUTES = 330;
export const QUIET_WINDOW_DEFAULT_START_HOUR = 18;
export const QUIET_WINDOW_DEFAULT_END_HOUR = 9;

const OFF_VALUES = new Set([
  "off",
  "0",
  "false",
  "no",
  "none",
  "disable",
  "disabled",
]);

export type StudioQuietWindow = {
  /** Inclusive start hour, 0-23, Asia/Kolkata. */
  startHour: number;
  /** Exclusive end hour, 0-23, Asia/Kolkata. Wraps past midnight when start > end. */
  endHour: number;
};

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function parseHour(raw: string): number | null {
  if (!/^\d{1,2}$/.test(raw)) return null;
  const n = Number.parseInt(raw, 10);
  return n >= 0 && n <= 23 ? n : null;
}

/**
 * REPORTING_STUDIO_QUIET_HOURS — "HH:HH" (start:end, Asia/Kolkata).
 * Unset/blank → 18:09. "off" (or 0/false/no/none/disabled) → no window.
 * Unparseable → the shipped 18:09 window, so a typo cannot silently re-open
 * the all-night pull.
 */
export function parseStudioQuietWindow(
  raw: string | undefined | null,
): StudioQuietWindow | null {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (value === "") {
    return {
      startHour: QUIET_WINDOW_DEFAULT_START_HOUR,
      endHour: QUIET_WINDOW_DEFAULT_END_HOUR,
    };
  }
  if (OFF_VALUES.has(value)) return null;
  const parts = value.split(/[/:\-]/).filter((p) => p !== "");
  if (parts.length !== 2)
    return {
      startHour: QUIET_WINDOW_DEFAULT_START_HOUR,
      endHour: QUIET_WINDOW_DEFAULT_END_HOUR,
    };
  const startHour = parseHour(parts[0]!);
  const endHour = parseHour(parts[1]!);
  if (startHour == null || endHour == null) {
    return {
      startHour: QUIET_WINDOW_DEFAULT_START_HOUR,
      endHour: QUIET_WINDOW_DEFAULT_END_HOUR,
    };
  }
  // start === end is a zero-length window: the admin means "never closed".
  if (startHour === endHour) return null;
  return { startHour, endHour };
}

export function resolveStudioQuietWindow(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): StudioQuietWindow | null {
  return parseStudioQuietWindow(env.REPORTING_STUDIO_QUIET_HOURS);
}

/** Minutes since IST midnight for an epoch-ms instant. */
export function istMinutesOfDay(nowMs: number): number {
  return mod(Math.floor((nowMs + IST_OFFSET_MINUTES * 60_000) / 60_000), 1440);
}

export function isStudioQuietAt(
  nowMs: number,
  window: StudioQuietWindow | null,
): boolean {
  if (!window) return false;
  const hour = Math.floor(istMinutesOfDay(nowMs) / 60);
  const { startHour, endHour } = window;
  if (startHour > endHour) return hour >= startHour || hour < endHour;
  return hour >= startHour && hour < endHour;
}

/** Whole seconds until the window opens; 0 when the window is not active. */
export function studioQuietSecondsRemaining(
  nowMs: number,
  window: StudioQuietWindow | null,
): number {
  if (!isStudioQuietAt(nowMs, window)) return 0;
  const openMinutes = window!.endHour * 60;
  return mod(openMinutes - istMinutesOfDay(nowMs), 1440) * 60;
}

export function studioQuietOpensAt(
  nowMs: number,
  window: StudioQuietWindow | null,
): Date {
  return new Date(nowMs + studioQuietSecondsRemaining(nowMs, window) * 1000);
}

function two(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatIstHour(hour: number): string {
  return `${two(hour)}:00`;
}

export type StudioQuietRejection = {
  error: string;
  quiet: true;
  timezone: "Asia/Kolkata";
  quietWindow: { startHour: number; endHour: number };
  opensAt: string;
  retryAfterSeconds: number;
};

export function buildStudioQuietRejection(
  nowMs: number,
  window: StudioQuietWindow,
): StudioQuietRejection {
  const retryAfterSeconds = studioQuietSecondsRemaining(nowMs, window);
  return {
    error:
      `Reporting Studio worklist pull is closed between ${formatIstHour(window.startHour)} and ` +
      `${formatIstHour(window.endHour)} IST (REPORTING_STUDIO_QUIET_HOURS). ` +
      "The studio keeps its own data; retry after the window opens.",
    quiet: true,
    timezone: "Asia/Kolkata",
    quietWindow: { startHour: window.startHour, endHour: window.endHour },
    opensAt: studioQuietOpensAt(nowMs, window).toISOString(),
    retryAfterSeconds,
  };
}
