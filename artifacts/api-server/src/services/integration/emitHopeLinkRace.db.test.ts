// ============================================================================
// PR-I4 — emitReportToHope must not let two deliveries of one report write two
// links, and must never report a delivery it did not make.
//
// The two entry points are the "Send to Hope" button
// (diagnostic-erp/src/components/radiology/workspace/WorkspaceTopBar.tsx:682)
// and the post-finalize auto-push (…/hooks/radiology-workspace/useStudyFinalize.ts:579).
// Both POST /api/internal/radiology/send-report-to-hope
// (api-server/src/routes/internal-radiology.ts:1912), which calls emitReportToHope
// directly. `sendHopeBusy` disables the button only for its own click, and the
// auto-push is fired with `void api.post(...)` and never awaits — so signing a
// report on a Hope-linked study and clicking Send while the toast is still
// arriving is two concurrent calls for the same (referral, report) pair. A third
// writer of the same pair is the 5-minute reconcileResults tick (#997).
//
// Real PostgreSQL, because the defect is a property of two transactions
// interleaving against a unique index that does not cover this row shape. The
// fixture chain is created for real (patient → order → referral → report, plus
// order_tests + diagnostic_referral_items for the item-linked shape) so foreign
// keys, the partial unique index, the state machine and the idempotency key all
// behave as they do in the clinic. Every row is synthetic and marker-scoped
// (`pr-i4-hope-link`); never the production database. `dispatchNow: false` keeps
// these tests on the enqueue side only — nothing is sent anywhere.
//
// Runs against its own scratch database. The neighbouring outbox suite asserts
// global dispatch counters, so keep shared-DB suites sequential.
// ============================================================================
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const hasDb = !!DATABASE_URL;
const pool = new Pool({ connectionString: DATABASE_URL, max: 10 });

const MARKER = "pr-i4-hope-link";
const uuidFor = (n: number | string) => `${MARKER}:${n}`;

let patientId = 0;
let testId = 0;

async function ensurePatient() {
  const r = await pool.query(
    `INSERT INTO patients (patient_id, first_name, last_name, date_of_birth, gender, phone)
     VALUES ($1,'Hope','Synthetic','1980-01-01','male','+00000000000')
     ON CONFLICT DO NOTHING RETURNING id`,
    [`${MARKER}-pat`],
  );
  if (r.rows[0]) return Number(r.rows[0].id);
  const e = await pool.query(`SELECT id FROM patients WHERE patient_id = $1`, [`${MARKER}-pat`]);
  return Number(e.rows[0].id);
}

async function ensureTest() {
  const r = await pool.query(
    `INSERT INTO diagnostic_tests (code, name, category, price, duration)
     VALUES ($1,'PR-I4 Synthetic Test','radiology',100,'1 day')
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [`${MARKER}-test`],
  );
  return Number(r.rows[0].id);
}

/**
 * A signed report on an order that a Hope referral points at — the exact input
 * `emitReportToHope` receives from the button and from the auto-push.
 */
async function insertPair(n: number, opts: {
  status?: string;
  withItem?: boolean;
  critical?: boolean;
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
     VALUES (COALESCE($5, nextval('diagnostic_referrals_id_seq')),$1,$2,'PR-I4 Synthetic',$3,$4) RETURNING id`,
    [referralUuid, `${MARKER}-uhid-${n}`, opts.status ?? "IN_PROGRESS", careOrderId, opts.id ?? null],
  );
  const referralId = Number(ref.rows[0].id);

  const rp = await pool.query(
    `INSERT INTO patient_reports (report_number, patient_id, test_id, order_id, type, status, title, is_critical, signed_by_name, signed_at)
     VALUES ($1,$2,$3,$4,'radiology','verified','PR-I4 synthetic signed report',$5,'Hope Radiologist', now()) RETURNING id`,
    [`${referralUuid}-rpt`, patientId, 1, careOrderId, opts.critical ?? false],
  );
  const reportId = Number(rp.rows[0].id);

  let itemId: number | null = null;
  if (opts.withItem) {
    const ot = await pool.query(
      `INSERT INTO order_tests (order_id, test_id, price) VALUES ($1,$2,100) RETURNING id`,
      [careOrderId, testId],
    );
    const orderTestId = Number(ot.rows[0].id);
    const it0 = await pool.query(
      `INSERT INTO diagnostic_referral_items (referral_id, source_test_name, care_order_test_id)
       VALUES ($1,'PR-I4 synthetic test',$2) RETURNING id`,
      [referralId, orderTestId],
    );
    itemId = Number(it0.rows[0].id);
    await pool.query(`UPDATE patient_reports SET order_test_id = $1 WHERE id = $2`, [orderTestId, reportId]);
  }

  return { referralId, careOrderId, reportId, itemId, referralUuid };
}

