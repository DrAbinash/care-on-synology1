import { describe, expect, test } from "vitest";
import {
  evaluateBackupJobEvidence,
  offNasEvidence,
  summariseBackupEvidence,
  type ArtifactProbe,
  type EvidenceJobRecord,
  type EvidenceLogRecord,
} from "./backupJobEvidence";

// October 2026: the 22nd is a Thursday, the 25th a Sunday. Times are LOCAL, which is what a stored
// cron expression means here (compose pins the container to TZ=Asia/Kolkata).
function at(day: number, hour: number, minute: number): Date {
  return new Date(2026, 9, day, hour, minute, 0, 0);
}

function job(over: Partial<EvidenceJobRecord> = {}): EvidenceJobRecord {
  return {
    id: 1,
    jobName: "Nightly DB",
    backupType: "DB",
    destinationType: "SYNOLOGY_NAS",
    destinationPath: "/volume1/backup/care-erp/db",
    schedule: "0 20 * * *",
    lastRunAt: at(22, 20, 0),
    lastStatus: "success",
    lastError: null,
    retentionDays: 14,
    isEnabled: true,
    ...over,
  };
}

function log(over: Partial<EvidenceLogRecord> = {}): EvidenceLogRecord {
  return {
    id: 500,
    status: "success",
    startedAt: at(22, 20, 0),
    completedAt: at(22, 20, 48),
    sizeBytes: 853_024_976,
    filePath: "/volume1/backup/care-erp/db/backup_Nightly_DB_2026-10-22T14-30-46-127Z.sql.enc",
    checksum: "0bc6a2db432a7c7792fd8bb9c0c0d740a1043cdb1f133cb5efe83c4ee71ab3db",
    encrypted: true,
    errorMessage: null,
    ...over,
  };
}

const ON_DISK: ArtifactProbe = { checked: true, exists: true, sizeBytes: 853_024_976, modifiedAt: at(22, 20, 48) };

function evaluate(over: {
  job?: Partial<EvidenceJobRecord>;
  log?: EvidenceLogRecord | null;
  artifact?: ArtifactProbe;
  now?: Date;
}) {
  return evaluateBackupJobEvidence({
    job: job(over.job ?? {}),
    latestLog: over.log === undefined ? log() : over.log,
    artifact: over.artifact ?? ON_DISK,
    now: over.now ?? at(22, 23, 30),
  });
}

describe("a green row is only green when the file is there", () => {
  test("success plus an artifact of the recorded size is HEALTHY and verified", () => {
    const e = evaluate({});
    expect(e.state).toBe("HEALTHY");
    expect(e.verified).toBe(true);
    expect(e.reasons).toEqual([]);
    expect(e.artifact.status).toBe("present");
    expect(e.artifact.sizeBytes).toBe(853_024_976);
  });

  test("a logged success whose file is gone is CRITICAL, not the green it used to be", () => {
    const e = evaluate({ artifact: { checked: true, exists: false } });
    expect(e.state).toBe("CRITICAL");
    expect(e.verified).toBe(false);
    expect(e.reasons.join(" ")).toMatch(/is not on disk/);
    expect(e.reasons.join(" ")).toMatch(/backup_Nightly_DB_/);
  });

  test("a file whose size contradicts the ledger is CRITICAL", () => {
    const e = evaluate({ artifact: { checked: true, exists: true, sizeBytes: 1_048_576, modifiedAt: at(22, 20, 48) } });
    expect(e.state).toBe("CRITICAL");
    expect(e.artifact.status).toBe("mismatched");
    expect(e.reasons.join(" ")).toMatch(/does not match the run/);
  });

  test("a file that could not be looked at is UNKNOWN — never inferred healthy", () => {
    const e = evaluate({ artifact: { checked: false, error: "EACCES" } });
    expect(e.state).toBe("UNKNOWN");
    expect(e.verified).toBe(false);
    expect(e.reasons.join(" ")).toMatch(/could not be checked: EACCES/);
  });

  test("a success with no SHA-256 recorded is only 'present', so it warns", () => {
    const e = evaluate({ log: log({ checksum: null }) });
    expect(e.state).toBe("WARNING");
    expect(e.reasons.join(" ")).toMatch(/at-rest corruption/);
  });

  test("an unencrypted artifact is reported, not waved through", () => {
    const e = evaluate({ log: log({ encrypted: false }) });
    expect(e.state).toBe("WARNING");
    expect(e.reasons.join(" ")).toMatch(/plaintext/);
  });
});

