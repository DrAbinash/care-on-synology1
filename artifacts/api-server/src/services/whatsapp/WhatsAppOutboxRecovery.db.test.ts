// ============================================================================
// PR-I8 — WhatsApp outbox: abandoned jobs, worker crashes and concurrency.
//
// `wa_outbox` is the queue every patient-facing WhatsApp message goes through
// (appointment reminders, report-ready alerts, receipts, OTPs). Its sibling — the
// CARE→HOPE integration outbox — was hardened across #995/#996: abandoned
// `sending` rows are reclaimed behind a lease, and a stale worker cannot write
// over a live owner. This file asks whether the WhatsApp queue has the same
// protection, because the two queues claim rows in nearly the same way.
//
// It does not.
//
// `dispatchPendingWaOutbox` (WhatsAppOutbox.ts:472) claims rows whose status is
// `queued` or `suppressed` and stamps them `processing` (:477). Nothing in the
// repository ever selects `processing` again, so a worker that dies between the
// claim and its write-back strands that row permanently — it is not retried, not
// dead-lettered, and not counted anywhere a human looks. And every write-back
// (:378, :385, :398, :421, :431, :443) is `WHERE id = ?` with no owner check, so
// the moment abandoned rows CAN be reclaimed, the dead worker's late write is
// free to overwrite the live one's result. Recovery without fencing would trade
// one defect for a worse one, so both are tested here together.
//
// Real PostgreSQL throughout. The Meta Graph API call is stubbed — no test in
// this file can put a message in front of a patient, and every recipient is a
// `pr-i8-wa-*` synthetic number.
// ============================================================================
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const hasDb = !!DATABASE_URL;
const pool = new Pool({ connectionString: DATABASE_URL, max: 10 });

const MARKER = "pr-i8-wa";
const SETTINGS_ID = 1;

// ── Provider stub ────────────────────────────────────────────────────────────
// The dispatcher calls global fetch once per attempt. Modes: accept (200 + a
// provider message id), reject (an error status), hang (never settles until the
// test releases it, which is how a worker is killed mid-call), timeout (settles
// only when the caller's AbortSignal fires, which is how a slow provider is
// simulated without waiting 15 s).
type Mode = "accept" | "hang" | "reject" | "timeout";
interface Call { url: string; body: any; workerHint: string }

const provider = {
  mode: "accept" as Mode,
  status: 400,
  calls: [] as Call[],
  release: null as null | (() => void),
  idSeq: 0,
};

function resetProvider(mode: Mode = "accept") {
  provider.mode = mode;
  provider.status = 400;
  provider.calls = [];
  provider.release = null;
}

vi.stubGlobal("fetch", async (url: any, init: any): Promise<any> => {
  const call: Call = { url: String(url), body: safeParse(init?.body), workerHint: String(init?.headers?.Authorization ?? "") };
  provider.calls.push(call);

  if (provider.mode === "accept") {
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: `wamid.I8${++provider.idSeq}` }] }) };
  }
  if (provider.mode === "reject") {
    return { ok: false, status: provider.status, json: async () => ({ error: { message: `provider said ${provider.status}`, code: provider.status } }) };
  }
  if (provider.mode === "timeout") {
    // Honour the caller's abort exactly as a hung socket would.
    await new Promise<void>((resolve, reject) => {
      const signal = init?.signal;
      const t = setTimeout(() => resolve(), 30_000);
      signal?.addEventListener?.("abort", () => {
        clearTimeout(t);
        const e: any = new Error("aborted");
        e.name = "AbortError";
        reject(e);
      });
    });
    const e: any = new Error("aborted");
    e.name = "AbortError";
    throw e;
  }
  // hang: the process dies here. Never settles unless released by the test — and
  // when it is released it SUCCEEDS, because the dangerous stale worker is the
  // one that comes back with a real answer to write down, not the one that fails.
  await new Promise<void>((resolve) => { provider.release = resolve; });
  return { ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.I8-ZOMBIE-LATE-ANSWER" }] }) };
});

