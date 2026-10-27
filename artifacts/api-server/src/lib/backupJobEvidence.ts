/**
 * What the Backup & Replication page is allowed to claim.
 *
 * WHY THIS EXISTS
 *   Every "green" on that page came out of `backup_jobs.last_status`, which is a log echo: the
 *   scheduler writes `success` because its own process finished. Nothing compared that row with the
 *   bytes the job was supposed to have produced. Three failures that were invisible on screen, all
 *   measured in production on 2026-10-22:
 *
 *     • a job with no `destination_path` wrote nothing at all and still reported success;
 *     • a daily 02:00 job ran hourly for weeks (see lib/backupSchedule.ts) while the page showed
 *       "Last Successful: today" — technically true, and useless as a recovery signal;
 *     • an artifact can disappear after the run (retention purge, a moved volume, a full disk), and
 *       the row goes on saying success forever.
 *
 *   So the page asks a different question: not "did the scheduler report success" but "is there a
 *   backup FILE, of the size the ledger claims, that we could actually restore from". An answer that
 *   cannot be given is reported as UNKNOWN, never as healthy.
 *
 * PURE: no fs, no db, no clock of its own. The caller probes the filesystem and the ledger and hands
 * the results in, so every rule here is testable against synthetic rows.
 */

import {
  BACKUP_CATCHUP_GRACE_MS,
  decideBackupRun,
  describeSchedule,
  formatLocalMinute,
  lastOccurrence,
  nextOccurrence,
  parseCronFields,
  toCronExpression,
} from "./backupSchedule";

export type BackupEvidenceState = "HEALTHY" | "WARNING" | "CRITICAL" | "UNKNOWN";

/** The part of `backup_jobs` this reads. */
export interface EvidenceJobRecord {
  id: number;
  jobName: string;
  backupType: string;
  destinationType: string;
  destinationPath: string | null;
  schedule: string | null;
  lastRunAt: Date | string | null;
  lastStatus: string | null;
  lastError: string | null;
  retentionDays: number | null;
  isEnabled: boolean;
}

/** The part of the newest `backup_job_logs` row this reads. */
export interface EvidenceLogRecord {
  id?: number;
  status: string;
  startedAt: Date | string;
  completedAt: Date | string | null;
  sizeBytes: number | bigint | null;
  filePath: string | null;
  checksum: string | null;
  encrypted: boolean | null;
  errorMessage: string | null;
  /** Carries the `backupProof=v1 …` marker when the run decrypt-verified its artifact. */
  notes?: string | null;
}

/** What the caller found when it looked at the artifact. `checked: false` means the page must not
 *  claim anything about the file — it is not the same as `exists: false`. */
export interface ArtifactProbe {
  checked: boolean;
  exists?: boolean;
  sizeBytes?: number | null;
  modifiedAt?: Date | string | null;
  /** Why the look failed (EACCES, ENOENT for the parent, …), for the reason line. */
  error?: string | null;
}

export interface BackupJobEvidence {
  jobId: number;
  jobName: string;
  state: BackupEvidenceState;
  /** Sentences an operator can act on. Empty when HEALTHY. */
  reasons: string[];
  scheduleLabel: string;
  /** The next scheduled minute in local time, or null when the job has no future occurrence. */
  nextRunAt: Date | string | null;
  /** True when the job is due right now (a run has not happened for the current occurrence). */
  dueNow: boolean;
  /** True when a scheduled occurrence went past the catch-up window without a run — the job is
   *  silently not backing anything up, which `last_status` cannot express. */
  overdue: boolean;
  /** Whether the ledger's own artifact is on disk and agrees with the ledger. */
  artifact: {
    status: "present" | "missing" | "mismatched" | "not-recorded" | "not-checked";
    path: string | null;
    sizeBytes: number | null;
    modifiedAt: Date | string | null;
    checksumRecorded: boolean;
  };
  /**
   * Whether "encrypted" here means anything. `encrypted=true` in the ledger is an echo of the code
   * having called openssl; this says whether the artifact was ever decrypted back to the bytes that
   * were archived, with which key, and whether that key is still configured.
   */
  encryption: BackupEncryptionEvidence;
  /** A backup this page can vouch for: a logged success whose file exists at the size it claimed.
   *  Checksum verification is deliberately NOT required here — hashing a ~810 MB dump on every page
   *  load is not something an admin screen should do — so `verified` means "present and whole", and
   *  `restoreVerified` (the overview) is what answers "would it actually restore". */
  verified: boolean;
}