async function linksFor(referralId: number) {
  const r = await pool.query(
    `SELECT id, care_report_id, referral_item_id, emitted_outbox_id, report_status
       FROM external_result_links WHERE referral_id = $1 ORDER BY id`,
    [referralId],
  );
  return r.rows as Array<{ id: number; care_report_id: number; referral_item_id: number | null; emitted_outbox_id: number | null; report_status: string }>;
}

async function eventsFor(referralUuid: string) {
  const r = await pool.query(
    `SELECT id, event_id, event_type, idempotency_key, status FROM integration_outbox WHERE correlation_id = $1 ORDER BY id`,
    [referralUuid],
  );
  return r.rows as Array<{ id: number; event_id: string; event_type: string; idempotency_key: string; status: string }>;
}

async function statusOf(referralId: number) {
  const r = await pool.query(`SELECT status FROM diagnostic_referrals WHERE id = $1`, [referralId]);
  return r.rows[0]?.status ?? null;
}

async function itemStatusOf(itemId: number) {
  const r = await pool.query(`SELECT item_status FROM diagnostic_referral_items WHERE id = $1`, [itemId]);
  return r.rows[0]?.item_status ?? null;
}

async function referralEventKinds(referralId: number) {
  const r = await pool.query(
    `SELECT event_type, count(*)::int AS n FROM diagnostic_referral_events WHERE referral_id = $1 GROUP BY event_type`,
    [referralId],
  );
  return r.rows as Array<{ event_type: string; n: number }>;
}

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
  await pool.query(`DELETE FROM diagnostic_tests WHERE code = $1`, [`${MARKER}-test`]);
  await pool.query(`DELETE FROM patients WHERE patient_id = $1`, [`${MARKER}-pat`]);
  await pool.query(`DELETE FROM pr_i4_refusals`);
  await pool.query(`DELETE FROM pr_i4_stalls`);
}

// ----------------------------------------------------------------------------
// Fault injection and interleaving control, all keyed by name so nothing is ever
// interpolated into SQL. The clinic's real failures are a constraint or a
// concurrent commit; a stub cannot reproduce either, so these are database
// triggers that refuse or delay one specific marker row.
//
//  - refusals   : make one INSERT raise, as a constraint violation would.
//  - stalls     : make the SECOND result-link insert for one (referral, report)
//    wait 300 ms. That is not a new product behaviour, it is a window widening:
//    it guarantees the losing call passes the pre-check, writes its link, and
//    then sees the winner's committed outbox event — the interleaving in which
//    the unfixed code produces two links for one report. Without it the race is
//    a coin flip, and a coin flip is not evidence.
// ----------------------------------------------------------------------------
const FAULT_SCHEMA = `
CREATE TABLE IF NOT EXISTS pr_i4_refusals (kind text NOT NULL, key text NOT NULL, PRIMARY KEY (kind, key));
CREATE TABLE IF NOT EXISTS pr_i4_stalls (referral_id int NOT NULL, care_report_id int NOT NULL, seen int NOT NULL DEFAULT 0, PRIMARY KEY (referral_id, care_report_id));
CREATE OR REPLACE FUNCTION pr_i4_refuse_outbox() RETURNS trigger AS $f$
  BEGIN
    IF EXISTS (SELECT 1 FROM pr_i4_refusals r WHERE r.kind = 'outbox' AND r.key = NEW.correlation_id) THEN
      RAISE EXCEPTION 'pr-i4 forced failure on the outbox insert';
    END IF;
    RETURN NEW;
  END $f$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION pr_i4_refuse_link() RETURNS trigger AS $f$
  BEGIN
    IF EXISTS (SELECT 1 FROM pr_i4_refusals r WHERE r.kind = 'link' AND r.key = NEW.referral_id::text) THEN
      RAISE EXCEPTION 'pr-i4 forced failure on the result-link insert';
    END IF;
    IF EXISTS (SELECT 1 FROM pr_i4_stalls s WHERE s.referral_id = NEW.referral_id AND s.care_report_id = NEW.care_report_id) THEN
      UPDATE pr_i4_stalls SET seen = seen + 1
        WHERE referral_id = NEW.referral_id AND care_report_id = NEW.care_report_id;
      IF (SELECT seen FROM pr_i4_stalls WHERE referral_id = NEW.referral_id AND care_report_id = NEW.care_report_id) >= 2 THEN
        PERFORM pg_sleep(0.3);
      END IF;
    END IF;
    RETURN NEW;
  END $f$ LANGUAGE plpgsql;
`;

