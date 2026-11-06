/**
 * Where clinically significant files that are written, then referenced only from
 * disk, must land so a container recreate cannot delete them.
 *
 * care-api mounts three persistent paths (`docker-compose.yml`): a named volume at
 * /app/data/uploads, one at /app/data/object-storage, and the NAS backup tree at
 * /volume1/docker/backups. Everything else under /app — including /app/data itself
 * — is the container's writable layer, which `docker compose up --build` discards.
 * Two retention jobs wrote their only copy of clinical data into that layer and
 * then deleted the database rows: the audit-log cold archive and the MWL prune
 * restore file. Both had already run in production, so the deleted rows' only
 * remaining copy lived in a directory the next deploy would destroy.
 *
 * Device ids cannot detect this: on Synology the layer and the bind mounts are all
 * on /dev/mapper/cachedev_0, so `stat.dev` says "same filesystem" for a real bind
 * mount and for the throwaway layer alike. The mount table is the only signal, so
 * durability is read from /proc/self/mountinfo.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveDataDir } from "./backupHealth";

/**
 * The container side of the backup bind
 * `${BACKUP_HOST_DIR:-/volume1/docker/backups}:/volume1/docker/backups`. Stable even
 * when the host side is overridden, because the target half of a bind is fixed text.
 */
export const CONTAINER_BACKUP_ROOT = "/volume1/docker/backups";
export const CLINICAL_ARCHIVE_DIR_ENV = "CARE_CLINICAL_ARCHIVE_DIR";

export type ClinicalArchiveDir = {
  dir: string;
  /** True when the directory sits on a mount that survives a recreate. */
  durable: boolean;
  /** What was checked — goes in the job log so a refusal is diagnosable. */
  detail: string;
  /** A production run must refuse its destructive step when `durable` is false. */
  enforceDurability: boolean;
};

/** Mount points from a mountinfo body. The container root `/` is excluded: it IS the layer. */
export function parseMountPoints(mountinfo: string): string[] {
  const points: string[] = [];
  for (const line of mountinfo.split("\n")) {
    const fields = line.trim().split(" ");
    // mount point is field 5; it escapes spaces as \040.
    const point = fields[4]?.replace(/\\040/g, " ").replace(/\\011/g, "\t").replace(/\\012/g, "\n");
    if (!point || point === "/") continue;
    points.push(point);
  }
  return points;
}

/** `dir` is durable when some mount point is `dir` itself or an ancestor of it. */
export function isOnMountedPath(dir: string, mountPoints: string[]): boolean {
  const normalized = dir.replace(/\/+$/, "");
  return mountPoints.some((mp) => {
    const mount = mp.replace(/\/+$/, "");
    return normalized === mount || normalized.startsWith(mount + "/");
  });
}

/** `/proc/self/mountinfo`, or null where there is none (Windows, macOS). */
export function readMountinfo(): string | null {
  try {
    return readFileSync("/proc/self/mountinfo", "utf8");
  } catch {
    return null;
  }
}

export function resolveClinicalArchiveDir(opts: {
  /** Leaf folder for this writer, e.g. "audit-logs". */
  subdir: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  production?: boolean;
  /** Injectable for tests; read from /proc when omitted. */
  mountinfo?: string | null;
}): ClinicalArchiveDir {
  const env = opts.env ?? process.env;
  const cwd = opts.cwd ?? process.cwd();
  const production = opts.production ?? env.NODE_ENV === "production";
  const mountinfo = opts.mountinfo !== undefined ? opts.mountinfo : production ? readMountinfo() : null;

  const override = env[CLINICAL_ARCHIVE_DIR_ENV]?.trim();
  const dir = override
    ? path.resolve(override, opts.subdir)
    : production
      ? `${CONTAINER_BACKUP_ROOT}/${opts.subdir}`
      : path.join(resolveDataDir(env, cwd), "archives", opts.subdir);

  if (mountinfo === null) {
    return {
      dir,
      durable: false,
      detail: "mount table unavailable (/proc/self/mountinfo) — durability not verified",
      enforceDurability: production,
    };
  }
  const mountPoints = parseMountPoints(mountinfo);
  // Mount points are POSIX. Two Windows-only artifacts would otherwise make a real
  // mount look unmounted on a development box: backslash separators, and path.resolve
  // hanging the current drive letter off a POSIX absolute path like /volume1/…
  const posixDir = (path.sep === "/" ? dir : dir.replace(/^[A-Za-z]:/, "").split(path.sep).join("/"));
  const durable = isOnMountedPath(posixDir, mountPoints);
  return {
    dir,
    durable,
    detail: durable
      ? `on a mounted path, so it survives a container recreate`
      : `not under any mount in the container's mount table — a recreate deletes it`,
    enforceDurability: production,
  };
}
