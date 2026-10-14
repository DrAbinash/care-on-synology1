// ============================================================================
// PR-I9 — the delivery answer must describe THIS report, not the batch.
//
// `emitReportToHope()` flushes the whole outbox and then reports the batch's
// aggregate counters as this report's `dispatched` (emitReportToHope.ts:392-398,
// and the same shape on the already-linked path at :226-231). The signing toast
// built on it (#994's `classifyHopeDeliveryResponse`) reads `dispatched.sent > 0`
// and prints "Sent to Hope".
//
// So when HOPE is down for one report and up for the next — the ordinary
// Monday-morning shape, one bad payload among a queue of good ones — the
// radiologist is told the bad one landed. Nothing was delivered for it; the
// counter belongs to a different patient's report. The brief's rule is exactly
// this: never label a report delivered on evidence that is not its own.
//
// Everything here is synthetic: marker-scoped referrals, `pr-i9-delivery:*`
// UUIDs, a stubbed HTTP endpoint at hope.invalid. No real HOPE and no real
// patient is contacted.
// ============================================================================
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const hasDb = !!DATABASE_URL;
const pool = new Pool({ connectionString: DATABASE_URL, max: 10 });

const MARKER = "pr-i9-delivery";
const uuidFor = (n: string) => `${MARKER}:${n}`;

let patientId = 0;
let testId = 0;