describe("the schedule shown is the schedule the runner will honour", () => {
  test("a daily 20:00 job reads as daily and names tonight, not the next hour", () => {
    const e = evaluate({ now: at(22, 9, 0) });
    expect(e.scheduleLabel).toBe("Daily at 20:00");
    expect(e.nextRunAt && (e.nextRunAt as Date).getHours()).toBe(20);
    expect(e.nextRunAt && (e.nextRunAt as Date).getDate()).toBe(22);
  });

  test("the hourly-ran-daily defect cannot show up as a next run an hour away", () => {
    // This is the display-side test of PR #1133's bug: with only the minute field honoured, every
    // minute-0 clock reading looked like the next occurrence.
    for (const hour of [0, 3, 9, 15, 21]) {
      const e = evaluate({ job: { schedule: "0 2 * * *" }, now: at(22, hour, 0) });
      const next = e.nextRunAt as Date;
      expect([next.getHours(), next.getMinutes()]).toEqual([2, 0]);
      expect(next.getDate()).toBe(hour < 2 ? 22 : 23);
    }
  });

  test("an unreadable schedule on an enabled job is CRITICAL even while last_status says success", () => {
    const e = evaluate({ job: { schedule: "nightly at 2" } });
    expect(e.state).toBe("CRITICAL");
    expect(e.scheduleLabel).toBe("Unknown schedule");
    expect(e.nextRunAt).toBeNull();
    expect(e.reasons.join(" ")).toMatch(/does not run/);
  });

  test("a manual job is stated as manual, and a manual job with a file is not HEALTHY", () => {
    expect(evaluate({ job: { schedule: "MANUAL" } }).state).toBe("WARNING");
    expect(evaluate({ job: { schedule: "MANUAL" }, log: null }).state).toBe("UNKNOWN");
    expect(evaluate({ job: { schedule: null } }).scheduleLabel).toBe("Manual only");
  });

  test("a disabled job never claims a schedule is working", () => {
    const e = evaluate({ job: { isEnabled: false } });
    expect(e.state).toBe("WARNING");
    expect(e.reasons.join(" ")).toMatch(/disabled/);
  });
});

describe("a missed occurrence is visible", () => {
  test("three days without a run on a daily schedule is overdue, whatever last_status says", () => {
    const e = evaluate({ job: { schedule: "0 20 * * *", lastRunAt: at(19, 20, 0) }, log: log({ startedAt: at(19, 20, 0) }), now: at(22, 10, 0) });
    expect(e.overdue).toBe(true);
    expect(e.state).toBe("CRITICAL");
    expect(e.reasons.join(" ")).toMatch(/went by with no run/);
    expect(e.reasons.join(" ")).toMatch(/2026-10-21 20:00/);
    expect(e.reasons.join(" ")).toMatch(/last recorded run was 2026-10-19 20:00/);
  });

  test("a schedule that has matched nothing in eight days says so plainly", () => {
    const e = evaluate({ job: { schedule: "0 2 30 2 *", lastRunAt: null, lastStatus: null }, log: null, now: at(22, 10, 0) });
    expect(e.state).toBe("CRITICAL");
    expect(e.reasons.join(" ")).toMatch(/matched no minute in the last 8 days/);
  });

  test("a run recorded at the occurrence is not overdue", () => {
    const e = evaluate({ job: { lastRunAt: at(22, 20, 0) }, now: at(23, 9, 0) });
    expect(e.overdue).toBe(false);
    expect(e.dueNow).toBe(false);
  });

  test("the occurrence the runner would fire for right now is reported as due", () => {
    const e = evaluate({ job: { schedule: "0 20 * * *", lastRunAt: at(21, 20, 0) }, now: at(22, 20, 30) });
    expect(e.dueNow).toBe(true);
  });
});

