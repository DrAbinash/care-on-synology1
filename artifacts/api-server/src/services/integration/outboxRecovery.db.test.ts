// ============================================================================
// PR-I2 — abandoned outbox delivery recovery.
//
// Runs against a REAL PostgreSQL (scratch cluster, synthetic rows only) because the
// guarantees under test are Postgres guarantees: `FOR UPDATE SKIP LOCKED` claim
// separation, lease expiry, and attempt accounting. A mocked db would only re-assert
// the shape of the query string, which is exactly the evidence that must not be
// claimed from a source assertion. The partner HTTP endpoint is the only mock.
//
// Rows are marker-scoped and deleted after each test, so nothing here depends on, or
// disturbs, any other session's data.
// ============================================================================
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const hasDb = !!DATABASE_URL;

const pool = new Pool({ connectionString: DATABASE_URL, max: 10 });

const MARKER = "pr-i2-outbox-recovery";
const eventIdFor = (n: string) => `${MARKER}:${n}`;

interface HopCall {
  url: string;
  eventId: string | null;
  headerEventId: string | null;
  body: string;
}

let calls: HopCall[] = [];
/** `http422` is HOPE's I11-D refusal: a permanent non-success it answers for an event
 *  type or envelope version it cannot interpret. */
let failMode: "none" | "timeout" | "http500" | "http422" = "none";
/** Per-test seam: runs inside the fake HOPE endpoint, so the test can observe or
 *  disturb outbox state at the exact moment a delivery is in flight. */
let onCall: ((eventId: string | null) => Promise<void>) | null = null;

/** Emulates HOPE's callback endpoint; records every delivery attempt. */
const fetchStub = vi.fn(async (input: unknown, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
  const url = String(input);
  const body = init?.body ?? "";
  const headers = init?.headers ?? {};
  let parsed: { eventId?: string } = {};
  try { parsed = JSON.parse(body); } catch { /* not json */ }
  calls.push({ url, eventId: parsed.eventId ?? null, headerEventId: headers["x-care-event-id"] ?? null, body });
  if (onCall) await onCall(parsed.eventId ?? null);
  if (failMode === "timeout") return Promise.reject(new Error("aborted"));
  if (failMode === "http500") {
    return { status: 500, ok: false, text: async () => "hope exploded" } as unknown as Response;
  }
  if (failMode === "http422") {
    // HOPE's compatibility refusal, verbatim in shape: permanent-by-status, with the
    // reason the sender cannot mistake for a delivery.
    return {
      status: 422,
      ok: false,
      text: async () => '{"ok":false,"error":"unsupported_event_type"}',
    } as unknown as Response;
  }
  return { status: 200, ok: true, text: async () => '{"ok":true}' } as unknown as Response;
});

async function insertOutbox(row: {
  name: string;
  eventType?: string;
  status?: string;
  attempts?: number;
  maxAttempts?: number;
  lockedAgoMs?: number | null;
  lockedBy?: string | null;
  nextAgoMs?: number | null;
  payload?: Record<string, unknown>;
  partnerId?: number | null;
}) {
  const next = row.nextAgoMs == null ? "NOW()" : `NOW() - (${row.nextAgoMs} || ' milliseconds')::interval`;
  const locked = row.lockedAgoMs == null ? "NULL" : `NOW() - (${row.lockedAgoMs} || ' milliseconds')::interval`;
  const res = await pool.query(
    `INSERT INTO integration_outbox
       (event_id, event_type, idempotency_key, aggregate_id, payload, status, attempts, max_attempts,
        next_attempt_at, locked_at, locked_by, partner_id, created_at)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,${next},${locked},$9,$10,NOW())
     RETURNING id`,
    [
      eventIdFor(row.name),
      row.eventType ?? "diagnostic_report.finalised",
      `${eventIdFor(row.name)}:key`,
      `${MARKER}-agg`,
      JSON.stringify(row.payload ?? { referralUuid: `${MARKER}-referral`, reportNumber: "R-1" }),
      row.status ?? "pending",
      row.attempts ?? 0,
      row.maxAttempts ?? 8,
      row.lockedBy ?? null,
      row.partnerId ?? null,
    ],
  );
  return Number(res.rows[0].id);
}

async function readOutbox(name: string) {
  const r = await pool.query(
    `SELECT id, status, attempts, max_attempts, last_error, locked_at, locked_by, sent_at, next_attempt_at
       FROM integration_outbox WHERE event_id = $1`,
    [eventIdFor(name)],
  );
  return r.rows[0] ?? null;
}

async function attemptsFor(name: string) {
  const r = await pool.query(
    `SELECT a.attempt_no, a.status, a.error FROM integration_delivery_attempts a
       JOIN integration_outbox o ON o.id = a.outbox_id
      WHERE o.event_id = $1 ORDER BY a.id ASC`,
    [eventIdFor(name)],
  );
  return r.rows as Array<{ attempt_no: number; status: string; error: string | null }>;
}

async function clearRows() {
  await pool.query(
    `DELETE FROM integration_delivery_attempts WHERE outbox_id IN (SELECT id FROM integration_outbox WHERE event_id LIKE $1)`,
    [`${MARKER}:%`],
  );
  await pool.query(
    `DELETE FROM external_result_links WHERE referral_id IN (SELECT id FROM diagnostic_referrals WHERE referral_uuid LIKE $1)`,
    [`${MARKER}:%`],
  );
  await pool.query(`DELETE FROM diagnostic_referrals WHERE referral_uuid LIKE $1`, [`${MARKER}:%`]);
  await pool.query(`DELETE FROM electronic_film_artifacts WHERE source_job_key LIKE $1`, [`${MARKER}:%`]);
  await pool.query(`DELETE FROM integration_outbox WHERE event_id LIKE $1`, [`${MARKER}:%`]);
  await pool.query(`DELETE FROM integration_partners WHERE code = 'PARTNERI2B'`);
}

/**
 * A referral + the result link that records this event as the one carrying the
 * report to HOPE. `external_result_links.delivered_at` is the field a clinician
 * and the admin view read as "HOPE has this report", so a rejected delivery must
 * not stamp it.
 */
async function attachResultLink(name: string, outboxId: number) {
  const ref = await pool.query(
    `INSERT INTO diagnostic_referrals (referral_uuid, source_patient_id, patient_name)
     VALUES ($1,$2,'PR-I2B synthetic') RETURNING id`,
    [eventIdFor(name), `${MARKER}-pat`],
  );
  const link = await pool.query(
    `INSERT INTO external_result_links (referral_id, emitted_outbox_id, result_type, delivered_at)
     VALUES ($1,$2,'radiology',NULL) RETURNING id`,
    [ref.rows[0].id, outboxId],
  );
  return Number(link.rows[0].id);
}

async function readLinkDeliveredAt(name: string) {
  const r = await pool.query(
    `SELECT l.delivered_at FROM external_result_links l
       JOIN diagnostic_referrals f ON f.id = l.referral_id
      WHERE f.referral_uuid = $1`,
    [eventIdFor(name)],
  );
  return r.rows[0]?.delivered_at ?? null;
}

