/**
 * Durability of the two clinical retention writers' output (audit-log cold archive,
 * MWL prune restore file). Both write the only remaining copy of rows they are about
 * to delete, so the whole question is whether the target directory survives a
 * container recreate — which in production it did not.
 *
 * No database, no server: the rules are pure, and the wiring of both writers is
 * pinned against their source because reaching either job needs a live cron tick.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CONTAINER_BACKUP_ROOT,
  CLINICAL_ARCHIVE_DIR_ENV,
  isOnMountedPath,
  parseMountPoints,
  resolveClinicalArchiveDir,
} from "./clinicalArchiveLocation";

/** The production shape: a btrfs layer, and bind/volume mounts that share its device id. */
const MOUNTINFO = [
  "645 91 0:33 /@docker/btrfs/subvolumes/abc / rw,nodev,noatime - btrfs /dev/mapper/cachedev_0 rw",
  "646 645 0:1536 / /proc rw,nosuid,nodev,noexec - proc proc rw",
  "774 645 0:33 /backup/care-erp /volume1/docker/backups rw,nodev,noatime - btrfs /dev/mapper/cachedev_0 rw",
  "775 645 0:33 /volumes/object_storage/_data /app/data/object-storage rw - btrfs /dev/mapper/cachedev_0 rw",
  "776 645 0:33 /volumes/uploads_data/_data /app/data/uploads rw - btrfs /dev/mapper/cachedev_0 rw",
  "777 645 0:33 /docker/root /mnt/escapes\\040test rw - btrfs /dev/mapper/cachedev_0 rw",
].join("\n");

/** Production as it runs on the Synology: NODE_ENV=production, no override. */
const prod = (mountinfo: string | null = MOUNTINFO, env: Record<string, string> = {}) =>
  resolveClinicalArchiveDir({ subdir: "audit-logs", env: { NODE_ENV: "production", ...env }, production: true, mountinfo, cwd: "/app" });

describe("parseMountPoints — the container's own mount table", () => {
  it("A1 drops the root, which is the ephemeral layer, not a mount to trust", () => {
    const points = parseMountPoints(MOUNTINFO);
    expect(points).not.toContain("/");
    expect(points).toContain(`${CONTAINER_BACKUP_ROOT}`);
    expect(points).toContain("/app/data/uploads");
    expect(points).toContain("/app/data/object-storage");
  });

  it("A2 decodes the mountinfo octal escapes for whitespace", () => {
    expect(parseMountPoints(MOUNTINFO)).toContain("/mnt/escapes test");
  });

  it("A3 ignores blank and malformed lines instead of throwing", () => {
    expect(parseMountPoints("\n   \nshort\n")).toEqual([]);
  });
});

describe("isOnMountedPath — ancestor matching, with the traps", () => {
  const mounts = parseMountPoints(MOUNTINFO);

  it("B1 a mount point is durable, and so is any directory below it", () => {
    expect(isOnMountedPath(`${CONTAINER_BACKUP_ROOT}/audit-logs`, mounts)).toBe(true);
    expect(isOnMountedPath(CONTAINER_BACKUP_ROOT, mounts)).toBe(true);
    expect(isOnMountedPath("/app/data/uploads/radiology-key-images", mounts)).toBe(true);
  });

  it("B2 a sibling string that merely starts with a mount name is NOT inside it", () => {
    expect(isOnMountedPath(`${CONTAINER_BACKUP_ROOT}-evil/x`, mounts)).toBe(false);
    expect(isOnMountedPath("/app/data/uploadstuff", mounts)).toBe(false);
  });

  it("B3 an unmounted directory is not durable even when its parent device is shared", () => {
    // /app/data is on the same btrfs device as the mounts above — which is exactly
    // why stat.dev cannot answer this question.
    expect(isOnMountedPath("/app/data/archives/audit-logs", mounts)).toBe(false);
    expect(isOnMountedPath("/app/data/mwl-prune-backups", mounts)).toBe(false);
  });

  it("B4 trailing slashes do not change the verdict", () => {
    expect(isOnMountedPath(`${CONTAINER_BACKUP_ROOT}/`, mounts)).toBe(true);
  });

  it("B5 nothing is durable against an empty mount table", () => {
    expect(isOnMountedPath(`${CONTAINER_BACKUP_ROOT}/audit-logs`, [])).toBe(false);
  });
});

