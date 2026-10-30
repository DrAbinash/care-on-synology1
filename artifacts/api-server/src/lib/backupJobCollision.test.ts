import { describe, expect, test } from "vitest";
import {
  backupFilePrefixOf,
  collisionMessage,
  findCollidingBackupJob,
  normalizeBackupDir,
  prefixesCollide,
  type BackupJobShape,
} from "./backupJobCollision";

// The rule this file guards is a deletion rule. cron.ts purges
// `readdirSync(destinationPath).filter(f => f.startsWith("backup_" + jobName))` by mtime, so two
// enabled jobs that share a folder and whose names share a prefix each delete the other's files.
// Production had exactly that: rows #2 and #3, both `DB`, both `0 2 * * *`, both
// /volume1/docker/backups/db, written 1.7 s apart — ~930 MB dumped twice every night.

const job = (over: Partial<BackupJobShape> = {}): BackupJobShape => ({
  id: 2,
  jobName: "DB",
  destinationPath: "/volume1/docker/backups/db",
  isEnabled: true,
  ...over,
});

describe("normalizeBackupDir", () => {
  test("keeps NAS paths as text — resolving them would rewrite them to C:\\ on a Windows checkout", () => {
    expect(normalizeBackupDir("/volume1/docker/backups/db")).toBe("/volume1/docker/backups/db");
    expect(normalizeBackupDir("/volume1/docker/backups/db/")).toBe("/volume1/docker/backups/db");
    expect(normalizeBackupDir("/volume1//docker///backups/db")).toBe("/volume1/docker/backups/db");
    expect(normalizeBackupDir("  /volume1/docker/backups/db  ")).toBe("/volume1/docker/backups/db");
    expect(normalizeBackupDir("/")).toBe("/");
  });

  test("an absent folder is not a directory, so no sweep and no collision", () => {
    expect(normalizeBackupDir(null)).toBeNull();
    expect(normalizeBackupDir("")).toBeNull();
    expect(normalizeBackupDir("   ")).toBeNull();
  });
});

describe("prefixesCollide", () => {
  test("a prefix of the other series overlaps it, in either direction", () => {
    expect(prefixesCollide("backup_DB", "backup_DB")).toBe(true);
    expect(prefixesCollide("backup_DB", "backup_DBnightly")).toBe(true);
    expect(prefixesCollide("backup_DBnightly", "backup_DB")).toBe(true);
  });

  test("unrelated series do not", () => {
    expect(prefixesCollide("backup_DB", "backup_config")).toBe(false);
    expect(prefixesCollide("backup_DB", "backup_XDB")).toBe(false);
  });

  test("the prefix is built the way cron.ts builds it", () => {
    expect(backupFilePrefixOf("DB")).toBe("backup_DB");
    expect(backupFilePrefixOf("  DB ")).toBe("backup_DB");
  });
});

describe("findCollidingBackupJob", () => {
  test("the production duplicate is refused", () => {
    const clash = findCollidingBackupJob(
      { jobName: "DB", destinationPath: "/volume1/docker/backups/db", isEnabled: true },
      [job()],
    );
    expect(clash?.id).toBe(2);
  });

  test("a trailing slash on one of them is still the same folder", () => {
    const clash = findCollidingBackupJob(
      { jobName: "DB", destinationPath: "/volume1/docker/backups/db/", isEnabled: true },
      [job()],
    );
    expect(clash?.id).toBe(2);
  });

  test("an overlapping name in the same folder is refused too", () => {
    expect(findCollidingBackupJob(
      { jobName: "DBnightly", destinationPath: "/volume1/docker/backups/db", isEnabled: true },
      [job()],
    )?.id).toBe(2);
  });

  test("a different folder is a different file series, so it is allowed", () => {
    expect(findCollidingBackupJob(
      { jobName: "DB", destinationPath: "/volume1/backup/offsite/db", isEnabled: true },
      [job()],
    )).toBeNull();
  });

  test("the same name in sibling folders that differ only by case stays allowed", () => {
    expect(findCollidingBackupJob(
      { jobName: "DB", destinationPath: "/volume1/docker/backups/Db", isEnabled: true },
      [job()],
    )).toBeNull();
  });

  // The sweep is a deletion, and only an enabled job runs it. Two disabled rows cost nothing, and
  // a row being switched off must never be blocked — that is the fix the owner is applying by hand.
  test("a job being disabled is never blocked by the job it overlaps", () => {
    expect(findCollidingBackupJob(
      { id: 3, jobName: "DB", destinationPath: "/volume1/docker/backups/db", isEnabled: false },
      [job({ id: 2 })],
    )).toBeNull();
  });

  test("a stored job that is switched off does not block a new one", () => {
    expect(findCollidingBackupJob(
      { jobName: "DB", destinationPath: "/volume1/docker/backups/db", isEnabled: true },
      [job({ isEnabled: false })],
    )).toBeNull();
  });

  test("a job with no destination cannot collide", () => {
    expect(findCollidingBackupJob({ jobName: "DB", destinationPath: null, isEnabled: true }, [job()])).toBeNull();
  });

  test("editing a job does not collide with itself", () => {
    expect(findCollidingBackupJob(
      { id: 2, jobName: "DB", destinationPath: "/volume1/docker/backups/db", isEnabled: true },
      [job({ id: 2 })],
    )).toBeNull();
  });

  test("a null isEnabled column is treated as switched off, matching the scheduler", () => {
    expect(findCollidingBackupJob(
      { jobName: "DB", destinationPath: "/volume1/docker/backups/db", isEnabled: true },
      [job({ isEnabled: null })],
    )).toBeNull();
  });
});

describe("collisionMessage", () => {
  test("names the row to edit and the folder, in the same-name case", () => {
    const msg = collisionMessage(
      { jobName: "DB", destinationPath: "/volume1/docker/backups/db", isEnabled: true },
      job({ id: 3 }),
    );
    expect(msg).toContain("#3");
    expect(msg).toContain("/volume1/docker/backups/db");
    expect(msg).toContain("Edit job #3");
  });

  test("explains the prefix overlap when the names differ", () => {
    const msg = collisionMessage(
      { jobName: "DBnightly", destinationPath: "/volume1/docker/backups/db", isEnabled: true },
      job(),
    );
    expect(msg).toContain("file prefix");
    expect(msg).toContain("backup_DB");
    expect(msg).toContain("backup_DBnightly");
  });
});