/** A film artifact whose delivery state the success branch advances. */
async function attachFilmArtifact(name: string, outboxId: number) {
  const r = await pool.query(
    `INSERT INTO electronic_film_artifacts (source_job_key, emitted_outbox_id, hope_delivery_status)
     VALUES ($1,$2,NULL) RETURNING id`,
    [eventIdFor(name), outboxId],
  );
  return Number(r.rows[0].id);
}

async function readFilm(artifactId: number) {
  const r = await pool.query(
    `SELECT hope_delivery_status, hope_sent_at, error_message, ingest_status
       FROM electronic_film_artifacts WHERE id = $1`,
    [artifactId],
  );
  return r.rows[0] ?? null;
}

/**
 * Hand the event to another worker while the current delivery is in flight — the
 * Phase 2 scenario: A claims, A POSTs, A stalls, the lease lapses, B takes over.
 */
async function handOverTo(eventId: string, worker: string) {
  await pool.query(
    `UPDATE integration_outbox SET status='sending', locked_by=$2, locked_at=NOW() WHERE event_id=$1`,
    [eventId, worker],
  );
}

async function freshDispatch(mod: typeof import("./outbox"), opts: Parameters<typeof mod.dispatchPendingOutbox>[0]) {
  return mod.dispatchPendingOutbox(opts);
}

// Imported lazily so DATABASE_URL is already in the environment when @workspace/db
// evaluates its pool.
let outbox: typeof import("./outbox");

beforeAll(async () => {
  if (!hasDb) return;
  outbox = await import("./outbox");
});

beforeEach(async () => {
  calls = [];
  failMode = "none";
  onCall = null;
  vi.stubGlobal("fetch", fetchStub);
  process.env.INTEGRATION_HOPE_CALLBACK_URL = "https://hope.invalid/callback";
  process.env.INTEGRATION_HOPE_SIGNING_SECRET = "synthetic-secret";
  if (!hasDb) return;
  await clearRows();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  if (!hasDb) return;
  await clearRows();
});

afterAll(async () => {
  if (hasDb) await pool.end();
});

const suite = hasDb ? describe : describe.skip;

// `dispatchPendingOutbox` claims by database state, not by test ownership, so in a
// full-suite run it can also pick up a pending event another test file left behind.
// Two consequences are handled explicitly: `claimed`/`sent` are only ever asserted
// with `>=` or beside a marker-row read that carries the actual claim, and any
// assertion about "how many times was this delivered" filters `calls` by marker.
// Verified: no other test file in this repository inserts a `sending` outbox row, so
// the reclaim counts (`recovered`, `dead`) stay exact.