/**
 * The machine-readable tail a backup run writes into `backup_job_logs.notes`.
 *
 * WHY A TEXT MARKER AND NOT A COLUMN
 *   The proof needs to be per-artifact, durable, and readable by the page — and `backup_job_logs`
 *   has no column for it. Adding one is a schema change, which in this repo means a file under
 *   `migrations/` applied by `care-db-patch-v2` and a production write the owner has not approved;
 *   inventing one inside a PR about verification would hide a migration inside a bugfix. So the
 *   writer emits a strict token and the reader parses only that token: `backupProof=v1 …`.
 *   Anything unparseable is ABSENCE of proof, never a malformed proof — the reader fails closed.
 *   The follow-up that belongs on the register is to promote this to a real column and backfill
 *   nothing (an old row has no proof, and saying so is the truth).
 *
 * What is in it is only what a restore decision needs: the digest the dump produced before
 * encryption, the digest and size of the artifact as written, the byte count that came back out of
 * openssl, and WHICH KEY proved it. No passphrase, no file contents, no patient data.
 */
export interface BackupRunProof {
  version: 1;
  plaintextSha256: string;
  artifactSha256: string | null;
  plaintextBytes: number | null;
  decryptedBytes: number | null;
  keySource: "BACKUP_PASSPHRASE" | "SESSION_SECRET";
  /** Only a completed proof is ever written; a run that could not prove it throws and is logged failed. */
  outcome: "verified";
}

const PROOF_PREFIX = "backupProof=v1";

export function formatBackupRunProof(p: BackupRunProof): string {
  return [
    PROOF_PREFIX,
    `plaintext=${p.plaintextSha256}`,
    `artifact=${p.artifactSha256 ?? "not-hashed"}`,
    `bytes=${p.plaintextBytes ?? "unknown"}`,
    `decryptedBytes=${p.decryptedBytes ?? "unknown"}`,
    `key=${p.keySource}`,
    "outcome=verified",
  ].join(" ");
}

/** Strict parse. Returns null for no marker, a partial marker, a bad digest, an unknown key or an
 *  outcome other than "verified" — so a future writer that changes the format cannot silently read
 *  as a proof. */
export function parseBackupRunProof(notes: string | null | undefined): BackupRunProof | null {
  if (!notes) return null;
  const at = notes.indexOf(PROOF_PREFIX);
  if (at === -1) return null;
  const tail = notes.slice(at).split(/\s+/).filter(Boolean);
  const fields: Record<string, string> = {};
  for (const token of tail) {
    const eq = token.indexOf("=");
    if (eq > 0) fields[token.slice(0, eq)] = token.slice(eq + 1);
  }
  const plaintext = fields.plaintext ?? "";
  if (!/^[0-9a-f]{64}$/.test(plaintext)) return null;
  const artifact = fields.artifact ?? "";
  const artifactSha256 = /^[0-9a-f]{64}$/.test(artifact) ? artifact : null;
  const key = fields.key;
  if (key !== "BACKUP_PASSPHRASE" && key !== "SESSION_SECRET") return null;
  if (fields.outcome !== "verified") return null;
  const num = (v: string | undefined) => (v && /^\d+$/.test(v) ? Number(v) : null);
  return {
    version: 1,
    plaintextSha256: plaintext,
    artifactSha256,
    plaintextBytes: num(fields.bytes),
    decryptedBytes: num(fields.decryptedBytes),
    keySource: key,
    outcome: "verified",
  };
}

export type BackupEncryptionState =
  /** The artifact is recorded as unencrypted — patient data in plaintext. */
  | "not_encrypted"
  /** Encrypted, but no run ever proved it opens. The common case today for older rows. */
  | "unproven"
  /** Proven to decrypt to the bytes that were archived, with a key that is still configured. */
  | "proven"
  /** Proven once, but with a passphrase this process no longer has — the rotation case. */
  | "proven_with_retired_key"
  /** Nothing can be said: no success row, or the row carries no encryption flag at all. */
  | "unknown";

export interface BackupEncryptionEvidence {
  state: BackupEncryptionState;
  /** True only when a real round-trip proof exists for this artifact. */
  decryptProven: boolean;
  keySource: string | null;
  /** The bytes that came back out of openssl when the proof was made, when recorded. */
  decryptedBytes: number | null;
  reason: string;
}

