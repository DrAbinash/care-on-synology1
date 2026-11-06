/**
 * ECHO and FETAL ECHO queue in Dr Sugandha's room — the USG queue.
 *
 * Measured in production on 2026-11-06. The two echo catalog rows (405 "ECHO",
 * 383 " ECHO FETAL") are billed under department Cardiology and performed on
 * device "USG GE E9 Voluson" in "USG ROOM NO. 1", which is where every USG
 * patient is examined. Queue tokens take their department from the catalog row,
 * so an echo patient was issued a CARDIOLOGY token, and the queue displays that
 * filter tokens are configured as usg / mri / ct. Over 3–5 November that was
 * 6–8 echo patients a day given a number no screen ever shows, in a room whose
 * screen ignored them.
 *
 * So the contract is: the queue follows the MACHINE, the way the study fan-out
 * already does (#1286). Two things this file pins down, because both were wrong
 * before:
 *   1. an echo patient's token is USG — and the catalog row's own department is
 *      never rewritten, so billing/revenue classification does not move;
 *   2. USG + ECHO on one bill is ONE token. The room label is stored two ways
 *      ("USG ROOM NO. 1" on the echo rows, "USG Room No. 1" on the USG rows),
 *      so the raw department+room comparison split one chair into two numbers.
 * A Cardiology test with no machine behind it (ECG, TMT, EEG) must keep the
 * Cardiology queue — that is the negative control for the rule.
 *
 * Run against real PostgreSQL: the assertions are about rows the database
 * actually holds after the fan-out, including the shared per-department token
 * series, which a stub cannot reproduce.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const hasDb = !!process.env.DATABASE_URL;
const suite = hasDb ? describe : describe.skip;

const MARKER = `QUEUE${Date.now() % 1_000_000}`;

let pool: Pool;
const ids = {
  patientId: 0,
  deviceId: 0,
  echoTestId: 0,
  fetalEchoTestId: 0,
  usgTestId: 0,
  ecgTestId: 0,
};

async function seed(): Promise<void> {
  const pat = await pool.query(
    `insert into patients (patient_id, first_name, last_name, date_of_birth, gender, phone)
     values ($1, 'Synthetic', 'Case', '1980-01-01', 'F', '0000000000') returning id`,
    [`${MARKER}-PAT`],
  );
  ids.patientId = pat.rows[0].id;

  // The same machine the clinic binds both echo rows to in production.
  const dev = await pool.query(
    `insert into modalities (name, code) values ($1, $2) returning id`,
    [`USG SYNTH VOLUSON ${MARKER}`, `${MARKER}-DEV`],
  );
  ids.deviceId = dev.rows[0].id;

  const seeded = await pool.query(
    `insert into diagnostic_tests (code, name, category, price, duration, department, room_number, modality_id)
     values
       ($1, $2, 'Cardiology', 800, '30 min', 'Cardiology', 'USG ROOM NO. 1', $7),
       ($3, $4, 'Cardiology', 900, '45 min', 'Cardiology', 'USG ROOM NO. 1', $7),
       ($5, $6, 'Imaging',    700, '20 min', 'USG',        'USG Room No. 1', $7),
       ($8, $9, 'Cardiology', 500, '15 min', 'Cardiology', 'Cardiology Room No. 6', null)
     returning id, code`,
    [
      `${MARKER}-ECHO`, `${MARKER} ECHO`,
      `${MARKER}-ECHOFETAL`, `${MARKER} ECHO FETAL`,
      `${MARKER}-USG`, `${MARKER} USG ABDOMEN`,
      ids.deviceId,
      `${MARKER}-ECG`, `${MARKER} ECG`,
    ],
  );
  for (const row of seeded.rows) {
    const code = String(row.code);
    const id = Number(row.id);
    if (code.endsWith("-ECHO")) ids.echoTestId = id;
    if (code.endsWith("-ECHOFETAL")) ids.fetalEchoTestId = id;
    if (code.endsWith("-USG")) ids.usgTestId = id;
    if (code.endsWith("-ECG")) ids.ecgTestId = id;
  }
}

/** Bill one order for the given tests and return the issued token rows. */
let orderSeq = 0;
async function billAndQueue(testIds: number[]): Promise<{
  orderId: number;
  tokens: Array<{ department: string; room_number: string; token_no: number; order_test_id: number }>;
}> {
  const { generateTestTokensForOrder } = await import("./test-tokens");

  orderSeq += 1;
  const tag = `${MARKER}-O${orderSeq}`;
  const ord = await pool.query(
    `insert into orders (order_number, patient_id) values ($1, $2) returning id`,
    [tag, ids.patientId],
  );
  const orderId = ord.rows[0].id;
  for (const testId of testIds) {
    await pool.query(
      `insert into order_tests (order_id, test_id, price) values ($1, $2, 800)`,
      [orderId, testId],
    );
  }
  const bill = await pool.query(
    `insert into bills (bill_number, order_id, patient_id, status) values ($1, $2, $3, 'paid') returning id`,
    [`${tag}-B`, orderId, ids.patientId],
  );
  const billId = bill.rows[0].id;

  await generateTestTokensForOrder({
    ledgerId: 1,
    billId,
    orderId,
    patientId: ids.patientId,
    source: "walkin",
  });

  const tokens = await pool.query(
    `select department, room_number, token_no, order_test_id
       from test_tokens where order_id = $1 order by id`,
    [orderId],
  );
  return { orderId, tokens: tokens.rows };
}