suite("PR-I2 outbox abandoned-delivery recovery (real PostgreSQL)", () => {
  it("Test 1 — a pending event is claimed, delivered once, and becomes sent", async () => {
    const id = await insertOutbox({ name: "t1" });
    const r = await freshDispatch(outbox, { workerId: "w1", limit: 50 });

    expect(r.claimed).toBeGreaterThanOrEqual(1);
    expect(r.sent).toBeGreaterThanOrEqual(1);
    const row = await readOutbox("t1");
    expect(row.status).toBe("sent");
    expect(row.sent_at).not.toBeNull();
    expect(row.locked_by).toBeNull();
    expect(row.attempts).toBe(1);
    // exactly one POST for this event, no duplicate dispatch
    expect(calls.filter((c) => c.eventId === eventIdFor("t1"))).toHaveLength(1);
    expect(id).toBeGreaterThan(0);
  });

  it("Test 2 — an event abandoned in 'sending' is recovered, not stranded", async () => {
    // A worker that died after claiming and before any write-back. locked_at is 10
    // minutes old, far beyond any lease.
    await insertOutbox({ name: "t2", status: "sending", attempts: 1, lockedBy: "dead-worker", lockedAgoMs: 600_000 });

    const r = await freshDispatch(outbox, { workerId: "w1", limit: 50 });

    expect(r.recovered).toBe(1);
    const row = await readOutbox("t2");
    // Not 'sent' — recovery must never invent a confirmed delivery.
    expect(row.status).toBe("pending");
    expect(row.sent_at).toBeNull();
    expect(row.attempts).toBe(2);
    expect(row.last_error).toBe("delivery_abandoned");
    expect(row.locked_by).toBeNull();
    // Backoff is honoured, so it is eligible shortly rather than instantly.
    expect(new Date(row.next_attempt_at).getTime()).toBeGreaterThan(Date.now());

    // And it actually moves again: once eligible, it is delivered.
    await pool.query(`UPDATE integration_outbox SET next_attempt_at = NOW() - interval '1 second' WHERE event_id = $1`, [eventIdFor("t2")]);
    await freshDispatch(outbox, { workerId: "w1", limit: 50 });
    const after = await readOutbox("t2");
    expect(after.status).toBe("sent");
    expect(calls.filter((c) => c.eventId === eventIdFor("t2"))).toHaveLength(1);
  });

  it("Test 3 — a healthy worker's in-flight event is never reclaimed", async () => {
    // Same 'sending' state as Test 2, but the lease is young: ownership is live.
    await insertOutbox({ name: "t3", status: "sending", attempts: 1, lockedBy: "alive-worker", lockedAgoMs: 1_000 });

    const r = await freshDispatch(outbox, { workerId: "thief", limit: 50 });

    expect(r.recovered).toBe(0);
    const row = await readOutbox("t3");
    expect(row.status).toBe("sending");
    expect(row.locked_by).toBe("alive-worker");
    expect(row.attempts).toBe(1);
    expect(row.last_error).toBeNull();
    expect(calls.filter((c) => c.eventId === eventIdFor("t3"))).toHaveLength(0);
  });

  it("Test 4 — a lease that has expired is reclaimed according to the policy", async () => {
    await insertOutbox({ name: "t4", status: "sending", attempts: 0, lockedBy: "gone", lockedAgoMs: 300_000 });
    // A short explicit lease proves the predicate is honoured, not hard-coded.
    const r = await freshDispatch(outbox, { workerId: "w2", limit: 50, staleLeaseMs: 60_000 });
    expect(r.recovered).toBe(1);
    const row = await readOutbox("t4");
    expect(row.status).toBe("pending");
    expect(row.locked_at).toBeNull();

    // And the same row at 1s old is left alone under the same explicit lease.
    await pool.query(
      `UPDATE integration_outbox SET status='sending', locked_by='w3', locked_at = NOW() - interval '1 seconds' WHERE event_id = $1`,
      [eventIdFor("t4")],
    );
    const r2 = await freshDispatch(outbox, { workerId: "w2", limit: 50, staleLeaseMs: 60_000 });
    expect(r2.recovered).toBe(0);
    expect((await readOutbox("t4")).locked_by).toBe("w3");
  });

  it("Test 5 — two concurrent dispatchers: one claim each, no double delivery, one reclaim each", async () => {
    for (const n of ["a", "b", "c", "d", "e"]) await insertOutbox({ name: `t5-${n}` });
    await insertOutbox({ name: "t5-stale", status: "sending", attempts: 1, lockedBy: "ghost", lockedAgoMs: 600_000 });

    const [x, y] = await Promise.all([
      freshDispatch(outbox, { workerId: "A", limit: 50 }),
      freshDispatch(outbox, { workerId: "B", limit: 50 }),
    ]);

    // Five fresh events, delivered exactly once between the two workers.
    const perEvent = calls.filter((c) => c.eventId?.startsWith(`${eventIdFor("t5-")}`) && c.eventId !== eventIdFor("t5-stale"));
    const unique = new Set(perEvent.map((c) => c.eventId));
    expect(perEvent.length).toBe(unique.size);
    expect(unique.size).toBe(5);

    // The abandoned row is recovered by exactly one dispatcher: the attempt counter
    // moved by one, not two, which is what SKIP LOCKED is supposed to buy.
    const stale = await readOutbox("t5-stale");
    expect(stale.attempts).toBe(2);
    expect(x.recovered + y.recovered).toBe(1);

    for (const n of ["a", "b", "c", "d", "e"]) expect((await readOutbox(`t5-${n}`)).status).toBe("sent");
  });

  it("Test 6 — a recovered event that exhausts its budget dead-letters instead of looping", async () => {
    // attempts=7, max=8 → the reclaim's charged attempt is the 8th → dead.
    await insertOutbox({ name: "t6", status: "sending", attempts: 7, maxAttempts: 8, lockedBy: "ghost", lockedAgoMs: 600_000 });
    const r = await freshDispatch(outbox, { workerId: "w1", limit: 50 });

    const row = await readOutbox("t6");
    expect(row.status).toBe("dead");
    expect(row.attempts).toBe(8);
    expect(row.sent_at).toBeNull();
    expect(r.dead).toBe(1);
    expect(calls.filter((c) => c.eventId === eventIdFor("t6"))).toHaveLength(0);

    // A second dispatch must not resurrect or loop it.
    await freshDispatch(outbox, { workerId: "w1", limit: 50 });
    expect((await readOutbox("t6")).status).toBe("dead");
  });

  it("Test 7 — recovery re-sends the SAME event_id, so HOPE dedupes rather than duplicating the report", async () => {
    await insertOutbox({ name: "t7", status: "sending", attempts: 0, lockedBy: "ghost", lockedAgoMs: 600_000 });
    await freshDispatch(outbox, { workerId: "w1", limit: 50, staleLeaseMs: 60_000 });
    await pool.query(`UPDATE integration_outbox SET next_attempt_at = NOW() - interval '1 second' WHERE event_id = $1`, [eventIdFor("t7")]);
    await freshDispatch(outbox, { workerId: "w1", limit: 50, staleLeaseMs: 60_000 });

    const row = await readOutbox("t7");
    expect(row.status).toBe("sent");

    const delivered = calls.filter((c) => c.eventId === eventIdFor("t7"));
    expect(delivered.length).toBeGreaterThanOrEqual(1);
    // The identifier HOPE dedupes on is stable across the reclaim, in both the body
    // and the signature header. This is the CARE-side half of at-least-once; the
    // receiver's dedupe is documented but lives outside this repository.
    for (const d of delivered) {
      expect(d.eventId).toBe(eventIdFor("t7"));
      expect(d.headerEventId).toBe(eventIdFor("t7"));
    }
    // One outbox event, one aggregate — no second event was minted by recovering.
    const count = await pool.query(`SELECT count(*)::int AS n FROM integration_outbox WHERE event_id = $1`, [eventIdFor("t7")]);
    expect(count.rows[0].n).toBe(1);
  });

  it("Test 8 — missing HOPE configuration keeps its existing deliberate never-dead-letter policy", async () => {
    delete process.env.INTEGRATION_HOPE_CALLBACK_URL;
    delete process.env.INTEGRATION_HOPE_SIGNING_SECRET;
    // attempts already past the budget: a real failure would dead-letter here.
    await insertOutbox({ name: "t8", attempts: 9, maxAttempts: 8 });

    const r = await freshDispatch(outbox, { workerId: "w1", limit: 50 });

    const row = await readOutbox("t8");
    expect(row.status).toBe("pending");
    expect(row.last_error).toBe("delivery_not_configured");
    expect(r.dead).toBe(0);
    expect(row.sent_at).toBeNull();
  });

  it("Test 9 — an administrator's manual retry still works", async () => {
    const id = await insertOutbox({ name: "t9", status: "dead", attempts: 8, maxAttempts: 8 });
    await outbox.retryOutboxEvent(id);

    const before = await readOutbox("t9");
    expect(before.status).toBe("pending");
    expect(before.locked_by).toBeNull();

    await pool.query(`UPDATE integration_outbox SET next_attempt_at = NOW() - interval '1 second' WHERE event_id = $1`, [eventIdFor("t9")]);
    await freshDispatch(outbox, { workerId: "w1", limit: 50 });
    expect((await readOutbox("t9")).status).toBe("sent");
  });

  it("Test 10 — recovery and the later delivery are both auditable; history is not erased", async () => {
    await insertOutbox({ name: "t10", status: "sending", attempts: 2, lockedBy: "ghost", lockedAgoMs: 600_000 });
    // Give it a pre-existing attempt record so we can prove nothing is overwritten.
    await pool.query(
      `INSERT INTO integration_delivery_attempts (outbox_id, attempt_no, status, error, duration_ms)
       SELECT id, 1, 'failure', 'http_503', 12 FROM integration_outbox WHERE event_id = $1`,
      [eventIdFor("t10")],
    );

    await freshDispatch(outbox, { workerId: "w1", limit: 50, staleLeaseMs: 60_000 });
    await pool.query(`UPDATE integration_outbox SET next_attempt_at = NOW() - interval '1 second' WHERE event_id = $1`, [eventIdFor("t10")]);
    await freshDispatch(outbox, { workerId: "w1", limit: 50, staleLeaseMs: 60_000 });

    const rows = await attemptsFor("t10");
    expect(rows.some((x) => x.attempt_no === 1 && x.error === "http_503")).toBe(true);
    expect(rows.some((x) => x.error === "delivery_abandoned")).toBe(true);
    expect(rows.some((x) => x.status === "success")).toBe(true);
    // Monotonic attempt numbering, no gap created by the reclaim.
    expect(new Set(rows.map((x) => x.attempt_no)).size).toBe(rows.length);
  });

  it("Test 11 — recovery is type-agnostic and does not disturb other event types", async () => {
    await insertOutbox({ name: "t11-film", eventType: "diagnostic_electronic_film.available", payload: { careFilmArtifactId: null } });
    await insertOutbox({ name: "t11-order", eventType: "diagnostic_order.created", payload: { referralUuid: "x" } });
    await insertOutbox({ name: "t11-stuck", eventType: "diagnostic_referral.status_changed", status: "sending", attempts: 0, lockedBy: "ghost", lockedAgoMs: 600_000 });

    const r = await freshDispatch(outbox, { workerId: "w1", limit: 50, staleLeaseMs: 60_000 });
    expect(r.recovered).toBe(1);

    // The abandoned non-report event is recoverable too — the reclaim keys on lease
    // state, never on event type.
    expect((await readOutbox("t11-stuck")).status).toBe("pending");

    await pool.query(`UPDATE integration_outbox SET next_attempt_at = NOW() - interval '1 second' WHERE event_id LIKE $1`, [`${MARKER}%`]);
    await freshDispatch(outbox, { workerId: "w1", limit: 50, staleLeaseMs: 60_000 });

    expect((await readOutbox("t11-film")).status).toBe("sent");
    expect((await readOutbox("t11-order")).status).toBe("sent");
    expect((await readOutbox("t11-stuck")).status).toBe("sent");
  });

  it("Test 12 — after a worker restart the abandoned job moves again with no admin action", async () => {
    // 'gone-1234' is the previous process. The new dispatcher has a different workerId
    // and there is no Retry click in this test at all.
    await insertOutbox({ name: "t12", status: "sending", attempts: 1, lockedBy: "gone-1234", lockedAgoMs: 600_000 });

    await freshDispatch(outbox, { workerId: "restarted-9999", limit: 50, staleLeaseMs: 60_000 });
    expect((await readOutbox("t12")).status).toBe("pending");

    await pool.query(`UPDATE integration_outbox SET next_attempt_at = NOW() - interval '1 second' WHERE event_id = $1`, [eventIdFor("t12")]);
    await freshDispatch(outbox, { workerId: "restarted-9999", limit: 50, staleLeaseMs: 60_000 });

    const row = await readOutbox("t12");
    expect(row.status).toBe("sent");
    expect(row.locked_by).toBeNull();
    expect(row.locked_at).toBeNull();
  });

  it("Test 13 — a row another worker took over is never POSTed by us", async () => {
    // Fault injection at the honest point: the dispatcher holds three rows, is inside
    // one delivery, and the two it has not reached yet are handed to a different
    // worker. The pre-delivery ownership check is what stands between that and two
    // signed reports arriving at HOPE, so this drives the real product guard rather
    // than re-implementing its WHERE clause in the test.
    for (const n of ["g1", "g2", "g3"]) await insertOutbox({ name: n });
    onCall = async (eventId) => {
      await pool.query(
        `UPDATE integration_outbox SET locked_by = 'other-worker'
          WHERE event_id LIKE $1 AND event_id <> $2 AND status = 'sending'`,
        [`${MARKER}:%`, eventId],
      );
    };

    const r = await freshDispatch(outbox, { workerId: "us", limit: 50 });

    // We delivered the one row we still owned and stopped. Marker-filtered because a
    // concurrent test file's pending event could ride along in the same batch.
    const mine = calls.filter((c) => c.eventId?.startsWith(`${MARKER}:`));
    expect(mine).toHaveLength(1);
    expect(r.claimed).toBeGreaterThanOrEqual(3);
    expect(r.sent).toBeGreaterThanOrEqual(1);
    expect(r.failed).toBe(0);
    expect(r.recovered).toBe(0);

    const all = await pool.query(
      `SELECT event_id, status, locked_by, attempts, last_error, sent_at FROM integration_outbox
        WHERE event_id LIKE $1 ORDER BY event_id`,
      [`${MARKER}:%`],
    );
    const sent = all.rows.filter((x) => x.status === "sent");
    const handedOver = all.rows.filter((x) => x.status === "sending");
    expect(sent).toHaveLength(1);
    expect(handedOver).toHaveLength(2);
    // The other worker's rows are left exactly as it set them: no result of ours is
    // written on top of a lease we no longer hold.
    for (const h of handedOver) {
      expect(h.locked_by).toBe("other-worker");
      expect(h.attempts).toBe(0);
      expect(h.last_error).toBeNull();
      expect(h.sent_at).toBeNull();
    }
  });

  it("Test 14 — a slow batch keeps every row it holds inside its lease", async () => {
    // The reclaim keys on `locked_at`, so the stamp must mean "my owner touched this
    // row recently" for EVERY row still waiting, not only the one being sent. If it
    // does not, a healthy dispatcher at limit 50 x 15s sees its own queued rows lapse
    // at 90s and get delivered twice by the next tick — a duplicate the recovery
    // feature itself would cause.
    //
    // Rows are made to fail so they stay in the batch, and each delivery is held open
    // long enough that a shared stamp would be visibly identical.
    for (const n of ["h1", "h2", "h3"]) await insertOutbox({ name: n });
    failMode = "http500";
    const stamps: number[] = [];
    onCall = async (eventId) => {
      const held = await pool.query(
        `SELECT max(locked_at) AS m FROM integration_outbox
          WHERE event_id LIKE $1 AND status = 'sending' AND event_id <> $2`,
        [`${MARKER}:%`, eventId],
      );
      if (held.rows[0]?.m) stamps.push(new Date(held.rows[0].m).getTime());
      await new Promise((res) => setTimeout(res, 300));
    };

    await freshDispatch(outbox, { workerId: "slow", limit: 50 });

    // At least two rows were observed while others were still queued, and the stamp
    // on those queued rows moved on between observations.
    expect(stamps.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < stamps.length; i++) {
      expect(stamps[i] - stamps[i - 1]).toBeGreaterThanOrEqual(100);
    }
  });

  it("Test 15 — each dispatch identifies itself, so ownership can distinguish it", async () => {
    // cron.tickOutbox is fire-and-forget, so two batches from one process overlap.
    // `locked_by` is the only name a reclaiming worker can be checked against, so a
    // PID-only identity would let the second batch pass the ownership guard on rows
    // the first batch still holds.
    for (const n of ["id1", "id2"]) await insertOutbox({ name: n });
    const owners: string[] = [];
    onCall = async (eventId) => {
      const r = await pool.query(`SELECT locked_by FROM integration_outbox WHERE event_id = $1`, [eventId]);
      owners.push(r.rows[0]?.locked_by ?? "");
    };

    await freshDispatch(outbox, { limit: 1 });
    await freshDispatch(outbox, { limit: 1 });

    expect(owners).toHaveLength(2);
    for (const o of owners) expect(o).toMatch(/^care-\d+-/);
    expect(new Set(owners).size).toBe(2);
  });

  it("the default lease is comfortably longer than one row's delivery bound", () => {
    // 15s HTTP abort -> lease must be several multiples, or a slow-but-alive worker
    // would have its event delivered twice. This pins the invariant, not the number.
    expect(outbox.staleLeaseMs(15_000)).toBeGreaterThanOrEqual(3 * 15_000);
    expect(outbox.staleLeaseMs(60_000)).toBeGreaterThanOrEqual(3 * 60_000);
  });

  // ==========================================================================
  // PR-I2B — write-back ownership.
  //
  // PR #995 guards the POST: a worker that no longer holds an event does not send
  // it. It does not guard what happens AFTER a worker has sent it: every result
  // write-back was `UPDATE … WHERE id = ?`, so a worker whose lease lapsed while it
  // was inside HTTP could still write `sent`, `pending` or `dead` over the state of
  // the worker that legitimately owns the event now — including the two fields that
  // tell a clinician HOPE has the report (`external_result_links.delivered_at`,
  // `electronic_film_artifacts.hope_delivery_status`).
  //
  // These tests take over ownership from inside the fake HOPE endpoint, i.e. after
  // the guard has been passed and before the write-back runs. That is the whole
  // window the guard cannot cover, and the reason a pre-delivery check is not an
  // ownership proof for a post-delivery write.
  // ==========================================================================

  const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

  it("Test 16 — an HTTP 200 arriving after ownership moved cannot mark the report delivered", async () => {
    const id = await insertOutbox({ name: "f2b-sent", eventType: "diagnostic_electronic_film.available", payload: { careFilmArtifactId: 0 } });
    await attachResultLink("f2b-sent", id);
    const artifactId = await attachFilmArtifact("f2b-sent", id);
    await pool.query(`UPDATE integration_outbox SET payload = jsonb_set(payload,'{careFilmArtifactId}',$2::jsonb) WHERE id = $1`, [id, String(artifactId)]);

    // Ownership passes to B while A's request is in flight, then A gets a 200.
    onCall = async (ev) => { if (ev) await handOverTo(ev, "worker-B"); };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let r!: Awaited<ReturnType<typeof outbox.dispatchPendingOutbox>>;
    let warned: string[] = [];
    try {
      r = await freshDispatch(outbox, { workerId: "worker-A", limit: 50 });
      warned = warn.mock.calls.flat().map(String);
    } finally {
      warn.mockRestore();
    }
    const row = await readOutbox("f2b-sent");

    // The event is not marked delivered by a worker that no longer owns it.
    expect(row.status).toBe("sending");
    expect(row.sent_at).toBeNull();
    expect(row.attempts).toBe(0);
    expect(row.last_error).toBeNull();
    // B's lock is intact: A neither overwrites the owner nor clears it.
    expect(row.locked_by).toBe("worker-B");
    expect(row.locked_at).not.toBeNull();
    // The two fields that read as "HOPE has this report" are untouched.
    expect(await readLinkDeliveredAt("f2b-sent")).toBeNull();
    expect((await readFilm(artifactId)).hope_delivery_status).toBeNull();
    // Not counted as a delivery, and visible as a conflict rather than silent.
    expect(r.sent).toBe(0);
    expect(r.conflicts).toBe(1);
    expect(warned.some((x) => /worker-B|owner|reclaim/i.test(x))).toBe(true);
    // Attempt history may record what this worker observed, but never as an
    // unqualified confirmed delivery: no bare `success` row for a rejected write.
    const rows = await attemptsFor("f2b-sent");
    expect(rows.every((x) => !(x.status === "success" && x.error === null))).toBe(true);
  });

  it("Test 17 — an HTTP 500 arriving after ownership moved cannot change the owner's state", async () => {
    const id = await insertOutbox({ name: "f2b-fail" });
    onCall = async (ev) => {
      if (!ev) return;
      // B has already tried and recorded its own outcome.
      await pool.query(
        `UPDATE integration_outbox SET status='sending', locked_by='worker-B', locked_at=NOW(), attempts=5, last_error='http_503' WHERE event_id=$1`,
        [ev],
      );
    };
    failMode = "http500";

    const r = await freshDispatch(outbox, { workerId: "worker-A", limit: 50 });
    const row = await readOutbox("f2b-fail");

    expect(row.status).toBe("sending");
    expect(row.locked_by).toBe("worker-B");
    expect(row.attempts).toBe(5);
    expect(row.last_error).toBe("http_503");
    expect(r.failed).toBe(0);
    expect(r.conflicts).toBe(1);
    expect(id).toBeGreaterThan(0);
  });

  it("Test 18 — a timeout after ownership moved cannot reset the event to pending or dead", async () => {
    // attempts 7/8: a legitimate timeout here dead-letters, so this also proves the
    // stale worker cannot dead-letter work it no longer holds.
    await insertOutbox({ name: "f2b-timeout", attempts: 7, maxAttempts: 8 });
    onCall = async (ev) => {
      if (!ev) return;
      await pool.query(
        `UPDATE integration_outbox SET status='sending', locked_by='worker-B', locked_at=NOW(), attempts=5, last_error='http_503' WHERE event_id=$1`,
        [ev],
      );
    };
    failMode = "timeout";

    const r = await freshDispatch(outbox, { workerId: "worker-A", limit: 50 });
    const row = await readOutbox("f2b-timeout");

    expect(row.status).toBe("sending");
    expect(row.attempts).toBe(5);
    expect(row.locked_by).toBe("worker-B");
    expect(r.dead).toBe(0);
    expect(r.conflicts).toBe(1);
  });

  it("Test 19 — a stale success cannot bring a dead-lettered event back to life", async () => {
    const id = await insertOutbox({ name: "f2b-dead" });
    await attachResultLink("f2b-dead", id);
    onCall = async (ev) => {
      if (!ev) return;
      await pool.query(
        `UPDATE integration_outbox SET status='dead', locked_by=NULL, locked_at=NULL, attempts=8, last_error='http_500', sent_at=NULL WHERE event_id=$1`,
        [ev],
      );
    };

    const r = await freshDispatch(outbox, { workerId: "worker-A", limit: 50 });
    const row = await readOutbox("f2b-dead");

    expect(row.status).toBe("dead");
    expect(row.attempts).toBe(8);
    expect(row.sent_at).toBeNull();
    expect(await readLinkDeliveredAt("f2b-dead")).toBeNull();
    expect(r.sent).toBe(0);
    expect(r.conflicts).toBe(1);
  });

  it("Test 20 — a stale failure cannot push an already-delivered event back to pending", async () => {
    const id = await insertOutbox({ name: "f2b-double" });
    await attachResultLink("f2b-double", id);
    onCall = async (ev) => {
      if (!ev) return;
      await pool.query(
        `UPDATE integration_outbox SET status='sent', locked_by=NULL, locked_at=NULL, attempts=3, sent_at=NOW(), last_error=NULL WHERE event_id=$1`,
        [ev],
      );
    };

    // A's own attempt fails, but B already delivered this same event_id.
    failMode = "http500";
    const r = await freshDispatch(outbox, { workerId: "worker-A", limit: 50 });
    const row = await readOutbox("f2b-double");

    expect(row.status).toBe("sent");
    expect(row.attempts).toBe(3);
    expect(row.sent_at).not.toBeNull();
    // A never owned this event, so it neither re-delivers it nor claims the link.
    expect(await readLinkDeliveredAt("f2b-double")).toBeNull();
    expect(r.failed).toBe(0);
    expect(r.conflicts).toBe(1);
    expect(id).toBeGreaterThan(0);
  });

  it("Test 21 — a re-claim under the SAME worker name is still a different owner", async () => {
    // Why `locked_by = workerId` alone is not an ownership proof: a caller that
    // passes an explicit workerId (the admin route, a test, a re-entrant tick) can
    // have its row taken over by another dispatch carrying the same name. The lease
    // stamp this dispatch wrote is what distinguishes the two.
    const id = await insertOutbox({ name: "f2b-token" });
    onCall = async (ev) => {
      if (!ev) return;
      await pool.query(
        `UPDATE integration_outbox SET status='sending', locked_by='same-name', locked_at = NOW() - interval '2 seconds' WHERE event_id=$1`,
        [ev],
      );
    };

    const r = await freshDispatch(outbox, { workerId: "same-name", limit: 50 });
    const row = await readOutbox("f2b-token");

    expect(row.status).toBe("sending");
    expect(row.sent_at).toBeNull();
    expect(row.attempts).toBe(0);
    expect(r.sent).toBe(0);
    expect(r.conflicts).toBe(1);
    expect(id).toBeGreaterThan(0);
  });

  it("Test 22 — the owner that receives HTTP 200 still finalizes everything", async () => {
    // The fence must not eat legitimate deliveries: state, delivery bookkeeping, the
    // result link and the film record all advance exactly as they did before.
    const id = await insertOutbox({ name: "f2b-legit", eventType: "diagnostic_electronic_film.available", payload: { careFilmArtifactId: 0 } });
    await attachResultLink("f2b-legit", id);
    const artifactId = await attachFilmArtifact("f2b-legit", id);
    await pool.query(`UPDATE integration_outbox SET payload = jsonb_set(payload,'{careFilmArtifactId}',$2::jsonb) WHERE id = $1`, [id, String(artifactId)]);

    const r = await freshDispatch(outbox, { workerId: "owner", limit: 50 });
    const row = await readOutbox("f2b-legit");

    expect(row.status).toBe("sent");
    expect(row.sent_at).not.toBeNull();
    expect(row.attempts).toBe(1);
    expect(row.locked_by).toBeNull();
    expect(row.locked_at).toBeNull();
    expect(await readLinkDeliveredAt("f2b-legit")).not.toBeNull();
    const film = await readFilm(artifactId);
    expect(film.hope_delivery_status).toBe("SENT");
    expect(film.hope_sent_at).not.toBeNull();
    expect(r.sent).toBe(1);
    expect(r.conflicts).toBe(0);
  });

  it("Test 23 — the owner that receives HTTP 500 keeps the existing retry and backoff policy", async () => {
    const id = await insertOutbox({ name: "f2b-retry", attempts: 1, maxAttempts: 8 });
    await attachResultLink("f2b-retry", id);
    failMode = "http500";

    const r = await freshDispatch(outbox, { workerId: "owner", limit: 50 });
    const row = await readOutbox("f2b-retry");

    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(2);
    expect(row.last_error).toBe("http_500");
    expect(new Date(row.next_attempt_at).getTime()).toBeGreaterThan(Date.now());
    expect(await readLinkDeliveredAt("f2b-retry")).toBeNull();
    expect(r.failed).toBe(1);
    expect(r.conflicts).toBe(0);
    expect(id).toBeGreaterThan(0);
  });

  it("Test 24 — the owner that exhausts maxAttempts still dead-letters", async () => {
    await insertOutbox({ name: "f2b-dl", attempts: 7, maxAttempts: 8 });
    failMode = "http500";

    const r = await freshDispatch(outbox, { workerId: "owner", limit: 50 });
    const row = await readOutbox("f2b-dl");

    expect(row.status).toBe("dead");
    expect(row.attempts).toBe(8);
    expect(row.sent_at).toBeNull();
    expect(r.dead).toBe(1);
    expect(r.conflicts).toBe(0);
  });

  it("Test 25 — an unconfigured callback keeps its policy and its owner still clears the lock", async () => {
    delete process.env.INTEGRATION_HOPE_CALLBACK_URL;
    delete process.env.INTEGRATION_HOPE_SIGNING_SECRET;
    await insertOutbox({ name: "f2b-cfg", attempts: 9, maxAttempts: 8 });

    const r = await freshDispatch(outbox, { workerId: "owner", limit: 50 });
    const row = await readOutbox("f2b-cfg");

    expect(row.status).toBe("pending");
    expect(row.last_error).toBe("delivery_not_configured");
    expect(row.locked_by).toBeNull();
    expect(r.dead).toBe(0);
    expect(r.conflicts).toBe(0);
  });

  it("Test 26 — an administrator's retry during a delivery is not overwritten by that delivery", async () => {
    const id = await insertOutbox({ name: "f2b-retryadmin", attempts: 3, maxAttempts: 8 });
    onCall = async (ev) => {
      if (ev) await outbox.retryOutboxEvent(id);
    };

    const r = await freshDispatch(outbox, { workerId: "worker-A", limit: 50 });
    const row = await readOutbox("f2b-retryadmin");

    // The retry wins: the event is queued again and the late 200 cannot mark it sent.
    expect(row.status).toBe("pending");
    expect(row.sent_at).toBeNull();
    expect(row.attempts).toBe(3);
    expect(row.locked_by).toBeNull();
    expect(r.sent).toBe(0);
    expect(r.conflicts).toBe(1);
    // And it still gets delivered on a later tick, so retry remains functional.
    await pool.query(`UPDATE integration_outbox SET next_attempt_at = NOW() - interval '1 second' WHERE event_id=$1`, [eventIdFor("f2b-retryadmin")]);
    onCall = null;
    await freshDispatch(outbox, { workerId: "worker-C", limit: 50 });
    expect((await readOutbox("f2b-retryadmin")).status).toBe("sent");
  });

  it("Test 27 — a delivery that outlives its lease: only the current owner finalizes", async () => {
    // The real path, not a direct UPDATE: A holds the event and stalls inside HTTP
    // past the lease; B reclaims it through PR #995's recovery, and because the
    // reclaim charges an attempt and honours the backoff curve, B delivers it on the
    // following pass; then A's response arrives. Both workers may POST (at-least-once
    // is unchanged), but the event's state must be written by exactly one of them, and
    // the bookkeeping must be the owner's.
    const id = await insertOutbox({ name: "f2b-race" });
    await attachResultLink("f2b-race", id);
    let first = true;
    onCall = async () => {
      if (first) {
        first = false;
        await sleep(700); // longer than the 120ms lease every dispatch here uses
      }
    };

    const pa = freshDispatch(outbox, { workerId: "slow-A", limit: 50, staleLeaseMs: 120 });
    await sleep(200);
    const b1 = await freshDispatch(outbox, { workerId: "fast-B", limit: 50, staleLeaseMs: 120 });
    // B recovered it (an attempt charged, backoff pending) but cannot re-claim it
    // until that backoff, so age it deliberately, exactly as a later tick would.
    expect(b1.recovered).toBe(1);
    await pool.query(`UPDATE integration_outbox SET next_attempt_at = NOW() - interval '1 second' WHERE event_id=$1`, [eventIdFor("f2b-race")]);
    const b2 = await freshDispatch(outbox, { workerId: "fast-B", limit: 50, staleLeaseMs: 120 });
    const a = await pa;

    const row = await readOutbox("f2b-race");
    expect(row.status).toBe("sent");
    expect(row.locked_by).toBeNull();
    expect(row.locked_at).toBeNull();
    expect(row.sent_at).not.toBeNull();
    // B's bookkeeping survived: B's reclaim made this the third attempt (0 -> 1 at the
    // reclaim, 1 -> 2 on delivery... A claimed it first at attempts 0, so B's own
    // delivery is attempt 2). An unfenced A wrote 1 over it.
    expect(row.attempts).toBe(2);
    expect(await readLinkDeliveredAt("f2b-race")).not.toBeNull();

    // A delivered too, but its outcome was refused.
    expect(a.sent).toBe(0);
    expect(a.conflicts).toBe(1);
    expect(b2.sent).toBeGreaterThanOrEqual(1);
    expect(b2.conflicts).toBe(0);
    // Two HTTP calls for one event_id is the pre-existing at-least-once contract,
    // asserted here rather than glossed over: the identity, not the count, is stable.
    const delivered = calls.filter((c) => c.eventId === eventIdFor("f2b-race"));
    expect(delivered.length).toBeGreaterThanOrEqual(2);
    for (const d of delivered) expect(d.headerEventId).toBe(eventIdFor("f2b-race"));
  });

  it("Test 28 — a takeover that reuses this dispatch's lease stamp is still refused", async () => {
    // Why the predicate carries both `locked_by` and the stamp. A millisecond-granular
    // timestamp can collide; an owner column can be carried over by a writer that only
    // changed one of the two. Either term alone leaves a window, and this case is the
    // one that closes it — so neither term in the fence is decoration.
    const id = await insertOutbox({ name: "f2b-stamp" });
    onCall = async (ev) => {
      if (!ev) return;
      // Same lease stamp, different owner.
      await pool.query(
        `UPDATE integration_outbox SET locked_by='worker-B' WHERE event_id=$1`,
        [ev],
      );
    };

    const r = await freshDispatch(outbox, { workerId: "worker-A", limit: 50 });
    const row = await readOutbox("f2b-stamp");

    expect(row.status).toBe("sending");
    expect(row.locked_by).toBe("worker-B");
    expect(row.sent_at).toBeNull();
    expect(row.attempts).toBe(0);
    expect(r.sent).toBe(0);
    expect(r.conflicts).toBe(1);
    expect(id).toBeGreaterThan(0);
  });

  it("Test 29 — a row taken out of 'sending' is not finalized by the worker that holds its lock", async () => {
    // The other half of the predicate: `status = 'sending'`. A row that has been put
    // back in the queue — or is no longer in flight — must not have a delivery outcome
    // written onto it by the dispatch that still appears to hold the lock, because
    // that is exactly how a re-queued report gets silently marked delivered.
    const id = await insertOutbox({ name: "f2b-status", attempts: 2, maxAttempts: 8 });
    onCall = async (ev) => {
      if (!ev) return;
      await pool.query(
        `UPDATE integration_outbox SET status='pending', next_attempt_at=NOW() WHERE event_id=$1`,
        [ev],
      );
    };

    const r = await freshDispatch(outbox, { workerId: "worker-A", limit: 50 });
    const row = await readOutbox("f2b-status");

    expect(row.status).toBe("pending");
    expect(row.sent_at).toBeNull();
    expect(row.attempts).toBe(2);
    expect(row.locked_by).toBe("worker-A");
    expect(r.sent).toBe(0);
    expect(r.conflicts).toBe(1);
    expect(id).toBeGreaterThan(0);
  });

  it("Test 30 — the unconfigured branch cannot rewrite an event handed over mid-batch", async () => {
    // On the merged code the configuration check ran BEFORE the ownership guard, so a
    // row that passed to another worker during an earlier row's delivery was still
    // written by this dispatch: re-queued, its lock cleared, an attempt charged for a
    // request that was never made. The guard now precedes it, so the row is skipped.
    //
    // Two partners, one gap: `x` has no partner and uses the configured HOPE callback,
    // so it makes the request that opens the window; `y` belongs to a partner with no
    // callback url and no env override, so it takes the configuration branch. The batch
    // is iterated in id order, so `x` is inserted first — if that ever stopped being
    // true this test would fail on the fixed code rather than pass quietly.
    const pr = await pool.query(
      `INSERT INTO integration_partners (code, name) VALUES ('PARTNERI2B','PR-I2B synthetic partner') RETURNING id`,
    );
    const partnerId = Number(pr.rows[0].id);
    await insertOutbox({ name: "f2b-cfg-x" });
    await insertOutbox({ name: "f2b-cfg-y", partnerId });

    onCall = async () => {
      await pool.query(
        `UPDATE integration_outbox SET status='sending', locked_by='worker-B', locked_at = NOW() + interval '1 hour'
          WHERE event_id = $1`,
        [eventIdFor("f2b-cfg-y")],
      );
    };

    const r = await freshDispatch(outbox, { workerId: "worker-A", limit: 50 });
    const row = await readOutbox("f2b-cfg-y");

    expect(row.status).toBe("sending");
    expect(row.locked_by).toBe("worker-B");
    expect(row.attempts).toBe(0);
    expect(row.last_error).toBeNull();
    // Nothing was failed or dead-lettered for a row this dispatch no longer holds.
    expect(r.failed).toBe(0);
    expect(r.dead).toBe(0);
  });
});

