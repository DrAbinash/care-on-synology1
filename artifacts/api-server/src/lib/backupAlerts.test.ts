import { describe, expect, test, vi, beforeEach } from "vitest";
import { watchdogStatusTable } from "@workspace/db/schema";
import { projectRows, relationName, selectRows } from "../testSupport/inMemoryRelation";

// Backup alerting: the cadence, the memory, and the promise that an e-mail can never cost the clinic
// a backup.
//
// What production measured on 2026-10-22 (the reason this file exists): the schedule defect in PR
// #1133 made a nightly job fire hourly, and every one of those runs that failed sent its own
// `sendBackupFailureEmail()` — 24 identical mails a day, plus four dead-man mails, from a system that
// had no idea it had already spoken. An alert nobody reads is not monitoring. So the rules under test
// here are the ones the clinic asked for, in order:
//
//   first failure            → one mail, now
//   still failing            → a reminder after 24 h, not after every run
//   recovered                → one confirmation, then silence
//   never ran (overdue)      → one mail per missed occurrence, not per tick
//   a mail that could not go → recorded as failed, retried on the next tick, and the backup itself
//                              is untouched
//
// State is read from and written to `watchdog_status` — one row per job, upserted on the unique
// `service_name` — because a `Set` in the process resets on every deploy, which is how a "daily"
// reminder became an hourly one. The restart test below proves that by re-importing the module
// between two failures and showing the second one is still suppressed.
//
// The `@workspace/db` mock honours the real WHERE clause (see testSupport/inMemoryRelation): a mock
// that returned every watchdog row would let job #2 inherit job #1's "already notified" memory, and
// the cooldown would look correct while meaning nothing.

type Row = Record<string, unknown>;

let watchdogRows: Row[];
let upserts: { relation: string; targetColumn: string; conflictValues: Row }[];
let idSeq: number;
let failStateWrites: boolean;

const sendAlertEmailMock = vi.hoisted(() =>
  vi.fn(async (_params: { subject: string; html: string }) => ({
    ok: true,
    to: ["admin@clinic.test"],
    error: null as string | null,
  })),
);

vi.mock("../email", () => ({ sendAlertEmail: sendAlertEmailMock }));

