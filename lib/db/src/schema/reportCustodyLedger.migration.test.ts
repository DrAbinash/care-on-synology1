/**
 * The physical report ledger must be the database's guarantee, not a convention.
 * ==========================================================================
 * `report_custody_events` is the record CARE will rely on when a report is lost,
 * mis-delivered or disputed. Four of its properties are the whole point of it:
 * a replayed request cannot write twice, two clerks cannot both confirm the same
 * paper, an unknown event name cannot be invented, and no row can claim to have
 * verified something without saying what it verified.
 *
 * Those are asserted here against a REAL database built the way the clinic builds
 * it (`db:bootstrap` → care-db-patch-v2 → migrations/*.sql), by executing this
 * PR's own migration file — not by grepping SQL text. A source-text assertion
 * ("some migration mentions rce_open_handover_uq") is satisfied by a comment; only
 * inserting the second row proves the index refuses it. See
 * artifacts/api-server/src/routes/schemaParity.request.test.ts for the class of
 * defect this pattern exists to prevent.
 *
 * Postgres error codes used are identical on 16 (CI, the NAS) and 18 (this box):
 * 23505 unique_violation, 23514 check_violation, 23502 not_null_violation.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

const dbUrl = process.env.DATABASE_URL;
const MIGRATION = "zzzzzzzzzzzzzzzzzzzzzzz_report_delivery_custody.sql";
const migrationSql = () =>
  readFileSync(resolve(__dirname, "../../../../migrations", MIGRATION), "utf8");

/** Marker-scoped synthetic report ids so nothing here can touch a real report. */
const REPORT_BASE = 900_000_000 + (process.pid * 100) % 50_000_000;
const KEY_PREFIX = `vitest-custody-${process.pid}`;

type PgError = { code: string; constraint?: string };
async function expectFailure(fn: () => Promise<unknown>): Promise<PgError> {
  try {
    await fn();
  } catch (err) {
    return err as PgError;
  }
  throw new Error("expected the statement to fail, but it succeeded");
}

let client: Client;

beforeAll(async () => {
  client = new Client({ connectionString: dbUrl });
  await client.connect();
  // Apply this PR's migration exactly as the deploy entrypoint would, twice, to
  // prove a re-run is a no-op rather than a hard stop on the next deployment.
  await client.query(migrationSql());
}, 120_000);

afterAll(async () => {
  await client.query("delete from report_custody_events where idempotency_key like $1", [`${KEY_PREFIX}%`]);
  await client.end();
});

let seq = 0;
function eventRow(over: Partial<Record<string, unknown>> = {}) {
  seq += 1;
  return {
    event: "RECEIVED_AT_DELIVERY_COUNTER",
    report_id: REPORT_BASE + seq,
    report_revision: 1,
    report_number: `RPT-VITEST-${String(seq).padStart(4, "0")}`,
    patient_id: REPORT_BASE + seq,
    actor_user_id: 4242,
    actor_name: "Vitest Receiver",
    actor_role: "reception",
    session_id: 77,
    verification: JSON.stringify({ checks: [{ id: "signed", pass: true }] }),
    payment_snapshot: JSON.stringify({ billId: null, balanceAmount: "0.00" }),
    idempotency_key: `${KEY_PREFIX}-${seq}`,
    ...over,
  };
}