function safeParse(v: any) { try { return JSON.parse(String(v)); } catch { return null; } }

// ── fixtures ─────────────────────────────────────────────────────────────────
async function ensureSettings() {
  const [row] = (await pool.query(`SELECT id FROM whatsapp_settings LIMIT 1`)).rows;
  if (row) {
    await pool.query(
      `UPDATE whatsapp_settings SET phone_number_id=$1, access_token=$2, enabled=true, max_retry_attempts=5,
         retry_delay_base_seconds=60, graph_api_version='v18.0' WHERE id=$3`,
      ["I8-SYNTH-PID", "synthetic-token-not-a-secret", row.id]);
    return;
  }
  await pool.query(
    `INSERT INTO whatsapp_settings (id, enabled, phone_number_id, access_token, graph_api_version,
        max_retry_attempts, retry_delay_base_seconds, shadow_mode)
     VALUES ($1,true,'I8-SYNTH-PID','synthetic-token-not-a-secret','v18.0',5,60,false)`, [SETTINGS_ID]);
}

let seq = 0;
interface RowOpts { status?: string; dueInMinutes?: number; lockedAgoMs?: number; lockedBy?: string; suppressed?: string; maxAttempts?: number; priority?: number }
async function insertRow(purpose: string, opts: RowOpts = {}) {
  const n = ++seq;
  const phone = `+9170${String(100000 + n).slice(0, 6)}`;
  const r = await pool.query(
    `INSERT INTO wa_outbox (patient_id, phone_number_id, recipient_phone, message_purpose, payload_json,
        idempotency_key, status, priority, attempt_count, max_attempts, next_attempt_at, locked_at, locked_by,
        processing_started_at, suppressed_reason)
     VALUES (NULL,$1,$2,$3,'{"kind":"text","body":"PR-I8 synthetic"}',$4,$5,$6,0,$7,
        COALESCE($8::timestamptz, NOW()), CASE WHEN $9::int IS NULL THEN NULL ELSE NOW() - ($9 || ' milliseconds')::interval END, $10,
        CASE WHEN $9::int IS NULL THEN NULL ELSE NOW() - ($9 || ' milliseconds')::interval END, $11)
     RETURNING id`,
    ["I8-SYNTH-PID", phone, `${purpose}`, `${MARKER}-key-${n}`, opts.status ?? "queued",
     opts.priority ?? 5, opts.maxAttempts ?? 5,
     opts.dueInMinutes == null ? null : new Date(Date.now() + opts.dueInMinutes * 60_000),
     opts.lockedAgoMs ?? null, opts.lockedBy ?? null, opts.suppressed ?? null]);
  return { id: Number(r.rows[0].id), phone, key: `${MARKER}-key-${n}` };
}

const rowOf = async (id: number) => (await pool.query(
  `SELECT id, status, attempt_count, locked_at, locked_by, provider_message_id, last_error_code,
          last_error_message, next_attempt_at, sent_at, dead_lettered_at, processing_started_at
     FROM wa_outbox WHERE id = $1`, [id])).rows[0];

const attemptsOf = async (id: number) => (await pool.query(
  `SELECT attempt_no, success, http_status, provider_error_code, response_sanitized
     FROM wa_delivery_attempts WHERE outbox_id = $1 ORDER BY attempt_no, id`, [id])).rows;

const clearAll = async () => {
  await pool.query(`DELETE FROM wa_delivery_attempts WHERE outbox_id IN (SELECT id FROM wa_outbox WHERE idempotency_key LIKE $1)`, [`${MARKER}%`]);
  await pool.query(`DELETE FROM wa_outbox WHERE idempotency_key LIKE $1`, [`${MARKER}%`]);
};

// A dispatcher tick started without awaiting it is a worker that may still be
// alive: it is parked inside the provider call, and it will write its outcome
// whenever that call settles — possibly during the NEXT test. Every such promise
// is registered here and drained before each test, so a stranding scenario cannot
// leak a late write into an unrelated case and make a verdict depend on timing.
const inflight: Array<Promise<unknown>> = [];
const startUnawaited = <T,>(p: Promise<T>): Promise<T> => { inflight.push(p.catch(() => null)); return p; };
const drainWorkers = async () => {
  provider.release?.();
  await Promise.allSettled(inflight.splice(0, inflight.length));
};