// ============================================================================
// PR-I11D — the sender's half of the CARE→HOPE event compatibility contract.
//
// HOPE used to answer `200 {ok:true}` for every event type, including the ones it has
// no handler for, and this side read any 2xx as delivered: `integration_outbox.status`
// became `sent`, `external_result_links.delivered_at` was stamped, and for an
// electronic film `markFilmHopeSent()` set `hope_delivery_status = SENT` on a document
// HOPE had thrown away. Two years of "delivered" with nothing behind it.
//
// HOPE now refuses an event it cannot interpret with 422 `unsupported_event_type`.
// These tests pin what this side does with that refusal: it must not be recorded as a
// delivery, it must not stop the retries by accident, it must exhaust its bounded
// budget into a dead letter a human can see, and the film must stop reading as
// "pending forever" once its event is actually dead — while staying re-sendable,
// because a refusal is not a permanent verdict on the artifact.
// ============================================================================
suite("PR-I11D HOPE event compatibility — sender side (real PostgreSQL)", () => {
  /** A film event carrying the artifact whose delivery state the outcome writes. */
  async function filmEvent(name: string, opts: { attempts?: number } = {}) {
    const id = await insertOutbox({
      name,
      eventType: "diagnostic_electronic_film.available",
      payload: { careFilmArtifactId: 0, referralUuid: `${MARKER}-referral` },
      attempts: opts.attempts ?? 0,
      maxAttempts: 8,
    });
    const artifactId = await attachFilmArtifact(name, id);
    await pool.query(
      `UPDATE integration_outbox SET payload = jsonb_set(payload,'{careFilmArtifactId}',$2::jsonb) WHERE id = $1`,
      [id, String(artifactId)],
    );
    await pool.query(
      `UPDATE electronic_film_artifacts SET ingest_status = 'HOPE_PENDING', hope_delivery_status = 'PENDING' WHERE id = $1`,
      [artifactId],
    );
    return { id, artifactId };
  }

  it("Test 31 — HOPE's refusal of an unsupported event type is not recorded as a delivery", async () => {
    const { artifactId } = await filmEvent("i11d-refused");
    failMode = "http422";

    const r = await freshDispatch(outbox, { workerId: "w1", limit: 50 });
    const row = await readOutbox("i11d-refused");

    // The event stays in the queue with the refusal on it. Recording `sent` here is
    // what turned HOPE's "I do not understand this" into a delivery receipt.
    expect(row.status).toBe("pending");
    expect(row.sent_at).toBeNull();
    expect(row.attempts).toBe(1);
    expect(row.last_error).toBe("http_422");
    expect(r.sent).toBe(0);

    // And the film's own row — the one the radiology panel reads — is not SENT.
    const film = await readFilm(artifactId);
    expect(film.hope_delivery_status).not.toBe("SENT");
    expect(film.hope_sent_at).toBeNull();
  });

  it("Test 32 — a refused film event dead-letters on budget and says so on the artifact", async () => {
    const { artifactId } = await filmEvent("i11d-dead", { attempts: 7 });
    failMode = "http422";

    const r = await freshDispatch(outbox, { workerId: "w1", limit: 50 });
    const row = await readOutbox("i11d-dead");
    expect(row.status).toBe("dead");
    expect(row.last_error).toBe("http_422");
    expect(r.dead).toBe(1);

    // `hope_delivery_status` was PENDING since the enqueue and nothing else ever
    // writes it, so without this the film reads "waiting" forever while the event it
    // was waiting on is dead. ElectronicFilmPanel renders FAILED as its warning badge
    // and worklist marker, which is what makes an undelivered film visible.
    const film = await readFilm(artifactId);
    expect(film.hope_delivery_status).toBe("FAILED");
    expect(String(film.error_message)).toContain("http_422");
    // Ingest state is untouched: the artifact itself stored fine, and HOPE's refusal
    // is a delivery outcome, not a reason to hide the film from the pipeline.
    expect(film.ingest_status).toBe("HOPE_PENDING");
  });

  it("Test 33 — a refusal that is still being retried does not condemn the film", async () => {
    // Only the terminal transition may write FAILED. Marking every non-2xx as failure
    // would report a film as undeliverable while CARE is still trying, and would fight
    // the retry policy #995-#997 exist to implement.
    const { artifactId } = await filmEvent("i11d-retrying", { attempts: 2 });
    failMode = "http422";

    await freshDispatch(outbox, { workerId: "w1", limit: 50 });
    const row = await readOutbox("i11d-retrying");
    expect(row.status).toBe("pending");
    expect((await readFilm(artifactId)).hope_delivery_status).toBe("PENDING");

    // Bounded: eight attempts on one immutable event id, then it stops. A permanent
    // refusal cannot become a retry storm.
    failMode = "none";
    await pool.query(
      `UPDATE integration_outbox SET attempts = 7, next_attempt_at = NOW() - interval '1 second' WHERE event_id = $1`,
      [eventIdFor("i11d-retrying")],
    );
    failMode = "http422";
    await freshDispatch(outbox, { workerId: "w1", limit: 50 });
    expect((await readOutbox("i11d-retrying")).status).toBe("dead");
    expect((await readFilm(artifactId)).hope_delivery_status).toBe("FAILED");
  });

  it("Test 34 — an event refused by an older HOPE still delivers after the upgrade", async () => {
    // The recovery the contract promises: HOPE gains the handler, the dead letter is
    // retried, and the same event id lands. Nothing in the refusal may make the film
    // un-sendable, or the compatibility fix would itself be a data-loss event.
    const { id, artifactId } = await filmEvent("i11d-upgrade", { attempts: 7 });
    failMode = "http422";
    await freshDispatch(outbox, { workerId: "w1", limit: 50 });
    expect((await readOutbox("i11d-upgrade")).status).toBe("dead");
    expect((await readFilm(artifactId)).hope_delivery_status).toBe("FAILED");

    // The operator retries it from the Hope connection screen, and this time HOPE
    // recognises the event.
    failMode = "none";
    await outbox.retryOutboxEvent(id);
    await pool.query(
      `UPDATE integration_outbox SET next_attempt_at = NOW() - interval '1 second' WHERE id = $1`,
      [id],
    );
    const r = await freshDispatch(outbox, { workerId: "w2", limit: 50 });
    const row = await readOutbox("i11d-upgrade");

    expect(row.status).toBe("sent");
    expect(r.sent).toBeGreaterThanOrEqual(1);
    const film = await readFilm(artifactId);
    expect(film.hope_delivery_status).toBe("SENT");
    expect(film.hope_sent_at).not.toBeNull();
  });

  it("Test 35 — a network failure that exhausts the budget marks the film failed too", async () => {
    // The dead-letter transition is one state, whatever produced it: a film whose event
    // is dead has not reached HOPE, whether HOPE refused it or never answered.
    const { artifactId } = await filmEvent("i11d-timeout", { attempts: 7 });
    failMode = "timeout";

    await freshDispatch(outbox, { workerId: "w1", limit: 50 });
    const row = await readOutbox("i11d-timeout");
    expect(row.status).toBe("dead");
    expect((await readFilm(artifactId)).hope_delivery_status).toBe("FAILED");
  });

  it("Test 36 — a stale worker's refusal cannot mark the film failed either", async () => {
    // Ownership fencing covers this write too. A is mid-POST, its lease lapses, B takes
    // the row over; A then receives 422 and would declare the film undeliverable while B
    // is still working on it — and a film B successfully delivers would keep A's FAILED
    // stamp as the last word. The artifact state belongs to whoever holds the event.
    const { artifactId } = await filmEvent("i11d-stale", { attempts: 7 });
    failMode = "http422";
    onCall = async (ev) => { if (ev) await handOverTo(ev, "worker-B"); };

    const r = await freshDispatch(outbox, { workerId: "worker-A", limit: 50 });
    const row = await readOutbox("i11d-stale");

    expect(row.status).toBe("sending");
    expect(row.locked_by).toBe("worker-B");
    expect(row.last_error).toBeNull();
    expect(r.dead).toBe(0);
    expect(r.conflicts).toBe(1);
    expect((await readFilm(artifactId)).hope_delivery_status).toBe("PENDING");
  });

  it("Test 37 — a dead report event does not condemn a film that shares its payload field", async () => {
    // The artifact id is read out of the event payload, so the type guard is the only
    // thing that keeps a report's delivery outcome off a film's record. The field is not
    // reserved by the schema — `payload` is jsonb and `careFilmArtifactId` in a report
    // body is one refactor away from happening — and a film silently marked FAILED by an
    // unrelated report's dead letter is a film nobody will go back and re-send.
    const id = await insertOutbox({
      name: "i11d-crosstalk",
      eventType: "diagnostic_report.finalised",
      payload: { referralUuid: `${MARKER}-referral`, reportNumber: "R-X", careFilmArtifactId: 0 },
      attempts: 7,
      maxAttempts: 8,
    });
    const artifactId = await attachFilmArtifact("i11d-crosstalk", id);
    await pool.query(
      `UPDATE integration_outbox SET payload = jsonb_set(payload,'{careFilmArtifactId}',$2::jsonb) WHERE id = $1`,
      [id, String(artifactId)],
    );
    await pool.query(`UPDATE electronic_film_artifacts SET hope_delivery_status = 'PENDING' WHERE id = $1`, [artifactId]);
    failMode = "http422";

    await freshDispatch(outbox, { workerId: "w1", limit: 50 });

    expect((await readOutbox("i11d-crosstalk")).status).toBe("dead");
    expect((await readFilm(artifactId)).hope_delivery_status).toBe("PENDING");
  });
});
