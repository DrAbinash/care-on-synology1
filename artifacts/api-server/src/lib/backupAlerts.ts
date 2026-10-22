/**
 * Backup alert e-mails: who is told, when, and only once.
 *
 * WHAT WAS ALREADY THERE (read on main, 2026-10-22)
 *   `cron.ts` already sends two kinds of backup mail through the existing SMTP setup:
 *     • `sendBackupFailureEmail()` on every failed run, and
 *     • `sendAlertEmail("CARE backups have stopped")` from the dead-man check every 6 hours while no
 *       successful run exists.
 *   So the plumbing exists. What it lacks is any memory: with the schedule defect that ran a nightly
 *   job hourly, one broken job produced a failure e-mail every hour, and the dead-man added four more
 *   a day on top. Nobody reading an inbox can act on 24 identical messages, so the practical result
 *   was that the alert that mattered was indistinguishable from the noise.
 *
 * WHAT THIS ADDS
 *   A restart-safe state machine per job, with exactly the cadence the clinic asked for:
 *     first failure  → e-mail now
 *     still failing  → reminder after 24 h, not every run
 *     recovered      → one confirmation, then silence
 *     overdue (never ran) → one alert per scheduled occurrence, not one per tick
 *   Every delivery attempt — sent or failed — is recorded, because "we would have emailed you" is
 *   only useful if someone can later check whether the mail actually left the building.
 *
 *   A failed send NEVER propagates: an e-mail that cannot be delivered must not cost the clinic its
 *   backup. `notifyBackupOutcome()` returns the outcome of the alert rather than throwing, and the
 *   caller in cron.ts is additionally wrapped so a broken SMTP cannot abort a run.
 *
 * STATE LIVES IN `watchdog_status`, one row per job, keyed by a unique service_name. It is the
 * product's existing background-service health table (status, consecutive failures, last error, a
 * JSON metadata column, updated at by the row itself) and it survives a container restart, which an
 * in-memory map would not — the previous `firedToday` Set reset to nothing on every deploy, which is
 * how a "daily" alert ended up firing hourly.
 */