async function cleanup(): Promise<void> {
  const like = `${MARKER}%`;
  await pool.query(
    `delete from test_tokens where order_id in (select id from orders where order_number like $1)`,
    [like],
  );
  await pool.query(`delete from bills where order_id in (select id from orders where order_number like $1)`, [like]);
  await pool.query(`delete from order_tests where order_id in (select id from orders where order_number like $1)`, [like]);
  await pool.query(`delete from orders where order_number like $1`, [like]);
  await pool.query(`delete from diagnostic_tests where code like $1`, [like]);
  await pool.query(`delete from modalities where code like $1`, [like]);
  await pool.query(`delete from patients where patient_id like $1`, [like]);
}

suite("echo queue placement over a real PostgreSQL", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await seed();
  }, 90_000);

  afterAll(async () => {
    await cleanup().catch(() => {});
    await pool?.end();
  });

  it("queues a Cardiology-billed ECHO as a USG token, in the USG room", async () => {
    const { tokens } = await billAndQueue([ids.echoTestId]);

    expect(tokens).toHaveLength(1);
    expect(tokens[0].department).toBe("USG");
    expect(tokens[0].room_number).toMatch(/USG ROOM NO\. 1/i);

    // The counter that gets paid must not move: only the queue changed.
    const catalog = await pool.query(
      `select department from diagnostic_tests where id = $1`,
      [ids.echoTestId],
    );
    expect(catalog.rows[0].department).toBe("Cardiology");
  }, 90_000);

  it("queues FETAL ECHO the same way", async () => {
    const { tokens } = await billAndQueue([ids.fetalEchoTestId]);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].department).toBe("USG");
  }, 90_000);

  it("gives one patient USG + ECHO a single token for the one room", async () => {
    const { tokens } = await billAndQueue([ids.usgTestId, ids.echoTestId]);

    // Two spellings of the same room, one queue number — the whole point of
    // "one room only", and what the raw department+room key used to break.
    expect(tokens).toHaveLength(1);
    expect(tokens[0].department).toBe("USG");
    expect(tokens[0].token_no).toBeGreaterThan(0);
  }, 90_000);

  it("keeps a machine-less Cardiology test on the Cardiology queue", async () => {
    const { tokens } = await billAndQueue([ids.ecgTestId]);

    // Negative control: no device binding means the counter still decides.
    expect(tokens).toHaveLength(1);
    expect(tokens[0].department).toBe("Cardiology");
  }, 90_000);

  it("numbers echo patients from the same counter as USG patients", async () => {
    const usgOnly = await billAndQueue([ids.usgTestId]);
    const echoOnly = await billAndQueue([ids.echoTestId]);

    // One counter, not two: the echo takes the very next USG number, so the
    // screen and the desk call them in the order the room actually runs.
    expect(usgOnly.tokens).toHaveLength(1);
    expect(echoOnly.tokens).toHaveLength(1);
    expect(usgOnly.tokens[0].department).toBe("USG");
    expect(echoOnly.tokens[0].department).toBe("USG");
    expect(echoOnly.tokens[0].token_no).toBe(usgOnly.tokens[0].token_no + 1);

    // Nothing echo-shaped is left behind on the Cardiology series.
    const stray = await pool.query(
      `select count(*)::int as n from test_tokens
        where department = 'Cardiology'
          and order_id in (select id from orders where order_number like $1)`,
      [`${MARKER}%`],
    );
    expect(stray.rows[0].n).toBe(1); // the machine-less ECG control only
  }, 90_000);
});
