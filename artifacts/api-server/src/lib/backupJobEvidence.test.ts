import { describe, expect, test } from "vitest";
import {
  evaluateBackupEncryption,
  evaluateBackupJobEvidence,
  formatBackupRunProof,
  offNasEvidence,
  parseBackupRunProof,
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

/** A run that proved its own artifact: the digest of the dump, the digest of the ciphertext, and
 *  the byte count that came back out when the ciphertext was opened again. */
const PROVEN_NOTES = `Backup saved to /volume1/backup/care-erp/db/x.sql.enc. ` + formatBackupRunProof({
  version: 1,
  plaintextSha256: "11".repeat(32),
  artifactSha256: "0bc6a2db432a7c7792fd8bb9c0c0d740a1043cdb1f133cb5efe83c4ee71ab3db",
  plaintextBytes: 853_024_976,
  decryptedBytes: 853_024_976,
  keySource: "BACKUP_PASSPHRASE",
  outcome: "verified",
});

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
    notes: PROVEN_NOTES,
    ...over,
  };
}

const ON_DISK: ArtifactProbe = { checked: true, exists: true, sizeBytes: 853_024_976, modifiedAt: at(22, 20, 48) };

function evaluate(over: {
  job?: Partial<EvidenceJobRecord>;
  log?: EvidenceLogRecord | null;
  artifact?: ArtifactProbe;
  now?: Date;
  availableKeySources?: string[] | null;
}) {
  return evaluateBackupJobEvidence({
    job: job(over.job ?? {}),
    latestLog: over.log === undefined ? log() : over.log,
    artifact: over.artifact ?? ON_DISK,
    now: over.now ?? at(22, 23, 30),
    // What the route passes: the key sources this process can actually use right now.
    availableKeySources: over.availableKeySources ?? ["BACKUP_PASSPHRASE", "SESSION_SECRET"],
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

describe("encrypted=true is not evidence that a backup opens", () => {
  // P10 requirements 4-5 on the read side. Every row the scheduler wrote before this change says
  // `encrypted=true`, because that column records that the code called openssl — not that the
  // artifact can be turned back into the database. The page has to say so, in the worst case loudly,
  // instead of letting a green tick stand in for a restore nobody tested.

  function proofNotes(over: Partial<Parameters<typeof formatBackupRunProof>[0]> = {}) {
    return "Backup saved to /volume1/backup/care-erp/db/x.sql.enc. " + formatBackupRunProof({
      version: 1,
      plaintextSha256: "11".repeat(32),
      artifactSha256: "0bc6a2db432a7c7792fd8bb9c0c0d740a1043cdb1f133cb5efe83c4ee71ab3db",
      plaintextBytes: 853_024_976,
      decryptedBytes: 853_024_976,
      keySource: "BACKUP_PASSPHRASE",
      outcome: "verified",
      ...over,
    });
  }

  test("a run that carries its proof is HEALTHY and states what was proven", () => {
    const e = evaluate({});
    expect(e.encryption.state).toBe("proven");
    expect(e.encryption.decryptProven).toBe(true);
    expect(e.encryption.keySource).toBe("BACKUP_PASSPHRASE");
    expect(e.encryption.decryptedBytes).toBe(853_024_976);
    expect(e.encryption.reason).toMatch(/Decrypt-verified/);
    expect(e.state).toBe("HEALTHY");
    expect(e.reasons).toEqual([]);
  });

  test("an encrypted row with no proof warns, in the operator's words rather than a code", () => {
    // Every artifact the clinic already has is in this shape, which is the honest finding: nobody has
    // ever opened them.
    const e = evaluate({ log: log({ notes: "Backup saved to /volume1/backup/care-erp/db/x.sql.enc." }) });
    expect(e.encryption.state).toBe("unproven");
    expect(e.encryption.decryptProven).toBe(false);
    expect(e.encryption.reason).toMatch(/nothing ever decrypted this artifact/);
    expect(e.state).toBe("WARNING");
    expect(e.reasons.join(" ")).toMatch(/nothing ever decrypted this artifact/);
    expect(e.verified).toBe(true); // the file is still there; that is the weaker claim
  });

  test("a row that does not say whether it was encrypted is not assumed to have been", () => {
    const e = evaluate({ log: log({ encrypted: null, notes: null }) });
    expect(e.encryption.state).toBe("unknown");
    expect(e.state).toBe("WARNING");
    expect(e.reasons.join(" ")).toMatch(/did not record whether the artifact was encrypted/);
  });

  test("an unencrypted artifact is called out as patient data sitting in plaintext", () => {
    // The direct read of evaluateBackupEncryption, which the page renders as its own badge.
    const enc = evaluateBackupEncryption({
      encrypted: false,
      notes: null,
      availableKeySources: ["BACKUP_PASSPHRASE"],
      loggedSuccess: true,
    });
    expect(enc.state).toBe("not_encrypted");
    expect(enc.reason).toMatch(/plaintext/);
    const e = evaluate({ log: log({ encrypted: false, notes: null }) });
    expect(e.state).toBe("WARNING");
    expect(e.reasons.join(" ")).toMatch(/unencrypted/);
  });

  test("a failed run has no encryption state to assess", () => {
    const e = evaluateBackupEncryption({
      encrypted: true,
      notes: proofNotes(),
      availableKeySources: ["BACKUP_PASSPHRASE"],
      loggedSuccess: false,
    });
    expect(e.state).toBe("unknown");
    expect(e.decryptProven).toBe(false);
  });
});

describe("a proof survives only as long as the key that made it does", () => {
  // P10 requirement 7. The proof marker names WHICH passphrase opened the artifact. After a
  // rotation, that sentence is still true and still useless: the current process cannot reproduce
  // it, so an older backup must not keep counting as recoverable. Reported, not inferred — the
  // caller passes the keys it actually has.

  const retiredProof = log({ notes: "saved. " + formatBackupRunProof({
    version: 1,
    plaintextSha256: "11".repeat(32),
    artifactSha256: "0bc6a2db432a7c7792fd8bb9c0c0d740a1043cdb1f133cb5efe83c4ee71ab3db",
    plaintextBytes: 853_024_976,
    decryptedBytes: 853_024_976,
    keySource: "SESSION_SECRET",
    outcome: "verified",
  }) });

  test("a proof made with a key this process no longer has is CRITICAL, not green", () => {
    const e = evaluate({ log: retiredProof, availableKeySources: ["BACKUP_PASSPHRASE"] });
    expect(e.encryption.state).toBe("proven_with_retired_key");
    // The proof was real — say so — while refusing to treat it as reachability.
    expect(e.encryption.decryptProven).toBe(true);
    expect(e.encryption.keySource).toBe("SESSION_SECRET");
    expect(e.encryption.reason).toMatch(/do not count it as recoverable until it is re-proven/);
    expect(e.state).toBe("CRITICAL");
  });

  test("a proof whose key is still configured is not downgraded by a rotation of the other one", () => {
    const e = evaluate({ log: retiredProof, availableKeySources: ["BACKUP_PASSPHRASE", "SESSION_SECRET"] });
    expect(e.encryption.state).toBe("proven");
    expect(e.state).toBe("HEALTHY");
  });

  test("an unknown key inventory cannot claim a key was retired", () => {
    // Null means the caller could not say what keys exist. Guessing "retired" would report a
    // catastrophe the page has no evidence for, so the proof stands and the page says who made it.
    const e = evaluate({ log: retiredProof, availableKeySources: null });
    expect(e.encryption.state).toBe("proven");
    expect(e.state).toBe("HEALTHY");
  });

  test("a retired-key artifact is left out of the last verified backup", () => {
    const older = evaluate({
      job: job({ id: 1, jobName: "Nightly DB", lastRunAt: at(19, 20, 0) }),
      log: log({ startedAt: at(19, 20, 0) }),
      artifact: ON_DISK,
      now: at(22, 23, 0),
    });
    const newer = evaluate({
      job: job({ id: 3, jobName: "Nightly DB (after rotation)", lastRunAt: at(22, 20, 0) }),
      log: retiredProof,
      artifact: ON_DISK,
      now: at(22, 23, 0),
      availableKeySources: ["BACKUP_PASSPHRASE"],
    });
    expect(newer.verified).toBe(true);
    const summary = summariseBackupEvidence([
      { job: job({ id: 1, jobName: "Nightly DB", lastRunAt: at(19, 20, 0) }), evidence: older },
      { job: job({ id: 3, jobName: "Nightly DB (after rotation)", lastRunAt: at(22, 20, 0) }), evidence: newer },
    ]);
    // The most recent file on disk is the one the clinic can no longer open. Reading this card as
    // "last verified" during a recovery must not point at it.
    expect(summary.lastVerifiedJob).toBe("Nightly DB");
    expect(summary.lastVerifiedAt && (summary.lastVerifiedAt as Date).getDate()).toBe(19);
    expect(summary.encryption.proven).toBe(1);
    expect(summary.encryption.retiredKey).toBe(1);
    expect(summary.needsAttention.map((j) => j.jobName)).toContain("Nightly DB (after rotation)");
  });

  test("the overview tallies every job by what was actually proven", () => {
    const summary = summariseBackupEvidence([
      { job: job({ id: 1 }), evidence: evaluate({}) },
      { job: job({ id: 2, jobName: "Old row" }), evidence: evaluate({ log: log({ notes: null }) }) },
      { job: job({ id: 3, jobName: "Plaintext" }), evidence: evaluate({ log: log({ encrypted: false, notes: null }) }) },
      { job: job({ id: 4, jobName: "Rotated" }), evidence: evaluate({ log: retiredProof, availableKeySources: ["BACKUP_PASSPHRASE"] }) },
      { job: job({ id: 5, jobName: "Never ran" }), evidence: evaluate({ log: null }) },
    ]);
    expect(summary.encryption).toEqual({ jobs: 5, proven: 1, unproven: 1, retiredKey: 1, notEncrypted: 1, unknown: 1 });
  });
});

describe("the proof marker is parsed strictly, or not at all", () => {
  // Fail-closed by design: the marker lives in a free-text column, so anything the reader cannot
  // match exactly is treated as ABSENCE of proof. A future writer that renames a field or emits a
  // different outcome must not be able to hand this page a proof it never earned.

  const valid = formatBackupRunProof({
    version: 1,
    plaintextSha256: "ab".repeat(32),
    artifactSha256: "cd".repeat(32),
    plaintextBytes: 1000,
    decryptedBytes: 1000,
    keySource: "SESSION_SECRET",
    outcome: "verified",
  });

  test("a marker written by the formatter reads back as the same proof", () => {
    expect(parseBackupRunProof(`Backup saved. ${valid}`)).toEqual({
      version: 1,
      plaintextSha256: "ab".repeat(32),
      artifactSha256: "cd".repeat(32),
      plaintextBytes: 1000,
      decryptedBytes: 1000,
      keySource: "SESSION_SECRET",
      outcome: "verified",
    });
  });

  test("anything but a completed proof is no proof", () => {
    const notProofs = [
      null,
      undefined,
      "",
      "Backup saved to /volume1/db/x.sql.enc (openssl-aes-256-cbc, key=BACKUP_PASSPHRASE)",
      valid.replace("outcome=verified", "outcome=failed"),
      valid.replace("outcome=verified", "outcome=pending"),
      valid.replace("key=SESSION_SECRET", "key=UNKNOWN"),
      valid.replace("key=SESSION_SECRET", "key=session_secret"),
      valid.replace("ab".repeat(32), "ab".repeat(31)),
      valid.replace("ab".repeat(32), "AB".repeat(32)),
      // The prefix is matched exactly; a similar token from another tool is not a proof.
      valid.replace("backupProof=v1", "backupProof=v2"),
    ];
    for (const notes of notProofs) {
      expect(parseBackupRunProof(notes)).toBeNull();
    }
  });

  test("a proof is about the digest; a missing byte count does not cancel it, and does not fake one", () => {
    // `bytes=unknown` is a shape a real writer can produce when it never measured the dump. The
    // digest comparison still happened, so the proof stands and the count is honestly null — the
    // reader must not turn a supplementary field into either a pass or a fail.
    const parsed = parseBackupRunProof(valid.replace("bytes=1000", "bytes=unknown"));
    expect(parsed).not.toBeNull();
    expect(parsed!.plaintextBytes).toBeNull();
    expect(parsed!.decryptedBytes).toBe(1000);
    expect(parsed!.plaintextSha256).toBe("ab".repeat(32));
  });

  test("an artifact digest that was never taken is recorded, and does not fake a plaintext proof", () => {
    const noArtifactHash = formatBackupRunProof({
      version: 1,
      plaintextSha256: "ab".repeat(32),
      artifactSha256: null,
      plaintextBytes: 1000,
      decryptedBytes: 1000,
      keySource: "BACKUP_PASSPHRASE",
      outcome: "verified",
    });
    const parsed = parseBackupRunProof(noArtifactHash);
    expect(parsed).not.toBeNull();
    expect(parsed!.artifactSha256).toBeNull();
    // The plaintext proof still stands — that is what "decrypt-verified" means. At-rest comparison is
    // the separate check the checksum column carries.
    expect(parsed!.plaintextSha256).toBe("ab".repeat(32));
  });

  test("an unparseable marker on an encrypted row reads as unproven, never as proven", () => {
    const e = evaluateBackupEncryption({
      encrypted: true,
      notes: `Backup saved. ${valid.replace("ab".repeat(32), "not-a-digest")}`,
      availableKeySources: ["BACKUP_PASSPHRASE"],
      loggedSuccess: true,
    });
    expect(e.state).toBe("unproven");
    expect(e.decryptProven).toBe(false);
  });
});
