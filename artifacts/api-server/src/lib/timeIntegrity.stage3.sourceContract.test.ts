/**
 * Final business-time policy — PR 3a: forward-only cutover + append-only
 * evidence. Source-contract style (the repo's convention for anything that
 * would otherwise open a Postgres pool in a test).
 *
 * The live half of this proof ran against a real Postgres 16.15 and is recorded
 * in docs/audits/business-time-class-a-date-enforcement-2026-10-01.md §11:
 * backwards update, delete, truncate and the singleton CHECK all raised, and
 * every rejection in the matrix wrote an evidence row naming the session actor.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CARE_CLASS_A_DATE_FIELDS,
  CARE_NEVER_BUSINESS_DATE_FIELDS,
  isCareNeverBusinessDate,
} from "./careDateFieldRegistry";
import { clinicDateAuthority, resolveCreateBusinessDate } from "./careBusinessDatePolicy";

const ROOT = resolve(__dirname, "../../../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const MIGRATION = read("migrations/add_time_integrity_cutover_and_events_20261001.sql");
const SCHEMA = read("lib/db/src/schema/timeIntegrity.ts");
const MODULE = read("artifacts/api-server/src/lib/timeIntegrity.ts");

/** Statements, comments removed — so a guard is about SQL and not about prose. */
const sqlCode = MIGRATION.replace(/--.*$/gm, "");

