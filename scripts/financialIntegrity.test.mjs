// ============================================================================
// READ-ONLY financial integrity — the tests behind scripts/financial-integrity.mjs
// and its two deploy-gate checks.
//
// Four things are proved here and each one is a failure mode this repository has
// actually been bitten by:
//
//   1. NOTHING IS WRITTEN. Every statement is asserted to be a SELECT, and asserted
//      to open its session read-only with a statement timeout. A money tool that
//      could write to `bills` is not a check, it is an incident.
//   2. NOTHING LEAKS. The projection is fixed by `wrapCountAndIds`, so a check can
//      only ever return a count and numeric row ids. A patient name, an MRN or a bill
//      number cannot be produced, and a test asserts the emitted strings.
//   3. THE GATE/ADVISORY SPLIT IS MEASURED, NOT OPINIONED. The gate list and the
//      advisory list are each pinned by id, the counts are asserted, and the two
//      shapes the older tooling gets wrong are pinned in the SQL text itself: bill
//      numbers unique PER BOOK (DQC-01 groups globally and calls 140 correct
//      invoices duplicates), and `paid_amount` compared only against the payment rows
//      the ledger counts (books-sanity sums all rows and disagrees with correct data
//      after any supersession).
//   4. A CHECK THAT DID NOT RUN IS NOT A CHECK THAT PASSED. A psql failure marks that
//      statement AND every statement after it UNVERIFIED, and the surface reports
//      UNVERIFIED rather than PASS.
//
// One case is a real defect found while writing this: `psql -Atc "SET …; SET …; SELECT"`
// prints a command tag per utility statement on some client builds (measured: psql 18.3
// emits `SET`, `SET`, then the row; the NAS's psql emits the row alone). A parser that
// read the first line graded every check as UNVERIFIED on those machines — a gate that
// never goes green is a gate that gets ignored, so the row is now marked and located by
// its marker, and T-PARSE pins both shapes.
//
// The live-schema cases run only when DATABASE_URL points at a reachable database
// (CI's Vitest job has one; a laptop without Postgres does not) and they run SELECTs
// only, against the schema the real migrations built.
// ============================================================================
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ADVISORY,
  CHECKS,
  CLOSES,
  FAIL,
  GATE,
  ID_SAMPLE_CAP,
  MONEY,
  PASS,
  RESULT_MARKER,
  SESSION_GUARD,
  UNCOUNTED_SETTLEMENT,
  UNVERIFIED,
  assertReadOnly,
  detailFor,
  evaluate,
  main,
  parseResult,
  runSurface,
  wrapCountAndIds,
} from "./financial-integrity.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");

const gateIds = CHECKS.filter((c) => c.kind === GATE).map((c) => c.id);
const advisoryIds = CHECKS.filter((c) => c.kind === ADVISORY).map((c) => c.id);
const byId = (id) => CHECKS.find((c) => c.id === id);
const sqlOf = (id) => wrapCountAndIds(byId(id).inner);

/** A psql that answers every statement with zero violations. */
const cleanExec = (calls = []) => (_cmd, args) => {
  calls.push(args[args.length - 1]);
  return { code: 0, stdout: `${RESULT_MARKER}|0|\n`, stderr: "", missing: false };
};

/** Answer one named check with a planted finding, everything else clean. */
const plantedExec = (findings, calls = []) => (_cmd, args) => {
  const sql = args[args.length - 1];
  calls.push(sql);
  const hit = Object.entries(findings).find(([id]) => sql.includes(`financial-integrity:${id} */`));
  if (hit) return { code: 0, stdout: `${RESULT_MARKER}|${hit[1]}|\n`, stderr: "", missing: false };
  return { code: 0, stdout: `${RESULT_MARKER}|0|\n`, stderr: "", missing: false };
};

const URL = "postgres://erp@127.0.0.1:59999/diagnostic_erp";