/**
 * What this page is allowed to say about encryption.
 *
 * `encrypted=true` in the ledger is an echo of "the code reached the line that called openssl". It
 * is NOT "the artifact opens": the scheduler used to write that flag with no round-trip at all, and
 * an AES-CBC artifact can be recorded as encrypted while being unrecoverable garbage. So a card only
 * turns green on a `backupProof=v1` marker, which the run writes only after decrypting the artifact
 * and comparing the digest of what came back to the digest of the dump that went in.
 *
 * Key rotation is the second half of the same question. A proof says "opened with SESSION_SECRET at
 * 04:12" — if SESSION_SECRET has since been rotated and BACKUP_PASSPHRASE is what runs now, the
 * older artifact is not proven recoverable any more, and saying otherwise is how a clinic discovers
 * it during the restore. That is reported as `proven_with_retired_key`, from the keys the caller
 * says are configured right now — never inferred.
 */
export function evaluateBackupEncryption(input: {
  encrypted: boolean | null;
  notes: string | null | undefined;
  /** Key sources available to this process today, best guess first (see candidatePassphrases). */
  availableKeySources: string[] | null;
  loggedSuccess: boolean;
}): BackupEncryptionEvidence {
  const { encrypted, notes, availableKeySources, loggedSuccess } = input;

  if (encrypted === false) {
    return {
      state: "not_encrypted",
      decryptProven: false,
      keySource: null,
      decryptedBytes: null,
      reason: "Recorded as unencrypted — a patient database sitting on disk in plaintext.",
    };
  }
  if (encrypted !== true || !loggedSuccess) {
    return {
      state: "unknown",
      decryptProven: false,
      keySource: null,
      decryptedBytes: null,
      reason: "No successful encrypted run to assess.",
    };
  }

  const proof = parseBackupRunProof(notes);
  if (!proof) {
    return {
      state: "unproven",
      decryptProven: false,
      keySource: null,
      decryptedBytes: null,
      reason:
        "The run recorded encrypted=true, but nothing ever decrypted this artifact and compared it back to the bytes that were archived — an AES-CBC file can be unrecoverable and still say it was encrypted.",
    };
  }

  const keyStillConfigured = availableKeySources === null ? null : availableKeySources.includes(proof.keySource);
  if (keyStillConfigured === false) {
    return {
      state: "proven_with_retired_key",
      decryptProven: true,
      keySource: proof.keySource,
      decryptedBytes: proof.decryptedBytes,
      reason:
        `This artifact was decrypt-verified with ${proof.keySource}, which is not configured in this process any more. The proof is real but stale: nothing shows the current key opens it, so do not count it as recoverable until it is re-proven.`,
    };
  }

  return {
    state: "proven",
    decryptProven: true,
    keySource: proof.keySource,
    decryptedBytes: proof.decryptedBytes,
    reason:
      `Decrypt-verified: ${proof.decryptedBytes ?? "?"} bytes re-read from the artifact hashed to the digest the dump produced before encryption (key=${proof.keySource}).`,
  };
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function asNumber(value: number | bigint | null | undefined): number | null {
  if (value == null) return null;
  return typeof value === "bigint" ? Number(value) : value;
}

/**
 * Evaluate one job against its newest log row and the filesystem probe.
 *
 * The ordering is deliberate: a schedule that cannot be honoured outranks everything else, because
 * a green `last_status` on a job whose cron text is unreadable is the exact lie this module exists
 * to stop.
 */
export function evaluateBackupJobEvidence(input: {
  job: EvidenceJobRecord;
  latestLog: EvidenceLogRecord | null;
  artifact: ArtifactProbe;
  now: Date;
  /** Key sources configured in this process right now, for the rotation check. null = not supplied,
   *  which is reported as "cannot say", never as "still valid". */
  availableKeySources?: string[] | null;
}): BackupJobEvidence {
  const { job, latestLog, artifact, now } = input;
  const reasons: string[] = [];

  const expression = toCronExpression(job.schedule);
  const fields = expression ? parseCronFields(expression) : null;
  const manual = expression === null;
  const unparsable = expression !== null && fields === null;
  const scheduleLabel = describeSchedule(job.schedule) ?? "Unknown schedule";

  let nextRunAt: Date | null = null;
  let dueNow = false;
  let overdue = false;
  let neverMatches = false;
  let missedOccurrence: Date | null = null;
  if (fields) {
    nextRunAt = nextOccurrence(fields, now);
    const decision = decideBackupRun({ schedule: job.schedule, lastRunAt: toDate(job.lastRunAt), now });
    dueNow = decision.due;

    // Overdue is NOT `decision.reason === "outside-grace"`. The runner checks the grace window
    // before the ledger cursor, so a job that ran last night at 20:00 and is being looked at at
    // 09:00 answers "outside-grace" — which is correct for "should I start it now" and completely
    // wrong for "did the schedule go unkept". Here it is the second question: a scheduled minute
    // has passed that no recorded run covers, and it is now too late for the runner to catch up.
    const covered = toDate(job.lastRunAt);
    const mostRecent = lastOccurrence(fields, now);
    missedOccurrence = mostRecent;
    if (mostRecent && (covered === null || covered.getTime() < mostRecent.getTime())) {
      overdue = now.getTime() - mostRecent.getTime() > BACKUP_CATCHUP_GRACE_MS;
    }
    neverMatches = mostRecent === null && nextRunAt === null;
  }

  // The artifact, as far as the disk can say.
  const loggedPath = latestLog?.filePath ?? null;
  const loggedSize = asNumber(latestLog?.sizeBytes);
  const probeSize = asNumber(artifact.sizeBytes);
  const loggedSuccess = latestLog?.status === "success" || latestLog?.status === "completed";

  let artifactStatus: BackupJobEvidence["artifact"]["status"] = "not-checked";
  if (!loggedPath) {
    artifactStatus = "not-recorded";
  } else if (!artifact.checked) {
    artifactStatus = "not-checked";
  } else if (!artifact.exists) {
    artifactStatus = "missing";
  } else if (loggedSize != null && probeSize != null && loggedSize !== probeSize) {
    artifactStatus = "mismatched";
  } else {
    artifactStatus = "present";
  }

  let verified = false;
  if (loggedSuccess && loggedPath && artifactStatus === "present") verified = true;

  const encryption = evaluateBackupEncryption({
    encrypted: latestLog?.encrypted ?? null,
    notes: latestLog?.notes ?? null,
    availableKeySources: input.availableKeySources ?? null,
    loggedSuccess,
  });

  // State, worst-first.
  let state: BackupEvidenceState = "HEALTHY";
  if (unparsable) {
    state = "CRITICAL";
    reasons.push(`Schedule "${job.schedule ?? ""}" is not a cron expression this scheduler can honour, so the job does not run.`);
  } else if (!job.isEnabled) {
    state = "WARNING";
    reasons.push("Job is disabled — nothing runs on this schedule.");
  } else if (manual) {
    state = verified ? "WARNING" : "UNKNOWN";
    reasons.push(verified
      ? "Manual-only job: it has a backup on disk, but nothing runs it on a schedule."
      : "Manual-only job — no schedule and no completed run on disk to check.");
  } else if (latestLog?.status === "failed" || job.lastStatus === "failed") {
    state = "CRITICAL";
    reasons.push(latestLog?.errorMessage || job.lastError || "The last recorded run failed.");
  } else if (neverMatches) {
    state = "CRITICAL";
    reasons.push("This schedule has matched no minute in the last 8 days and has none coming in the next 400, so it can never produce a backup.");
  } else if (overdue) {
    state = "CRITICAL";
    const lastRunText = toDate(job.lastRunAt) ? formatLocalMinute(toDate(job.lastRunAt)!) : "never";
    reasons.push(`Scheduled for ${missedOccurrence ? formatLocalMinute(missedOccurrence) : "an occurrence that has passed"}, which went by with no run — the last recorded run was ${lastRunText}.`);
  } else if (artifactStatus === "missing") {
    state = "CRITICAL";
    reasons.push(`The ledger says this backup succeeded but ${loggedPath} is not on disk.`);
  } else if (artifactStatus === "mismatched") {
    state = "CRITICAL";
    reasons.push(`${loggedPath} is ${probeSize} bytes; the ledger recorded ${loggedSize} bytes. The artifact does not match the run that claims to have written it.`);
  } else if (!loggedSuccess && latestLog) {
    state = "UNKNOWN";
    reasons.push(`The newest run is recorded as "${latestLog.status}", not success, so nothing here has been verified.`);
  } else if (!latestLog) {
    state = "UNKNOWN";
    reasons.push("This job has never recorded a run, so there is nothing to verify.");
  } else if (artifactStatus === "not-checked") {
    state = "UNKNOWN";
    reasons.push(artifact.error
      ? `The backup file could not be checked: ${artifact.error}.`
      : "The backup file could not be checked, so its size is unverified.");
  } else if (!verified) {
    state = "UNKNOWN";
    reasons.push("No completed run with an artifact to check.");
  }

  if (state === "HEALTHY" && !job.destinationPath) {
    state = "CRITICAL";
    reasons.push("No destination path is configured, so a scheduled run would persist nothing.");
  }
  if (state === "HEALTHY" && loggedSuccess && loggedPath && !latestLog?.checksum) {
    // "Present and the right size" is not "the bytes are intact". Without the digest that a run
    // recorded, silent corruption shows up at restore time instead of here.
    state = "WARNING";
    reasons.push("No SHA-256 was recorded for this artifact, so at-rest corruption would not be noticed until a restore.");
  }
  if (state === "HEALTHY" && loggedSuccess && loggedPath && latestLog?.encrypted === false) {
    state = "WARNING";
    reasons.push("This artifact is recorded as unencrypted — a patient database dump on disk in plaintext.");
  }
  if (state === "HEALTHY" && loggedSuccess && loggedPath && latestLog?.encrypted == null) {
    // Older rows never set the flag. Claiming "unencrypted" would be a guess in the alarming
    // direction and claiming "encrypted" a guess in the quiet one, so the page says what it knows.
    state = "WARNING";
    reasons.push("This run did not record whether the artifact was encrypted, so the page cannot tell you either way.");
  }

  // Worst-first, like the rest of this function: a proven artifact whose key is gone outranks a
  // warning, because the clinic's operating assumption ("we can restore last night") stops being
  // true the moment the passphrase that proved it is no longer configured.
  if (encryption.state === "proven_with_retired_key" && loggedSuccess && loggedPath) {
    state = "CRITICAL";
    reasons.push(encryption.reason);
  } else if (state === "HEALTHY" && encryption.state === "unproven") {
    state = "WARNING";
    reasons.push(encryption.reason);
  } else if (state === "HEALTHY" && encryption.state === "unknown" && loggedSuccess && loggedPath) {
    state = "WARNING";
    reasons.push("Nothing has ever decrypted this artifact, so its recoverability is unknown rather than good.");
  }

  return {
    jobId: job.id,
    jobName: job.jobName,
    state,
    reasons,
    scheduleLabel,
    nextRunAt,
    dueNow,
    overdue,
    artifact: {
      status: artifactStatus,
      path: loggedPath,
      sizeBytes: artifact.checked && artifact.exists ? probeSize : null,
      modifiedAt: artifact.checked ? artifact.modifiedAt ?? null : null,
      checksumRecorded: Boolean(latestLog?.checksum),
    },
    encryption,
    verified,
  };
}

export interface BackupOverviewEvidence {
  /** The newest backup this page can vouch for — a logged success whose file is on disk at the
   *  size the ledger claims. null means there is no such backup, which is not the same as "zero". */
  lastVerifiedAt: Date | string | null;
  lastVerifiedJob: string | null;
  lastVerifiedSizeBytes: number | null;
  /** Soonest scheduled run across enabled jobs. null when nothing is scheduled. */
  nextScheduledAt: Date | string | null;
  nextScheduledJob: string | null;
  /** Jobs that are not HEALTHY, worst first. */
  needsAttention: { jobId: number; jobName: string; state: BackupEvidenceState; reasons: string[] }[];
  counts: Record<BackupEvidenceState, number>;
  /**
   * How many of these jobs have an artifact that was actually decrypted back to the bytes that were
   * archived. `verified` above means "the file is there at the recorded size" — a different and
   * weaker claim, and the two must not be confused on the same screen. A backup that has never been
   * opened is counted as `unproven`, never as healthy.
   */
  encryption: {
    jobs: number;
    proven: number;
    unproven: number;
    retiredKey: number;
    notEncrypted: number;
    unknown: number;
  };
  /** True when at least one enabled job has a schedule the runner cannot read. */
  anyDueNow: boolean;
}

/** Roll the per-job evidence up into the cards the page shows. Deliberately reports null
 *  rather than a reassuring default when the answer is not known. */
export function summariseBackupEvidence(
  jobs: { job: EvidenceJobRecord; evidence: BackupJobEvidence; verifiedArtifactModifiedAt?: Date | string | null }[],
): BackupOverviewEvidence {
  const counts: Record<BackupEvidenceState, number> = { HEALTHY: 0, WARNING: 0, CRITICAL: 0, UNKNOWN: 0 };
  const encryption: BackupOverviewEvidence["encryption"] = { jobs: 0, proven: 0, unproven: 0, retiredKey: 0, notEncrypted: 0, unknown: 0 };
  const out: BackupOverviewEvidence = {
    lastVerifiedAt: null,
    lastVerifiedJob: null,
    lastVerifiedSizeBytes: null,
    nextScheduledAt: null,
    nextScheduledJob: null,
    needsAttention: [],
    counts,
    encryption,
    anyDueNow: false,
  };

  let best: { at: Date; job: string; size: number | null } | null = null;
  let soonest: { at: Date; job: string } | null = null;

  for (const { job, evidence } of jobs) {
    counts[evidence.state] += 1;
    encryption.jobs += 1;
    encryption[evidence.encryption.state === "not_encrypted" ? "notEncrypted"
      : evidence.encryption.state === "proven_with_retired_key" ? "retiredKey"
      : evidence.encryption.state === "unproven" ? "unproven"
      : evidence.encryption.state === "proven" ? "proven" : "unknown"] += 1;
    if (evidence.state !== "HEALTHY") {
      out.needsAttention.push({ jobId: evidence.jobId, jobName: evidence.jobName, state: evidence.state, reasons: evidence.reasons });
    }
    if (evidence.dueNow) out.anyDueNow = true;

    const at = toDate(job.lastRunAt);
    // A file whose decrypt-proof was made with a passphrase this process no longer has is not a
    // backup the clinic can reach: it stays out of "last verified backup" rather than quietly
    // counting, because that card is what a recovery decision gets read from.
    const reachable = evidence.encryption.state !== "proven_with_retired_key";
    if (evidence.verified && reachable && at && (!best || at.getTime() > best.at.getTime())) {
      best = { at, job: evidence.jobName, size: evidence.artifact.sizeBytes };
    }
    const next = toDate(evidence.nextRunAt);
    if (job.isEnabled && next && (!soonest || next.getTime() < soonest.at.getTime())) {
      soonest = { at: next, job: evidence.jobName };
    }
  }

  out.lastVerifiedAt = best ? best.at : null;
  out.lastVerifiedJob = best ? best.job : null;
  out.lastVerifiedSizeBytes = best ? best.size : null;
  out.nextScheduledAt = soonest ? soonest.at : null;
  out.nextScheduledJob = soonest ? soonest.job : null;
  out.needsAttention.sort((a, b) => RANK[b.state] - RANK[a.state]);
  return out;
}

const RANK: Record<BackupEvidenceState, number> = { HEALTHY: 0, WARNING: 1, UNKNOWN: 2, CRITICAL: 3 };

/**
 * The off-NAS question, answered honestly.
 *
 * CARE can only see the filesystem it runs on. When a job's destination lives on the same device as
 * the application data, that is measurable and it is NOT an independent copy — RAID1 mirrors the
 * same two disks, and a second folder on the same volume dies with the box. Anything beyond that
 * (Hyper Backup vaults, Duplicati destinations, Snapshot Replication targets, a second NAS) is
 * configured outside this container and cannot be read from here, so it is UNKNOWN and stays UNKNOWN
 * until the operator verifies it. A page that guessed "Healthy" here is worse than no page.
 */
export function offNasEvidence(input: {
  /** Device id of a job destination that has been probed, and of the app's own data dir. */
  destinationDev: number | null;
  appDataDev: number | null;
  destinationPath: string | null;
}): { state: BackupEvidenceState; message: string; sameVolumeAsAppData: boolean | null } {
  if (input.destinationDev != null && input.appDataDev != null) {
    const same = input.destinationDev === input.appDataDev;
    return {
      state: same ? "WARNING" : "UNKNOWN",
      sameVolumeAsAppData: same,
      message: same
        ? `${input.destinationPath ?? "This destination"} sits on the same filesystem as the live application data (device ${input.destinationDev}). A disk-array or host failure takes both. This is not an independent copy.`
        : `${input.destinationPath ?? "This destination"} is on a different device (device ${input.destinationDev}), which is necessary but not sufficient for independence — the copy still has to be proven restorable from outside this host.`,
    };
  }
  return {
    state: "UNKNOWN",
    sameVolumeAsAppData: null,
    message: "CARE cannot read Hyper Backup, Duplicati, Snapshot Replication or the second NAS from inside this container, so no independently recoverable off-box copy has been verified.",
  };
}