describe("§17/§18 — the migration is additive and cannot touch history", () => {
  it("creates only new objects; no existing table is altered or dropped", () => {
    expect(sqlCode).not.toMatch(/\bALTER\s+TABLE\s+(?!care_time_integrity)/i);
    expect(sqlCode).not.toMatch(/\bDROP\s+(TABLE|COLUMN|INDEX)\b/i);
    // `TRUNCATE` may only appear as the event the guard trigger fires on, never
    // as a statement that clears data.
    expect(sqlCode).not.toMatch(/^\s*TRUNCATE\b/im);
    expect(sqlCode).not.toMatch(/\bTRUNCATE\s+TABLE\b/i);
    const created = [...sqlCode.matchAll(/CREATE TABLE IF NOT EXISTS ([a-z_]+)/gi)].map((m) => m[1]);
    expect(created.sort()).toEqual(["care_time_integrity_events", "care_time_integrity_policy"]);
  });

  it("contains no data statement other than stamping its own singleton row", () => {
    expect(sqlCode).not.toMatch(/^\s*UPDATE\s+/im);
    expect(sqlCode).not.toMatch(/^\s*DELETE\s+FROM\s+/im);
    const inserts = [...sqlCode.matchAll(/INSERT INTO ([a-z_.-]+)/gi)].map((m) => m[1]);
    expect(inserts).toEqual(["care_time_integrity_policy"]);
    expect(sqlCode).toMatch(/INSERT INTO care_time_integrity_policy[\s\S]*?ON CONFLICT \(id\) DO NOTHING/);
  });

  it("the cutover instant comes from Postgres, never from a literal or a client", () => {
    expect(sqlCode).toMatch(/enforcement_cutover_at timestamptz NOT NULL DEFAULT now\(\)/);
    expect(sqlCode).toMatch(/VALUES \(1, now\(\), 'postgres-migration-now'\)/);
    expect(sqlCode).not.toMatch(/enforcement_cutover_at[^\n]*'20\d\d-\d\d-\d\d/);
  });

  it("every new column that a pre-existing row would have to satisfy is absent", () => {
    // The leak path Stage 0 §1.5 warned about: NOT NULL / CHECK on an EXISTING
    // table validates retroactively. Both tables here are new, so nothing can.
    const altered = sqlCode.match(/ALTER TABLE/gi) ?? [];
    expect(altered).toEqual([]);
    expect(sqlCode).toMatch(/CONSTRAINT care_time_integrity_policy_singleton CHECK \(id = 1\)/);
  });
});

describe("§18 — the cutover cannot be quietly moved or removed", () => {
  it("a backwards cutover change is refused in the database", () => {
    expect(MIGRATION).toMatch(/IF NEW\.enforcement_cutover_at < OLD\.enforcement_cutover_at THEN\s+RAISE EXCEPTION/);
    expect(MIGRATION).toMatch(/CREATE TRIGGER care_time_integrity_policy_backward_guard\s+BEFORE UPDATE ON care_time_integrity_policy/);
  });

  it("deleting the cutover row is refused, so enforcement cannot be switched off silently", () => {
    expect(MIGRATION).toMatch(/CREATE TRIGGER care_time_integrity_policy_delete_guard\s+BEFORE DELETE ON care_time_integrity_policy/);
  });

  it("evidence refuses UPDATE, DELETE and TRUNCATE — the repo's existing append-only pattern", () => {
    expect(MIGRATION).toMatch(/CREATE TRIGGER care_time_integrity_events_append_only_guard\s+BEFORE UPDATE OR DELETE/);
    expect(MIGRATION).toMatch(/CREATE TRIGGER care_time_integrity_events_truncate_guard\s+BEFORE TRUNCATE/);
    // Same shape as the guards already trusted on study_snapshots / ai_shadow_drafts.
    const precedent = read("migrations/add_ai_shadow_uniqueness_hardening.sql");
    expect(precedent).toMatch(/BEFORE TRUNCATE ON ai_shadow_drafts/);
  });

  it("the app reads the cutover and fails CLOSED", () => {
    expect(MODULE).toMatch(/reason: cached\.unreadable \? "policy-unreadable-fail-closed" : "policy-row-missing-fail-closed"/);
    expect(MODULE).toMatch(/active: true/);
    // Fail-closed is the only safe reading: an unreadable policy row must not
    // become a licence to post backdated entries.
    expect(MODULE).toMatch(/catch \{\s*cached = \{ cutoverAtIso: null, source: null, missing: true, unreadable: true \}/);
  });
});

describe("§19 — evidence records the decision without recording the payload", () => {
  it("the writer cannot throw at the call site", () => {
    expect(MODULE).toMatch(/catch \{\s*return false;/);
    expect(MODULE).toMatch(/export async function recordTimeIntegrityEvent/);
    // Callers await it and never branch on the result.
    for (const rel of ["routes/accounting.ts", "routes/expenses.ts"]) {
      const s = read("artifacts/api-server/src/" + rel);
      expect(s, rel).toMatch(/await recordBusinessDateRejection\(\{/);
      expect(s, rel).not.toMatch(/if \(!?await recordBusinessDateRejection|=== false/);
    }
  });

  it("evidence stores identity from the session and has no secret-shaped column", () => {
    expect(MODULE).toMatch(/identitySource: "authenticated-session"/);
    // Judged on column names, not prose: the file is allowed to SAY it stores no
    // token, as long as it cannot store one.
    const columns = [...SCHEMA.matchAll(/\w+\("([a-z_]+)"/g)].map((m) => m[1]);
    for (const forbidden of ["token", "password", "authorization", "cookie", "api_key", "patient_name", "phone", "email"]) {
      expect(columns.join(","), forbidden).not.toContain(forbidden);
    }
    // Payload columns are the two the guard itself computes, plus operator text.
    expect(columns).toContain("attempted_business_date");
    expect(columns).toContain("trusted_clinic_date");
    expect(columns).not.toContain("request_body");
  });

  it("the guard's verdict is what gets recorded: field, direction, dates, actor", () => {
    expect(MODULE).toMatch(/field: rejection\.field/);
    expect(MODULE).toMatch(/direction: rejection\.direction/);
    expect(MODULE).toMatch(/attemptedBusinessDate: rejection\.attempted/);
    expect(MODULE).toMatch(/trustedClinicDate: args\.authority\.clinicDate/);
    expect(MODULE).toMatch(/actorSubjectId: input\.actor\?\.subjectId \?\? null/);
    // A typed reason is retained but capped and never interpreted.
    expect(MODULE).toMatch(/args\.reason\.trim\(\)\.slice\(0, 500\)/);
  });

  it("the schema mirrors the SQL exactly, including the identity column", () => {
    expect(SCHEMA).toMatch(/bigint\("id", \{ mode: "number" \}\)\.primaryKey\(\)\.generatedAlwaysAsIdentity\(\)/);
    expect(MIGRATION).toMatch(/id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY/);
    expect(SCHEMA).toMatch(/occurredAt: timestamp\("occurred_at", \{ withTimezone: true \}\)\.notNull\(\)\.defaultNow\(\)/);
    expect(MIGRATION).toMatch(/occurred_at timestamptz NOT NULL DEFAULT now\(\)/);
  });

  it("is exported from the schema barrel so routes can see it", () => {
    expect(read("lib/db/src/schema/index.ts")).toContain('export * from "./timeIntegrity";');
  });
});

describe("§13 — enforcement is gated on the cutover at every Class-A site", () => {
  it("all five write paths ask the database before judging a date", () => {
    const accounting = read("artifacts/api-server/src/routes/accounting.ts");
    const expenses = read("artifacts/api-server/src/routes/expenses.ts");
    // Three sites in accounting: voucher POST, voucher PATCH, and the bank
    // import. The import is not a Class-A *rejection* gate — since PR 3c the
    // cutover decides whether it posts today with the bank's date preserved.
    expect([...accounting.matchAll(/businessDateEnforcementActive\(\)/g)]).toHaveLength(3);
    expect([...expenses.matchAll(/businessDateEnforcementActive\(\)/g)]).toHaveLength(2);
  });

  it("pre-cutover behaviour is the old behaviour, not a silent rewrite", () => {
    const accounting = read("artifacts/api-server/src/routes/accounting.ts");
    expect(accounting).toMatch(/let postingDate = date \?\? authority\.clinicDate;/);
    const expenses = read("artifacts/api-server/src/routes/expenses.ts");
    expect(expenses).toMatch(/let postedExpenseDate = expenseDate \|\| expenseDateAuthority\.clinicDate;/);
  });

  it("nothing here touches day-close, payroll or clinical dates", () => {
    for (const rel of ["routes/day-close.ts", "routes/staff.ts", "routes/form-f.ts", "routes/bills.ts", "routes/radiology.ts"]) {
      expect(read("artifacts/api-server/src/" + rel), rel).not.toMatch(/timeIntegrity|businessDateEnforcementActive|recordBusinessDateRejection/);
    }
  });
});

/**
 * PR 3c — management decision of 2026-10-01, recorded in design doc §12. A bank
 * statement is a document about the past, so the import now keeps the bank's own
 * date as an external Class-B fact and posts the voucher on CARE's clinic date,
 * instead of refusing the whole batch the way PR 2 did. These assertions are
 * what stop that rule from drifting back into either extreme: writing the bank's
 * date into the ledger, or blocking the workflow again.
 */
describe("§12 — bank feeds carry an external date, never a business date", () => {
  const FEED_SQL = read("migrations/add_vouchers_external_event_date_20261001.sql").replace(/--.*$/gm, "");
  const accounting = read("artifacts/api-server/src/routes/accounting.ts");

  it("the submitted statement date can no longer reach vouchers.date", () => {
    expect(accounting).toMatch(/const date = enforcementActive \? importAuthority\.clinicDate : bankDate;/);
    expect(accounting).not.toContain("submitted: txn.date");
    expect(accounting).toContain('externalEventDate: enforcementActive ? bankDate : null,');
    expect(accounting).toContain('externalEventSource: enforcementActive ? "bank-statement-import" : null,');
  });

  it("the duplicate guard spans both date columns, or the change would reopen double-posting", () => {
    // Rows imported before this change hold the bank date in `date`; rows
    // imported after hold it in `external_event_date`. Keying only on the new
    // column would make an already-imported pre-cutover statement importable a
    // second time — the strictness removed from one place must not open a hole
    // in another.
    expect(accounting).toMatch(/and\(gte\(vouchersTable\.date, minDate\), lte\(vouchersTable\.date, maxDate\)\)/);
    expect(accounting).toMatch(/and\(gte\(vouchersTable\.externalEventDate, minDate\), lte\(vouchersTable\.externalEventDate, maxDate\)\)/);
    expect(accounting).toMatch(/dupKey\(v\.externalEventDate \?\? v\.date,/);
    expect(accounting).toMatch(/const key = dupKey\(bankDate, amount, txn\.reference, txn\.description\);/);
  });

  it("the guard is structurally refused any power over the external date", () => {
    expect(isCareNeverBusinessDate("vouchers", "external_event_date")).toBe(true);
    expect(CARE_NEVER_BUSINESS_DATE_FIELDS["vouchers.external_event_date"].class).toBe("B");
    const decision = resolveCreateBusinessDate({
      table: "vouchers",
      column: "external_event_date",
      submitted: "2026-09-24",
      authority: clinicDateAuthority(new Date("2026-10-01T10:00:00+05:30")),
    });
    expect(decision.ok && "policed" in decision && decision.policed).toBe(false);
    // Adding this rule must not have smuggled a third Class-A field in.
    expect(Object.keys(CARE_CLASS_A_DATE_FIELDS).sort()).toEqual(["expenses.expense_date", "vouchers.date"]);
  });

  it("the migration adds two nullable columns and touches no existing row", () => {
    expect(FEED_SQL).toMatch(/ALTER TABLE "vouchers" ADD COLUMN IF NOT EXISTS "external_event_date" text;/);
    expect(FEED_SQL).toMatch(/ALTER TABLE "vouchers" ADD COLUMN IF NOT EXISTS "external_event_source" text;/);
    expect(FEED_SQL).not.toMatch(/ADD COLUMN[^;]*(NOT NULL|DEFAULT)/i);
    expect(FEED_SQL).not.toMatch(/^\s*UPDATE\s+/im);
    expect(FEED_SQL).not.toMatch(/^\s*(DELETE|TRUNCATE|DROP)\b/im);
    expect(FEED_SQL).toMatch(/CREATE INDEX IF NOT EXISTS "vouchers_external_event_date_idx"/);
  });

  it("the Drizzle schema mirrors the SQL columns", () => {
    const s = read("lib/db/src/schema/accounting.ts");
    expect(s).toMatch(/externalEventDate: text\("external_event_date"\)/);
    expect(s).toMatch(/externalEventSource: text\("external_event_source"\)/);
    expect(s).toMatch(/externalEventDateIdx: index\("vouchers_external_event_date_idx"\)/);
  });

  it("an accepted import writes one evidence row that cannot fail the save", () => {
    expect(accounting).toContain('event: "external-date-import"');
    expect(accounting).toContain('outcome: "accepted"');
    // The non-throwing writer only — a route that branches on evidence capture
    // would turn an audit-table problem into a lost accounting batch.
    expect(accounting).not.toMatch(/(if\s*\(\s*!?\s*await|=)\s*await recordTimeIntegrityEvent/);
  });

  it("an unparsable bank date is refused as a data problem, not filed as backdating", () => {
    expect(accounting).toContain('/^\\d{4}-\\d{2}-\\d{2}$/.test(txn.date)');
    const importRoute = accounting.slice(accounting.indexOf('router.post("/bank-statement/import"'));
    expect(importRoute).not.toContain("recordBusinessDateRejection");
    expect(importRoute).not.toContain("careBusinessDateErrorBody");
    expect(importRoute).toContain("Nothing was written from this batch");
  });
});
