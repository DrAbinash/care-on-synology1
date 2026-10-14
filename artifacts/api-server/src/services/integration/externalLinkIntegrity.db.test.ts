// ============================================================================
// PR-I6 — database-level integrity for CARE→HOPE external result links.
//
// Why this file exists: since #997 and #998 the two known writers of
// external_result_links agree on one identity — (referral_id, care_report_id) —
// and take the same advisory lock to protect it. But the only unique index on the
// table is (referral_item_id, care_report_id) WHERE care_report_id IS NOT NULL,
// and PostgreSQL treats NULLs as distinct. So the invariant lives entirely in
// application code: a third writer that forgets the lock, or a referral with no
// item row, is free to link the same signed report twice. These tests pin the
// invariant in the database instead, and prove the two delivery paths still
// report the truth when it fires.
//
// Real PostgreSQL throughout: the property under test is what the storage engine
// accepts, and a stub would be asserting the shape of the stub. Fixtures build the
// genuine chain (patient → order → referral → signed report → order_test →
// referral_item) so foreign keys, the partial indexes, the referral state machine
// and the outbox idempotency key all behave as they do in the clinic.
//
// Every row is synthetic and marker-scoped (`pr-i6-link-integrity`); never the
// production database. `dispatchNow: false` keeps the emit tests on the enqueue
// side — nothing is sent to any partner. Runs against its own scratch database and
// sequentially, because the neighbouring outbox suite asserts shared counters.
// ============================================================================
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const hasDb = !!DATABASE_URL;
const pool = new Pool({ connectionString: DATABASE_URL, max: 10 });

const MARKER = "pr-i6-link-integrity";
const uuidFor = (n: number | string) => `${MARKER}:${n}`;

let patientId = 0;
let testId = 0;

async function ensurePatient() {
  const r = await pool.query(
    `INSERT INTO patients (patient_id, first_name, last_name, date_of_birth, gender, phone)
     VALUES ($1,'Link','Synthetic','1980-01-01','male','+00000000000')
     ON CONFLICT DO NOTHING RETURNING id`, [`${MARKER}-pat`]);
  if (r.rows[0]) return Number(r.rows[0].id);
  return Number((await pool.query(`SELECT id FROM patients WHERE patient_id = $1`, [`${MARKER}-pat`])).rows[0].id);
}

