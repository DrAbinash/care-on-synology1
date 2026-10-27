// ============================================================================
// PR-I3 — reconcileResults must make fair progress.
//
// Real PostgreSQL, because the failure is a property of the selection query
// against a growing table: which rows a bounded scan is allowed to see. A mocked
// db cannot reproduce it — it would only re-assert the shape of the query string.
//
// Every row is synthetic and marker-scoped (`pr-i3-reconcile`), and the fixture
// chain (patient → order → referral → report) is created for real so the foreign
// keys, the state machine and the idempotency constraints all behave as they do
// in the clinic. Never the production database.
//
// Run this file and outboxRecovery.db.test.ts in the same database with
// `--no-file-parallelism`. Both drive the same shared tables, and that suite
// asserts dispatch *summary* counts (claimed/sent/conflicts) which a second
// suite's rows legitimately appear in: with the two files in flight together,
// measured 4 of 5 runs went red on tests that pass every time sequentially.
// ============================================================================
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const hasDb = !!DATABASE_URL;
const pool = new Pool({ connectionString: DATABASE_URL, max: 10 });

const MARKER = "pr-i3-reconcile";
const uuidFor = (n: number | string) => `${MARKER}:${n}`;

let patientId = 0;
let testId = 0;

/** One synthetic patient serves the whole fixture set (orders require a patient). */
async function ensurePatient() {
  const r = await pool.query(
    `INSERT INTO patients (patient_id, first_name, last_name, date_of_birth, gender, phone)
     VALUES ($1,'Reconcile','Synthetic','1980-01-01','male','+00000000000')
     ON CONFLICT DO NOTHING RETURNING id`,
    [`${MARKER}-pat`],
  );
  if (r.rows[0]) return Number(r.rows[0].id);
  const e = await pool.query(`SELECT id FROM patients WHERE patient_id = $1`, [`${MARKER}-pat`]);
  return Number(e.rows[0].id);
}

