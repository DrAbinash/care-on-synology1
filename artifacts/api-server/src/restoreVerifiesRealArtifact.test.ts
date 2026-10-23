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

// The alert state machine is NOT stubbed: it is wrapped, so the run still produces a real
// `buildBackupAlertEmail` message through the mocked transport above, while these tests can read
// exactly what the job reported (outcome, job id, detail, destination). Requirement 6 of the brief
// is that a verification failure travels on the existing backup-alert path — a stub would prove
// nothing about that.
const alertReports: Record<string, unknown>[] = [];
let alertThrows = false;
vi.mock("./lib/backupAlerts", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./lib/backupAlerts")>();
  return {
    ...mod,
    notifyBackupOutcome: (params: Record<string, unknown>) => {
      alertReports.push(params);
      if (alertThrows) return Promise.reject(new Error("watchdog_status is unreadable"));
      return mod.notifyBackupOutcome(params as never);
    },
  };
});

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
    alertReports.length = 0;
    alertThrows = false;
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

describe("the weekly restore check reports through the existing backup alert path", () => {
  // P10 requirement 6, on the read side. A backup run that fails its encryption round-trip mails
  // through PR #1137's state machine (see cron.test.ts). The check that catches an artifact which
  // only goes bad AFTER it was written — at-rest corruption, a rotated passphrase — used to mail
  // through its own `sendAlertEmail` call instead: one message a week forever, no reminder while it
  // stayed broken, and no word when it recovered. These tests pin that it now reports an outcome,
  // the way a backup job does.

  let dir: string;

  beforeEach(() => {
    vi.resetModules();
    rows.length = 0;
    alerts.length = 0;
    alertReports.length = 0;
    alertThrows = false;
    capturedOpts = null;
    verificationResult = { ok: true, steps: [] };
    dir = mkdtempSync(join(tmpdir(), "restore-alert-"));
  });

  function failingDecrypt(artifact: string) {
    rows.push({ filePath: artifact, completedAt: new Date() });
    verificationResult = {
      ok: false,
      steps: [
        { ok: true, name: "artifact_found", detail: artifact },
        { ok: false, name: "decrypt", detail: "no configured passphrase opens this artifact" },
      ],
    };
  }

  test("the failure is reported to the alert state machine as the reserved verify job", async () => {
    const artifact = join(dir, "backup_nightly_retired_key.sql.enc");
    writeFileSync(artifact, "Salted__ciphertext");
    failingDecrypt(artifact);

    const result = await (await loadJob())("test");

    expect(result.ok).toBe(false);
    expect(alertReports).toHaveLength(1);
    const report = alertReports[0]!;
    expect(report.jobId).toBe(0);
    expect(report.jobName).toBe("Weekly restore verification");
    expect(report.outcome).toBe("failure");
    expect(report.destination).toBe(artifact);
    expect(String(report.scheduleLabel)).toMatch(/Weekly/i);
    // The detail carries both what was tested and which step refused, because that is the whole
    // content of the mail an operator reads.
    expect(String(report.detail)).toContain(artifact);
    expect(String(report.detail)).toContain("FAILED decrypt");
    rmSync(dir, { recursive: true, force: true });
  });

  test("the mail it produces is the standard backup-failure mail, and there is only one", async () => {
    const artifact = join(dir, "backup_nightly_corrupt.sql.enc");
    writeFileSync(artifact, "Salted__ciphertext");
    failingDecrypt(artifact);

    await (await loadJob())("test");

    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.subject).toContain("CARE backup failed — Weekly restore verification");
    expect(alerts[0]!.html).toContain("FAILED decrypt");
    rmSync(dir, { recursive: true, force: true });
  });

  test("a passing check reports success, so an open incident gets its recovery notice", async () => {
    const artifact = join(dir, "backup_nightly_good.sql.enc");
    writeFileSync(artifact, "Salted__ciphertext");
    rows.push({ filePath: artifact, completedAt: new Date() });
    verificationResult = { ok: true, steps: [{ ok: true, name: "restore", detail: "restored into the scratch database" }] };

    await (await loadJob())("test");

    expect(alertReports).toHaveLength(1);
    expect(alertReports[0]!["outcome"]).toBe("success");
    expect(alertReports[0]!["jobId"]).toBe(0);
    expect(String(alertReports[0]!["detail"])).toContain(artifact);
    // A healthy week sends nothing: the state machine only mails a recovery when a failure was
    // outstanding, and the mocked state read reports none.
    expect(alerts).toHaveLength(0);
    rmSync(dir, { recursive: true, force: true });
  });

  test("a pass that tested no stored artifact still cannot be reported as proof", async () => {
    verificationResult = { ok: true, steps: [] };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await (await loadJob())("test");

    expect(alertReports).toHaveLength(1);
    expect(String(alertReports[0]!["detail"])).toMatch(/NO stored backup artifact/i);
    expect(alertReports[0]!["destination"]).toBeNull();
    warn.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  test("an alert layer that throws does not change what the run proved", async () => {
    // The e-mail is a report about a restore test, never part of one. With the reporting path
    // broken, the job still returns the engine's verdict and says out loud that it could not report.
    const artifact = join(dir, "backup_nightly_alert_down.sql.enc");
    writeFileSync(artifact, "Salted__ciphertext");
    failingDecrypt(artifact);
    alertThrows = true;
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await (await loadJob())("test");

    expect(result.ok).toBe(false);
    expect(result.steps).toHaveLength(2);
    expect(error.mock.calls.flat().join(" ")).toMatch(/Restore-verification alert could not be reported/i);
    expect(alerts).toHaveLength(0);
    error.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });
});