async function ensureBase() {
  const p = await pool.query(
    `INSERT INTO patients (patient_id, first_name, last_name, date_of_birth, gender, phone)
     VALUES ($1,'Delivery','Synthetic','1980-01-01','male','+00000000000')
     ON CONFLICT DO NOTHING RETURNING id`, [`${MARKER}-pat`]);
  patientId = Number(p.rows[0]?.id ?? (await pool.query(`SELECT id FROM patients WHERE patient_id = $1`, [`${MARKER}-pat`])).rows[0].id);
  const t = await pool.query(
    `INSERT INTO diagnostic_tests (code, name, category, price, duration)
     VALUES ($1,'PR-I9 Synthetic Test','radiology',100,'1 day')
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [`${MARKER}-test`]);
  testId = Number(t.rows[0].id);
}

/** A signed report on an order a Hope referral points at — the emitting input. */
async function insertSignedReport(name: string) {
  const refUuid = uuidFor(name);
  const ord = await pool.query(`INSERT INTO orders (order_number, patient_id) VALUES ($1,$2) RETURNING id`,
    [`${refUuid}-order`, patientId]);
  const careOrderId = Number(ord.rows[0].id);
  const ref = await pool.query(
    `INSERT INTO diagnostic_referrals (referral_uuid, source_patient_id, patient_name, status, care_order_id)
     VALUES ($1,$2,'PR-I9 Synthetic','IN_PROGRESS',$3) RETURNING id`, [refUuid, `${refUuid}-uhid`, careOrderId]);
  const rp = await pool.query(
    `INSERT INTO patient_reports (report_number, patient_id, test_id, order_id, type, status, title, is_critical, signed_by_name, signed_at)
     VALUES ($1,$2,$3,$4,'radiology','verified','PR-I9 synthetic signed report',false,'Dr Synthetic Signatory', now()) RETURNING id`,
    [`${refUuid}-rpt`, patientId, testId, careOrderId]);
  return { referralUuid: refUuid, referralId: Number(ref.rows[0].id), reportId: Number(rp.rows[0].id) };
}

/** What the durable rows actually say about one report's delivery. */
async function deliveryFacts(referralUuid: string) {
  const r = await pool.query(
    `SELECT o.status AS event_status, o.attempts, o.last_error, l.delivered_at
       FROM external_result_links l
       JOIN diagnostic_referrals f ON f.id = l.referral_id
       LEFT JOIN integration_outbox o ON o.id = l.emitted_outbox_id
      WHERE f.referral_uuid = $1`, [referralUuid]);
  return r.rows[0] ?? null;
}

async function clearAll() {
  await pool.query(`DELETE FROM integration_delivery_attempts WHERE outbox_id IN (SELECT id FROM integration_outbox WHERE correlation_id LIKE $1)`, [`${MARKER}%`]);
  await pool.query(`DELETE FROM external_result_links WHERE referral_id IN (SELECT id FROM diagnostic_referrals WHERE referral_uuid LIKE $1)`, [`${MARKER}%`]);
  await pool.query(`DELETE FROM integration_outbox WHERE correlation_id LIKE $1`, [`${MARKER}%`]);
  await pool.query(`DELETE FROM diagnostic_referral_events e USING diagnostic_referrals f WHERE f.id = e.referral_id AND f.referral_uuid LIKE $1`, [`${MARKER}%`]);
  await pool.query(`DELETE FROM patient_reports WHERE report_number LIKE $1`, [`${MARKER}%`]);
  await pool.query(`DELETE FROM diagnostic_referrals WHERE referral_uuid LIKE $1`, [`${MARKER}%`]);
  await pool.query(`DELETE FROM orders WHERE order_number LIKE $1`, [`${MARKER}%`]);
}

// ── the only mock in the file: the partner HTTP endpoint ─────────────────────
// Keyed on the correlation id inside the signed body, so "HOPE refuses this one
// report" is a property of the report, not of call order or timing.
const http = { calls: [] as string[], failNames: new Set<string>(), status: 500 };

function resetHttp() {
  http.calls = [];
  http.failNames = new Set();
  http.status = 500;
}

vi.stubGlobal("fetch", async (url: unknown, init?: { body?: string }) => {
  const body = String(init?.body ?? "");
  http.calls.push(body);
  const failing = [...http.failNames].find((n) => body.includes(uuidFor(n)));
  if (failing) {
    return { ok: false, status: http.status, json: async () => ({ error: "synthetic refusal" }), text: async () => `synthetic refusal for ${failing}` };
  }
  return { ok: true, status: 200, json: async () => ({ received: true }), text: async () => '{"received":true}' };
});

let emit: typeof import("./emitReportToHope");

beforeAll(async () => {
  if (!hasDb) return;
  await ensureBase();
  emit = await import("./emitReportToHope");
});

beforeEach(async () => {
  if (!hasDb) return;
  await clearAll();
  resetHttp();
  process.env.INTEGRATION_HOPE_CALLBACK_URL = "https://hope.invalid/callback";
  process.env.INTEGRATION_HOPE_SIGNING_SECRET = "synthetic-secret-not-a-secret";
});

afterEach(() => {
  delete process.env.INTEGRATION_HOPE_CALLBACK_URL;
  delete process.env.INTEGRATION_HOPE_SIGNING_SECRET;
});

afterAll(async () => {
  if (!hasDb) return;
  await clearAll();
  await pool.end();
});

const emitNow = (reportId: number) => emit.emitReportToHope({ reportId, worklistId: null, dispatchNow: true });

describe.skipIf(!hasDb)("emitReportToHope — delivery evidence belongs to the report it describes", () => {
  it("E1 — a report HOPE refused is not reported as sent just because the next one landed", async () => {
    const other = await insertSignedReport("other");
    const mine = await insertSignedReport("mine");
    // Queue the healthy report first, without flushing, so it is sitting in the
    // batch when the failing report is emitted.
    await emit.emitReportToHope({ reportId: other.reportId, worklistId: null, dispatchNow: false });

    http.failNames = new Set(["mine"]);
    const res = await emitNow(mine.reportId);
    expect(res.ok, `emit refused: ${JSON.stringify(res)}`).toBe(true);
    if (!res.ok) return;

    const facts = await deliveryFacts(mine.referralUuid);
    expect(facts?.event_status, "setup: this report's own event was never attempted")
      .not.toBe("sent");
    expect(res.dispatched?.sent ?? 0,
      `HOPE refused this report (${JSON.stringify(facts)}) but the emit reported ${JSON.stringify(res.dispatched)} — `
      + "a batch counter from another report's successful send")
      .toBe(0);
    expect((res.dispatched?.failed ?? 0) > 0, `a refused delivery must not report zero failures: ${JSON.stringify(res.dispatched)}`)
      .toBe(true);
    expect(facts?.delivered_at, "the link of a refused report must not be stamped delivered").toBeNull();

    // And the report that really landed keeps saying so — the fix must not turn
    // every answer into a shrug.
    const healthy = await deliveryFacts(other.referralUuid);
    expect(healthy?.event_status).toBe("sent");
    expect(healthy?.delivered_at, "a delivered report's link must carry the delivery timestamp").not.toBeNull();
  });

  it("E2 — the already-linked path answers for this report, not for the queue", async () => {
    const mine = await insertSignedReport("again-mine");
    const other = await insertSignedReport("again-other");
    // First emit: linked, event queued, deliberately not flushed.
    await emit.emitReportToHope({ reportId: mine.reportId, worklistId: null, dispatchNow: false });
    await emit.emitReportToHope({ reportId: other.reportId, worklistId: null, dispatchNow: false });

    http.failNames = new Set(["again-mine"]);
    // Second emit hits `alreadySent`, which still flushes the queue — and the
    // operator is told about whichever report the flush happened to finish.
    const res = await emitNow(mine.reportId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.alreadySent, "setup: this is the already-linked path").toBe(true);

    expect(res.dispatched?.sent ?? 0,
      `an already-linked but never-delivered report was reported as on Hope from another report's send: ${JSON.stringify(res.dispatched)}`)
      .toBe(0);
    const facts = await deliveryFacts(mine.referralUuid);
    expect(facts?.delivered_at, `the link says delivered although the event did not land: ${JSON.stringify(facts)}`)
      .toBeNull();
  });

  it("E3 — a report whose retries ran out is reported as stopped, not as queued", async () => {
    const mine = await insertSignedReport("exhausted");
    const other = await insertSignedReport("healthy");
    await emit.emitReportToHope({ reportId: mine.reportId, worklistId: null, dispatchNow: false });
    await emit.emitReportToHope({ reportId: other.reportId, worklistId: null, dispatchNow: false });
    // One attempt left: the next refusal is terminal, which is the state that must
    // reach a human. (No HTTP failure dead-letters on attempt 1 — outbox.ts:400
    // retries every non-2xx until the budget is gone — so the budget is set here.)
    await pool.query(`UPDATE integration_outbox SET max_attempts = 1 WHERE correlation_id = $1`, [uuidFor("exhausted")]);

    http.failNames = new Set(["exhausted"]);
    const res = await emitNow(mine.reportId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const facts = await deliveryFacts(mine.referralUuid);
    expect(facts?.event_status, "setup: the exhausted event did not dead-letter").toBe("dead");
    expect(res.dispatched?.sent ?? 0,
      `a dead-lettered report reported a successful send taken from the batch: ${JSON.stringify(res.dispatched)}`)
      .toBe(0);
    expect(res.dispatched?.dead ?? 0,
      "the operator's answer cannot distinguish 'will be retried' from 'gave up', and this one gave up")
      .toBe(1);
  });

  it("E4 — a report that really did land still reports that it landed", async () => {
    const mine = await insertSignedReport("clean");
    const res = await emitNow(mine.reportId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.dispatched?.sent ?? 0, `a delivered report must not be downgraded: ${JSON.stringify(res)}`).toBe(1);
    expect(res.dispatched?.dead ?? 0).toBe(0);
    const facts = await deliveryFacts(mine.referralUuid);
    expect(facts?.event_status).toBe("sent");
    expect(facts?.delivered_at).not.toBeNull();
  });

  it("E5 — nothing is claimed as delivered that the durable rows do not agree with", async () => {
    const mine = await insertSignedReport("two-of-us");
    const other = await insertSignedReport("confounder");
    await emit.emitReportToHope({ reportId: other.reportId, worklistId: null, dispatchNow: false });
    http.failNames = new Set(["two-of-us"]);
    http.status = 502;

    const res = await emitNow(mine.reportId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const facts = await deliveryFacts(mine.referralUuid);
    const claimsDelivered = (res.dispatched?.sent ?? 0) > 0;
    expect(claimsDelivered === (facts?.event_status === "sent" && facts?.delivered_at !== null),
      `the emit answered ${JSON.stringify(res.dispatched)} while the rows say ${JSON.stringify(facts)}`)
      .toBe(true);
    expect(claimsDelivered, "setup: a 502 must not have delivered this report").toBe(false);
  });

  it("E6 — a report HOPE already has stays reported as delivered when its event is re-queued", async () => {
    // `retryOutboxEvent` (outbox.ts:439) accepts any id with no status guard, so an
    // admin pressing Retry on a row that already landed puts that event back to
    // `pending` while `external_result_links.delivered_at` keeps saying HOPE has the
    // report. Evidence read from the event alone would then claim it was undelivered
    // — a false alarm about a delivered result. The link is the durable fact.
    const mine = await insertSignedReport("retried-after-delivery");
    const first = await emitNow(mine.reportId);
    expect(first.ok && first.dispatched?.sent,
      `setup: this report should have been delivered: ${JSON.stringify(first)}`).toBe(1);
    expect((await deliveryFacts(mine.referralUuid)).delivered_at, "setup: no delivery timestamp").not.toBeNull();

    await pool.query(
      `UPDATE integration_outbox SET status='pending', attempts=0, next_attempt_at = NOW() + interval '1 hour'
        WHERE correlation_id = $1`, [mine.referralUuid]);

    const again = await emitNow(mine.reportId);
    expect(again.ok && again.alreadySent, "setup: the report is still linked").toBe(true);
    if (!again.ok) return;
    expect((await deliveryFacts(mine.referralUuid)).event_status, "setup: the event was not re-queued")
      .toBe("pending");
    expect(again.dispatched?.sent ?? 0,
      `HOPE has this report but the re-queued event made the emit answer ${JSON.stringify(again.dispatched)}`)
      .toBe(1);
  });
});