async function ensureTest() {
  const r = await pool.query(
    `INSERT INTO diagnostic_tests (code, name, category, price, duration)
     VALUES ($1,'PR-I6 Synthetic Test','radiology',100,'1 day')
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [`${MARKER}-test`]);
  return Number(r.rows[0].id);
}

/**
 * A signed report on an order a Hope referral points at. `withItem: false` is the
 * shape the existing unique index does not cover — it is what a referral created
 * before item mapping, or a report whose order_test has no matching referral item,
 * actually looks like in the clinic.
 */
async function insertPair(n: number | string, opts: { withItem?: boolean; itemId?: number } = {}) {
  const referralUuid = uuidFor(n);
  const ord = await pool.query(
    `INSERT INTO orders (order_number, patient_id) VALUES ($1,$2) RETURNING id`,
    [`${referralUuid}-order`, patientId]);
  const careOrderId = Number(ord.rows[0].id);
  const ref = await pool.query(
    `INSERT INTO diagnostic_referrals (referral_uuid, source_patient_id, patient_name, status, care_order_id)
     VALUES ($1,$2,'PR-I6 Synthetic','IN_PROGRESS',$3) RETURNING id`,
    [referralUuid, `${referralUuid}-uhid`, careOrderId]);
  const referralId = Number(ref.rows[0].id);

  const rp = await pool.query(
    `INSERT INTO patient_reports (report_number, patient_id, test_id, order_id, type, status, title, is_critical, signed_by_name, signed_at)
     VALUES ($1,$2,$3,$4,'radiology','verified','PR-I6 synthetic signed report',false,'Dr Synthetic Signatory', now()) RETURNING id`,
    [`${referralUuid}-rpt`, patientId, testId, careOrderId]);
  const reportId = Number(rp.rows[0].id);

  let itemId: number | null = opts.itemId ?? null;
  if (opts.withItem) {
    const ot = await pool.query(
      `INSERT INTO order_tests (order_id, test_id, price) VALUES ($1,$2,100) RETURNING id`, [careOrderId, testId]);
    const orderTestId = Number(ot.rows[0].id);
    const it0 = await pool.query(
      `INSERT INTO diagnostic_referral_items (referral_id, source_test_name, care_order_test_id)
       VALUES ($1,'PR-I6 synthetic test',$2) RETURNING id`, [referralId, orderTestId]);
    itemId = Number(it0.rows[0].id);
    await pool.query(`UPDATE patient_reports SET order_test_id = $1 WHERE id = $2`, [orderTestId, reportId]);
  }
  return { referralId, careOrderId, reportId, itemId, referralUuid };
}

/**
 * A second signed report on the SAME order — the shape an amendment takes: CARE
 * mints a new patient_reports row and records the chain in patient_report_amendments;
 * the signed rows themselves are never modified (see lib/db/src/schema/patientReportAmendments.ts).
 */
async function insertAmendedReport(pair: { referralId: number; careOrderId: number; reportId: number; itemId: number | null }) {
  const rp = await pool.query(
    `INSERT INTO patient_reports (report_number, patient_id, test_id, order_id, type, status, title, is_critical, signed_by_name, signed_at)
     VALUES ($1,$2,$3,$4,'radiology','verified','PR-I6 synthetic amended report',false,'Dr Synthetic Amender', now()) RETURNING id`,
    [`${uuidFor("amend")}-${Date.now()}-rpt`, patientId, testId, pair.careOrderId]);
  const amendedReportId = Number(rp.rows[0].id);
  await pool.query(
    `INSERT INTO patient_report_amendments
       (original_report_id, amended_report_id, root_report_id, original_document_id, amended_document_id, sequence_number, reason, amended_by_name)
     VALUES ($1,$2,$1,$3,$4,1,'PR-I6 synthetic correction','Dr Synthetic Amender')`,
    [pair.reportId, amendedReportId, `${uuidFor("doc-o")}`, `${uuidFor("doc-a")}`]);
  return { amendedReportId };
}

/**
 * A SECOND referral item on the SAME referral, pointing at a different order test —
 * the shape the item-keyed index cannot see. One referral, one signed report, two
 * legitimate-looking item rows, and (referral_item_id, care_report_id) is therefore
 * two different keys for one result.
 */
async function insertSecondItemOfReferral(referralId: number, careOrderId: number) {
  const t2 = await pool.query(
    `INSERT INTO diagnostic_tests (code, name, category, price, duration)
     VALUES ($1,'PR-I6 Synthetic Test B','radiology',100,'1 day')
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [`${MARKER}-test-b`]);
  const ot = await pool.query(
    `INSERT INTO order_tests (order_id, test_id, price) VALUES ($1,$2,100) RETURNING id`,
    [careOrderId, Number(t2.rows[0].id)]);
  const it = await pool.query(
    `INSERT INTO diagnostic_referral_items (referral_id, source_test_name, care_order_test_id)
     VALUES ($1,'PR-I6 synthetic test B',$2) RETURNING id`, [referralId, Number(ot.rows[0].id)]);
  return Number(it.rows[0].id);
}

const linksFor = async (referralId: number, reportId?: number) =>
  (await pool.query(
    `SELECT id, care_report_id, referral_item_id, emitted_outbox_id, report_status, report_ref
       FROM external_result_links
      WHERE referral_id = $1${reportId ? " AND care_report_id = $2" : ""} ORDER BY id`,
    reportId ? [referralId, reportId] : [referralId])).rows as Array<{
      id: number; care_report_id: number; referral_item_id: number | null;
      emitted_outbox_id: number | null; report_status: string; report_ref: string | null;
    }>;

const insertLink = async (referralId: number, reportId: number, itemId: number | null, status = "final") => {
  try {
    const r = await pool.query(
      `INSERT INTO external_result_links (referral_id, referral_item_id, care_report_id, result_type, report_status, report_ref)
       VALUES ($1,$2,$3,'radiology',$4,'PR-I6 direct') RETURNING id`,
      [referralId, itemId, reportId, status]);
    return { ok: true as const, id: Number(r.rows[0].id) };
  } catch (e: any) {
    return { ok: false as const, code: e?.code, constraint: e?.constraint, message: String(e?.message ?? "").split("\n")[0] };
  }
};

