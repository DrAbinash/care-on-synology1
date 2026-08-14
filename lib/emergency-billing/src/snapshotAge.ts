import type { SnapshotAgeBand } from "./types";

export const SNAPSHOT_FRESH_HOURS = 6;
export const SNAPSHOT_STALE_HOURS = 24;

export function snapshotAgeHours(syncedAt: string | Date | null | undefined, now = new Date()): number | null {
  if (!syncedAt) return null;
  const t = typeof syncedAt === "string" ? Date.parse(syncedAt) : syncedAt.getTime();
  if (!Number.isFinite(t) || t <= 0) return null;
  return (now.getTime() - t) / 3_600_000;
}

export function snapshotAgeBand(syncedAt: string | Date | null | undefined, now = new Date()): SnapshotAgeBand {
  const hours = snapshotAgeHours(syncedAt, now);
  if (hours == null) return "never";
  if (hours < SNAPSHOT_FRESH_HOURS) return "fresh";
  if (hours < SNAPSHOT_STALE_HOURS) return "warning";
  return "stale";
}

export function formatDurationHours(hours: number | null): string {
  if (hours == null) return "never";
  if (hours < 1) {
    const mins = Math.max(0, Math.round(hours * 60));
    return mins <= 1 ? "1 minute" : `${mins} minutes`;
  }
  if (hours < 48) {
    const h = Math.round(hours * 10) / 10;
    return h === 1 ? "1 hour" : `${h} hours`;
  }
  const days = Math.round(hours / 24);
  return days === 1 ? "1 day" : `${days} days`;
}

/** Asia/Kolkata display, e.g. "14 Aug 2026, 5:05 pm" */
export function formatIstTimestamp(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function emergencyMasterSyncIntervalHours(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.EMERGENCY_MASTER_SYNC_INTERVAL_HOURS ?? 6);
  if (!Number.isFinite(n) || n <= 0) return 6;
  return Math.min(168, n);
}

/** Skip a scheduled tick when a successful push already landed inside the interval. */
export function shouldSkipScheduledPush(
  lastSuccessAt: Date | string | null | undefined,
  intervalHours: number,
  now = new Date(),
): boolean {
  if (!lastSuccessAt) return false;
  const t = typeof lastSuccessAt === "string" ? Date.parse(lastSuccessAt) : lastSuccessAt.getTime();
  if (!Number.isFinite(t)) return false;
  return now.getTime() - t < intervalHours * 3_600_000;
}
