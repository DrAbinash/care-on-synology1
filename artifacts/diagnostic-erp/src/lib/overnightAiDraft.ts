/**
 * Overnight AI Drafts worklist helpers. Display status comes from the API
 * (`overnightAi`); this file only formats timestamps and view filters.
 */

export type OvernightDisplayStatus =
  | "QUEUED"
  | "RUNNING"
  | "RETRYING"
  | "READY"
  | "ERROR"
  | "STUCK"
  | "NONE";

export interface OvernightAiPayload {
  displayStatus: OvernightDisplayStatus;
  jobId: number | null;
  jobStatus: string | null;
  queuedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  lastAttemptAt: string | null;
  attemptCount: number;
  lastError: string | null;
  queuePosition: number | null;
  stale: boolean;
  canCancel: boolean;
  canRetry: boolean;
}

export type OvernightAgeChip = "today" | "last_24h" | "last_48h" | "last_3d" | "last_7d" | "custom";
export type OvernightStatusChip = "all" | "queued" | "running" | "ready" | "error";

export const OVERNIGHT_AGE_CHIPS: Array<{ id: OvernightAgeChip; label: string }> = [
  { id: "today", label: "Today" },
  { id: "last_24h", label: "24h" },
  { id: "last_48h", label: "48h" },
  { id: "last_3d", label: "3 days" },
  { id: "last_7d", label: "7 days" },
  { id: "custom", label: "Custom" },
];

export const OVERNIGHT_STATUS_CHIPS: Array<{ id: OvernightStatusChip; label: string }> = [
  { id: "all", label: "All" },
  { id: "queued", label: "Queued" },
  { id: "running", label: "Running" },
  { id: "ready", label: "Ready" },
  { id: "error", label: "Error" },
];

export function formatRelativeAgo(iso: string | null | undefined, now = Date.now()): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const min = Math.max(0, Math.round((now - t) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const days = Math.round(hr / 24);
  return `${days}d ago`;
}

export function formatIstTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function overnightStatusMatches(
  status: OvernightDisplayStatus,
  chip: OvernightStatusChip,
): boolean {
  if (chip === "all") return true;
  if (chip === "queued") return status === "QUEUED" || status === "RETRYING";
  if (chip === "running") return status === "RUNNING";
  if (chip === "ready") return status === "READY";
  if (chip === "error") return status === "ERROR" || status === "STUCK";
  return true;
}

export function studyInOvernightAgeView(opts: {
  chip: OvernightAgeChip;
  studyDate?: string | null;
  createdAt?: string | null;
  customFrom?: string;
  customTo?: string;
  now?: Date;
}): boolean {
  const now = opts.now ?? new Date();
  const created = opts.createdAt ? new Date(opts.createdAt) : null;
  const study = parseLooseStudyDate(opts.studyDate);
  const calendarInstant = study ?? created;
  const rollingInstant = created ?? study;
  if (opts.chip === "today") {
    if (!calendarInstant) return false;
    const day = calendarInstant.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const today = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    return day === today;
  }
  if (opts.chip === "custom") {
    if (!calendarInstant) return false;
    const day = calendarInstant.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    if (opts.customFrom && day < opts.customFrom) return false;
    if (opts.customTo && day > opts.customTo) return false;
    return true;
  }
  if (!rollingInstant || Number.isNaN(rollingInstant.getTime())) return false;
  const hours = opts.chip === "last_24h" ? 24 : opts.chip === "last_48h" ? 48 : opts.chip === "last_3d" ? 72 : 168;
  return rollingInstant.getTime() >= now.getTime() - hours * 3600_000;
}

function parseLooseStudyDate(studyDate?: string | null): Date | null {
  if (!studyDate) return null;
  const raw = studyDate.trim();
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return new Date(`${compact[1]}-${compact[2]}-${compact[3]}T00:00:00+05:30`);
  if (/^\d{4}-\d{2}-\d{2}/.test(raw) && raw.length <= 10) return new Date(`${raw.slice(0, 10)}T00:00:00+05:30`);
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const OVERNIGHT_STATUS_STYLE: Record<OvernightDisplayStatus, string> = {
  QUEUED: "bg-amber-50 text-amber-800 border-amber-200",
  RETRYING: "bg-orange-50 text-orange-800 border-orange-200",
  RUNNING: "bg-sky-50 text-sky-800 border-sky-200",
  READY: "bg-purple-50 text-purple-700 border-purple-200",
  ERROR: "bg-red-50 text-red-700 border-red-200",
  STUCK: "bg-rose-50 text-rose-800 border-rose-300",
  NONE: "bg-gray-100 text-gray-600 border-gray-200",
};

function rank(status: OvernightDisplayStatus): number {
  if (status === "RUNNING") return 0;
  if (status === "READY") return 1;
  if (status === "ERROR" || status === "STUCK") return 2;
  if (status === "QUEUED" || status === "RETRYING") return 3;
  return 4;
}

function ts(iso: string | null | undefined): number {
  if (!iso) return 0;
  const n = new Date(iso).getTime();
  return Number.isNaN(n) ? 0 : n;
}

/** Overnight AI Drafts view only — does not change ordinary worklist date sort. */
export function compareOvernightWorklistRows(
  a: { overnightAi?: OvernightAiPayload | null; createdAt?: string | null },
  b: { overnightAi?: OvernightAiPayload | null; createdAt?: string | null },
): number {
  const sa = a.overnightAi?.displayStatus ?? "NONE";
  const sb = b.overnightAi?.displayStatus ?? "NONE";
  const r = rank(sa) - rank(sb);
  if (r !== 0) return r;
  if (sa === "READY") return ts(b.overnightAi?.completedAt) - ts(a.overnightAi?.completedAt);
  if (sa === "QUEUED" || sa === "RETRYING") {
    const pa = a.overnightAi?.queuePosition ?? Number.MAX_SAFE_INTEGER;
    const pb = b.overnightAi?.queuePosition ?? Number.MAX_SAFE_INTEGER;
    return pa - pb;
  }
  return ts(b.createdAt) - ts(a.createdAt);
}