const eventsFor = async (referralUuid: string) =>
  (await pool.query(
    `SELECT id, event_type, idempotency_key, status FROM integration_outbox WHERE correlation_id = $1 ORDER BY id`,
    [referralUuid])).rows as Array<{ id: number; event_type: string; idempotency_key: string; status: string }>;

/**
 * Which unique indexes the database actually ended up with. Every assertion below
 * that names a constraint reads this first, so the test cannot pass by matching a
 * constraint the repository no longer has, and cannot silently "pass" because no
 * constraint fired at all.
 */
const uniqueIndexes = async () => {
  const r = await pool.query(
    `SELECT i.relname AS name,
            array_to_string(array_agg(a.attname ORDER BY k.ord) FILTER (WHERE a.attname IS NOT NULL), ',') AS cols,
            (x.indpred IS NOT NULL OR x.indexprs IS NOT NULL) AS is_partial,
            x.indnullsnotdistinct AS nulls_not_distinct
       FROM pg_class t
       JOIN pg_index x ON x.indrelid = t.oid
       JOIN pg_class i ON i.oid = x.indexrelid
       LEFT JOIN LATERAL unnest(x.indkey) WITH ORDINALITY k(attnum, ord) ON true
       LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
      WHERE t.relname = 'external_result_links' AND x.indisunique
      GROUP BY i.relname, x.indexprs, x.indpred, x.indnullsnotdistinct
      ORDER BY i.relname`);
  // Joined in SQL and split here, so the assertion does not depend on how the driver
  // happens to hand back a text[].
  return (r.rows as Array<{ name: string; cols: string; is_partial: boolean; nulls_not_distinct: boolean }>)
    .map((row) => ({ ...row, colList: String(row.cols ?? "").split(",").filter(Boolean) }));
};

async function clearAll() {
  await pool.query(`DELETE FROM integration_delivery_attempts WHERE outbox_id IN (SELECT id FROM integration_outbox WHERE correlation_id LIKE $1)`, [`${MARKER}%`]);
  await pool.query(`DELETE FROM external_result_links WHERE referral_id IN (SELECT id FROM diagnostic_referrals WHERE referral_uuid LIKE $1)`, [`${MARKER}%`]);
  await pool.query(`DELETE FROM integration_outbox WHERE correlation_id LIKE $1`, [`${MARKER}%`]);
  await pool.query(`DELETE FROM diagnostic_referral_events e USING diagnostic_referrals f WHERE f.id = e.referral_id AND f.referral_uuid LIKE $1`, [`${MARKER}%`]);
  await pool.query(`DELETE FROM patient_report_amendments WHERE amended_report_id IN (SELECT id FROM patient_reports WHERE report_number LIKE $1)`, [`${MARKER}%`]);
  await pool.query(`DELETE FROM diagnostic_referral_items WHERE referral_id IN (SELECT id FROM diagnostic_referrals WHERE referral_uuid LIKE $1)`, [`${MARKER}%`]);
  await pool.query(`DELETE FROM order_tests WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`, [`${MARKER}%`]);
  await pool.query(`DELETE FROM patient_reports WHERE report_number LIKE $1`, [`${MARKER}%`]);
  await pool.query(`DELETE FROM diagnostic_referrals WHERE referral_uuid LIKE $1`, [`${MARKER}%`]);
  await pool.query(`DELETE FROM orders WHERE order_number LIKE $1`, [`${MARKER}%`]);
  await pool.query(`DELETE FROM diagnostic_tests WHERE code LIKE $1`, [`${MARKER}%`]);
  await pool.query(`DELETE FROM patients WHERE patient_id = $1`, [`${MARKER}-pat`]);
  await pool.query(`DELETE FROM pr_i6_stalls`).catch(() => {});
}