// Wait for a worker to be provably *inside* the provider call for a row. The
// claim commits before the call is made, so waiting on `processing` alone races
// the fetch — the first version of this helper did exactly that, and the suite
// then failed or passed depending on how fast the DB answered.
const waitInsideProviderCall = async (id: number, workerId: string, expectedCalls: number) => {
  await vi.waitFor(async () => {
    const r = await rowOf(id);
    expect(r.status).toBe("processing");
    expect(r.locked_by).toBe(workerId);
    expect(provider.calls.length).toBe(expectedCalls);
  }, { timeout: 10_000, interval: 20 });
};
const ageLease = async (id: number, minutes = 10) =>
  pool.query(`UPDATE wa_outbox SET locked_at = NOW() - ($1 || ' minutes')::interval WHERE id = $2`, [String(minutes), id]);

// Make a row due now, standing in for the backoff window elapsing.
const makeDue = (id: number) =>
  pool.query(`UPDATE wa_outbox SET next_attempt_at = NOW() - interval '1 minute' WHERE id = $1`, [id]);

let wa: typeof import("./WhatsAppOutbox");

// A DB fault injected on the write-back only — this is what a process dying
// immediately AFTER the provider answered looks like to the database. The fence
// is on the ROW, not the worker: every row in a batch shares one worker id, so a
// worker-keyed fault would hit all of them and "one bad row" would test nothing.
// Every write-back also clears locked_by in the same statement, so a predicate on
// NEW.locked_by would never fire.
const CRASH_TRIGGER = "pr_i8_crash_writeback";
async function armWritebackCrash(outboxId: number) {
  await pool.query(`CREATE OR REPLACE FUNCTION ${CRASH_TRIGGER}() RETURNS trigger AS $f$
      BEGIN
        IF OLD.id = ${outboxId} AND NEW.status IN ('sent','queued','dead_letter','suppressed') THEN
          RAISE EXCEPTION 'pr-i8 simulated process death during write-back';
        END IF;
        RETURN NEW;
      END $f$ LANGUAGE plpgsql`);
  await pool.query(`DROP TRIGGER IF EXISTS ${CRASH_TRIGGER} ON wa_outbox`);
  await pool.query(`CREATE TRIGGER ${CRASH_TRIGGER} BEFORE UPDATE ON wa_outbox FOR EACH ROW EXECUTE FUNCTION ${CRASH_TRIGGER}()`);
}
async function disarmWritebackCrash() {
  await pool.query(`DROP TRIGGER IF EXISTS ${CRASH_TRIGGER} ON wa_outbox`);
  await pool.query(`DROP FUNCTION IF EXISTS ${CRASH_TRIGGER}() CASCADE`);
}

beforeAll(async () => {
  if (!hasDb) return;
  await ensureSettings();
  wa = await import("./WhatsAppOutbox");
});

afterAll(async () => {
  if (!hasDb) return;
  await drainWorkers();
  await disarmWritebackCrash();
  await clearAll();
  await pool.end();
});

beforeEach(async () => {
  if (!hasDb) return;
  await drainWorkers();
  await disarmWritebackCrash();
  await clearAll();
  resetProvider();
});

