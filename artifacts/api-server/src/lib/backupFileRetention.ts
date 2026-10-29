/**
 * Choosing which server-side backup files an admin may delete.
 *
 * The scheduler's own retention (cron.ts) deletes by `mtimeMs < cutoff` inside
 * `backup_jobs.destination_path` with no floor, and on the clinic that path has
 * pointed at a folder nothing writes into since August — so it has never removed
 * a real dump. This module is the deliberate version: a date range in, a list of
 * named files out, and a rule that no series can be taken down to zero files.
 *
 * Pure: it takes the file list and the clock as arguments so the deciding logic
 * is testable without a server, a database or the clinic's disk.
 */

import path from "node:path";

export type ServerBackupFile = {
  filePath: string;
  fileName: string;
  directory: string;
  sizeBytes: number;
  modifiedAt: string;
  encrypted: boolean;
};

/** Typed in the UI exactly as Orthanc's purge panel requires its phrase. */
export const DELETE_CONFIRM_PHRASE = "DELETE BACKUPS";

/** A range that matches more than this must be narrowed instead of confirmed. */
export const DELETE_HARD_CAP = 300;

/** The extensions the existing GET /files already treats as backups. */
const BACKUP_EXTENSION = /\.(sql|zip|enc|gz)$/i;

/**
 * `backup_DB_2026-10-28T20-32-05-362Z.sql.enc` is what cron.ts writes; the
 * manual exports use `caredeoghar-db-2026-10-22-14-30.sql` and the sidecar uses
 * `caredeoghar_backup_<iso>.sql.gz`. One pattern covers the date and the optional
 * dashed time, so a file's own name is preferred over the filesystem mtime —
 * mtime moves when a file is copied or replicated, the name does not.
 */
const STAMP_IN_NAME = /(\d{4})-(\d{2})-(\d{2})(?:T(\d{2})-(\d{2})-(\d{2})(?:-(\d{1,3}))?Z?)?/;

export type TimestampSource = "name" | "mtime";

export function parseBackupTimestamp(file: ServerBackupFile, now: Date): { at: Date; source: TimestampSource } {
  const m = STAMP_IN_NAME.exec(file.fileName);
  if (m) {
    const [, y, mo, d, hh, mm, ss, ms] = m;
    const iso =
      `${y}-${mo}-${d}T${(hh ?? "00").padStart(2, "0")}:${(mm ?? "00").padStart(2, "0")}:` +
      `${(ss ?? "00").padStart(2, "0")}.${(ms ?? "0").padStart(3, "0")}Z`;
    const at = new Date(iso);
    if (!Number.isNaN(at.getTime()) && at.getTime() <= now.getTime() + 86_400_000) return { at, source: "name" };
  }
  const mt = new Date(file.modifiedAt);
  return { at: Number.isNaN(mt.getTime()) ? new Date(0) : mt, source: "mtime" };
}

/**
 * Files of one series share a name apart from their timestamp — `backup_DB_*`,
 * `backup_Nightly DB_*`, `caredeoghar-files-*`. The floor is per series, so
 * deleting every old `backup_DB_` dump can never take the last one with it, and
 * an unrelated series in the same folder is untouched by the rule.
 */
export function seriesKeyOf(file: ServerBackupFile): string {
  const masked = file.fileName.replace(STAMP_IN_NAME, "<stamp>");
  return `${path.resolve(file.directory)}::${masked}`;
}

export type DateRange = { dateFrom: string; dateTo: string };