// ----------------------------------------------------------------------------
// Interleaving control. The scenario worth proving is a writer that never takes
// the #997/#998 advisory lock — the whole reason a database constraint is needed.
// The application's own insert is parked inside its transaction (after the
// in-transaction re-check, before the row lands) while the unlocked writer
// commits the same pair, so the loser is the application and the outcome is
// fixed rather than a coin flip.
//
// Two properties make this deterministic:
//  * the trigger stalls only the application's writer, identified by the
//    sentinel report_ref the unlocked insert uses; and
//  * the trigger only READS its arm row. An UPDATE here would take a row lock
//    that the unlocked writer's own trigger fires behind, serialising the two
//    transactions — which is precisely the interleaving being tested. That
//    lock, not the code under test, is what made the first version of this
//    harness always lose the race.
// ----------------------------------------------------------------------------
const UNLOCKED_REF = "PR-I6 unlocked writer";

const FAULT_SCHEMA = `
CREATE TABLE IF NOT EXISTS pr_i6_stalls (referral_id int NOT NULL, care_report_id int NOT NULL, PRIMARY KEY (referral_id, care_report_id));
CREATE OR REPLACE FUNCTION pr_i6_stall_link() RETURNS trigger AS $f$
  BEGIN
    IF NEW.report_ref IS DISTINCT FROM '${UNLOCKED_REF}' THEN
      IF EXISTS (SELECT 1 FROM pr_i6_stalls s
                  WHERE s.referral_id = NEW.referral_id AND s.care_report_id = NEW.care_report_id) THEN
        PERFORM pg_sleep(0.45);
      END IF;
    END IF;
    RETURN NEW;
  END $f$ LANGUAGE plpgsql;
`;

