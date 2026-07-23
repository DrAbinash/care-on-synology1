import path from "node:path";

/**
 * Backup data-folder resolution + freshness evaluation (operational
 * reliability). Pure logic, unit-tested.
 *
 * The uploads backup used to hardcode repo-relative folders
 * ("artifacts/api-server/data/uploads"), which resolve against the process
 * CWD. In the Docker image the app runs from /app (WORKDIR /app, cwd /app)
 * and serves + writes uploads under /app/data/uploads (compose volume
 * `uploads_data:/app/data/uploads`), so the repo-relative path resolved to
 * /app/artifacts/api-server/data/uploads — which does not exist — and the
 * backup silently zipped nothing while reporting success. Resolving from the
 * real data dir (CWD/data, overridable via CARE_DATA_DIR) fixes it in both
 * Docker and the repo-rooted dev layout, where the app's own artifactDir also
 * equals the CWD.
 */

export interface BackupDataFolder {
  /** Absolute path on disk. */
  path: string;
  /** Short label used as the top-level folder name inside the zip. */
  label: string;
}

/** The resolved data dir the app serves uploads from (CWD/data by default). */
export function resolveDataDir(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): string {
  return env.CARE_DATA_DIR && env.CARE_DATA_DIR.trim()
    ? path.resolve(env.CARE_DATA_DIR.trim())
    : path.resolve(cwd, "data");
}

/** Folders the files backup must capture, resolved to real runtime paths. */
export function resolveBackupDataFolders(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): BackupDataFolder[] {
  const dataDir = resolveDataDir(env, cwd);
  return [
    { path: path.join(dataDir, "uploads"), label: "uploads" },
    { path: path.join(dataDir, "reports"), label: "reports" },
    { path: path.join(dataDir, "object-storage"), label: "object-storage" },
    // Legacy locations, still resolved from CWD so they keep working in dev.
    { path: path.resolve(cwd, "attached_assets"), label: "attached_assets" },
  ];
}

export type BackupFreshness =
  | { status: "ok"; ageHours: number }
  | { status: "stale"; ageHours: number }
  | { status: "never" };

/**
 * Dead-man evaluation: is there a recent SUCCESSFUL backup? Independent of
 * whether any backup job ran this cycle — a down container or an all-disabled
 * schedule means nothing runs and the old per-job failure email never fires,
 * so silence must itself raise the alert.
 */
export function evaluateBackupFreshness(
  lastSuccessAt: Date | string | null | undefined,
  now: Date,
  thresholdHours: number,
): BackupFreshness {
  if (lastSuccessAt == null) return { status: "never" };
  const at = lastSuccessAt instanceof Date ? lastSuccessAt : new Date(lastSuccessAt);
  if (Number.isNaN(at.getTime())) return { status: "never" };
  const ageHours = (now.getTime() - at.getTime()) / 3_600_000;
  return ageHours > thresholdHours ? { status: "stale", ageHours } : { status: "ok", ageHours };
}

/** Whether a dead-man freshness result should page someone. */
export function shouldAlertOnBackup(freshness: BackupFreshness): boolean {
  return freshness.status === "stale" || freshness.status === "never";
}