export function resolveRange(r: Partial<DateRange> | undefined, now: Date): { from: Date; to: Date; dayEnd: boolean } {
  const fromStr = r?.dateFrom ?? "";
  const toStr = r?.dateTo ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromStr) || !/^\d{4}-\d{2}-\d{2}$/.test(toStr)) {
    throw new Error("A complete date range is required (dateFrom and dateTo as YYYY-MM-DD)");
  }
  const from = new Date(`${fromStr}T00:00:00.000Z`);
  // Inclusive end of the last day, so "to 2026-10-01" means through that day.
  const to = new Date(`${toStr}T23:59:59.999Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new Error("Invalid date in range");
  if (from.getTime() > to.getTime()) throw new Error("The range starts after it ends");
  if (from.getTime() > now.getTime() + 86_400_000) throw new Error("The range is entirely in the future");
  return { from, to, dayEnd: true };
}

export type ProtectedFile = { fileName: string; directory: string; sizeBytes: number; reason: string };

export type Selection = {
  range: { from: string; to: string };
  candidates: ServerBackupFile[];
  protectedFiles: ProtectedFile[];
  ignored: { fileName: string; reason: string }[];
  count: number;
  totalBytes: number;
  outsideRange: number;
  overCap: boolean;
  hardCap: number;
  oldest: string | null;
  newest: string | null;
};

/**
 * @param files      the same list GET /files returns
 * @param range      inclusive calendar range, UTC day boundaries
 * @param allowedDirs the directories the caller is willing to delete from — pass
 *                    the enumeration's own `directories`, never a client-supplied path
 * @param now        injected so the floor rule is deterministic under test
 */
export function selectBackupFilesForDeletion(
  files: ServerBackupFile[],
  range: Partial<DateRange> | undefined,
  allowedDirs: string[],
  now: Date = new Date(),
): Selection {
  const { from, to } = resolveRange(range, now);
  const roots = allowedDirs.map((d) => path.resolve(d));
  const candidates: ServerBackupFile[] = [];
  const protectedFiles: ProtectedFile[] = [];
  const ignored: { fileName: string; reason: string }[] = [];
  const bySeries = new Map<string, { file: ServerBackupFile; at: Date }>();
  let outsideRange = 0;

  for (const f of files) {
    if (!BACKUP_EXTENSION.test(f.fileName)) {
      ignored.push({ fileName: f.fileName, reason: "not a recognised backup extension" });
      continue;
    }
    // A file must sit directly inside a directory this deployment itself listed.
    // That is the traversal defence: no subdirectory, no `..`, no client path.
    const parent = path.resolve(path.dirname(f.filePath));
    if (!roots.includes(parent) || parent !== path.resolve(f.directory)) {
      ignored.push({ fileName: f.fileName, reason: "outside the directories the server lists as backups" });
      continue;
    }
    const { at } = parseBackupTimestamp(f, now);
    const key = seriesKeyOf(f);
    const best = bySeries.get(key);
    if (!best || at.getTime() > best.at.getTime()) bySeries.set(key, { file: f, at });

    // Outside the range on either side is simply not offered; it is not a
    // "protection", and calling it one would hide the real floor rule below.
    if (at < from || at > to) { outsideRange++; continue; }
    candidates.push(f);
  }

  // The floor, applied to what the range offered: the newest file of each series
  // survives even when it falls inside the requested window.
  const floors = new Map<string, ServerBackupFile>();
  for (const [key, newest] of bySeries) floors.set(key, newest.file);
  const kept: ServerBackupFile[] = [];
  for (const f of candidates) {
    const floor = floors.get(seriesKeyOf(f));
    if (floor && floor.filePath === f.filePath) {
      protectedFiles.push({ ...pick(f), reason: "newest file of its series — deleting it would leave nothing to restore" });
      continue;
    }
    kept.push(f);
  }

  kept.sort((a, b) => a.fileName.localeCompare(b.fileName));
  const times = kept.map((f) => parseBackupTimestamp(f, now).at);
  return {
    range: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
    candidates: kept,
    protectedFiles: protectedFiles.sort((a, b) => a.fileName.localeCompare(b.fileName)),
    ignored,
    count: kept.length,
    totalBytes: kept.reduce((s, f) => s + f.sizeBytes, 0),
    outsideRange,
    overCap: kept.length > DELETE_HARD_CAP,
    hardCap: DELETE_HARD_CAP,
    oldest: times.length ? new Date(Math.min(...times.map(t => t.getTime()))).toISOString() : null,
    newest: times.length ? new Date(Math.max(...times.map(t => t.getTime()))).toISOString() : null,
  };
}

function pick(f: ServerBackupFile) {
  return { fileName: f.fileName, directory: f.directory, sizeBytes: f.sizeBytes };
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}