async function ensureTest() {
  // order_tests.test_id is the one column on this path that carries a real foreign
  // key, so the billed line needs a catalogue row behind it.
  const r = await pool.query(
    `INSERT INTO diagnostic_tests (code, name, category, price, duration)
     VALUES ($1,'PR-I3 Synthetic Test','radiology',100,'1 day')
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [`${MARKER}-test`],
  );
  return Number(r.rows[0].id);
}

/**
 * A referral with a care order and a finalised report on it — exactly the shape
 * `reconcileResults` is built to find. `alreadyLinked` produces the state a
 * referral is left in after a successful reconciliation, which is what the
 * eligible window must not fill up with.
 */
async function insertEligible(n: number, opts: {
  status?: string;
  alreadyLinked?: boolean;
  reportStatus?: string;
  extraReport?: boolean;
  withItem?: boolean;
  /** Force the primary key: R3 needs ids handed out out-of-order. */
  id?: number;
} = {}) {
  const referralUuid = uuidFor(n);
  const ord = await pool.query(
    `INSERT INTO orders (order_number, patient_id) VALUES ($1,$2) RETURNING id`,
    [`${referralUuid}-order`, patientId],
  );
  const careOrderId = Number(ord.rows[0].id);
  const ref = await pool.query(
    `INSERT INTO diagnostic_referrals (id, referral_uuid, source_patient_id, patient_name, status, care_order_id)
     VALUES (COALESCE($5, nextval('diagnostic_referrals_id_seq')),$1,$2,'PR-I3 Synthetic',$3,$4) RETURNING id`,
    [referralUuid, `${MARKER}-uhid-${n}`, opts.status ?? "IN_PROGRESS", careOrderId, opts.id ?? null],
  );
  const referralId = Number(ref.rows[0].id);

  const mkReport = async (tag: string) => {
    const rp = await pool.query(
      `INSERT INTO patient_reports (report_number, patient_id, test_id, order_id, type, status, title, is_critical)
       VALUES ($1,$2,$3,$4,'radiology',$5,'PR-I3 synthetic report', false) RETURNING id`,
      [`${referralUuid}-${tag}-rpt`, patientId, 1, careOrderId, opts.reportStatus ?? "verified"],
    );
    return Number(rp.rows[0].id);
  };

  const first = await mkReport("main");

  let itemId: number | null = null;
  if (opts.withItem) {
    // The shape a real HOPE referral has: an item line bound to the billed order
    // test, and a report naming that same test. That pairing is what lets the
    // reconciler stamp external_result_links.referral_item_id (the only column the
    // table's unique index covers) and move the item to `reported`.
    const ot = await pool.query(
      `INSERT INTO order_tests (order_id, test_id, price) VALUES ($1,$2,100) RETURNING id`,
      [careOrderId, testId],
    );
    const orderTestId = Number(ot.rows[0].id);
    const it = await pool.query(
      `INSERT INTO diagnostic_referral_items (referral_id, source_test_name, care_order_test_id)
       VALUES ($1,'PR-I3 synthetic test',$2) RETURNING id`,
      [referralId, orderTestId],
    );
    itemId = Number(it.rows[0].id);
    await pool.query(`UPDATE patient_reports SET order_test_id = $1 WHERE id = $2`, [orderTestId, first]);
  }

  if (opts.alreadyLinked) {
    await pool.query(
      `INSERT INTO external_result_links (referral_id, care_order_id, care_report_id, result_type, report_status)
       VALUES ($1,$2,$3,'radiology','final')`,
      [referralId, careOrderId, first],
    );
  }
  let second: number | null = null;
  if (opts.extraReport) second = await mkReport("amend");

  return { referralId, careOrderId, reportId: first, amendReportId: second, itemId, referralUuid };
}

async function linksFor(referralId: number) {
  const r = await pool.query(
    `SELECT id, care_report_id, referral_item_id, emitted_outbox_id FROM external_result_links WHERE referral_id = $1`,
    [referralId],
  );
  return r.rows as Array<{ id: number; care_report_id: number; referral_item_id: number | null; emitted_outbox_id: number | null }>;
}

async function itemStatusOf(itemId: number) {
  const r = await pool.query(`SELECT item_status FROM diagnostic_referral_items WHERE id = $1`, [itemId]);
  return r.rows[0]?.item_status ?? null;
}

async function statusOf(referralId: number) {
  const r = await pool.query(`SELECT status FROM diagnostic_referrals WHERE id = $1`, [referralId]);
  return r.rows[0]?.status ?? null;
}

async function eventsFor(referralUuid: string) {
  const r = await pool.query(
    `SELECT event_type, count(*)::int AS n FROM integration_outbox WHERE correlation_id = $1 GROUP BY event_type`,
    [referralUuid],
  );
  return r.rows as Array<{ event_type: string; n: number }>;
}

async function clearAll() {
  // FK order: external_result_links.emitted_outbox_id points at integration_outbox,
  // so links go first, then the events they reference.
  await pool.query(`DELETE FROM integration_delivery_attempts WHERE outbox_id IN (SELECT id FROM integration_outbox WHERE correlation_id LIKE $1)`, [`${MARKER}%`]);
  await pool.query(`DELETE FROM external_result_links WHERE referral_id IN (SELECT id FROM diagnostic_referrals WHERE referral_uuid LIKE $1)`, [`${MARKER}%`]);
  await pool.query(`DELETE FROM integration_outbox WHERE correlation_id LIKE $1`, [`${MARKER}%`]);
  await pool.query(
    `DELETE FROM diagnostic_referral_events e USING diagnostic_referrals f WHERE f.id = e.referral_id AND f.referral_uuid LIKE $1`,
    [`${MARKER}%`],
  );
  await pool.query(`DELETE FROM patient_report_amendments WHERE amended_report_id IN (SELECT id FROM patient_reports WHERE report_number LIKE $1)`, [`${MARKER}%`]);
  await pool.query(`DELETE FROM diagnostic_referral_items WHERE referral_id IN (SELECT id FROM diagnostic_referrals WHERE referral_uuid LIKE $1)`, [`${MARKER}%`]);
  await pool.query(`DELETE FROM order_tests WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`, [`${MARKER}%`]);
  await pool.query(`DELETE FROM patient_reports WHERE report_number LIKE $1`, [`${MARKER}%`]);
  await pool.query(`DELETE FROM diagnostic_referrals WHERE referral_uuid LIKE $1`, [`${MARKER}%`]);
  await pool.query(`DELETE FROM orders WHERE order_number LIKE $1`, [`${MARKER}%`]);
  await pool.query(`DELETE FROM diagnostic_tests WHERE code = $1`, [`${MARKER}-test`]);
  await pool.query(`DELETE FROM patients WHERE patient_id = $1`, [`${MARKER}-pat`]);
  await pool.query(`DELETE FROM pr_i3_refusals`);
}

// ----------------------------------------------------------------------------
// Fault injection. A fairness contract needs a record the database actually
// refuses, and the refusals must be scoped to these marker rows only — a stub
// that pretends the INSERT failed would not prove the transaction rolled back.
// The tables are consulted by name, so no identifier is ever interpolated.
// ----------------------------------------------------------------------------
async function refuse(kind: "outbox" | "link", key: string) {
  await pool.query(`INSERT INTO pr_i3_refusals (kind, key) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [kind, key]);
}
async function allowAgain(kind: "outbox" | "link", key: string) {
  await pool.query(`DELETE FROM pr_i3_refusals WHERE kind = $1 AND key = $2`, [kind, key]);
}

