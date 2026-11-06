/**
 * Two enabled backup jobs must not write the same file series into the same folder.
 *
 * The scheduler's retention sweep (cron.ts, "Retention cleanup") deletes
 * `readdirSync(job.destinationPath).filter(f => f.startsWith("backup_" + job.jobName))`
 * wherever `job.retentionDays` reaches. Both halves of that key — the folder and the
 * `backup_<jobName>` prefix — come from the job's own fields, so two jobs that share them
 * each sweep the OTHER's files. With equal Retention values that is merely wasteful; with
 * different ones the shorter job silently deletes the longer job's backups, and the ledger
 * still reports "success" for both. Production carried two rows named `DB` with identical
 * schedule and destination (created 1.7 seconds apart) and wrote ~930 MB twice a night.
 */

export type BackupJobShape = {
  id: number;
  jobName: string;
  destinationPath: string | null;
  isEnabled: boolean | null;
};

/** What the candidate row is about to become. Fields not sent by the caller arrive as the stored value. */
export type BackupJobCandidate = {
  id?: number;
  jobName: string;
  destinationPath: string | null;
  isEnabled: boolean | null;
};

/**
 * Folder text as the container stores it. Deliberately string work, not `path.resolve`:
 * these are POSIX paths (`/volume1/docker/backups/db`) and resolving them on a Windows
 * checkout rewrites them to `C:\volume1\…`, which would make two equal NAS folders look
 * different — and a test could pass here while the clinic's real comparison fails.
 */
export function normalizeBackupDir(dir: string | null | undefined): string | null {
  const trimmed = (dir ?? "").trim();
  if (!trimmed) return null;
  const collapsed = trimmed.replace(/\/{2,}/g, "/");
  if (collapsed === "/") return "/";
  return collapsed.replace(/\/+$/, "");
}

/** The filename prefix the scheduler purges by — must stay identical to cron.ts. */
export function backupFilePrefixOf(jobName: string): string {
  return `backup_${(jobName ?? "").trim()}`;
}

/** True when one prefix is the other, i.e. one sweep also matches the other's files. */
export function prefixesCollide(a: string, b: string): boolean {
  return a === b || a.startsWith(b) || b.startsWith(a);
}

/**
 * The first enabled job this candidate would collide with, or null when it is safe to save.
 * A disabled job writes nothing, so it can never collide in either direction.
 */
export function findCollidingBackupJob(
  candidate: BackupJobCandidate,
  existing: BackupJobShape[],
): BackupJobShape | null {
  if (candidate.isEnabled === false) return null;
  const dir = normalizeBackupDir(candidate.destinationPath);
  if (!dir) return null; // no destination → the retention sweep never runs for this job
  const prefix = backupFilePrefixOf(candidate.jobName);
  for (const row of existing) {
    if (candidate.id !== undefined && row.id === candidate.id) continue;
    if (!row.isEnabled) continue;
    const otherDir = normalizeBackupDir(row.destinationPath);
    if (!otherDir || otherDir !== dir) continue;
    if (prefixesCollide(prefix, backupFilePrefixOf(row.jobName))) return row;
  }
  return null;
}

/** Refusal an operator can act on: names the row to edit and says what the overlap does. */
export function collisionMessage(candidate: BackupJobCandidate, clash: BackupJobShape): string {
  const sameName = (candidate.jobName ?? "").trim() === (clash.jobName ?? "").trim();
  return sameName
    ? `A backup job named "${clash.jobName}" (#${clash.id}) already writes to ${normalizeBackupDir(clash.destinationPath)} with the same file names. `
      + "Two jobs in one folder sweep each other's files, so the shorter Retention (days) silently deletes the longer job's backups. "
      + `Edit job #${clash.id} instead of creating another, or choose a different folder or name prefix.`
    : `A backup job named "${clash.jobName}" (#${clash.id}) already owns the file prefix `
      + `"${backupFilePrefixOf(clash.jobName)}" in ${normalizeBackupDir(clash.destinationPath)}, which overlaps "${backupFilePrefixOf(candidate.jobName)}". `
      + "Its Retention (days) sweep would also delete this job's backups. Use a name that does not start with (or extend) "
      + `the existing one, or a different folder.`;
}
