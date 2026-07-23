import { describe, expect, test } from "vitest";
import { resolveDataDir, resolveBackupDataFolders, evaluateBackupFreshness, shouldAlertOnBackup } from "./backupHealth";

describe("resolveDataDir / resolveBackupDataFolders", () => {
  test("defaults to CWD/data (matches how the app serves uploads in Docker: /app/data)", () => {
    expect(resolveDataDir({}, "/app")).toBe("/app/data");
    const folders = resolveBackupDataFolders({}, "/app");
    expect(folders.find((f) => f.label === "uploads")?.path).toBe("/app/data/uploads");
    expect(folders.map((f) => f.label)).toContain("object-storage");
  });
  test("CARE_DATA_DIR overrides", () => {
    expect(resolveDataDir({ CARE_DATA_DIR: "/mnt/nas/care" } as NodeJS.ProcessEnv, "/app")).toBe("/mnt/nas/care");
  });
  test("never resolves to the old broken repo-relative path", () => {
    expect(resolveBackupDataFolders({}, "/app").find((f) => f.label === "uploads")?.path)
      .not.toContain("artifacts/api-server/data");
  });
});

describe("evaluateBackupFreshness / dead-man", () => {
  const now = new Date("2026-07-23T12:00:00Z");
  test("recent success is ok, no alert", () => {
    const f = evaluateBackupFreshness(new Date("2026-07-23T06:00:00Z"), now, 26);
    expect(f.status).toBe("ok");
    expect(shouldAlertOnBackup(f)).toBe(false);
  });
  test("beyond threshold is stale → alert", () => {
    const f = evaluateBackupFreshness(new Date("2026-07-21T06:00:00Z"), now, 26);
    expect(f.status).toBe("stale");
    expect(shouldAlertOnBackup(f)).toBe(true);
  });
  test("no backup ever → alert", () => {
    expect(shouldAlertOnBackup(evaluateBackupFreshness(null, now, 26))).toBe(true);
    expect(shouldAlertOnBackup(evaluateBackupFreshness("not-a-date", now, 26))).toBe(true);
  });
});