const FAULT_SCHEMA = `
CREATE TABLE IF NOT EXISTS pr_i3_refusals (kind text NOT NULL, key text NOT NULL, PRIMARY KEY (kind, key));
CREATE OR REPLACE FUNCTION pr_i3_refuse_outbox() RETURNS trigger AS $f$
  BEGIN
    IF EXISTS (SELECT 1 FROM pr_i3_refusals r WHERE r.kind = 'outbox' AND r.key = NEW.correlation_id) THEN
      RAISE EXCEPTION 'pr-i3 forced failure on the outbox insert';
    END IF;
    RETURN NEW;
  END $f$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION pr_i3_refuse_link() RETURNS trigger AS $f$
  BEGIN
    IF EXISTS (SELECT 1 FROM pr_i3_refusals r WHERE r.kind = 'link' AND r.key = NEW.referral_id::text) THEN
      RAISE EXCEPTION 'pr-i3 forced failure on the result-link insert';
    END IF;
    RETURN NEW;
  END $f$ LANGUAGE plpgsql;
`;

let emitter: typeof import("./resultsEmitter");

beforeAll(async () => {
  if (!hasDb) return;
  await pool.query(FAULT_SCHEMA);
  await pool.query(`DROP TRIGGER IF EXISTS pr_i3_refuse_outbox ON integration_outbox`);
  await pool.query(`CREATE TRIGGER pr_i3_refuse_outbox BEFORE INSERT ON integration_outbox FOR EACH ROW EXECUTE FUNCTION pr_i3_refuse_outbox()`);
  await pool.query(`DROP TRIGGER IF EXISTS pr_i3_refuse_link ON external_result_links`);
  await pool.query(`CREATE TRIGGER pr_i3_refuse_link BEFORE INSERT ON external_result_links FOR EACH ROW EXECUTE FUNCTION pr_i3_refuse_link()`);
  emitter = await import("./resultsEmitter");
});

beforeEach(async () => {
  if (!hasDb) return;
  await clearAll();
  patientId = await ensurePatient();
  testId = await ensureTest();
});

afterEach(async () => {
  if (!hasDb) return;
  await clearAll();
});

afterAll(async () => {
  if (!hasDb) return;
  // Leave the scratch database exactly as found: these triggers sit on tables the
  // neighbouring outbox suite also writes, so they must not outlive this file.
  await pool.query(`DROP TRIGGER IF EXISTS pr_i3_refuse_outbox ON integration_outbox`);
  await pool.query(`DROP TRIGGER IF EXISTS pr_i3_refuse_link ON external_result_links`);
  await pool.query(`DROP FUNCTION IF EXISTS pr_i3_refuse_outbox()`);
  await pool.query(`DROP FUNCTION IF EXISTS pr_i3_refuse_link()`);
  await pool.query(`DROP TABLE IF EXISTS pr_i3_refusals`);
  await pool.end();
});

const suite = hasDb ? describe : describe.skip;

