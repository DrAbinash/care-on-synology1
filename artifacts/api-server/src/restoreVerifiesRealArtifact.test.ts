import { describe, expect, test, beforeEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The weekly restore test proved nothing about your actual backups.
//
// runRestoreVerificationJob() called runRestoreVerification({ ranBy }) with no
// backupPath. Given no path, the engine takes its OWN fresh pg_dump into a
// throwaway database and restores that. So it proved pg_dump and psql work —
// and nothing at all about the files sitting on the NAS. The failure email even
// claimed it "could not restore the latest backup", which was never what ran.
//
// That is precisely how months of DATA-ONLY fallback artifacts stayed green:
// the artifacts were unrestorable, and the one job whose purpose is to catch
// that never opened one. lib/restoreVerification already accepts a backupPath
// and already knows how to decrypt every format the product has written
// (lib/backupCrypto.decryptBackupToSql) — it was simply never given one.

const rows: Array<{ filePath: string | null; completedAt: Date | null }> = [];
let capturedOpts: Record<string, unknown> | null = null;
let verificationResult = { ok: true, steps: [] as Array<{ ok: boolean; name: string; detail: string }> };
const alerts: Array<{ subject: string; html: string }> = [];

// Minimal Drizzle-shaped query builder returning `rows`.
function selectChain() {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve(rows),
  };
  return chain;
}

vi.mock("@workspace/db", () => ({
  db: { select: () => selectChain(), update: () => ({ set: () => ({ where: () => Promise.resolve() }) }) },
  pool: { connect: () => Promise.resolve({ query: () => Promise.resolve({ rows: [] }), release: () => undefined }) },
}));

vi.mock("./lib/restoreVerification", () => ({
  runRestoreVerification: (opts: Record<string, unknown>) => {
    capturedOpts = opts;
    return Promise.resolve(verificationResult);
  },
}));

vi.mock("./email", () => ({
  sendAlertEmail: (a: { subject: string; html: string }) => { alerts.push(a); return Promise.resolve(); },
  sendDailySummaryEmail: () => Promise.resolve(),
  sendMonthlyAuditEmail: () => Promise.resolve(),
}));

async function loadJob() {
  const mod = await import("./cron");
  return mod.runRestoreVerificationJob;
}

describe("the weekly restore test verifies a REAL backup artifact", () => {
  let dir: string;

  beforeEach(() => {
    vi.resetModules();
    rows.length = 0;
    alerts.length = 0;
    capturedOpts = null;
    verificationResult = { ok: true, steps: [] };
    dir = mkdtempSync(join(tmpdir(), "restore-artifact-"));
  });

  test("the newest successful backup still on disk is the one verified", async () => {
    const artifact = join(dir, "backup_nightly_2026-07-26.sql.enc");
    writeFileSync(artifact, "Salted__ciphertext");
    rows.push({ filePath: artifact, completedAt: new Date("2026-07-26T02:00:00Z") });

    const run = await loadJob();
    await run("test");

    expect(capturedOpts, "the engine must be handed the real artifact").toMatchObject({ backupPath: artifact });
    rmSync(dir, { recursive: true, force: true });
  });

  test("a pruned file is skipped in favour of an older one that still exists", async () => {
    // Retention deletes files, so the newest DB row is not necessarily the
    // newest file present. Walking back is what keeps the job useful instead
    // of failing on a path that legitimately no longer exists.
    const older = join(dir, "backup_nightly_older.sql.enc");
    writeFileSync(older, "Salted__ciphertext");
    rows.push({ filePath: join(dir, "deleted-by-retention.sql.enc"), completedAt: new Date("2026-07-26T02:00:00Z") });
    rows.push({ filePath: older, completedAt: new Date("2026-07-19T02:00:00Z") });

    const run = await loadJob();
    await run("test");

    expect(capturedOpts).toMatchObject({ backupPath: older });
    rmSync(dir, { recursive: true, force: true });
  });

  test("with no artifact at all it still runs, but does NOT claim backups are restorable", async () => {
    // Falling back to a fresh dump is fine; silently reporting that as proof
    // of restorable backups is not.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const run = await loadJob();
    await run("test");

    expect(capturedOpts).not.toHaveProperty("backupPath");
    expect(warn.mock.calls.flat().join(" ")).toMatch(/NO stored backup artifact/i);
    warn.mockRestore();
  });

  test("the failure email names what was actually tested", async () => {
    const artifact = join(dir, "backup_nightly.sql.enc");
    writeFileSync(artifact, "Salted__ciphertext");
    rows.push({ filePath: artifact, completedAt: new Date() });
    verificationResult = { ok: false, steps: [{ ok: false, name: "decrypt", detail: "bad key" }] };

    const run = await loadJob();
    await run("test");

    expect(alerts).toHaveLength(1);
    // The old email said "could not restore the latest backup" no matter what
    // it had actually opened.
    expect(alerts[0].html).toContain(artifact);
    expect(alerts[0].html).toContain("decrypt");
    rmSync(dir, { recursive: true, force: true });
  });

  test("a failure with no artifact says so, rather than implying a backup was tested", async () => {
    verificationResult = { ok: false, steps: [{ ok: false, name: "dump_created", detail: "pg_dump missing" }] };
    const run = await loadJob();
    await run("test");

    expect(alerts).toHaveLength(1);
    expect(alerts[0].html).toMatch(/NO stored backup artifact/i);
  });
});