// ── 1. read-only ────────────────────────────────────────────────────────────
describe("the tool cannot write, by construction", () => {
  it("refuses any check whose statement contains a write verb", () => {
    for (const c of CHECKS) expect(assertReadOnly(c.inner), `${c.id} is not a SELECT`).toBe(true);
    // The guard itself is load-bearing, so it gets its own negative case.
    for (const bad of ["DELETE FROM bills", "SELECT 1; UPDATE bills SET paid_amount = 0", "WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x", "CREATE TABLE t AS SELECT 1"]) {
      expect(() => assertReadOnly(bad), `assertReadOnly let through: ${bad}`).toThrow(/refusing to emit/);
    }
    expect(() => assertReadOnly("EXPLAIN SELECT 1")).toThrow(/must begin with SELECT or WITH/);
  });

  it("opens every session read-only and time-boxed, before the statement runs", () => {
    const calls = [];
    runSurface({ exec: cleanExec(calls), env: { DATABASE_URL: URL }, surface: MONEY });
    expect(calls.length, "every money statement is issued when advisories are asked for").toBe(CHECKS.filter((c) => c.surface === MONEY).length);
    for (const sql of calls) {
      expect(sql.startsWith("SET default_transaction_read_only = on;"), sql.slice(0, 60)).toBe(true);
      expect(sql).toContain("SET statement_timeout =");
      expect(sql).toMatch(/\/\* financial-integrity:[a-z_.]+ \*\//);
    }
  });

  it("the read-only session guard is part of the emitted command, not a comment about it", () => {
    // Deleting SESSION_GUARD from the template must be caught, so assert the literal
    // the shipped string is built from rather than a paraphrase of it.
    const src = readFileSync(path.join(HERE, "financial-integrity.mjs"), "utf8");
    expect(src).toContain("export const SESSION_GUARD = \"SET default_transaction_read_only = on;");
    expect(src).toMatch(/const sql = `\$\{SESSION_GUARD\}/);
  });
});

// ── 2. output hygiene ───────────────────────────────────────────────────────
describe("what a finding can say", () => {
  it("every projection is a count plus numeric row ids and nothing else", () => {
    for (const c of CHECKS) {
      const sql = wrapCountAndIds(c.inner);
      expect(sql, c.id).toContain("string_agg(id::text");
      // Bounded by the constant, and by a number, because "contains LIMIT 5" is also
      // true of `LIMIT 5000` — which is a finding that prints a list of records.
      const cap = Number(/ORDER BY id LIMIT (\d+)\) sample/.exec(sql)?.[1]);
      expect(cap, `${c.id} has no row-id cap`).toBe(Number(ID_SAMPLE_CAP));
      expect(ID_SAMPLE_CAP, "the cap itself must stay small").toBeLessThanOrEqual(10);
      // One outer projection only: the count of `findings`, never a column of a row.
      expect((sql.match(/FROM findings/g) || []).length).toBeGreaterThanOrEqual(2);
      expect(sql).not.toMatch(/patient_name|mrn|phone|email|bill_number AS|SELECT b.bill_number,/);
    }
  });

  it("a finding with thousands of rows still prints one bounded line", () => {
    const line = detailFor(byId("bills.bill_number_repeats_across_books"), { count: 5231, ids: ["11", "22", "33", "44", "55"] });
    expect(line).toBe("5231 violations (rows 11, 22, 33, 44, 55, …)");
    expect(line.length, line).toBeLessThan(70);
  });

  it("detailFor prints counts and ids only", () => {
    expect(detailFor(byId("bills.total_identity"), { count: 0, ids: [] })).toBe("0 violations");
    const line = detailFor(byId("bills.total_identity"), { count: 7, ids: ["11", "12"] });
    expect(line).toContain("7 violations");
    expect(line).toContain("rows 11, 12, …");
    expect(line).not.toMatch(/[A-Za-z]{6,}.*[:=].*[A-Za-z]{6,}/);
  });

  it("the json proof carries counts and ids, never a value that looks like a record", () => {
    const out = path.join(REPO, "tmp", "fi-proof-test.json");
    rmSync(out, { force: true });
    return main(["--json=tmp/fi-proof-test.json", "--advisory"], {
      exec: plantedExec({ "orders.total_vs_active_lines": 3 }),
      env: { DATABASE_URL: URL },
      log: () => {},
    }).then((code) => {
      expect(code, "advisory findings never change the exit code").toBe(0);
      const text = readFileSync(out, "utf8");
      expect(text).toContain("orders.total_vs_active_lines");
      expect(text).not.toMatch(/postgres:\/\//);
      rmSync(out, { force: true });
    });
  });
});

// ── 3. the parser, and the shape it exists for ──────────────────────────────
describe("parseResult survives what psql actually prints", () => {
  it("reads the marked row when the session SETs echo command tags", () => {
    // Measured output of `psql -Atc "SET …; SET …; SELECT …"` on psql 18.3.
    const tagged = `SET\r\nSET\r\n${RESULT_MARKER}|140|8638,8653\r\n`;
    expect(parseResult(tagged)).toEqual({ count: 140, ids: ["8638", "8653"] });
  });

  it("reads the marked row when they are not echoed", () => {
    expect(parseResult(`${RESULT_MARKER}|0|\n`)).toEqual({ count: 0, ids: [] });
  });

  it("returns null, not zero, when no marked row came back", () => {
    for (const text of ["", "\n\n", "SET\nSET\n", "ERROR:  column \"refund_amount\" does not exist\n", `${RESULT_MARKER}|\n`]) {
      expect(parseResult(text), JSON.stringify(text)).toBeNull();
    }
  });

  it("refuses a negative or non-numeric count", () => {
    expect(parseResult(`${RESULT_MARKER}|-3|`)).toBeNull();
    expect(parseResult(`${RESULT_MARKER}|abc|`)).toBeNull();
    expect(parseResult(null)).toBeNull();
  });
});

// ── 4. verdicts ─────────────────────────────────────────────────────────────
describe("evaluate keeps UNKNOWN out of the pass column", () => {
  it("a gate with zero violations passes; any count fails", () => {
    expect(evaluate(byId("bills.total_identity"), { count: 0, ids: [] }).status).toBe(PASS);
    expect(evaluate(byId("bills.total_identity"), { count: 1, ids: ["9"] }).status).toBe(FAIL);
    expect(evaluate(byId("bills.total_identity"), { count: 1, ids: ["9"] }).ok).toBe(false);
  });

  it("an advisory reports a failure without ever claiming the right to block", () => {
    const r = evaluate(byId("orders.total_vs_active_lines"), { count: 52, ids: ["1"] });
    expect(r.status).toBe(FAIL);
    expect(r.ok, "an advisory cannot fail a deploy").toBe(true);
    expect(r.advisory).toBe(true);
  });

  it("a missing answer is UNVERIFIED, not PASS and not FAIL", () => {
    const r = evaluate(byId("bills.total_identity"), null);
    expect(r.status).toBe(UNVERIFIED);
    expect(r.detail).toContain("was not evaluated");
  });

  it("zero checks judged is never a clean bill of health", () => {
    const r = runSurface({ exec: () => ({ code: 0, stdout: "", stderr: "", missing: false }), env: { DATABASE_URL: URL }, surface: MONEY });
    expect(r.status).toBe(UNVERIFIED);
  });
});

// ── 5. the surface verdict ──────────────────────────────────────────────────
describe("runSurface", () => {
  it("passes a surface when every gate holds, and says how many advisories it saw", () => {
    const r = runSurface({ exec: cleanExec(), env: { DATABASE_URL: URL }, surface: MONEY });
    expect(r.status).toBe(PASS);
    expect(r.id).toBe("financial.money_identity");
    expect(r.critical).toBe(true);
    expect(r.detail).toContain("11 bills, payments and vouchers invariants hold");
  });

  it("names the violated gate and its row ids in the detail", () => {
    const r = runSurface({ exec: plantedExec({ "bills.balance_identity": 3 }), env: { DATABASE_URL: URL }, surface: MONEY });
    expect(r.status).toBe(FAIL);
    expect(r.detail).toContain("bills.balance_identity 3 violations");
    expect(r.remediation).toContain("Do not deploy over this");
    expect(r.remediation).toContain("Do not patch the database directly");
  });

  it("marks every statement after a psql failure UNVERIFIED instead of dropping it", () => {
    const boom = (_cmd, args) => ({ code: 2, stdout: "", stderr: "psql: error: connection refused\n", missing: false });
    const r = runSurface({ exec: boom, env: { DATABASE_URL: URL }, surface: MONEY });
    expect(r.status).toBe(UNVERIFIED);
    const gates = r.results.filter((c) => c.kind === GATE);
    expect(gates.length).toBe(CHECKS.filter((c) => c.surface === MONEY && c.kind === GATE).length);
    expect(gates.every((g) => g.status === UNVERIFIED), "one dead connection must not leave the rest looking judged").toBe(true);
    expect(r.detail).toContain("could not be evaluated");
    expect(r.detail).not.toContain("invariants hold");
  });

  it("reports UNVERIFIED with no DATABASE_URL and runs nothing", () => {
    const calls = [];
    const r = runSurface({ exec: cleanExec(calls), env: {}, surface: CLOSES });
    expect(r.status).toBe(UNVERIFIED);
    expect(calls.length).toBe(0);
    expect(r.detail).toContain("no DATABASE_URL");
    // The remediation must not invite the operator to print a connection string.
    expect(r.remediation).not.toMatch(/printenv DATABASE_URL\b/);
    expect(r.remediation).toContain("care-db");
  });

  it("the deploy gate asks only the 16 gate statements, not the advisories", () => {
    const calls = [];
    for (const s of [MONEY, CLOSES]) runSurface({ exec: cleanExec(calls), env: { DATABASE_URL: URL }, surface: s, gatesOnly: true });
    expect(calls.length).toBe(16);
    expect(calls.filter((c) => c.includes("perfect_count_never_taken")).length).toBe(0);
  });

  it("the deploy gate itself, as ops-preflight wires it, runs 16 statements and no more", async () => {
    // Same property one level up: the thing that runs before every deploy should not be
    // the full 23-statement report. If `gatesOnly` is dropped at the call site, this is
    // the assertion that notices, because the count of statements is the only witness.
    const { checkFinancialIntegrity } = await import("./ops-preflight.mjs");
    const calls = [];
    const exec = (_cmd, args) => {
      calls.push(args[args.length - 1]);
      return { code: 0, stdout: `${RESULT_MARKER}|0|\n`, stderr: "", missing: false };
    };
    const checks = checkFinancialIntegrity({ exec, env: { DATABASE_URL: URL } });
    expect(checks.map((c) => c.id)).toEqual(["financial.money_identity", "financial.day_close_identity"]);
    expect(calls.filter((c) => c.includes("financial-integrity:")).length).toBe(16);
    expect(calls.some((c) => c.includes("orders.total_vs_active_lines"))).toBe(false);
    expect(checks.every((c) => c.status === PASS), JSON.stringify(checks.map((c) => c.detail))).toBe(true);
  });

  it("an unknown surface is refused rather than answered empty", async () => {
    const code = await main(["--surface=bogus"], { env: { DATABASE_URL: URL }, log: () => {} });
    expect(code).toBe(3);
  });
});

// ── 6. exit codes ───────────────────────────────────────────────────────────
describe("main's exit codes are the four answers, not three", () => {
  const env = { DATABASE_URL: URL };
  it("0 when every gate passes", async () => {
    expect(await main([], { exec: cleanExec(), env, log: () => {} })).toBe(0);
  });
  it("1 when a gate is violated", async () => {
    expect(await main([], { exec: plantedExec({ "vouchers.amount_positive": 2 }), env, log: () => {} })).toBe(1);
  });
  it("2 when there is no database to ask", async () => {
    expect(await main([], { exec: cleanExec(), env: {}, log: () => {} })).toBe(2);
  });
  it("3 when a gate could not be evaluated — and 3 is not a quieter 1", async () => {
    expect(await main([], { exec: () => ({ code: 2, stdout: "", stderr: "no server\n", missing: false }), env, log: () => {} })).toBe(3);
  });
  it("an advisory finding alone still exits 0", async () => {
    expect(await main([], { exec: plantedExec({ "bills.bill_number_repeats_across_books": 140 }), env, log: () => {} })).toBe(0);
  });
  it("--help exits 0 and names the read-only promise", async () => {
    let out = "";
    expect(await main(["--help"], { env: {}, log: (s) => { out += s; } })).toBe(0);
    expect(out).toContain("read-only");
    expect(out).toContain("Exit 0 all gates pass");
  });
});

// ── 7. the split, pinned ────────────────────────────────────────────────────
describe("the gate/advisory split is a claim about this clinic", () => {
  it("16 gates and 7 advisories, by id", () => {
    expect(gateIds).toEqual([
      "bills.total_identity",
      "bills.balance_identity",
      "payments.collected_matches_ledger",
      "bills.no_negative_amounts",
      "bills.discount_within_subtotal",
      "bills.refund_within_collected",
      "bills.bill_number_unique_in_book",
      "payments.bill_exists",
      "vouchers.no_self_cancelling_posting",
      "vouchers.amount_positive",
      "vouchers.accounts_resolve",
      "day_closures.expected_totals_sum",
      "day_closures.variance_identity",
      "user_day_closures.expected_totals_sum",
      "user_day_closures.variance_identity",
      "user_day_closures.denomination_total_matches_cash",
    ]);
    expect(advisoryIds).toEqual([
      "bills.bill_number_repeats_across_books",
      "bills.cancelled_with_money_collected",
      "orders.total_vs_active_lines",
      "payments.gateway_txn_reused_across_bills",
      "vouchers.reference_points_at_no_bill",
      "day_closures.window_shape",
      "user_day_closures.perfect_count_never_taken",
    ]);
    expect(new Set(CHECKS.map((c) => c.id)).size).toBe(CHECKS.length);
  });

  it("every check states what it measured, because that is what makes the split reviewable", () => {
    for (const c of CHECKS) {
      expect(c.measured, `${c.id} has no measurement`).toBeTruthy();
      expect(c.claim, `${c.id} has no claim`).toBeTruthy();
      expect(c.surface).toMatch(new RegExp(`^(${MONEY}|${CLOSES})$`));
    }
  });

  it("bill-number uniqueness is scoped to the book — DQC-01's global grouping is not repeated", () => {
    expect(sqlOf("bills.bill_number_unique_in_book")).toContain("GROUP BY ledger_id, bill_number");
    expect(sqlOf("bills.bill_number_unique_in_book")).not.toMatch(/GROUP BY bill_number HAVING/);
    // The cross-book repeat is the false positive, and it is advisory on purpose.
    expect(sqlOf("bills.bill_number_repeats_across_books")).toContain("count(DISTINCT ledger_id) > 1");
    expect(byId("bills.bill_number_repeats_across_books").kind).toBe(ADVISORY);
  });

  it("paid_amount is compared only against counted rows, and the exclusion is the sanctioned list", () => {
    const sql = sqlOf("payments.collected_matches_ledger");
    for (const status of UNCOUNTED_SETTLEMENT) expect(sql, `missing ${status}`).toContain(`'${status}'`);
    expect(sql).toContain("LEFT JOIN payments p ON p.bill_id = b.id AND");
  });

  it("the exclusion list is the application's own, not a copy that can drift", () => {
    // Derived from the source that defines it, so widening or narrowing either side
    // without changing both is a failure rather than a silent disagreement.
    const fin = readFileSync(path.join(REPO, "artifacts", "api-server", "src", "lib", "financialIntegrity.ts"), "utf8");
    const block = /INVALID_COLLECTION_STATUSES = new Set\(\[([\s\S]*?)\]\)/.exec(fin);
    expect(block, "financialIntegrity.ts no longer declares INVALID_COLLECTION_STATUSES in a recognisable shape").toBeTruthy();
    const theirs = [...block[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(theirs.length).toBeGreaterThan(3);
    expect([...UNCOUNTED_SETTLEMENT].sort()).toEqual([...theirs].sort());
  });

  it("every emitted statement carries the read-only guard verbatim", () => {
    const calls = [];
    runSurface({ exec: cleanExec(calls), env: { DATABASE_URL: URL }, surface: CLOSES, gatesOnly: true });
    for (const sql of calls) expect(sql.startsWith(`${SESSION_GUARD} `), sql.slice(0, 70)).toBe(true);
  });

  it("the cancelled-bill exemption is real, because cancellation pins balance to zero", () => {
    expect(sqlOf("bills.balance_identity")).toContain("status <> 'cancelled'");
    expect(byId("bills.cancelled_with_money_collected").kind).toBe(ADVISORY);
  });

  it("the drawer control weakness is advisory and says why in the check itself", () => {
    const c = byId("user_day_closures.perfect_count_never_taken");
    expect(c.kind).toBe(ADVISORY);
    expect(c.measured).toMatch(/pre-fills|process decision/);
  });
});

// ── 8. live schema, when a database is reachable ───────────────────────────
const hasDb = (() => {
  const url = (process.env.DATABASE_URL || "").trim();
  if (!url) return false;
  const r = spawnSync("psql", [url, "-Atc", "SELECT 'FI|1|'"], { encoding: "utf8", timeout: 15_000 });
  return r.status === 0 && String(r.stdout).includes("FI|1");
})();

describe.skipIf(!hasDb)("the shipped SQL runs against the schema the real migrations built", () => {
  it("every check returns a number rather than a server error", () => {
    for (const surface of [MONEY, CLOSES]) {
      const r = runSurface({ exec: undefined, env: process.env, surface });
      for (const line of r.results) {
        expect(line.status, `${line.id}: ${line.detail}`).not.toBe(UNVERIFIED);
        expect(line.detail).toMatch(/^\d+ violation/);
      }
    }
  });

  it("an empty money schema is not a violation, and is not reported as one", () => {
    // The scratch databases this repo's tests build carry the tables and no rows; a
    // count over nothing must be 0, never null, or a fresh install fails its own gate.
    const r = runSurface({ env: process.env, surface: CLOSES });
    expect([PASS, FAIL].includes(r.status), r.detail).toBe(true);
  });
});