suite("PR-I3 reconcileResults fair progress (real PostgreSQL)", () => {
  it("R1 — more than 100 eligible referrals all reach a link, not just the first window", async () => {
    // 150 referrals each carrying a finalised, not-yet-linked report. One bounded
    // scan cannot see them all, so the contract that matters is that successive
    // runs keep advancing until none is left behind.
    const ids: number[] = [];
    for (let i = 1; i <= 150; i++) ids.push((await insertEligible(i)).referralId);

    const linked = async () => {
      const r = await pool.query(
        `SELECT count(DISTINCT l.referral_id)::int AS n FROM external_result_links l
           JOIN diagnostic_referrals f ON f.id = l.referral_id
          WHERE f.referral_uuid LIKE $1`,
        [`${MARKER}%`],
      );
      return r.rows[0].n;
    };

    const a = await emitter.reconcileResults({ limit: 100 });
    expect(a.scanned).toBeLessThanOrEqual(100);
    const afterFirst = await linked();
    expect(afterFirst).toBeGreaterThan(0);

    const b = await emitter.reconcileResults({ limit: 100 });
    const afterSecond = await linked();
    expect(afterSecond).toBeGreaterThan(afterFirst);

    const c = await emitter.reconcileResults({ limit: 100 });
    const afterThird = await linked();

    // Three passes of 100 cover 150 — no referral may be left with nothing done.
    expect(afterThird).toBe(150);
    expect([a.emitted, b.emitted, c.emitted].reduce((x, y) => x + y, 0)).toBe(150);
    // Each pass must spend its window on work: 100, then the 50 that were behind it.
    expect([a.scanned, b.scanned, c.scanned]).toEqual([100, 50, 0]);
    // Nothing may be counted that was not written, and no pair may be linked twice.
    expect([a.failed, b.failed, c.failed].reduce((x, y) => x + y, 0)).toBe(0);
    const dupes = await pool.query(
      `SELECT l.referral_id, l.care_report_id, count(*)::int AS n FROM external_result_links l
         JOIN diagnostic_referrals f ON f.id = l.referral_id
        WHERE f.referral_uuid LIKE $1 GROUP BY 1,2 HAVING count(*) > 1`,
      [`${MARKER}%`],
    );
    expect(dupes.rows).toEqual([]);
  });

  it("R2 — completed referrals do not occupy the window and starve a new one", async () => {
    // The clinic's real steady state: a large history of referrals that were
    // reconciled long ago, plus one report that has just been finalised. The new
    // one is the only row with work. It must not sit behind 250 finished rows.
    const done: number[] = [];
    for (let i = 1; i <= 250; i++) {
      done.push((await insertEligible(i, { alreadyLinked: true, status: "REPORTED" })).referralId);
    }
    const fresh = await insertEligible(9001);

    await emitter.reconcileResults({ limit: 100 });

    expect((await linksFor(fresh.referralId)).length).toBe(1);
    // Nothing was created for the history rows.
    const stray = await pool.query(
      `SELECT count(*)::int AS n FROM external_result_links l
         JOIN diagnostic_referrals f ON f.id = l.referral_id
        WHERE f.referral_uuid LIKE $1 AND l.referral_id = ANY($2::int[])`,
      [`${MARKER}%`, done],
    );
    expect(stray.rows[0].n).toBe(250); // the fixtures themselves; reconcile added none more
    const total = await pool.query(
      `SELECT count(*)::int AS n FROM external_result_links l
         JOIN diagnostic_referrals f ON f.id = l.referral_id
        WHERE f.referral_uuid LIKE $1`,
      [`${MARKER}%`],
    );
    expect(total.rows[0].n).toBe(251);
  });

  it("R3 — selection is deterministic, so a bounded pass cannot re-scan a random subset", async () => {
    // 120 referrals whose ids run opposite to the order they are stored in, so the
    // 100 lowest ids are the 100 physically LAST rows in the heap. A `LIMIT` without
    // `ORDER BY` answers "which 100 did the scan reach first", which on this table is
    // the other 100 — and no fairness claim survives that being a storage accident.
    const base = await pool.query(`SELECT coalesce(max(id), 0) + 1 AS b FROM diagnostic_referrals`);
    const firstId = Number(base.rows[0].b);
    for (let i = 120; i >= 1; i--) await insertEligible(i, { id: firstId + i - 1 });

    await emitter.reconcileResults({ limit: 100 });

    const touched = await pool.query(
      `SELECT DISTINCT l.referral_id FROM external_result_links l
         JOIN diagnostic_referrals f ON f.id = l.referral_id
        WHERE f.referral_uuid LIKE $1 ORDER BY l.referral_id`,
      [`${MARKER}%`],
    );
    const got = touched.rows.map((r) => Number(r.referral_id));
    expect(got.length).toBe(100);
    // The 100 oldest ids — not the 100 the heap happened to reach first.
    expect(got).toEqual(Array.from({ length: 100 }, (_, k) => firstId + k));
  });

  it("R4 — a referral already at REPORTED is reconciled again when new work appears", async () => {
    // The other half of the fairness fix: keeping finished rows out of the window
    // must not keep them out permanently. A second, un-linked report on a referral
    // the reconciler already completed is exactly the case that must still be
    // delivered — it is how a later report or amendment reaches HOPE. This test
    // pins the property the exclusion must not break; the amendment-specific event
    // type is pre-existing behaviour and is not re-proved here.
    const f = await insertEligible(7001, { alreadyLinked: true, status: "REPORTED" });
    const before = await linksFor(f.referralId);
    expect(before.length).toBe(1);

    const rp = await pool.query(
      `INSERT INTO patient_reports (report_number, patient_id, test_id, order_id, type, status, title, is_critical)
       VALUES ($1,$2,$3,$4,'radiology','verified','PR-I3 later report', false) RETURNING id`,
      [`${f.referralUuid}-later-rpt`, patientId, 1, f.careOrderId],
    );
    const laterId = Number(rp.rows[0].id);

    const r = await emitter.reconcileResults({ limit: 100 });
    expect(r.emitted).toBe(1);

    const links = await linksFor(f.referralId);
    expect(links.length).toBe(2);
    expect(links.map((l) => l.care_report_id).sort((a, b) => a - b))
      .toEqual([before[0].care_report_id, laterId].sort((a, b) => a - b));
    const kinds = await eventsFor(f.referralUuid);
    expect(kinds.some((k) => k.event_type === "diagnostic_report.finalised" && k.n === 1)).toBe(true);
  });

  it("R5 — the header advance to REPORTED still happens with the report", async () => {
    const f = await insertEligible(5, { status: "IN_PROGRESS" });
    const r = await emitter.reconcileResults({ limit: 100 });

    expect(r.emitted).toBe(1);
    expect(await statusOf(f.referralId)).toBe("REPORTED");
    const ev = await pool.query(
      `SELECT event_type FROM diagnostic_referral_events WHERE referral_id = $1`,
      [f.referralId],
    );
    expect(ev.rows.map((x) => x.event_type)).toContain("referral.reported");
  });

  it("R6 — an illegal header advance is tolerated and the report is still delivered", async () => {
    // PATIENT_DECLINED cannot legally jump to REPORTED. The reconciler must deliver
    // the report and leave the status alone rather than throwing — this error path
    // is pre-existing behaviour and the selection change must not disturb it.
    const f = await insertEligible(6, { status: "PATIENT_DECLINED" });
    const r = await emitter.reconcileResults({ limit: 100 });

    expect(r.emitted).toBe(1);
    expect((await linksFor(f.referralId)).length).toBe(1);
    expect(await statusOf(f.referralId)).toBe("PATIENT_DECLINED");
  });

  it("R7 — concurrent reconciles neither duplicate database-side effects nor abort the pass", async () => {
    const made: Array<{ referralId: number; uuid: string }> = [];
    for (let i = 1; i <= 20; i++) {
      const f = await insertEligible(i);
      made.push({ referralId: f.referralId, uuid: f.referralUuid });
    }

    // A collision on one report must not end the run. Before this fix two passes
    // racing on the same rows surfaced a unique-violation from the enqueue, and
    // because the per-report work was not contained the rejection escaped and
    // abandoned every referral after it in the same pass — a fairness failure in
    // its own right, not only a duplicate-avoidance one. And the collision the
    // abort hid is worse than a wasted pass: with no referral item on the row, the
    // table's only unique index does not apply, so both links committed.
    const run = async () => {
      try {
        return { r: await emitter.reconcileResults({ limit: 100 }), error: null as string | null };
      } catch (e) {
        return { r: null, error: String((e as Error)?.message ?? "reconcile failed").slice(0, 120) };
      }
    };
    const [x, y] = await Promise.all([run(), run()]);

    expect(x.error).toBeNull();
    expect(y.error).toBeNull();

    for (const m of made) {
      const links = await linksFor(m.referralId);
      expect(links.length).toBe(1);
      const kinds = await eventsFor(m.uuid);
      for (const k of kinds) expect(k.n).toBe(1);
    }
    // Whatever the split, exactly 20 emissions happened in total, and losing a
    // race is a benign skip rather than a failure — nothing had to be retried.
    expect((x.r?.emitted ?? 0) + (y.r?.emitted ?? 0)).toBe(20);
    expect((x.r?.failed ?? 0) + (y.r?.failed ?? 0)).toBe(0);
  });

  it("R8 — an item-linked referral keeps its line association and the item moves to reported", async () => {
    // Fairness must not cost the reconciler anything it used to do. The referral
    // item is the HOPE-side line the result belongs to, and its status is what the
    // clinic sees on the referral tracker.
    const f = await insertEligible(8001, { withItem: true, status: "IN_PROGRESS" });
    const r = await emitter.reconcileResults({ limit: 100 });

    expect(r.emitted).toBe(1);
    const links = await linksFor(f.referralId);
    expect(links.length).toBe(1);
    expect(links[0].referral_item_id).toBe(f.itemId);
    expect(links[0].emitted_outbox_id).not.toBeNull();
    expect(await itemStatusOf(f.itemId!)).toBe("reported");
  });

  it("R9 — concurrent passes on the item-linked shape write one link and count one emission", async () => {
    // The other side of the same race. Here the (referral_item_id, care_report_id)
    // index does fire, and the loser's insert error is swallowed inside the
    // transaction — so the COMMIT rolls the unit back while the promise still
    // resolves. Counting that as an emission is how a pass can report work it did
    // not do, and how a report can be marked delivered while HOPE never received it.
    const made: Array<{ referralId: number; itemId: number | null; uuid: string }> = [];
    for (let i = 9001; i <= 9010; i++) {
      const f = await insertEligible(i, { withItem: true });
      made.push({ referralId: f.referralId, itemId: f.itemId, uuid: f.referralUuid });
    }

    const run = async () => {
      try {
        return { r: await emitter.reconcileResults({ limit: 100 }), error: null as string | null };
      } catch (e) {
        return { r: null, error: String((e as Error)?.message ?? "reconcile failed").slice(0, 120) };
      }
    };
    const [x, y] = await Promise.all([run(), run()]);
    expect(x.error).toBeNull();
    expect(y.error).toBeNull();

    for (const m of made) {
      const links = await linksFor(m.referralId);
      expect(links.length).toBe(1);
      expect(links[0].referral_item_id).toBe(m.itemId);
      const kinds = await eventsFor(m.uuid);
      for (const k of kinds) expect(k.n).toBe(1);
    }
    expect((x.r?.emitted ?? 0) + (y.r?.emitted ?? 0)).toBe(made.length);
    expect((x.r?.failed ?? 0) + (y.r?.failed ?? 0)).toBe(0);
  });

  it("R10 — a report the database refuses mid-transaction does not starve the ones behind it", async () => {
    // The failing record is deliberately the oldest, so it is read first: the
    // contract is that the passes after it still deliver everything else, and
    // still come back for the refused one once it can be written.
    const bad = await insertEligible(10001);
    const good = [await insertEligible(10002), await insertEligible(10003)];
    await refuse("outbox", bad.referralUuid);

    const r = await emitter.reconcileResults({ limit: 100 });
    expect(r.emitted).toBe(2);
    expect(r.failed).toBe(1);
    for (const g of good) expect((await linksFor(g.referralId)).length).toBe(1);
    // Nothing half-written was left behind for the refused report.
    expect(await linksFor(bad.referralId)).toEqual([]);
    expect(await eventsFor(bad.referralUuid)).toEqual([]);

    // Deferred, not lost: the next pass reaches it.
    await allowAgain("outbox", bad.referralUuid);
    const again = await emitter.reconcileResults({ limit: 100 });
    expect(again.emitted).toBe(1);
    expect(again.failed).toBe(0);
    expect((await linksFor(bad.referralId)).length).toBe(1);
  });

  it("R11 — a refused link insert is not counted as an emission, and is delivered next pass", async () => {
    const f = await insertEligible(11001);
    await refuse("link", String(f.referralId));

    const r = await emitter.reconcileResults({ limit: 100 });
    expect(r.emitted).toBe(0);
    expect(r.scanned).toBe(1);
    expect(r.failed).toBe(1);
    expect(await linksFor(f.referralId)).toEqual([]);
    expect(await eventsFor(f.referralUuid)).toEqual([]);

    await allowAgain("link", String(f.referralId));
    const again = await emitter.reconcileResults({ limit: 100 });
    expect(again.emitted).toBe(1);
    expect((await linksFor(f.referralId)).length).toBe(1);
  });
});