async function insertEvent(over: Partial<Record<string, unknown>> = {}) {
  const r = eventRow(over);
  const cols = Object.keys(r);
  const values = Object.values(r);
  const res = await client.query(
    `insert into report_custody_events (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
    values,
  );
  return res.rows[0]!.id as number;
}

describe.skipIf(!dbUrl)("report_custody_events on a migration-built database", () => {
  it("creates the table, and re-applying the migration is a no-op", async () => {
    const exists = await client.query("select to_regclass('public.report_custody_events') as t");
    expect(exists.rows[0]!.t).toBe("report_custody_events");

    const before = await client.query("select count(*)::int as n from report_custody_events");
    await client.query(migrationSql()); // second application
    const after = await client.query("select count(*)::int as n from report_custody_events");
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
  });

  it("declares no column that could hold clinical text", async () => {
    const cols = await client.query(
      "select column_name from information_schema.columns where table_schema='public' and table_name='report_custody_events'",
    );
    const names = cols.rows.map((c) => c.column_name as string);
    // The counter is entitled to identity, status and money state — never the
    // findings, the impression or an attached file.
    for (const forbidden of ["body", "impression", "parameters", "file_path", "structured_json", "public_token"]) {
      expect(names, `custody ledger must not carry ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("refuses a replayed request", async () => {
    const key = `${KEY_PREFIX}-replay`;
    await insertEvent({ idempotency_key: key });
    const err = await expectFailure(() => insertEvent({ idempotency_key: key }));
    expect(err.code).toBe("23505");
    expect(err.constraint).toBe("rce_idempotency_uq");
  });

  it("allows one open counter receipt per report revision, then closes it on correction", async () => {
    const reportId = REPORT_BASE + 5_000;
    const first = await insertEvent({ report_id: reportId, event: "RECEIVED_AT_DELIVERY_COUNTER" });
    const dup = await expectFailure(() => insertEvent({ report_id: reportId, event: "RECEIVED_AT_DELIVERY_COUNTER" }));
    expect(dup.code).toBe("23505");
    expect(dup.constraint).toBe("rce_open_receipt_uq");

    // A corrected report legitimately returns to the counter, so closing the
    // previous row must reopen the possibility — history is kept, not replaced.
    await client.query("update report_custody_events set valid_until = now() where id = $1", [first]);
    const again = await insertEvent({ report_id: reportId, event: "RECEIVED_AT_DELIVERY_COUNTER" });
    expect(typeof again).toBe("number");
  });

  it("makes a second physical handover of the same revision impossible", async () => {
    const reportId = REPORT_BASE + 6_000;
    await insertEvent({ report_id: reportId, event: "PHYSICALLY_HANDED_OVER" });
    const dup = await expectFailure(() => insertEvent({ report_id: reportId, event: "PHYSICALLY_HANDED_OVER" }));
    expect(dup.code).toBe("23505");
    expect(dup.constraint).toBe("rce_open_handover_uq");
  });

  it("does not let a receipt and a handover of the same report block each other", async () => {
    const reportId = REPORT_BASE + 7_000;
    await insertEvent({ report_id: reportId, event: "RECEIVED_AT_DELIVERY_COUNTER" });
    const handed = await insertEvent({ report_id: reportId, event: "PHYSICALLY_HANDED_OVER" });
    expect(typeof handed).toBe("number");
  });

  it("rejects an invented event name instead of absorbing it", async () => {
    // The previous delivery writer invented deliveryMode 'HANDED', which no
    // consumer could recognise as a handover. Vocabulary drift is now a
    // database error, not a silent row.
    const err = await expectFailure(() => insertEvent({ event: "HANDED" }));
    expect(err.code).toBe("23514");
    expect(err.constraint).toBe("report_custody_events_event_chk");
  });

  it("requires the verification and payment evidence an event claims to have", async () => {
    const noVerification = await expectFailure(() => {
      const r = eventRow();
      const { verification: _drop, ...kept } = r;
      const cols = Object.keys(kept);
      return client.query(
        `insert into report_custody_events (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
        Object.values(kept),
      );
    });
    expect(noVerification.code).toBe("23502");

    const noPayment = await expectFailure(() => {
      const r = eventRow();
      const { payment_snapshot: _drop, ...kept } = r;
      const cols = Object.keys(kept);
      return client.query(
        `insert into report_custody_events (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
        Object.values(kept),
      );
    });
    expect(noPayment.code).toBe("23502");
  });

  it("adds the derived physical state and origin to patient_reports without touching existing rows", async () => {
    const cols = await client.query(
      `select column_name, is_nullable, coalesce(column_default,'') as d
         from information_schema.columns
        where table_schema='public' and table_name='patient_reports'
          and column_name in ('origin','physical_state','physical_state_at')`,
    );
    const byName = new Map(cols.rows.map((c) => [c.column_name as string, c]));
    expect([...byName.keys()].sort()).toEqual(["origin", "physical_state", "physical_state_at"]);
    expect(byName.get("origin")!.d).toContain("care_composer");
    // null is meaningful: "not in the physical system". A pre-existing report is
    // never silently promoted to received.
    expect(byName.get("physical_state")!.is_nullable).toBe("YES");
    expect(byName.get("physical_state_at")!.is_nullable).toBe("YES");

    const idx = await client.query(
      "select indexname from pg_indexes where tablename='patient_reports' and indexname='patient_reports_physical_state_idx'",
    );
    expect(idx.rowCount).toBe(1);
  });

  it("ships the dispatch acknowledgment defaulting to OFF", async () => {
    const col = await client.query(
      `select is_nullable, column_default from information_schema.columns
        where table_schema='public' and table_name='clinic_settings'
          and column_name='require_report_dispatch_acknowledgment'`,
    );
    expect(col.rowCount).toBe(1);
    expect(col.rows[0]!.is_nullable).toBe("NO");
    expect(col.rows[0]!.column_default).toContain("false");
  });

  it("keeps scan attempts in the existing audit table without breaking its writers", async () => {
    const cols = await client.query(
      `select column_name, is_nullable from information_schema.columns
        where table_schema='public' and table_name='scan_audit_logs'
          and column_name in ('scanned_code','linked_report_id','page')`,
    );
    expect(cols.rowCount).toBe(3);
    for (const row of cols.rows) expect(row.is_nullable).toBe("YES");

    // A legacy-shaped insert (what scan-sessions.ts writes today) must still work.
    const before = await client.query("select count(*)::int as n from scan_audit_logs");
    await client.query(
      "insert into scan_audit_logs (user_id, username, method, status) values (1, 'Vitest', 'qr', 'success')",
    );
    const after = await client.query("select count(*)::int as n from scan_audit_logs");
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n + 1);
    await client.query("delete from scan_audit_logs where username = 'Vitest' and method = 'qr' and status = 'success'");
  });
});
