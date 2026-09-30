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