const stallPair = (referralId: number, reportId: number) =>
  pool.query(
    `INSERT INTO pr_i6_stalls (referral_id, care_report_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
    [referralId, reportId],
  );

/** Is some session parked in the trigger's sleep, mid-insert into the link table? */
const writerIsStalled = async () => {
  // Readable from another backend because a wait event is session state, not row
  // state: nothing here needs the stalled transaction to have committed.
  const r = await pool.query(
    `SELECT 1 AS x FROM pg_stat_activity
      WHERE state = 'active' AND wait_event_type = 'Timeout' AND wait_event = 'PgSleep'
        AND query ILIKE '%external_result_links%'
      LIMIT 1`,
  );
  return (r.rowCount ?? 0) > 0;
};

/**
 * Run `startWriter` (an application delivery path) and commit the same
 * (referral, report) pair from a connection that takes no advisory lock, proven
 * to happen while that writer is inside its own check-then-insert window.
 */
async function raceUnlockedWriter<T>(
  referralId: number,
  reportId: number,
  startWriter: () => Promise<T>,
): Promise<T> {
  await stallPair(referralId, reportId);
  const pending = startWriter();

  // Observe the stall instead of sleeping a fixed guess: once the writer is
  // provably parked, the unlocked insert has the rest of the 0.45 s to itself.
  let stalled = false;
  for (let i = 0; i < 300 && !stalled; i++) {
    stalled = await writerIsStalled();
    if (!stalled) await new Promise((r) => setTimeout(r, 20));
  }
  if (!stalled) {
    await pending.catch(() => null);
    throw new Error(
      `setup: the application writer never entered the stall window for pair (${referralId}, ${reportId}), `
      + `so no race took place — links after the pass: ${(await linksFor(referralId, reportId)).length}`,
    );
  }

  const unlockedError = await pool
    .query(
      `INSERT INTO external_result_links (referral_id, referral_item_id, care_report_id, result_type, report_status, report_ref)
       VALUES ($1,NULL,$2,'radiology','final',$3)`,
      [referralId, reportId, UNLOCKED_REF],
    )
    .then(() => "")
    .catch((e: any) => String(e?.message ?? e).split("\n")[0]);
  if (unlockedError) {
    await pending.catch(() => null);
    throw new Error(
      `setup: the unlocked writer could not commit (${unlockedError}, links now `
      + `${(await linksFor(referralId, reportId)).length}) — no race took place`,
    );
  }

  return await pending;
}

let emit: typeof import("./emitReportToHope");
let emitter: typeof import("./resultsEmitter");

beforeAll(async () => {
  if (!hasDb) return;
  await pool.query(FAULT_SCHEMA);
  await pool.query(`DROP TRIGGER IF EXISTS pr_i6_stall_link ON external_result_links`);
  await pool.query(`CREATE TRIGGER pr_i6_stall_link BEFORE INSERT ON external_result_links FOR EACH ROW EXECUTE FUNCTION pr_i6_stall_link()`);
  emit = await import("./emitReportToHope");
  emitter = await import("./resultsEmitter");
});

afterAll(async () => {
  if (!hasDb) return;
  await clearAll();
  await pool.query(`DROP TRIGGER IF EXISTS pr_i6_stall_link ON external_result_links`);
  await pool.query(`DROP FUNCTION IF EXISTS pr_i6_stall_link() CASCADE`);
  await pool.query(`DROP TABLE IF EXISTS pr_i6_stalls`);
  await pool.end();
});

beforeEach(async () => {
  if (!hasDb) return;
  await clearAll();
  patientId = await ensurePatient();
  testId = await ensureTest();
});

describe.skipIf(!hasDb)("external_result_links — database-level identity", () => {

  it("I1 — refuses an exact (referral, report) duplicate for an item-less referral", async () => {
    const { referralId, reportId } = await insertPair("i1", { withItem: false });
    const first = await insertLink(referralId, reportId, null);
    expect(first.ok).toBe(true);

    const second = await insertLink(referralId, reportId, null);
    expect(second.ok,
      `the same signed report was linked twice to one referral (rows=${(await linksFor(referralId, reportId)).length}) — `
      + "the only unique index keys on referral_item_id, and NULLs are distinct")
      .toBe(false);
    expect(String(second.constraint ?? "")).toMatch(/external_result_links/);
    expect((await linksFor(referralId, reportId)).length).toBe(1);
  });

  it("I2 — refuses the same report reached through a second item of one referral", async () => {
    const a = await insertPair("i2", { withItem: true });
    const itemB = await insertSecondItemOfReferral(a.referralId, a.careOrderId);
    // The fixture must be what the case claims: two items, ONE referral. If itemB
    // belonged to another referral this would prove nothing about the item key.
    const owners = await pool.query(
      `SELECT id, referral_id FROM diagnostic_referral_items WHERE id = ANY($1)`, [[a.itemId, itemB]]);
    expect(owners.rows.map((r: any) => Number(r.referral_id)).sort(),
      `the two items must belong to referral ${a.referralId}`)
      .toEqual([a.referralId, a.referralId]);

    const first = await insertLink(a.referralId, a.reportId, a.itemId);
    expect(first.ok).toBe(true);
    const second = await insertLink(a.referralId, a.reportId, itemB);
    expect(second.ok,
      `one report was linked to one referral twice through two different items `
      + `(rows=${(await linksFor(a.referralId, a.reportId)).length}) — the item-keyed index sees two keys, `
      + "the business fact is one result")
      .toBe(false);
    expect((await linksFor(a.referralId, a.reportId)).length).toBe(1);
  });

  it("I3 — two concurrent writers that bypass the advisory lock cannot both commit", async () => {
    const { referralId, reportId } = await insertPair("i3", { withItem: false });
    const [x, y] = await Promise.all([
      insertLink(referralId, reportId, null),
      pool.query(
        `INSERT INTO external_result_links (referral_id, referral_item_id, care_report_id, result_type, report_status, report_ref)
         VALUES ($1,NULL,$2,'radiology','final','PR-I6 direct 2') RETURNING id`, [referralId, reportId])
          .then((r) => ({ ok: true as const, id: Number(r.rows[0].id) }))
          .catch((e: any) => ({ ok: false as const, code: e?.code, constraint: e?.constraint })),
    ]);
    const rows = await linksFor(referralId, reportId);
    expect(Number(x.ok) + Number(y.ok), `both unlocked writers were accepted (${rows.length} rows)`).toBe(1);
    expect(rows.length).toBe(1);
  });

  it("I4 — several reports may still be linked to one referral (final then amended)", async () => {
    const pair = await insertPair("i4", { withItem: true });
    // An amendment is a NEW signed patient_reports row chained through
    // patient_report_amendments, so it must land as its own link. A constraint that
    // keyed on something coarser than the report id (referral alone, or referral +
    // order) would refuse this and silently stop corrected results reaching the
    // hospital — the sharpest way to lose a corrected signed report.
    const first = await insertLink(pair.referralId, pair.reportId, pair.itemId);
    const amended = await insertAmendedReport(pair);
    const second = await insertLink(pair.referralId, amended.amendedReportId, pair.itemId, "amended");
    expect(first.ok && second.ok).toBe(true);
    const rows = await linksFor(pair.referralId);
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.report_status).sort()).toEqual(["amended", "final"]);
  });

  it("I5 — several items on one referral each keep their own result link", async () => {
    const referralOnly = await insertPair("i5-base", { withItem: false });
    const { referralId } = referralOnly;
    const itemA = await insertPair("i5-a", { withItem: true });
    const itemB = await insertPair("i5-b", { withItem: true });
    // Two distinct tests, two distinct reports, one referral — the ordinary clinic
    // case of a panel referral. Nothing here may be constrained away.
    await pool.query(`UPDATE diagnostic_referral_items SET referral_id = $1 WHERE id = ANY($2::int[])`,
      [referralId, [itemA.itemId, itemB.itemId]]);
    const a = await insertLink(referralId, itemA.reportId, itemA.itemId);
    const b = await insertLink(referralId, itemB.reportId, itemB.itemId);
    expect(a.ok && b.ok).toBe(true);
    expect((await linksFor(referralId)).length).toBe(2);
  });

  it("I6 — a link row that carries no report id is still allowed", async () => {
    // The outbox write-back from #996 anchors on referral + emitted_outbox_id with
    // no report at all (outboxRecovery.db.test.ts:136). A constraint written with
    // NULLS NOT DISTINCT, or on the wrong column set, would start refusing that
    // legitimate shape — this test is the fence against over-reach.
    const { referralId } = await insertPair("i6", { withItem: false });
    const outboxIds: number[] = [];
    for (let i = 0; i < 2; i++) {
      const ev = await pool.query(
        `INSERT INTO integration_outbox (event_id, event_type, event_version, idempotency_key, aggregate_type, destination_org, payload, status, next_attempt_at)
         VALUES ($1,'diagnostic_result.critical','1.0',$2,'diagnostic_referral','HOPE','{}'::jsonb,'pending', now()) RETURNING id`,
        [`${MARKER}-i6-evt-${i}-${Date.now()}`, `${MARKER}-i6-key-${i}-${Date.now()}`]);
      outboxIds.push(Number(ev.rows[0].id));
    }
    const first = await pool.query(
      `INSERT INTO external_result_links (referral_id, emitted_outbox_id, result_type) VALUES ($1,$2,'radiology') RETURNING id`,
      [referralId, outboxIds[0]]);
    let secondError: any = null;
    try {
      await pool.query(
        `INSERT INTO external_result_links (referral_id, emitted_outbox_id, result_type) VALUES ($1,$2,'radiology') RETURNING id`,
        [referralId, outboxIds[1]]);
    } catch (e) { secondError = e; }
    expect(Number(first.rows[0].id) > 0).toBe(true);
    expect(secondError,
      `a report-less link row was refused (${String(secondError?.message ?? "").split("\n")[0]}) — `
      + "the index must stay partial on care_report_id IS NOT NULL").toBeNull();
  });

  it("I7 — the index that now exists is the one the application already treats as identity", async () => {
    const idx = await uniqueIndexes();
    const names = idx.map((r) => `${r.name}(${r.colList.join(",")})${r.is_partial ? " partial" : ""}${r.nulls_not_distinct ? " NULLS_NOT_DISTINCT" : ""}`);
    const pair = idx.filter((r) => r.name !== "external_result_links_pkey"
      && r.colList.length === 2 && r.colList.includes("referral_id") && r.colList.includes("care_report_id"));
    expect(pair.length,
      `no unique index on exactly (referral_id, care_report_id); indexes are: ${names.join(" | ")}`)
      .toBeGreaterThan(0);
    // Partial, not total: a link row with no report is a legitimate shape (I6).
    expect(pair.every((r) => r.is_partial),
      `the new index must be partial on care_report_id IS NOT NULL; indexes are: ${names.join(" | ")}`)
      .toBe(true);
    // And it must leave those report-less rows alone, which NULLS NOT DISTINCT would
    // not: PostgreSQL 15+ can collapse NULLs into one slot, and on this table that
    // would refuse a row shape the outbox write-back depends on.
    expect(pair.every((r) => !r.nulls_not_distinct),
      `the new index must not use NULLS NOT DISTINCT; indexes are: ${names.join(" | ")}`)
      .toBe(true);
    // And the item/study indexes it sits beside were not quietly dropped.
    expect(idx.some((r) => r.name === "external_result_links_report_uidx"),
      `the pre-existing item-keyed index disappeared; indexes are: ${names.join(" | ")}`).toBe(true);
  });

  it("I8 — emitReportToHope does not claim a delivery the database refused", async () => {
    // The writer's own re-check is atomic against the #998 advisory lock, but a
    // future path that ignores the lock is exactly what this index is for. Stall the
    // application's insert, land a direct row meanwhile, and see what the operator is
    // told: either "already sent" or a failure — never "this call sent it".
    const { referralId, reportId, referralUuid } = await insertPair("i8", { withItem: false });

    const result = await raceUnlockedWriter(referralId, reportId, () =>
      emit.emitReportToHope({ reportId, worklistId: null, dispatchNow: false }));

    const rows = await linksFor(referralId, reportId);
    expect(rows.length,
      `the report ended up linked ${rows.length} times for one (referral, report) pair`)
      .toBe(1);
    // Which row survived is the measurement: if the unlocked writer's row is the one
    // on disk, emitReportToHope's insert really was refused and it is being asked to
    // report a delivery it did not make. If the app's own row survived instead, the
    // race never happened and this test proves nothing — so say so rather than pass.
    expect(rows[0].report_ref,
      "the race did not engage: emitReportToHope wrote the only link row, so nothing was refused").toBe(UNLOCKED_REF);
    if (!result.ok) {
      throw new Error(`emitReportToHope reported the refused race as a plain failure (${result.error}) `
        + "although a committed link for this pair does exist");
    }
    expect(result.emitted,
      `emitReportToHope reported emitted:true although its insert was refused: ${JSON.stringify(result)}`)
      .toBe(false);
    // A committed link from another writer IS the honest answer for this call.
    expect(result.alreadySent,
      `the refused emit answered ${JSON.stringify(result)}`).toBe(true);
    // And the rolled-back unit left no delivery event behind — the local fact, not a
    // global counter: an event here would tell HOPE about a result CARE never linked.
    const events = await eventsFor(referralUuid);
    expect(events.length, `the refused emit queued ${events.length} delivery event(s) for one result`).toBe(0);
  });

  it("I9 — reconcileResults counts the refused duplicate as failed work, not as work done", async () => {
    // #997's rule: a transaction that wrote nothing may not be reported as an
    // emission. The index makes that reachable on the item-less shape the old
    // item-keyed index could not see, so the reconciler's own bookkeeping is what is
    // under test. A canary pair is reconciled first, on its own, to learn what a clean
    // pass reports as failed on this database — without it a `failed` assertion could
    // be satisfied by unrelated rows in the scratch schema.
    const canary = await insertPair("i9-canary", { withItem: false });
    const control = await emitter.reconcileResults({ limit: 500 });
    expect((await linksFor(canary.referralId, canary.reportId)).length,
      "setup: the canary report was not reconciled, so the pass is not measuring what this test thinks")
      .toBe(1);

    // The pair under test is created AFTER the control pass, so the control cannot
    // link it out of existence.
    const pair = await insertPair("i9-race", { withItem: false });
    const after = await raceUnlockedWriter(pair.referralId, pair.reportId, () =>
      emitter.reconcileResults({ limit: 500 }));

    const rows = await linksFor(pair.referralId, pair.reportId);
    expect(rows.length, `the reconciler raced an unlocked writer and left ${rows.length} links for one report`)
      .toBe(1);
    expect(rows[0].report_ref,
      `the reconciler wrote the surviving link row, so its insert was never refused (failed=${after.failed})`)
      .toBe(UNLOCKED_REF);
    expect(after.failed,
      `the refused insert was not counted as failed work (control pass failed=${control.failed}, this pass failed=${after.failed})`)
      .toBeGreaterThan(control.failed);
    // The local fact, not the global counter: a rolled-back unit must have left no
    // delivery event behind, or HOPE would be told about a result CARE never queued.
    const events = await eventsFor(pair.referralUuid);
    expect(events.length,
      `the refused reconciler pass still queued ${events.length} delivery event(s) for the raced report`)
      .toBe(0);
  });

});