describe("the newest run is not the newest backup", () => {
  const healthyNightly = { job: job({ id: 1, jobName: "Nightly DB", lastRunAt: at(19, 20, 0) }), latestLog: log({ startedAt: at(19, 20, 0) }), artifact: ON_DISK, now: at(22, 23, 0) };
  const failedHourly = { job: job({ id: 2, jobName: "DB", schedule: "0 * * * *", lastRunAt: at(22, 22, 0), lastStatus: "failed" }), latestLog: log({ status: "failed", startedAt: at(22, 22, 0), completedAt: at(22, 22, 1), filePath: null, sizeBytes: null, checksum: null, errorMessage: "pg_dump exited 1" }), artifact: { checked: true, exists: false }, now: at(22, 23, 0) };

  test("lastVerified names the job whose file exists, not the job that ran most recently", () => {
    const summary = summariseBackupEvidence([
      { job: healthyNightly.job, evidence: evaluateBackupJobEvidence(healthyNightly) },
      { job: failedHourly.job, evidence: evaluateBackupJobEvidence(failedHourly) },
    ]);
    expect(summary.lastVerifiedJob).toBe("Nightly DB");
    expect(summary.lastVerifiedAt && (summary.lastVerifiedAt as Date).getDate()).toBe(19);
    expect(summary.lastVerifiedSizeBytes).toBe(853_024_976);
    expect(summary.needsAttention[0].jobName).toBe("DB");
    expect(summary.needsAttention[0].state).toBe("CRITICAL");
    expect(summary.counts.CRITICAL).toBe(1);
  });

  test("nextScheduled is the soonest enabled job, in time order", () => {
    const a = evaluateBackupJobEvidence({ job: job({ id: 1, jobName: "Nightly DB", schedule: "0 20 * * *" }), latestLog: log(), artifact: ON_DISK, now: at(22, 9, 0) });
    const b = evaluateBackupJobEvidence({ job: job({ id: 2, jobName: "Config", schedule: "0 2 * * *" }), latestLog: log(), artifact: ON_DISK, now: at(22, 9, 0) });
    const summary = summariseBackupEvidence([{ job: job(), evidence: a }, { job: job({ id: 2 }), evidence: b }]);
    // Tonight's 20:00 comes before tomorrow's 02:00.
    expect(summary.nextScheduledJob).toBe("Nightly DB");
    expect(summary.nextScheduledAt && (summary.nextScheduledAt as Date).getHours()).toBe(20);
  });

  test("a disabled job does not contribute a next scheduled time", () => {
    // The disabled job's next minute (12:00 today) is EARLIER than the enabled job's (20:00 today),
    // so a summary that forgot to check isEnabled would name the wrong job — a version of this test
    // where the disabled job's next run was later survived that mutant.
    const enabled = evaluateBackupJobEvidence({ job: job({ schedule: "0 20 * * *" }), latestLog: log(), artifact: ON_DISK, now: at(22, 9, 0) });
    const disabled = evaluateBackupJobEvidence({ job: job({ id: 2, jobName: "Retired", schedule: "0 12 * * *", isEnabled: false }), latestLog: log(), artifact: ON_DISK, now: at(22, 9, 0) });
    expect(disabled.nextRunAt && (disabled.nextRunAt as Date).getHours()).toBe(12);
    const summary = summariseBackupEvidence([
      { job: job({ schedule: "0 20 * * *" }), evidence: enabled },
      { job: job({ id: 2, jobName: "Retired", schedule: "0 12 * * *", isEnabled: false }), evidence: disabled },
    ]);
    expect(summary.nextScheduledJob).toBe("Nightly DB");
    expect(summary.nextScheduledAt && (summary.nextScheduledAt as Date).getHours()).toBe(20);
  });

  test("no verified artifact at all reports null, not a reassuring date", () => {
    const summary = summariseBackupEvidence([{ job: job(), evidence: evaluate({ artifact: { checked: true, exists: false } }) }]);
    expect(summary.lastVerifiedAt).toBeNull();
    expect(summary.lastVerifiedJob).toBeNull();
  });
});

describe("off-NAS protection is only claimed when it can be seen", () => {
  test("a destination on the same device as the app data is called out", () => {
    const e = offNasEvidence({ destinationDev: 42, appDataDev: 42, destinationPath: "/volume1/backup/care-erp/db" });
    expect(e.state).toBe("WARNING");
    expect(e.sameVolumeAsAppData).toBe(true);
    expect(e.message).toMatch(/same filesystem/);
    expect(e.message).toMatch(/not an independent copy/);
  });

  test("a different device is still not proof of an independent copy", () => {
    const e = offNasEvidence({ destinationDev: 7, appDataDev: 42, destinationPath: "/mnt/nas2/backup" });
    expect(e.state).toBe("UNKNOWN");
    expect(e.sameVolumeAsAppData).toBe(false);
    expect(e.message).toMatch(/necessary but not sufficient/);
  });

  test("nothing measurable is UNKNOWN, with the reason stated", () => {
    const e = offNasEvidence({ destinationDev: null, appDataDev: 42, destinationPath: null });
    expect(e.state).toBe("UNKNOWN");
    expect(e.message).toMatch(/cannot read Hyper Backup, Duplicati, Snapshot Replication/);
  });
});