describe("resolveClinicalArchiveDir — which directory each mode writes to", () => {
  it("C1 production puts the cold archive under the mounted NAS backup tree", () => {
    const r = prod();
    expect(r.dir).toBe(`${CONTAINER_BACKUP_ROOT}/audit-logs`);
    expect(r.durable).toBe(true);
    expect(r.enforceDurability).toBe(true);
  });

  it("C2 production refuses when the backup bind is gone from the mount table", () => {
    const withoutBackups = MOUNTINFO.split("\n").filter((l) => !l.includes(CONTAINER_BACKUP_ROOT)).join("\n");
    const r = prod(withoutBackups);
    expect(r.durable).toBe(false);
    expect(r.enforceDurability).toBe(true);
    expect(r.detail).toMatch(/not under any mount/);
  });

  it("C3 production with no mount table is unverifiable and therefore refused", () => {
    const r = prod(null);
    expect(r.durable).toBe(false);
    expect(r.enforceDurability).toBe(true);
    expect(r.detail).toMatch(/mount table unavailable/);
  });

  it("C4 development keeps a local directory and does not block the job", () => {
    const r = resolveClinicalArchiveDir({
      subdir: "audit-logs",
      env: { NODE_ENV: "test" },
      production: false,
      mountinfo: null,
      cwd: "/repo",
    });
    expect(r.dir).toBe(path.resolve("/repo", "data", "archives", "audit-logs"));
    expect(r.enforceDurability).toBe(false);
  });

  it("C5 CARE_CLINICAL_ARCHIVE_DIR wins in both modes, and durability is still checked", () => {
    const mounted = prod(MOUNTINFO, { [CLINICAL_ARCHIVE_DIR_ENV]: CONTAINER_BACKUP_ROOT });
    expect(mounted.dir).toBe(path.resolve(CONTAINER_BACKUP_ROOT, "audit-logs"));
    expect(mounted.durable).toBe(true);

    const unmounted = prod(MOUNTINFO, { [CLINICAL_ARCHIVE_DIR_ENV]: "/somewhere/else" });
    expect(unmounted.dir).toBe(path.resolve("/somewhere/else", "audit-logs"));
    expect(unmounted.durable).toBe(false);
  });

  it("C6 the two directories production actually used are not durable — this is the defect", () => {
    const mounts = parseMountPoints(MOUNTINFO);
    // Re-derived from the shipped expressions (cron.ts and mwlWorklistRetention.ts)
    // rather than typed as literals, so the assertion cannot pass vacuously.
    const oldAudit = path.posix.join(path.posix.resolve("/app"), "data", "archives", "audit-logs");
    const oldMwl = path.posix.join(path.posix.resolve("/app"), "data", "mwl-prune-backups");
    expect(isOnMountedPath(oldAudit, mounts)).toBe(false);
    expect(isOnMountedPath(oldMwl, mounts)).toBe(false);
    expect(prod().dir).not.toBe(oldAudit);
  });
});

describe("the two retention writers are wired to the rule and refuse before deleting", () => {
  const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
  const cron = src("../cron.ts");
  const retention = src("./pacs/mwlWorklistRetention.ts");

  it("D1 cron.ts archives into the resolved directory and refuses the purge when it is not durable", () => {
    expect(cron.length).toBeGreaterThan(20_000); // non-vacuity: the slice has content
    expect(cron).toContain('resolveClinicalArchiveDir({ subdir: "audit-logs" })');
    expect(cron).toContain("if (archive.enforceDurability && !archive.durable)");
    expect(cron).toContain("No rows were deleted");
    expect(cron).not.toContain('path.join(process.cwd(), "data", "archives", "audit-logs")');
  });

  it("D2 the MWL restore file resolves through the same rule and refuses the run when not durable", () => {
    expect(retention.length).toBeGreaterThan(4_000);
    expect(retention).toContain('resolveClinicalArchiveDir({ subdir: RESTORE_SUBDIR, env })');
    expect(retention).toContain("if (archive.enforceDurability && !archive.durable)");
    expect(retention).toContain("run refused, nothing was deleted");
    expect(retention).not.toContain('path.resolve(process.cwd(), RESTORE_DIRNAME)');
    expect(retention).not.toContain("RESTORE_DIRNAME");
  });

  it("D3 the compose bind the constant assumes is still the container path in the shipped contract", () => {
    const compose = src("../../../../docker-compose.yml");
    expect(compose).toContain(`:/volume1/docker/backups`);
    expect(compose).toContain("uploads_data:/app/data/uploads");
  });
});