vi.mock("@workspace/db", () => ({
  db: {
    select: (columns: Record<string, unknown>) => ({
      from: (table: unknown) => ({
        where: (clause: unknown) => ({
          limit: async (n: number) =>
            projectRows(selectRows(table, watchdogRows, clause).slice(0, n), columns, table),
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: Row) => ({
        onConflictDoUpdate: ({ target, set }: { target: unknown; set: Row }) => {
          const relation = relationName(table);
          if (relation !== "watchdog_status") {
            throw new Error(`backupAlerts wrote an unexpected relation: ${relation}`);
          }
          if (failStateWrites) throw new Error("simulated write failure");
          const targetColumn = (target as { name?: string })?.name ?? "?";
          upserts.push({ relation, targetColumn, conflictValues: set });
          const existing = watchdogRows.find((r) => r["serviceName"] === values["serviceName"]);
          if (existing) Object.assign(existing, set);
          else watchdogRows.push({ ...values, id: idSeq++ });
          return undefined;
        },
      }),
    }),
  },
}));

import {
  BACKUP_ALERT_REMINDER_MS,
  type BackupAlertState,
  EMPTY_BACKUP_ALERT_STATE,
  alertOnOverdueBackupJobs,
  backupAlertServiceName,
  buildBackupAlertEmail,
  decideBackupAlert,
  notifyBackupOutcome,
  parseBackupAlertMetadata,
  recordDelivery,
  serializeBackupAlertMetadata,
} from "./backupAlerts";

function at(iso: string): Date {
  return new Date(iso);
}

const T0 = at("2026-10-22T14:30:00.000Z");
/** One hour later — the shape of the production defect: another failure, still inside 24 h. */
const T1H = at("2026-10-22T15:30:00.000Z");
/** 25 hours after T0 — the reminder is due. */
const T25H = at("2026-10-23T15:30:00.000Z");

function stateWith(over: Partial<BackupAlertState>): BackupAlertState {
  return { ...emptyState(), ...over };
}
function emptyState(): BackupAlertState {
  return { ...EMPTY_BACKUP_ALERT_STATE, deliveries: [] };
}

beforeEach(() => {
  watchdogRows = [];
  upserts = [];
  idSeq = 1;
  failStateWrites = false;
  sendAlertEmailMock.mockReset();
  sendAlertEmailMock.mockImplementation(async () => ({ ok: true, to: ["admin@clinic.test"], error: null }));
  vi.resetModules();
});

describe("decideBackupAlert — first failure, 24 h reminder, one recovery", () => {
  test("the first failure is reported immediately", () => {
    const d = decideBackupAlert({ outcome: "failure", state: emptyState(), now: T0 });
    expect({ send: d.send, kind: d.kind, reason: d.reason }).toEqual({ send: true, kind: "failure", reason: "first-failure" });
    expect(d.nextState.consecutiveFailures).toBe(1);
  });

  test("a failure an hour later stays quiet — that is the whole point of the cooldown", () => {
    const afterFirst = decideBackupAlert({ outcome: "failure", state: emptyState(), now: T0 }).nextState;
    const second = decideBackupAlert({ outcome: "failure", state: afterFirst, now: T1H });
    expect(second.send).toBe(false);
    expect(second.reason).toBe("suppressed-cooldown");
    // The count still advances: an operator reading the row can see this job has failed 2×, not 1×.
    expect(second.nextState.consecutiveFailures).toBe(2);
    expect(second.nextState.lastAlertAt).toEqual(T0);
  });

  test("a failure still open after 24 h produces exactly one reminder", () => {
    const afterFirst = decideBackupAlert({ outcome: "failure", state: emptyState(), now: T0 }).nextState;
    const reminder = decideBackupAlert({ outcome: "failure", state: afterFirst, now: T25H });
    expect({ send: reminder.send, reason: reminder.reason }).toEqual({ send: true, reason: "reminder-due" });
    // …and the reminder starts its own 24 h window rather than becoming one-per-run again.
    const justAfter = decideBackupAlert({
      outcome: "failure",
      state: reminder.nextState,
      now: new Date(T25H.getTime() + 60_000),
    });
    expect(justAfter.send).toBe(false);
  });

  test("recovery is confirmed once, then the job goes silent", () => {
    const afterFirst = decideBackupAlert({ outcome: "failure", state: emptyState(), now: T0 }).nextState;
    const recovered = decideBackupAlert({ outcome: "success", state: afterFirst, now: T1H });
    expect({ send: recovered.send, kind: recovered.kind, reason: recovered.reason })
      .toEqual({ send: true, kind: "recovery", reason: "recovery" });
    expect(recovered.nextState.lastAlertKind).toBeNull();
    expect(recovered.nextState.consecutiveFailures).toBe(0);

    const second = decideBackupAlert({ outcome: "success", state: recovered.nextState, now: T25H });
    expect({ send: second.send, reason: second.reason }).toEqual({ send: false, reason: "nothing-to-report" });
  });

  test("a healthy schedule sends nothing at all", () => {
    // No per-success mail: the clinic asked for failure, reminder and recovery. Confirming every
    // 20:00 backup would be the 365-mails-a-year inbox nobody reads.
    const d = decideBackupAlert({ outcome: "success", state: emptyState(), now: T0 });
    expect({ send: d.send, kind: d.kind, reason: d.reason }).toEqual({ send: false, kind: null, reason: "nothing-to-report" });
  });

  test("an overdue occurrence is reported once per occurrence, not once per tick", () => {
    const occurrence = at("2026-10-21T14:00:00.000Z");
    const first = decideBackupAlert({ outcome: "overdue", state: emptyState(), now: T0, occurrence });
    expect({ send: first.send, reason: first.reason }).toEqual({ send: true, reason: "first-failure" });
    expect(first.nextState.lastNotifiedOccurrence).toEqual(occurrence);

    // The dead-man runs every 6 h; the internal cron endpoint can be hit far more often than that.
    const again = decideBackupAlert({
      outcome: "overdue",
      state: first.nextState,
      now: new Date(T0.getTime() + 60_000),
      occurrence,
    });
    expect({ send: again.send, reason: again.reason }).toEqual({ send: false, reason: "suppressed-occurrence" });
  });

  test("an overdue alert does not pretend the job failed — it only counts real failures", () => {
    const d = decideBackupAlert({
      outcome: "overdue",
      state: stateWith({ consecutiveFailures: 3 }),
      now: T0,
      occurrence: at("2026-10-21T14:00:00.000Z"),
    });
    expect(d.send).toBe(true);
    expect(d.nextState.consecutiveFailures).toBe(3);
  });
});

describe("the delivery log", () => {
  test("keeps the newest attempts first and cannot grow without bound", () => {
    let state = emptyState();
    for (let i = 0; i < 25; i++) {
      state = recordDelivery(state, {
        at: new Date(T0.getTime() + i * 1000).toISOString(),
        kind: "failure",
        ok: i % 2 === 0,
        to: ["admin@clinic.test"],
        detail: i % 2 === 0 ? null : "SMTP refused",
      });
    }
    expect(state.deliveries).toHaveLength(10);
    expect(state.deliveries[0]!.at).toBe(new Date(T0.getTime() + 24_000).toISOString());
  });
});

describe("the persisted state row", () => {
  test("survives the round trip through `watchdog_status.metadata`", () => {
    const state = {
      lastAlertKind: "overdue" as const,
      lastAlertAt: T0,
      lastNotifiedOccurrence: T1H,
      consecutiveFailures: 4,
      deliveries: [{ at: T0.toISOString(), kind: "overdue" as const, ok: false, to: [], detail: "SMTP down" }],
    };
    expect(parseBackupAlertMetadata(serializeBackupAlertMetadata(state), 4)).toEqual(state);
  });

  test("a hand-edited or half-written row is treated as un-notified, not as an exception", () => {
    const parsed = parseBackupAlertMetadata("{ not json", 7);
    expect(parsed.lastAlertKind).toBeNull();
    expect(parsed.deliveries).toEqual([]);
    // The failure count lives in its own column, so it is not lost with the JSON.
    expect(parsed.consecutiveFailures).toBe(7);
  });

  test("a row written by an older build with an unknown kind does not alert forever", () => {
    expect(parseBackupAlertMetadata(JSON.stringify({ lastAlertKind: "warned" }), 0).lastAlertKind).toBeNull();
  });
});

describe("notifyBackupOutcome — one mail per decision, and state that outlives the process", () => {
  const job5 = { jobId: 5, jobName: "Nightly DB", outcome: "failure" as const, detail: "pg_dump exited 1", destination: "/volume1/backup/care-erp/db", scheduleLabel: "Daily at 20:00" };

  test("the first failure mails once and writes one state row for that job", async () => {
    const res = await notifyBackupOutcome({ ...job5, now: T0 });

    expect({ sent: res.sent, kind: res.kind, reason: res.reason }).toEqual({ sent: true, kind: "failure", reason: "first-failure" });
    expect(sendAlertEmailMock).toHaveBeenCalledTimes(1);
    expect(String(sendAlertEmailMock.mock.calls[0]![0].subject)).toContain("Nightly DB");

    expect(watchdogRows).toHaveLength(1);
    expect(watchdogRows[0]!["serviceName"]).toBe(backupAlertServiceName(5));
    expect(watchdogRows[0]!["status"]).toBe("down");
    expect(watchdogRows[0]!["lastError"]).toBe("pg_dump exited 1");
    // Upserted on the unique column: without this, every tick inserts a fresh row, the next read
    // returns the oldest one, and the cooldown silently never applies.
    expect(upserts[0]!.targetColumn).toBe("service_name");
  });

  test("jobs do not share one cooldown — job 6 is told about its own first failure", async () => {
    await notifyBackupOutcome({ ...job5, now: T0 });
    const other = await notifyBackupOutcome({ ...job5, jobId: 6, jobName: "Config", now: T1H });

    expect(other.sent).toBe(true);
    expect(watchdogRows).toHaveLength(2);
    expect(sendAlertEmailMock).toHaveBeenCalledTimes(2);
  });

  test("a restart does not reset the cooldown: state is re-read from the table, not kept in memory", async () => {
    await notifyBackupOutcome({ ...job5, now: T0 });

    // A new process: fresh module graph, so any in-process cache is gone. Only `watchdog_status`
    // survives, which is exactly what production loses on every deploy or container restart.
    vi.resetModules();
    const fresh = await import("./backupAlerts");
    const second = await fresh.notifyBackupOutcome({ ...job5, now: T1H });

    expect({ sent: second.sent, reason: second.reason }).toEqual({ sent: false, reason: "suppressed-cooldown" });
    expect(sendAlertEmailMock).toHaveBeenCalledTimes(1);
    // Hourly failures for a day: one mail, twelve counted failures.
    expect(JSON.parse(String(watchdogRows[0]!["metadata"])).deliveries).toHaveLength(1);
    expect(watchdogRows[0]!["consecutiveFailures"]).toBe(2);
  });

  test("an SMTP rejection is recorded as a failed delivery and never thrown to the backup runner", async () => {
    sendAlertEmailMock.mockRejectedValueOnce(new Error("connect ECONNREFUSED 127.0.0.1:587"));
    const res = await notifyBackupOutcome({ ...job5, now: T0 });

    expect(res.sent).toBe(false);
    expect(res.delivery).toMatchObject({ ok: false, detail: "connect ECONNREFUSED 127.0.0.1:587" });
    expect(watchdogRows).toHaveLength(1);
  });

  test("a delivery that failed is retried on the next tick instead of being marked as notified", async () => {
    // The trap this exists to close: if the cooldown clock started at the *attempt*, a dead SMTP for
    // a day would mean the clinic was never told — the state would claim it had been.
    sendAlertEmailMock.mockRejectedValueOnce(new Error("SMTP down"));
    const failed = await notifyBackupOutcome({ ...job5, now: T0 });
    expect(failed.sent).toBe(false);

    const retried = await notifyBackupOutcome({ ...job5, now: T1H });
    expect({ sent: retried.sent, reason: retried.reason }).toEqual({ sent: true, reason: "first-failure" });
    expect(sendAlertEmailMock).toHaveBeenCalledTimes(2);
  });

  test("an un-writable state table cannot stop the alert, and cannot stop the run", async () => {
    failStateWrites = true;
    const res = await notifyBackupOutcome({ ...job5, now: T0 });
    expect(res.sent).toBe(true); // the mail still went
    expect(watchdogRows).toHaveLength(0); // and the clinic has no memory of it, which the next tick repeats
  });

  test("recovery mails once and clears what was outstanding", async () => {
    await notifyBackupOutcome({ ...job5, now: T0 });
    const recovered = await notifyBackupOutcome({ ...job5, outcome: "success", detail: "backup_Nightly_….sql.enc written encrypted", now: T25H });
    expect({ sent: recovered.sent, kind: recovered.kind }).toEqual({ sent: true, kind: "recovery" });

    const after = await notifyBackupOutcome({ ...job5, outcome: "success", now: T25H });
    expect(after.sent).toBe(false);
    expect(sendAlertEmailMock).toHaveBeenCalledTimes(2);
    expect(watchdogRows[0]!["status"]).toBe("healthy");
  });
});

describe("the alert an operator actually reads", () => {
  test("a failure names the job, the schedule, the destination and what went wrong", () => {
    const { subject, html } = buildBackupAlertEmail({
      jobName: "Nightly DB",
      jobId: 5,
      kind: "failure",
      reason: "first-failure",
      detail: "pg_dump exited with code 1",
      destination: "/volume1/backup/care-erp/db",
      scheduleLabel: "Daily at 20:00",
      now: T0,
    });
    expect(subject).toContain("Nightly DB");
    expect(subject).toMatch(/failed/);
    for (const needle of ["Daily at 20:00", "/volume1/backup/care-erp/db", "pg_dump exited with code 1"]) {
      expect(html).toContain(needle);
    }
  });

  test("a reminder says it is a reminder, so the reader knows this is the same incident", () => {
    const { html } = buildBackupAlertEmail({
      jobName: "Nightly DB", jobId: 5, kind: "failure", reason: "reminder-due",
      detail: "still failing", destination: null, scheduleLabel: "Daily at 20:00", now: T25H,
    });
    expect(html).toMatch(/daily reminder/);
  });

  test("a recovery message reports what was written, not merely that the code finished", () => {
    // "An email must not report a successful backup unless the underlying backup result has been
    // verified" — so the message carries the artifact and states the two facts that make it usable.
    const { html } = buildBackupAlertEmail({
      jobName: "Nightly DB", jobId: 5, kind: "recovery", reason: "recovery",
      detail: "/volume1/backup/care-erp/db/backup_Nightly_2026-10-22T14-00-00-000Z.sql.enc written encrypted, checksum recorded",
      destination: "/volume1/backup/care-erp/db", scheduleLabel: "Daily at 20:00", now: T25H,
    });
    expect(html).toContain("written encrypted, checksum recorded");
    expect(html).toMatch(/only confirmation/);
  });

  test("an error message is escaped rather than injected into the mail as markup", () => {
    const { html } = buildBackupAlertEmail({
      jobName: "Nightly DB", jobId: 5, kind: "failure", reason: "first-failure",
      detail: 'disk <script>alert("x")</script> & "quoted"',
      destination: null, scheduleLabel: "Daily at 20:00", now: T0,
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("alertOnOverdueBackupJobs — the job that never ran is the one nobody hears about", () => {
  /** Local-time Date, because a stored `0 20 * * *` means 20:00 in the container's zone (compose
   *  pins TZ=Asia/Kolkata) and `lastOccurrence` matches against local clock fields. Building the
   *  clock in local time keeps these assertions true on any runner's zone. */
  function local(y: number, mo: number, d: number, h = 0, mi = 0): Date {
    return new Date(y, mo, d, h, mi, 0, 0);
  }

  interface JobRow {
    id: number;
    jobName: string;
    schedule: string | null;
    lastRunAt: Date | null;
    destinationPath: string | null;
    isEnabled?: boolean;
  }

  function overdueJob(over: Partial<JobRow> = {}): JobRow {
    return { id: 9, jobName: "Nightly DB", schedule: "0 20 * * *", lastRunAt: null, destinationPath: "/volume1/backup/care-erp/db", ...over };
  }

  // October 2026. The nightly 20:00 run of the 22nd is 17 h old at this instant: past the runner's
  // 12 h catch-up window, so the occurrence is gone unclaimed, and still before tonight's 20:00, so
  // the next tick in this test looks at the SAME occurrence.
  const now = local(2026, 9, 23, 13, 0);
  const laterSameDay = local(2026, 9, 23, 18, 0);

  test("a manual-only job is not overdue — nobody scheduled anything", async () => {
    const res = await alertOnOverdueBackupJobs([overdueJob({ schedule: "MANUAL" })], now);
    expect(res).toEqual({ checked: 0, sent: 0, suppressed: 0 });
    expect(sendAlertEmailMock).not.toHaveBeenCalled();
  });

  test("a job an admin disabled on purpose stays out of the mailbox", async () => {
    const res = await alertOnOverdueBackupJobs([overdueJob({ isEnabled: false })], now);
    expect(res.checked).toBe(0);
    expect(sendAlertEmailMock).not.toHaveBeenCalled();
  });

  test("a job that ran for its latest occurrence is not called overdue", async () => {
    const res = await alertOnOverdueBackupJobs([overdueJob({ lastRunAt: local(2026, 9, 22, 20, 0) })], now);
    expect(res.checked).toBe(0);
  });

  test("an occurrence still inside the runner's catch-up window is not called overdue", async () => {
    // 22:00 on the 23rd: tonight's run is 2 h late and could still start. Alerting here would train
    // the clinic to ignore a mail that describes a backup that is merely running behind.
    const res = await alertOnOverdueBackupJobs([overdueJob()], local(2026, 9, 23, 22, 0));
    expect(res.checked).toBe(0);
  });

  test("a job a day behind is reported once, and a second tick reports nothing new", async () => {
    const jobs = [overdueJob()];
    const first = await alertOnOverdueBackupJobs(jobs, now);
    expect(first).toEqual({ checked: 1, sent: 1, suppressed: 0 });
    const mail = sendAlertEmailMock.mock.calls[0]![0];
    expect(String(mail.subject)).toMatch(/did not run/);
    expect(String(mail.html)).toContain("2026-10-22 20:00");

    const second = await alertOnOverdueBackupJobs(jobs, laterSameDay);
    expect(second).toEqual({ checked: 1, sent: 0, suppressed: 1 });
    expect(sendAlertEmailMock).toHaveBeenCalledTimes(1);
  });

  test("each missed occurrence is reported, so a job that stops is not silent after day one", async () => {
    const jobs = [overdueJob()];
    await alertOnOverdueBackupJobs(jobs, now); // reports 22 Oct 20:00
    // Two days on: the newest occurrence is 23 Oct 20:00, now 17 h old. A new fact, so a new mail —
    // with the dead-man's own aggregate alert still doing its job alongside it.
    const third = await alertOnOverdueBackupJobs(jobs, local(2026, 9, 24, 13, 0));
    expect(third).toEqual({ checked: 1, sent: 1, suppressed: 0 });
    expect(sendAlertEmailMock).toHaveBeenCalledTimes(2);
    expect(String(sendAlertEmailMock.mock.calls[1]![0].html)).toContain("2026-10-23 20:00");
  });

  test("a schedule the runner cannot parse is reported instead of staying silent forever", async () => {
    // The Backups UI's "Custom cron…" stores the literal CUSTOM. Before this, such a job never
    // became due, never failed, never ran, and never said anything.
    const res = await alertOnOverdueBackupJobs([overdueJob({ schedule: "CUSTOM" })], now);
    expect(res.sent).toBe(1);
    const html = String(sendAlertEmailMock.mock.calls[0]![0].html);
    expect(html).toMatch(/not a cron expression this scheduler can honour/);
    expect(html).toContain("CUSTOM");
  });

  test("a schedule that can never match is reported too", async () => {
    // 30 February: parseable fields, no occurrence ever. The page calls it CRITICAL; the mailbox
    // must not be the second place a clinic learns about it only during an actual restore.
    const res = await alertOnOverdueBackupJobs([overdueJob({ schedule: "0 2 30 2 *" })], now);
    expect(res.sent).toBe(1);
    expect(String(sendAlertEmailMock.mock.calls[0]![0].html)).toMatch(/matched no minute in the last 8 days/);
  });

  test("each job gets its own overdue alert, not one shared verdict", async () => {
    const res = await alertOnOverdueBackupJobs([overdueJob({ id: 9 }), overdueJob({ id: 10, jobName: "Config" })], now);
    expect(res).toEqual({ checked: 2, sent: 2, suppressed: 0 });
    expect(watchdogRows.map((r) => r["serviceName"]).sort()).toEqual([
      "backup-alert:job:10",
      "backup-alert:job:9",
    ]);
    expect(BACKUP_ALERT_REMINDER_MS).toBe(24 * 60 * 60 * 1000);
  });
});