describe.skipIf(!hasDb)("wa_outbox — abandoned jobs, crashes and concurrent workers", () => {

  it("W1 — a job abandoned in `processing` by a dead worker is stranded forever (the gap), and a later tick must recover it", async () => {
    const row = await insertRow("appointment_reminder");
    // A real claim, by the real code path: the provider hangs and the worker
    // never comes back, which is exactly the state a crash leaves behind.
    provider.mode = "hang";
    startUnawaited(wa.dispatchPendingWaOutbox({ limit: 1, workerId: "pr-i8-dead-worker", timeoutMs: 600_000 }));
    await waitInsideProviderCall(row.id, "pr-i8-dead-worker", 1);

    // Time passes — the lease would have expired — and the worker is gone.
    await ageLease(row.id, 10);
    provider.mode = "accept";
    const tick = await wa.dispatchPendingWaOutbox({ limit: 5, workerId: "pr-i8-live-worker" });

    const r = await rowOf(row.id);
    expect(r.status, `an abandoned processing row was never retried (status=${r.status}, tick=${JSON.stringify(tick)})`)
      .not.toBe("processing");
    expect(tick.recovered ?? 0, `the tick did not report the row it recovered: ${JSON.stringify(tick)}`)
      .toBeGreaterThan(0);
    expect(r.last_error_code, "the recovery has to say what happened, or an operator reads it as a send failure")
      .toBe("delivery_abandoned");
    expect(r.attempt_count, "the abandoned attempt must be charged, so a crash loop cannot live forever")
      .toBe(1);

    // Recovery defers the resend by the normal backoff, exactly as the HOPE
    // outbox does (#995): the message is not lost, it is waiting.
    await makeDue(row.id);
    const second = await wa.dispatchPendingWaOutbox({ limit: 5, workerId: "pr-i8-live-worker-2" });
    const sent = await rowOf(row.id);
    expect(sent.status, `the recovered row never went out on the next pass (${JSON.stringify(second)})`).toBe("sent");
    expect(sent.sent_at).not.toBeNull();
    expect(sent.locked_by, "a delivered row must not still look locked").toBeNull();
  });

  it("W2 — a crash AFTER the provider accepted re-delivers the message and never calls it delivered on the strength of nothing", async () => {
    const row = await insertRow("report_ready");
    // The provider accepts; the worker then dies before its write-back lands.
    await armWritebackCrash(row.id);
    provider.mode = "accept";
    await wa.dispatchPendingWaOutbox({ limit: 1, workerId: "pr-i8-doomed-worker" }).catch(() => null);

    const stranded = await rowOf(row.id);
    expect(stranded.status, "the accepted message must not have been marked sent by a dead worker").toBe("processing");
    expect(stranded.sent_at).toBeNull();
    expect(stranded.provider_message_id).toBeNull();
    expect(provider.calls.length).toBe(1);

    await disarmWritebackCrash();
    await ageLease(row.id, 10);
    await wa.dispatchPendingWaOutbox({ limit: 5, workerId: "pr-i8-second-worker" });
    await makeDue(row.id);
    const tick = await wa.dispatchPendingWaOutbox({ limit: 5, workerId: "pr-i8-third-worker" });

    const r = await rowOf(row.id);
    expect(r.status, `the accepted-but-unwritten message stayed invisible (tick=${JSON.stringify(tick)})`).toBe("sent");
    // Honest consequence of recovery, and it must stay visible: the provider was
    // asked twice. Delivery here is at-least-once; no test may claim exactly-once.
    expect(provider.calls.length, "a recovered row is re-sent — the duplicate must be auditable, not silent")
      .toBeGreaterThanOrEqual(2);
    const atts = await attemptsOf(row.id);
    expect(atts.length, "every attempt, including the abandoned one, must be recorded").toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(atts.map((a: any) => a.provider_error_code)),
      "the abandoned attempt must be identifiable in the audit trail")
      .toContain("delivery_abandoned");
  });

  it("W3 — two workers running at once never both take the same row, and a slow one keeps it", async () => {
    // The claim was already exclusive (FOR UPDATE SKIP LOCKED), and the new
    // reclaim must not break that: a second tick must neither re-claim a row
    // that is `processing` nor treat a worker that is merely inside a slow
    // provider call as dead. If it did, every retry would double-send.
    const row = await insertRow("appointment_reminder");
    provider.mode = "hang";
    const slow = startUnawaited(wa.dispatchPendingWaOutbox({ limit: 1, workerId: "pr-i8-slow", timeoutMs: 600_000 }));
    await waitInsideProviderCall(row.id, "pr-i8-slow", 1);

    const other = await wa.dispatchPendingWaOutbox({ limit: 5, workerId: "pr-i8-second" });
    expect(other.claimed, `a second worker claimed the row still being sent (${JSON.stringify(other)})`).toBe(0);
    expect(other.recovered ?? 0, "a worker inside its own lease window is not a dead worker").toBe(0);
    const held = await rowOf(row.id);
    expect(held.locked_by, `the second worker took the lease: ${JSON.stringify(held)}`).toBe("pr-i8-slow");
    expect(provider.calls.length, "the same message must not be POSTed twice").toBe(1);

    provider.release?.();
    await slow.catch(() => null);
    const done = await rowOf(row.id);
    expect(done.status).toBe("sent");
    expect(done.attempt_count).toBe(1);
    expect(provider.calls.length).toBe(1);
    expect(done.provider_message_id).toBe("wamid.I8-ZOMBIE-LATE-ANSWER");
  });

  it("W4 — a dead worker's late write-back may not overwrite the worker that actually finished", async () => {
    const row = await insertRow("payment_receipt");
    provider.mode = "hang";
    const dying = startUnawaited(wa.dispatchPendingWaOutbox({ limit: 1, workerId: "pr-i8-zombie", timeoutMs: 600_000 }));
    await waitInsideProviderCall(row.id, "pr-i8-zombie", 1);
    const zombieCallCount = provider.calls.length;

    // Another worker recovers it after the lease expires and then delivers it.
    await ageLease(row.id, 10);
    provider.mode = "accept";
    await wa.dispatchPendingWaOutbox({ limit: 5, workerId: "pr-i8-live" });
    await makeDue(row.id);
    await wa.dispatchPendingWaOutbox({ limit: 5, workerId: "pr-i8-live-2" });
    const won = await rowOf(row.id);
    expect(won.status, `the new owner never got to send it: ${JSON.stringify(won)}`).toBe("sent");
    const winnerMessageId = won.provider_message_id;
    expect(winnerMessageId).toBeTruthy();
    // Recovery costs exactly one resend: the message the zombie may already have
    // put in front of the patient is delivered once more, never twice more.
    expect(provider.calls.length, "the recovery path must not multiply sends")
      .toBe(zombieCallCount + 1);

    // The zombie now wakes up and writes the answer it finally got: a successful
    // send of its own, with its own provider message id. It no longer owns the row.
    provider.release?.();
    await dying.catch(() => null);

    const after = await rowOf(row.id);
    expect(after.status, `the late worker's write knocked the row off its real outcome: ${JSON.stringify(after)}`)
      .toBe("sent");
    expect(after.provider_message_id,
      "a stale worker overwrote the provider message id of the delivery that actually completed")
      .toBe(winnerMessageId);
    expect(after.provider_message_id, "the zombie's own provider id must not be on the row")
      .not.toBe("wamid.I8-ZOMBIE-LATE-ANSWER");
    expect(after.locked_by, `the zombie still owns the row it lost: ${JSON.stringify(after)}`).not.toBe("pr-i8-zombie");
    expect(after.sent_at, "the delivery timestamp must still belong to the worker that delivered it")
      .not.toBeNull();
    expect(provider.calls.length, "the zombie's wake-up must not send the patient another message")
      .toBe(zombieCallCount + 1);
  });

  it("W5 — a provider timeout is a retry, never a success", async () => {
    const row = await insertRow("otp");
    provider.mode = "timeout";
    const tick = await wa.dispatchPendingWaOutbox({ limit: 1, workerId: "pr-i8-timeout", timeoutMs: 250 });
    const r = await rowOf(row.id);
    expect(r.status, `timeout produced ${r.status}: ${JSON.stringify(tick)}`).toBe("queued");
    expect(r.sent_at).toBeNull();
    expect(r.attempt_count).toBe(1);
    expect(String(r.last_error_message)).toMatch(/timeout/i);
    expect(new Date(r.next_attempt_at).getTime()).toBeGreaterThan(Date.now() - 1000);
  });

  it("W6 — a permanent provider rejection is dead-lettered on the first attempt", async () => {
    const row = await insertRow("appointment_reminder");
    provider.mode = "reject";
    provider.status = 400;
    await wa.dispatchPendingWaOutbox({ limit: 1, workerId: "pr-i8-reject" });
    const r = await rowOf(row.id);
    expect(r.status).toBe("dead_letter");
    expect(r.dead_lettered_at).not.toBeNull();
    expect(r.attempt_count).toBe(1);
  });

  it("W7 — retry exhaustion terminates the job instead of re-queued forever", async () => {
    const row = await insertRow("dues_reminder", { maxAttempts: 2 });
    provider.mode = "reject";
    provider.status = 429; // retryable status, so it advances to the attempt budget
    for (let i = 0; i < 4; i++) {
      await pool.query(`UPDATE wa_outbox SET next_attempt_at = NOW() - interval '1 minute' WHERE id = $1`, [row.id]);
      await wa.dispatchPendingWaOutbox({ limit: 1, workerId: `pr-i8-exhaust-${i}` });
    }
    const r = await rowOf(row.id);
    expect(r.status, `attempt_count=${r.attempt_count} never reached a terminal state`).toBe("dead_letter");
    expect(r.attempt_count).toBeLessThanOrEqual(3);
  });

  it("W8 — a restart resumes both pending and abandoned work in one tick", async () => {
    const strandedA = await insertRow("appointment_reminder");
    const strandedB = await insertRow("report_ready");
    const fresh = await insertRow("payment_receipt");
    const deferred = await insertRow("dues_reminder", { dueInMinutes: 60 });
    await pool.query(
      `UPDATE wa_outbox SET status='processing', locked_by='pr-i8-dead', locked_at=NOW() - interval '10 minutes',
              processing_started_at=NOW() - interval '10 minutes' WHERE id = ANY($1::int[])`, [[strandedA.id, strandedB.id]]);
    provider.mode = "accept";
    const tick = await wa.dispatchPendingWaOutbox({ limit: 10, workerId: "pr-i8-after-restart" });

    expect((await rowOf(fresh.id)).status, "pending work must resume after a restart").toBe("sent");
    const a = await rowOf(strandedA.id);
    const b = await rowOf(strandedB.id);
    expect(a.status, `abandoned row A still stranded: ${JSON.stringify(a)} tick=${JSON.stringify(tick)}`).not.toBe("processing");
    expect(b.status, `abandoned row B still stranded: ${JSON.stringify(b)}`).not.toBe("processing");
    expect(tick.recovered ?? 0, `neither abandoned row was reported recovered (${JSON.stringify(tick)})`)
      .toBe(2);

    await makeDue(strandedA.id);
    await makeDue(strandedB.id);
    const second = await wa.dispatchPendingWaOutbox({ limit: 10, workerId: "pr-i8-after-restart-2" });
    expect((await rowOf(strandedA.id)).status, `recovered A never sent (${JSON.stringify(second)})`).toBe("sent");
    expect((await rowOf(strandedB.id)).status).toBe("sent");
    expect((await rowOf(deferred.id)).status, "a message deferred to a future time must be left alone")
      .toBe("queued");
    expect(tick.claimed).toBeGreaterThanOrEqual(1);
  });

  it("W9a — rows that can never be sent must not consume the whole batch and starve real messages", async () => {
    // Shadow-mode / allowlist rows are re-claimed every tick and re-suppressed
    // without advancing next_attempt_at (WhatsAppOutbox.ts:377-379), so with a
    // peak limit of 5 (cron.ts:1234) six of them permanently occupy the batch.
    for (let i = 0; i < 6; i++) {
      await insertRow("appointment_reminder", { status: "suppressed", suppressed: "shadow_mode", dueInMinutes: -120 });
    }
    const real = await insertRow("report_ready");

    provider.mode = "accept";
    const tick = await wa.dispatchPendingWaOutbox({ limit: 5, workerId: "pr-i8-starved" });
    const r = await rowOf(real.id);
    expect(r.status, `a real message was starved by ${JSON.stringify(tick)} while unsendable rows held the batch`)
      .toBe("sent");
  });

  it("W9b — one row whose write-back fails must not abort the rest of the batch", async () => {
    const poison = await insertRow("appointment_reminder", { priority: 1 });
    const healthy = await insertRow("report_ready", { priority: 2 });
    const alsoHealthy = await insertRow("payment_receipt", { priority: 3 });
    await armWritebackCrash(poison.id);
    provider.mode = "accept";
    // Same tick, poison claimed first by priority. Its own write-back throws.
    const tick = await wa.dispatchPendingWaOutbox({ limit: 5, workerId: "pr-i8-poison-worker" }).catch((e: any) => ({ threw: String(e?.message) } as any));
    await disarmWritebackCrash();

    expect((tick as any).threw, "a dispatcher tick must not die on one row").toBeUndefined();
    for (const row of [healthy, alsoHealthy]) {
      const r = await rowOf(row.id);
      expect(r.status, `an unrelated message was left in ${r.status} by one bad row (tick=${JSON.stringify(tick)})`)
        .toBe("sent");
    }
    // The poison row is not lost either — it is recoverable, not stranded.
    await ageLease(poison.id, 10);
    await wa.dispatchPendingWaOutbox({ limit: 5, workerId: "pr-i8-recover" });
    await makeDue(poison.id);
    const again = await wa.dispatchPendingWaOutbox({ limit: 5, workerId: "pr-i8-recover-2" });
    expect((await rowOf(poison.id)).status, `the failing row never came back for a retry (${JSON.stringify(again)})`)
      .toBe("sent");
  });

  it("W10 — a job with no usable recipient is never reported as delivered", async () => {
    const blank = await insertRow("report_ready");
    await pool.query(`UPDATE wa_outbox SET recipient_phone = '' WHERE id = $1`, [blank.id]);
    provider.mode = "accept";
    await wa.dispatchPendingWaOutbox({ limit: 1, workerId: "pr-i8-blank" });
    const r = await rowOf(blank.id);
    const sentToNobody = r.status === "sent" && provider.calls.some((c) => !String(c.body?.to ?? "").length);
    expect(sentToNobody, "an empty recipient was POSTed to the provider and marked sent").toBe(false);
  });

  it("W11 — a manual retry of a message that already reached the patient must not send it again", async () => {
    const row = await insertRow("report_ready");
    provider.mode = "accept";
    await wa.dispatchPendingWaOutbox({ limit: 1, workerId: "pr-i8-first" });
    expect((await rowOf(row.id)).status).toBe("sent");
    const callsAfterFirstSend = provider.calls.length;

    const retried = await wa.retryWaOutboxMessage(row.id);
    await wa.dispatchPendingWaOutbox({ limit: 5, workerId: "pr-i8-after-retry" });

    const r = await rowOf(row.id);
    expect(retried.ok && r.status === "sent" && provider.calls.length > callsAfterFirstSend,
      `retrying a delivered message re-sent it to the patient (status=${r.status}, calls=${provider.calls.length}, retried=${JSON.stringify(retried)})`)
      .toBe(false);
    if (retried.ok) expect(r.status, "a refused retry must not leave the row queued").toBe("sent");
  });

  it("W12 — recovery keeps the retry budget: an abandoned row that keeps failing still terminates", async () => {
    const row = await insertRow("appointment_reminder", { maxAttempts: 1 });
    provider.mode = "hang";
    const dying = startUnawaited(wa.dispatchPendingWaOutbox({ limit: 1, workerId: "pr-i8-burn", timeoutMs: 600_000 }));
    await waitInsideProviderCall(row.id, "pr-i8-burn", 1);
    await ageLease(row.id, 10);
    provider.mode = "reject";
    provider.status = 429;
    await wa.dispatchPendingWaOutbox({ limit: 5, workerId: "pr-i8-retry" });
    provider.release?.();
    await dying.catch(() => null);

    const r = await rowOf(row.id);
    expect(["dead_letter", "queued", "sent"].includes(r.status), `recovery left the row in ${r.status}`).toBe(true);
    expect(r.attempt_count, "the abandoned attempt was not charged, so a retry-exhausted job can live forever")
      .toBeGreaterThanOrEqual(1);
    if (r.status === "queued") {
      await pool.query(`UPDATE wa_outbox SET next_attempt_at = NOW() - interval '1 minute' WHERE id = $1`, [row.id]);
      await wa.dispatchPendingWaOutbox({ limit: 5, workerId: "pr-i8-final" });
      expect((await rowOf(row.id)).status, "the budget was never honoured").toBe("dead_letter");
    }
  });

  it("W14 — the reclaim is bounded by the batch and takes the longest-stranded rows first", async () => {
    // An unbounded reclaim would rewrite every stranded row in one transaction
    // on a tick that is supposed to do `limit` rows of work, and without an
    // order the message abandoned an hour ago could keep losing to one
    // abandoned a minute ago. Both halves are the reclaim's own contract,
    // matching integration/outbox.ts:246-252 for the HOPE outbox.
    const newest = await insertRow("report_ready");
    const middle = await insertRow("report_ready");
    const oldest = await insertRow("report_ready");
    for (const r of [newest, middle, oldest]) {
      await pool.query(
        `UPDATE wa_outbox SET status='processing', locked_by='pr-i8-dead', processing_started_at=NOW() WHERE id = $1`, [r.id]);
    }
    // Inserted newest-first on purpose: if the reclaim ever loses its
    // ORDER BY locked_at, the rows it happens to pick will be the rows with the
    // lowest ids, which is not the same set — the test then fails instead of
    // agreeing with an arbitrary scan order.
    await ageLease(newest.id, 10);
    await ageLease(middle.id, 20);
    await ageLease(oldest.id, 30);

    provider.mode = "accept";
    const tick = await wa.dispatchPendingWaOutbox({ limit: 2, workerId: "pr-i8-bounded" });
    expect(tick.recovered ?? 0, `a bounded tick recovered more than its limit (${JSON.stringify(tick)})`).toBe(2);
    expect((await rowOf(oldest.id)).status, "the longest-stranded row must be recovered first").not.toBe("processing");
    expect((await rowOf(middle.id)).status).not.toBe("processing");
    const left = await rowOf(newest.id);
    expect(left.status, `the third row should have waited for the next tick: ${JSON.stringify(left)}`).toBe("processing");
    expect(left.locked_by, "a row this tick did not take over must keep its original owner").toBe("pr-i8-dead");

    const next = await wa.dispatchPendingWaOutbox({ limit: 5, workerId: "pr-i8-bounded-2" });
    expect(next.recovered ?? 0, `the row left behind was never picked up (${JSON.stringify(next)})`).toBe(1);
    const after = await rowOf(newest.id);
    expect(after.status, `the deferred row is still stranded: ${JSON.stringify(after)}`).toBe("queued");
    expect(after.locked_by, "a recovered row must not stay locked to the worker that died").toBeNull();
  });

  it("W13 — a retry of a dead-lettered message still works: the guard must not break the honest case", async () => {
    const row = await insertRow("appointment_reminder");
    provider.mode = "reject";
    provider.status = 400;
    await wa.dispatchPendingWaOutbox({ limit: 1, workerId: "pr-i8-deny" });
    expect((await rowOf(row.id)).status).toBe("dead_letter");

    const retried = await wa.retryWaOutboxMessage(row.id);
    expect(retried, `a dead-lettered message must be retryable: ${JSON.stringify(retried)}`).toEqual({ ok: true });
    expect((await rowOf(row.id)).status).toBe("queued");

    provider.mode = "accept";
    await wa.dispatchPendingWaOutbox({ limit: 5, workerId: "pr-i8-retry-ok" });
    const r = await rowOf(row.id);
    expect(r.status, "the retry must actually put the message back in play").toBe("sent");
    expect(r.attempt_count, "the fresh budget is what a manual retry is for").toBe(1);
  });

});
