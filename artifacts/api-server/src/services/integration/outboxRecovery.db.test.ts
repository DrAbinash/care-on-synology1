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
let failMode: "none" | "timeout" | "http500" = "none";
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
}) {
  const next = row.nextAgoMs == null ? "NOW()" : `NOW() - (${row.nextAgoMs} || ' milliseconds')::interval`;
  const locked = row.lockedAgoMs == null ? "NULL" : `NOW() - (${row.lockedAgoMs} || ' milliseconds')::interval`;
  const res = await pool.query(
    `INSERT INTO integration_outbox
       (event_id, event_type, idempotency_key, aggregate_id, payload, status, attempts, max_attempts,
        next_attempt_at, locked_at, locked_by, created_at)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,${next},${locked},$9,NOW())
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
  await pool.query(`DELETE FROM integration_outbox WHERE event_id LIKE $1`, [`${MARKER}:%`]);
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
});