async function refuse(kind: "outbox" | "link", key: string) {
  await pool.query(`INSERT INTO pr_i4_refusals (kind, key) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [kind, key]);
}
async function allowAgain(kind: "outbox" | "link", key: string) {
  await pool.query(`DELETE FROM pr_i4_refusals WHERE kind = $1 AND key = $2`, [kind, key]);
}
async function stallSecondLink(referralId: number, reportId: number) {
  await pool.query(`INSERT INTO pr_i4_stalls (referral_id, care_report_id, seen) VALUES ($1,$2,0) ON CONFLICT DO NOTHING`, [referralId, reportId]);
}

let emit: typeof import("./emitReportToHope");
let emitter: typeof import("./resultsEmitter");

const sendNow = async (reportId: number, worklistId: number | null = null) =>
  emit.emitReportToHope({ reportId, worklistId, dispatchNow: false });

beforeAll(async () => {
  if (!hasDb) return;
  await pool.query(FAULT_SCHEMA);
  await pool.query(`DROP TRIGGER IF EXISTS pr_i4_refuse_outbox ON integration_outbox`);
  await pool.query(`CREATE TRIGGER pr_i4_refuse_outbox BEFORE INSERT ON integration_outbox FOR EACH ROW EXECUTE FUNCTION pr_i4_refuse_outbox()`);
  await pool.query(`DROP TRIGGER IF EXISTS pr_i4_refuse_link ON external_result_links`);
  await pool.query(`CREATE TRIGGER pr_i4_refuse_link BEFORE INSERT ON external_result_links FOR EACH ROW EXECUTE FUNCTION pr_i4_refuse_link()`);
  emit = await import("./emitReportToHope");
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
  // Leave the scratch database as found: these triggers sit on tables other
  // suites in this cluster write.
  await pool.query(`DROP TRIGGER IF EXISTS pr_i4_refuse_outbox ON integration_outbox`);
  await pool.query(`DROP TRIGGER IF EXISTS pr_i4_refuse_link ON external_result_links`);
  await pool.query(`DROP FUNCTION IF EXISTS pr_i4_refuse_outbox()`);
  await pool.query(`DROP FUNCTION IF EXISTS pr_i4_refuse_link()`);
  await pool.query(`DROP TABLE IF EXISTS pr_i4_refusals`);
  await pool.query(`DROP TABLE IF EXISTS pr_i4_stalls`);
  await pool.end();
});

const suite = hasDb ? describe : describe.skip;

suite("PR-I4 emitReportToHope duplicate-link race (real PostgreSQL)", () => {
  it("H1 — two concurrent sends of one report write one link, and only one call may claim it delivered", async () => {
    const f = await insertPair(1);
    await stallSecondLink(f.referralId, f.reportId);

    const [x, y] = await Promise.all([sendNow(f.reportId), sendNow(f.reportId)]);

    const links = await linksFor(f.referralId);
    expect(links.length).toBe(1);
    expect(links[0].care_report_id).toBe(f.reportId);

    // Exactly one call wrote the unit. The other either found it already sent or
    // failed — it may not also report success, because that is what a clinician
    // reads as "Hope has it".
    const claims = [x, y].filter((r) => r.ok === true && r.emitted === true);
    expect(claims.length).toBe(1);
    for (const r of [x, y]) {
      if (r.ok && !r.emitted) expect(r.alreadySent).toBe(true);
    }

    const evs = await eventsFor(f.referralUuid);
    expect(evs.length).toBe(1);
    expect(evs[0].idempotency_key).toBe(`diagnostic_report.finalised:${f.referralUuid}:${f.reportId}`);
  });

  it("H2 — a send concurrent with the reconcile tick writes one link", async () => {
    // The third writer of the same pair is the 5-minute reconciler (#997). Its
    // guard is only effective if this path takes the same lock.
    const f = await insertPair(2);
    await stallSecondLink(f.referralId, f.reportId);

    const [sent, reconciled] = await Promise.all([
      sendNow(f.reportId),
      emitter.reconcileResults({ limit: 100 }),
    ]);

    expect((await linksFor(f.referralId)).length).toBe(1);
    expect(await eventsFor(f.referralUuid)).toHaveLength(1);
    const claims = [sent.ok && sent.emitted === true, reconciled.emitted === 1].filter(Boolean).length;
    expect(claims).toBeLessThanOrEqual(1);
  });

  it("H3 — an item-less referral is protected (the shape the unique index cannot cover)", async () => {
    // external_result_links_report_uidx is (referral_item_id, care_report_id), and
    // PostgreSQL treats NULLs as distinct, so with no item line nothing in the
    // schema stops a second link. This is the shape most Hope referrals arrive as.
    const f = await insertPair(3);
    expect(f.itemId).toBeNull();
    await stallSecondLink(f.referralId, f.reportId);

    await Promise.all([sendNow(f.reportId), sendNow(f.reportId)]);

    const links = await linksFor(f.referralId);
    expect(links.length).toBe(1);
    expect(links[0].referral_item_id).toBeNull();
  });

  it("H4 — an item-linked referral keeps its line association under concurrency", async () => {
    const f = await insertPair(4, { withItem: true });
    await stallSecondLink(f.referralId, f.reportId);

    const [x, y] = await Promise.all([sendNow(f.reportId), sendNow(f.reportId)]);

    const links = await linksFor(f.referralId);
    expect(links.length).toBe(1);
    expect(links[0].referral_item_id).toBe(f.itemId);
    expect(links[0].emitted_outbox_id).not.toBeNull();
    expect(await itemStatusOf(f.itemId!)).toBe("reported");

    // This is the shape the unique index DOES cover, so no duplicate link appears
    // — and it is still wrong: the loser's insert error is swallowed, its
    // transaction rolls back, and the call answers `emitted: true`. One association
    // test cannot tell a delivered report from a rolled-back one; this can.
    const claims = [x, y].filter((r) => r.ok === true && r.emitted === true);
    expect(claims.length).toBe(1);
  });

  it("H5 — a refused link insert is never reported as a successful delivery", async () => {
    // This is the phantom: the INSERT error is swallowed inside the transaction,
    // PostgreSQL turns the COMMIT into a rollback but the promise still resolves,
    // and the caller answers `emitted: true` for a unit that wrote nothing.
    const f = await insertPair(5);
    await refuse("link", String(f.referralId));

    const r = await sendNow(f.reportId);

    expect(r.ok).toBe(false);
    expect(await linksFor(f.referralId)).toEqual([]);
    expect(await eventsFor(f.referralUuid)).toEqual([]);

    // Cleared: the retry delivers for real.
    await allowAgain("link", String(f.referralId));
    const again = await sendNow(f.reportId);
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.emitted).toBe(true);
    expect((await linksFor(f.referralId)).length).toBe(1);
  });

  it("H6 — a refused outbox insert fails only its own report", async () => {
    const bad = await insertPair(6001);
    const good = await insertPair(6002);
    await refuse("outbox", bad.referralUuid);

    const rBad = await sendNow(bad.reportId);
    const rGood = await sendNow(good.reportId);

    expect(rBad.ok).toBe(false);
    expect(await linksFor(bad.referralId)).toEqual([]);
    expect(await eventsFor(bad.referralUuid)).toEqual([]);
    expect(rGood.ok).toBe(true);
    expect((await linksFor(good.referralId)).length).toBe(1);

    await allowAgain("outbox", bad.referralUuid);
    const retry = await sendNow(bad.reportId);
    expect(retry.ok).toBe(true);
    expect((await linksFor(bad.referralId)).length).toBe(1);
  });

  it("H7 — repeated sends are idempotent on the existing key", async () => {
    const f = await insertPair(7);

    const first = await sendNow(f.reportId);
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.emitted).toBe(true);

    const second = await sendNow(f.reportId);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.emitted).toBe(false);
      expect(second.alreadySent).toBe(true);
    }

    const links = await linksFor(f.referralId);
    expect(links.length).toBe(1);
    const evs = await eventsFor(f.referralUuid);
    expect(evs.length).toBe(1);
    expect(evs[0].event_id).toBeTruthy();
  });

  it("H8 — the successful send still delivers, audits and advances the header", async () => {
    // Guard: nothing in this PR may cost the path what it already did.
    const f = await insertPair(8, { status: "IN_PROGRESS" });

    const r = await sendNow(f.reportId);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.emitted).toBe(true);
    expect(r.referralUuid).toBe(f.referralUuid);

    const links = await linksFor(f.referralId);
    expect(links.length).toBe(1);
    expect(links[0].emitted_outbox_id).not.toBeNull();
    expect(links[0].report_status).toBe("final");

    const evs = await eventsFor(f.referralUuid);
    expect(evs.length).toBe(1);
    expect(evs[0].event_type).toBe("diagnostic_report.finalised");

    expect(await statusOf(f.referralId)).toBe("REPORTED");
    const kinds = await referralEventKinds(f.referralId);
    expect(kinds.map((k) => k.event_type)).toContain("report.finalised");
  });
});