import { db } from "@workspace/db";
import { watchdogStatusTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import {
  BACKUP_CATCHUP_GRACE_MS,
  describeSchedule,
  formatLocalMinute,
  lastOccurrence,
  parseCronFields,
  toCronExpression,
} from "./backupSchedule";

export type BackupAlertOutcome = "success" | "failure" | "overdue";
export type BackupAlertKind = "failure" | "overdue" | "recovery";

/** Continuing-failure reminder interval. */
export const BACKUP_ALERT_REMINDER_MS = 24 * 60 * 60 * 1000;

/** Bounded so the metadata column cannot grow without limit; newest first. */
const DELIVERY_HISTORY_KEEP = 10;

export interface BackupAlertState {
  /** Which alert was sent last, or null when nothing is outstanding. */
  lastAlertKind: BackupAlertKind | null;
  lastAlertAt: Date | null;
  /** For "overdue": the occurrence already reported, so six checks a day do not make six e-mails. */
  lastNotifiedOccurrence: Date | null;
  consecutiveFailures: number;
  deliveries: BackupAlertDelivery[];
}

export interface BackupAlertDelivery {
  /** When the send was attempted, ISO. */
  at: string;
  kind: BackupAlertKind;
  ok: boolean;
  to: string[];
  /** Transport error, or the reason the alert was suppressed. */
  detail: string | null;
}

export const EMPTY_BACKUP_ALERT_STATE: BackupAlertState = {
  lastAlertKind: null,
  lastAlertAt: null,
  lastNotifiedOccurrence: null,
  consecutiveFailures: 0,
  deliveries: [],
};

export interface AlertDecision {
  /** Send this alert, or stay quiet. */
  send: boolean;
  kind: BackupAlertKind | null;
  /** A reason an operator can read in the log: first-failure | reminder-due | recovery |
   *  suppressed-cooldown | suppressed-occurrence | nothing-to-report. */
  reason: "first-failure" | "reminder-due" | "recovery" | "suppressed-cooldown" | "suppressed-occurrence" | "nothing-to-report";
  nextState: BackupAlertState;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The whole cadence, in one pure function: no clock of its own, no database, no e-mail.
 *
 * `occurrence` is only meaningful for an "overdue" outcome — it is the scheduled minute being
 * reported. It is compared by minute identity, not by "is this a new message", because the internal
 * cron endpoint can be hit several times an hour by whatever scheduler the clinic runs.
 */
export function decideBackupAlert(input: {
  outcome: BackupAlertOutcome;
  state: BackupAlertState;
  now: Date;
  occurrence?: Date | null;
  reminderMs?: number;
}): AlertDecision {
  const { outcome, now } = input;
  const reminderMs = input.reminderMs ?? BACKUP_ALERT_REMINDER_MS;
  const state: BackupAlertState = { ...input.state, deliveries: input.state.deliveries.slice() };
  const lastAlertAt = toDate(state.lastAlertAt);

  if (outcome === "success") {
    // Nothing outstanding → nothing to say. A confirmation e-mail after a successful week is noise.
    if (state.lastAlertKind === null) {
      return { send: false, kind: null, reason: "nothing-to-report", nextState: { ...state, consecutiveFailures: 0 } };
    }
    return {
      send: true,
      kind: "recovery",
      reason: "recovery",
      nextState: {
        ...state,
        lastAlertKind: null,
        lastAlertAt: now,
        lastNotifiedOccurrence: null,
        consecutiveFailures: 0,
      },
    };
  }

  const kind: BackupAlertKind = outcome;
  const failedCount = kind === "failure" ? state.consecutiveFailures + 1 : state.consecutiveFailures;

  if (kind === "overdue" && input.occurrence) {
    const already = toDate(state.lastNotifiedOccurrence);
    if (already && already.getTime() === input.occurrence.getTime()) {
      return { send: false, kind, reason: "suppressed-occurrence", nextState: state };
    }
  }

  // Same kind still open: one reminder per reminderMs, not one per run.
  if (state.lastAlertKind === kind && lastAlertAt && now.getTime() - lastAlertAt.getTime() < reminderMs) {
    // The mail is suppressed; the count is not. `consecutive_failures` describes the job, and the
    // watchdog views read it — freezing it at the value from the day the first mail went out would
    // make a week of hourly failures look like one.
    return {
      send: false,
      kind,
      reason: "suppressed-cooldown",
      nextState: kind === "overdue" && input.occurrence
        ? { ...state, consecutiveFailures: failedCount, lastNotifiedOccurrence: input.occurrence }
        : { ...state, consecutiveFailures: failedCount },
    };
  }

  const reason = state.lastAlertKind === kind && lastAlertAt ? "reminder-due" : "first-failure";
  return {
    send: true,
    kind,
    reason,
    nextState: {
      ...state,
      lastAlertKind: kind,
      lastAlertAt: now,
      lastNotifiedOccurrence: kind === "overdue" ? input.occurrence ?? state.lastNotifiedOccurrence : null,
      consecutiveFailures: failedCount,
    },
  };
}

/** Append one delivery attempt, newest first, bounded. */
export function recordDelivery(state: BackupAlertState, attempt: BackupAlertDelivery): BackupAlertState {
  return { ...state, deliveries: [attempt, ...state.deliveries].slice(0, DELIVERY_HISTORY_KEEP) };
}

export function backupAlertServiceName(jobId: number): string {
  return `backup-alert:job:${jobId}`;
}

/** Read the persisted state. A missing row is "nothing outstanding", not an error. */
export async function loadBackupAlertState(jobId: number): Promise<BackupAlertState> {
  const [row] = await db
    .select({ metadata: watchdogStatusTable.metadata, consecutiveFailures: watchdogStatusTable.consecutiveFailures })
    .from(watchdogStatusTable)
    .where(eq(watchdogStatusTable.serviceName, backupAlertServiceName(jobId)))
    .limit(1);
  if (!row) return { ...EMPTY_BACKUP_ALERT_STATE };
  return parseBackupAlertMetadata(row.metadata, row.consecutiveFailures ?? 0);
}

/** The JSON kept in `watchdog_status.metadata`. Pure, so the round trip is testable. */
export function parseBackupAlertMetadata(raw: string | null | undefined, consecutiveFailures: number): BackupAlertState {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {};
  } catch {
    // A hand-edited or half-written row must not take the alerting path down with it.
    return { ...EMPTY_BACKUP_ALERT_STATE, consecutiveFailures };
  }
  const kind = parsed.lastAlertKind;
  return {
    lastAlertKind: kind === "failure" || kind === "overdue" || kind === "recovery" ? kind : null,
    lastAlertAt: typeof parsed.lastAlertAt === "string" ? toDate(parsed.lastAlertAt) : null,
    lastNotifiedOccurrence: typeof parsed.lastNotifiedOccurrence === "string" ? toDate(parsed.lastNotifiedOccurrence) : null,
    consecutiveFailures: Number.isInteger(consecutiveFailures) ? consecutiveFailures : 0,
    deliveries: Array.isArray(parsed.deliveries) ? (parsed.deliveries as BackupAlertDelivery[]).slice(0, DELIVERY_HISTORY_KEEP) : [],
  };
}

export function serializeBackupAlertMetadata(state: BackupAlertState): string {
  return JSON.stringify({
    lastAlertKind: state.lastAlertKind,
    lastAlertAt: state.lastAlertAt ? state.lastAlertAt.toISOString() : null,
    lastNotifiedOccurrence: state.lastNotifiedOccurrence ? state.lastNotifiedOccurrence.toISOString() : null,
    deliveries: state.deliveries,
  });
}

/**
 * Persist the state. Upsert on the unique service_name; the row also carries the plain health
 * columns so the existing watchdog views show the same truth the e-mail path acts on.
 * Never throws: an un-writable state row must not lose the clinic its backup.
 */
export async function saveBackupAlertState(
  jobId: number,
  jobName: string,
  state: BackupAlertState,
  health: { status: "healthy" | "degraded" | "down"; lastError: string | null },
): Promise<boolean> {
  try {
    const values = {
      serviceName: backupAlertServiceName(jobId),
      displayName: `Backup alert state — ${jobName}`,
      status: health.status,
      lastHeartbeat: new Date(),
      lastError: health.lastError,
      consecutiveFailures: state.consecutiveFailures,
      metadata: serializeBackupAlertMetadata(state),
      updatedAt: new Date(),
    };
    await db
      .insert(watchdogStatusTable)
      .values(values)
      .onConflictDoUpdate({ target: watchdogStatusTable.serviceName, set: { ...values } });
    return true;
  } catch {
    return false;
  }
}

/** Subject/body for one alert. Composed here so the wording is tested rather than improvised. */
export function buildBackupAlertEmail(params: {
  jobName: string;
  jobId: number;
  kind: BackupAlertKind;
  reason: AlertDecision["reason"];
  detail: string | null;
  destination: string | null;
  scheduleLabel: string;
  now: Date;
}): { subject: string; html: string } {
  const when = params.now.toISOString().replace("T", " ").slice(0, 16);
  const esc = (s: string | null) => (s ?? "—").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  if (params.kind === "recovery") {
    return {
      subject: `✅ CARE backup recovered — ${params.jobName}`,
      html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
<h2 style="color:#15803d">Backup recovered: ${esc(params.jobName)}</h2>
<p>The job is producing backups again. This is the only confirmation you will get for this incident.</p>
<ul>
<li>Job: <b>#${params.jobId} ${esc(params.jobName)}</b> (${esc(params.scheduleLabel)})</li>
<li>Destination: <code>${esc(params.destination)}</code></li>
<li>Recovered at (UTC): <b>${when}</b></li>
<li>What was written: ${esc(params.detail)}</li>
</ul>
<p>This message is sent after the run wrote an artifact and recorded it; it is not sent because a
schedule matched. Treat "UNENCRYPTED" or "checksum NOT recorded" above as a problem to fix, not a
successful backup.</p>
<p>Nothing further is required unless the failure recurred within the last day, in which case check
the Backup &amp; Replication page for the artifact size and the last verified run.</p></div>`,
    };
  }
  const overdue = params.kind === "overdue";
  const reminder = params.reason === "reminder-due";
  return {
    subject: `${reminder ? "🔁" : "🛑"} CARE backup ${overdue ? "did not run" : "failed"} — ${params.jobName}`,
    html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;background:#fef2f2;padding:24px;border-radius:12px">
<h2 style="color:#b91c1c;margin-top:0">${overdue ? "Scheduled backup did not run" : "Backup failed"}: ${esc(params.jobName)}</h2>
<p>${reminder
  ? `This is the daily reminder — the job is still not producing a usable backup. First alert was 24 h ago.`
  : "This is the first alert for this job."}</p>
<ul>
<li>Job: <b>#${params.jobId} ${esc(params.jobName)}</b></li>
<li>Schedule: <b>${esc(params.scheduleLabel)}</b></li>
<li>Destination: <code>${esc(params.destination)}</code></li>
<li>Detected at (UTC): <b>${when}</b></li>
<li>Detail: ${esc(params.detail)}</li>
</ul>
<p>Until this job has a file on disk that the Backup &amp; Replication page can verify, the clinic has
no recoverable copy of whatever changed since the last verified backup.</p></div>`,
  };
}

function healthForOutcome(outcome: BackupAlertOutcome, detail: string | null) {
  if (outcome === "success") return { status: "healthy" as const, lastError: null };
  if (outcome === "overdue") return { status: "degraded" as const, lastError: detail };
  return { status: "down" as const, lastError: detail };
}

export interface BackupAlertSendResult {
  sent: boolean;
  kind: BackupAlertKind | null;
  reason: AlertDecision["reason"];
  /** Present when a send was attempted: what the transport said. */
  delivery?: BackupAlertDelivery;
}

/**
 * The one entry point the backup runner calls. It decides, sends through the existing SMTP setup,
 * records the attempt, and persists the state — and it never throws.
 *
 * A backup is a data-integrity operation; the e-mail about it is not. If SMTP is down, unconfigured,
 * or the state row cannot be written, the run still completes and the failure is logged. The reverse
 * — an e-mail problem costing the clinic its backup — is the outcome this ordering exists to prevent.
 */
export async function notifyBackupOutcome(params: {
  jobId: number;
  jobName: string;
  outcome: BackupAlertOutcome;
  detail: string | null;
  destination: string | null;
  scheduleLabel: string;
  occurrence?: Date | null;
  now?: Date;
}): Promise<BackupAlertSendResult> {
  const now = params.now ?? new Date();
  let state = { ...EMPTY_BACKUP_ALERT_STATE };
  try {
    state = await loadBackupAlertState(params.jobId);
  } catch (err) {
    console.error("[backup-alerts] state could not be read; treating this job as un-notified:", err instanceof Error ? err.message : err);
  }

  const decision = decideBackupAlert({
    outcome: params.outcome,
    state,
    now,
    occurrence: params.occurrence ?? null,
  });

  if (!decision.send || !decision.kind) {
    // Still persist: "overdue for this occurrence" is remembered so the next tick does not repeat it.
    await saveBackupAlertState(params.jobId, params.jobName, decision.nextState, healthForOutcome(params.outcome, params.detail));
    return { sent: false, kind: decision.kind, reason: decision.reason };
  }

  const { subject, html } = buildBackupAlertEmail({
    jobName: params.jobName,
    jobId: params.jobId,
    kind: decision.kind,
    reason: decision.reason,
    detail: params.detail,
    destination: params.destination,
    scheduleLabel: params.scheduleLabel,
    now,
  });

  let ok = false;
  let to: string[] = [];
  let error: string | null = null;
  try {
    const { sendAlertEmail } = await import("../email");
    const res = await sendAlertEmail({ subject, html });
    ok = !!res?.ok;
    to = res?.to ?? [];
    error = res?.error ?? null;
  } catch (err) {
    ok = false;
    error = err instanceof Error ? err.message : String(err);
  }

  const delivery: BackupAlertDelivery = { at: now.toISOString(), kind: decision.kind, ok, to, detail: error };
  const withDelivery = recordDelivery(decision.nextState, delivery);
  // The cooldown clock runs on notifications that actually reached someone. If the send failed, the
  // alert fields roll back to what they were before this attempt — so the next tick reports the same
  // failure as "first failure" again and tries once more, instead of a dead SMTP quietly buying the
  // job 24 hours of silence it never earned. The failure count and the delivery log still advance,
  // because those describe the job and the attempts, not the mailbox.
  const nextState: BackupAlertState = ok
    ? withDelivery
    : {
        ...withDelivery,
        lastAlertKind: state.lastAlertKind,
        lastAlertAt: state.lastAlertAt,
        lastNotifiedOccurrence: state.lastNotifiedOccurrence,
      };
  await saveBackupAlertState(params.jobId, params.jobName, nextState, healthForOutcome(params.outcome, params.detail));

  if (!ok) console.error(`[backup-alerts] ${decision.kind} alert for job #${params.jobId} could not be delivered: ${error ?? "unknown"}`);
  return { sent: ok, kind: decision.kind, reason: decision.reason, delivery };
}

/**
 * Per-job overdue alerts, for the tick that also runs the dead-man check.
 *
 * The dead-man asks "has ANY successful backup happened recently". A clinic with four jobs and one
 * broken schedule passes it — the other three ran — while the broken one has produced nothing for
 * days. This walks each enabled job through the same occurrence decision the runner uses (PR #1133),
 * so an occurrence that went by unreported is alerted once, and only once, per occurrence.
 *
 * Two jobs are overdue without ever writing a failed run, and both used to be silent:
 *   • a schedule this runner cannot parse (`CUSTOM`, a typo) is never due, so nothing fires, so
 *     nothing fails, so nothing is recorded;
 *   • a schedule that matches no minute inside the search bound (`0 2 30 2 *`) is the same case.
 * They are reported here as overdue, because "no backup was ever due" is exactly the fact an
 * operator needs. A manual-only job is not: nobody scheduled anything, so nothing is missing.
 */
export async function alertOnOverdueBackupJobs(
  jobs: { id: number; jobName: string; isEnabled?: boolean; schedule: string | null; lastRunAt: Date | string | null; destinationPath: string | null }[],
  now: Date = new Date(),
): Promise<{ checked: number; sent: number; suppressed: number }> {
  let checked = 0;
  let sent = 0;
  let suppressed = 0;
  for (const job of jobs) {
    if (job.isEnabled === false) continue; // disabled on purpose: the page says so, the mailbox need not
    const expression = toCronExpression(job.schedule);
    if (!expression) continue; // manual-only: nothing was scheduled, so nothing is overdue
    const fields = parseCronFields(expression);
    const lastRunAt = toDate(job.lastRunAt);
    const mostRecent = fields ? lastOccurrence(fields, now) : null;

    let detail: string;
    if (!fields) {
      detail = `Schedule ${JSON.stringify(job.schedule)} is not a cron expression this scheduler can honour, so this job has never been due and has produced nothing.`;
    } else if (!mostRecent) {
      detail = "This schedule has matched no minute in the last 8 days, so nothing has ever been due and no backup has come from it.";
    } else {
      if (lastRunAt && lastRunAt.getTime() >= mostRecent.getTime()) continue; // it ran; nothing overdue
      // Overdue means "this occurrence will no longer be started", which is exactly the runner's own
      // catch-up window (PR #1133): 12 h past the scheduled minute. It is NOT 24 h — a daily job's
      // newest occurrence can never be more than 24 h old, so a 24 h test would mean an unnoticed
      // missed backup forever and an alert only in theory.
      if (now.getTime() - mostRecent.getTime() <= BACKUP_CATCHUP_GRACE_MS) continue;
      detail = `No run was recorded for the scheduled occurrence at ${formatLocalMinute(mostRecent)}.`;
    }

    checked++;
    const res = await notifyBackupOutcome({
      jobId: job.id,
      jobName: job.jobName,
      outcome: "overdue",
      detail,
      destination: job.destinationPath,
      scheduleLabel: describeSchedule(job.schedule) ?? job.schedule ?? "",
      occurrence: mostRecent,
      now,
    });
    if (res.sent) sent++;
    else suppressed++;
  }
  return { checked, sent, suppressed };
}
