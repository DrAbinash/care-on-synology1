/**
 * One paid examination must not be lost because its ORDER-mate is already booked.
 *
 * The 2026-11-06 echo deploy measured this in production: the 48h missing-study
 * sweep failed 14 orders with
 *   duplicate key value violates unique constraint "radiology_studies_order_test_uq"
 * thrown out of generateStudiesForOrder, even though the fan-out's own catch is
 * written to treat exactly that name as an idempotent skip. Every failing order
 * carried one examination that already had a study row (an MRI booked yesterday)
 * plus one that had none (the paid echo). The duplicate aborted the whole order,
 * so the second examination was never created and the sweep re-failed on it every
 * 15 minutes.
 *
 * So the contract is: a per-test conflict skips THAT test and the remaining
 * tests on the order still become studies. This file reproduces it against real
 * PostgreSQL because a stubbed database cannot show what the driver actually
 * throws.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const hasDb = !!process.env.DATABASE_URL;
const suite = hasDb ? describe : describe.skip;

const MARKER = `MIXED${Date.now() % 1_000_000}`;

let pool: Pool;
const ids = {
  patientId: 0,
  mriTestId: 0,
  echoTestId: 0,
  deviceId: 0,
  orderId: 0,
  orderTestId: 0,
  echoOrderTestId: 0,
  bookedStudyId: 0,
  billId: 0,
  echoOnlyOrder: { orderId: 0, orderTestId: 0, testId: 0, billId: 0 },
};

async function seed(): Promise<void> {
  const pat = await pool.query(
    `insert into patients (patient_id, first_name, last_name, date_of_birth, gender, phone)
     values ($1, 'Synthetic', 'Case', '1980-01-01', 'F', '0000000000') returning id`,
    [`${MARKER}-PAT`],
  );
  ids.patientId = pat.rows[0].id;

  const dev = await pool.query(
    `insert into modalities (name, code) values ($1, $2) returning id`,
    [`USG SYNTH VOLUSON ${MARKER}`, `${MARKER}-DEV`],
  );
  ids.deviceId = dev.rows[0].id;

  const tests = await pool.query(
    `insert into diagnostic_tests (code, name, category, price, duration, department, modality_id)
     values
       ($1, $2, 'Imaging', 1000, '30 min', 'MRI', null),
       ($3, $4, 'Cardiology', 800, '30 min', 'Cardiology', $5)
     returning id, name`,
    [`${MARKER}-MR`, `${MARKER} MRI BRAIN`, `${MARKER}-ECHO`, `${MARKER} ECHO`, ids.deviceId],
  );
  ids.mriTestId = Number(tests.rows[0].id);
  ids.echoTestId = Number(tests.rows[1].id);

  // Order A: an MRI examination that is ALREADY booked, plus the paid echo.
  const ord = await pool.query(
    `insert into orders (order_number, patient_id) values ($1, $2) returning id`,
    [`${MARKER}-O1`, ids.patientId],
  );
  ids.orderId = ord.rows[0].id;

  const bookedTest = await pool.query(
    `insert into order_tests (order_id, test_id, price) values ($1, $2, 1000) returning id`,
    [ids.orderId, ids.mriTestId],
  );
  ids.orderTestId = bookedTest.rows[0].id;
  const echoTest = await pool.query(
    `insert into order_tests (order_id, test_id, price) values ($1, $2, 800) returning id`,
    [ids.orderId, ids.echoTestId],
  );
  ids.echoOrderTestId = echoTest.rows[0].id;

  const bill = await pool.query(
    `insert into bills (bill_number, order_id, patient_id, status) values ($1, $2, $3, 'paid') returning id`,
    [`${MARKER}-B1`, ids.orderId, ids.patientId],
  );
  ids.billId = bill.rows[0].id;

  await pool.query(
    `insert into radiology_studies
       (accession_number, bill_id, order_id, order_test_id, patient_id, test_id,
        modality, department, status, study_date, study_description)
     values ($1, $2, $3, $4, $5, $6, 'MR', 'MRI', 'acquired', current_date, $7)
     returning id`,
    [`${MARKER}-MR-001`, ids.billId, ids.orderId, ids.orderTestId, ids.patientId, ids.mriTestId, `${MARKER} MRI BRAIN`],
  ).then((r) => { ids.bookedStudyId = r.rows[0].id; });

  // Order B: a paid echo alone — what the safety net is supposed to heal.
  const ord2 = await pool.query(
    `insert into orders (order_number, patient_id) values ($1, $2) returning id`,
    [`${MARKER}-O2`, ids.patientId],
  );
  const t2 = await pool.query(
    `insert into order_tests (order_id, test_id, price) values ($1, $2, 800) returning id`,
    [ord2.rows[0].id, ids.echoTestId],
  );
  const b2 = await pool.query(
    `insert into bills (bill_number, order_id, patient_id, status) values ($1, $2, $3, 'paid') returning id`,
    [`${MARKER}-B2`, ord2.rows[0].id, ids.patientId],
  );
  ids.echoOnlyOrder = {
    orderId: ord2.rows[0].id,
    orderTestId: t2.rows[0].id,
    testId: ids.echoTestId,
    billId: b2.rows[0].id,
  };
}

async function cleanup(): Promise<void> {
  // The fan-out mints REAL accessions (ACC-…), so scope everything by the
  // marker order rather than by accession prefix.
  const marker = `${MARKER}%`;
  await pool.query(
    `delete from radiology_scheduled_procedures
      where accession_number in (
        select accession_number from radiology_studies
         where order_id in (select id from orders where order_number like $1))`,
    [marker],
  );
  await pool.query(
    `delete from radiology_studies
      where order_id in (select id from orders where order_number like $1)`,
    [marker],
  );
  await pool.query(
    `delete from bills where order_id in (select id from orders where order_number like $1)`,
    [marker],
  );
  await pool.query(
    `delete from order_tests where order_id in (select id from orders where order_number like $1)`,
    [marker],
  );
  await pool.query(`delete from orders where order_number like $1`, [marker]);
  await pool.query(`delete from diagnostic_tests where code like $1`, [marker]);
  await pool.query(`delete from modalities where code like $1`, [marker]);
  await pool.query(`delete from patients where patient_id like $1`, [marker]);
}

describe("mixed-order study creation over a real PostgreSQL", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query(`select current_date::text as today`).catch(() => {});
    await seed();
  });

  afterAll(async () => {
    await cleanup().catch(() => {});
    await pool?.end();
  });

  it("the unique index the fan-out claims to handle is a real one", async () => {
    const r = await pool.query(
      `select indexname from pg_indexes where tablename='radiology_studies' and indexdef ilike '%unique%'`,
    );
    const names = r.rows.map((x: { indexname: string }) => x.indexname);
    expect(names).toContain("radiology_studies_order_test_uq");
  });

  it("a duplicate for one test does not lose the other test on the same order", async () => {    const { generateStudiesForOrder } = await import("./radiology");

    let thrown: unknown = null;
    let created: Awaited<ReturnType<typeof generateStudiesForOrder>> = [];
    try {
      created = await generateStudiesForOrder({
        billId: ids.billId,
        orderId: ids.orderId,
        patientId: ids.patientId,
        priority: "routine",
      });
    } catch (err) {
      thrown = err;
    }

    if (thrown) {
      const e = thrown as { message?: string; name?: string; constructor?: { name?: string } };
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `fan-out threw for a mixed order — ` +
          `instanceofError=${e instanceof Error} ctor=${e?.constructor?.name} ` +
          `guardMatches=${/radiology_studies_order_test_uq/i.test(msg)} ` +
          `head=${msg.slice(0, 160)}`,
      );
    }

    expect(thrown).toBeNull();
    expect(created).toHaveLength(1);
    expect(created[0].modality).toBe("US");

    const echo = await pool.query(
      `select accession_number, modality, department, order_test_id, status
         from radiology_studies where order_test_id = $1`,
      [ids.echoOrderTestId],
    );
    expect(echo.rows).toHaveLength(1);
    expect(echo.rows[0].modality).toBe("US");
    expect(echo.rows[0].department).toBe("USG");

    // The already-booked MRI must not be duplicated.
    const mri = await pool.query(
      `select count(*)::int as n from radiology_studies where order_test_id = $1`,
      [ids.orderTestId],
    );
    expect(mri.rows[0].n).toBe(1);
    // 60 s, not the 5 s default: importing the route module inside the test costs
    // seconds, and CI runs every db suite against one shared database.
  }, 60_000);

  it("the safety net heals an echo-only order in the same run", async () => {
    const { reconcileMissingStudies } = await import("./radiology");

    let recovered = 0;
    let thrown: unknown = null;
    try {
      recovered = await reconcileMissingStudies();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeNull();
    expect(recovered).toBeGreaterThanOrEqual(1);

    const healed = await pool.query(
      `select modality, department, status from radiology_studies where order_test_id = $1`,
      [ids.echoOnlyOrder.orderTestId],
    );
    expect(healed.rows).toHaveLength(1);
    expect(healed.rows[0].modality).toBe("US");
    expect(healed.rows[0].department).toBe("USG");
    // The sweep walks every qualifying order in the shared CI database.
  }, 90_000);
});
