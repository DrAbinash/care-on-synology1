#!/usr/bin/env node
/**
 * financial-integrity.mjs — read-only checks over the clinic's live money data.
 *
 * WHY THIS EXISTS. `workspace/accounting-audit/accounting-data-audit.sql` holds 61
 * numbered checks and has NEVER been run against this clinic — its own header says
 * "Data-inconsistency status: UNVERIFIED (no DB reachable; SQL authored, not run)".
 * The API's `runBooksSanity()` does compute some of it, but only behind a logged-in
 * HTTP route, so nothing on the box can answer "is the money data self-consistent"
 * before a deploy. This is that answer, as a gate.
 *
 * READ-ONLY IS ENFORCED, NOT PROMISED. Every statement is a SELECT, the session is
 * opened with `default_transaction_read_only = on` so PostgreSQL refuses any write
 * before it reaches a table, and `statement_timeout` cancels a slow query instead of
 * letting it hold a snapshot on a live Bill Desk. `financialIntegrity.test.mjs` fails
 * if any emitted SQL contains a write verb, and fails if any check can print anything
 * but a count and numeric row ids.
 *
 * GATE vs ADVISORY IS MEASURED, NOT OPINIONED. A check blocks a deploy only if its
 * invariant provably holds in every writer AND it measured zero violations on the live
 * clinic on 2026-10-15 (8,370 bills / 9,207 payments / 11,588 vouchers). The findings
 * that measured a backlog — 140 cross-book bill-number repeats, 52 order totals that
 * differ from their active lines, 240 drawer closes that claim a perfect count they
 * never took — are reported as advisory, because a permanently-red gate is not a
 * control: it is the reason the next real red gets ignored.
 *
 * Two known-bad shapes are deliberately NOT repeated here:
 *   • bill numbers are unique PER BOOK (`unique(ledger_id, bill_number)`,
 *     lib/db/src/schema/bills.ts:59). The audit SQL's DQC-01 groups by `bill_number`
 *     alone and so calls 140 correct invoices duplicates.
 *   • `paid_amount` is compared against the payment rows the ledger actually counts:
 *     the sanctioned exclusion (`reports.ts:239`, `lib/financialIntegrity.ts:18-25`).
 *     Superseding a double-post decrements `bills.paid_amount` and posts a reversal
 *     VOUCHER without inserting a compensating payment row
 *     (routes/accounting.ts:1217-1253), so `SUM(all rows)` disagrees with correct data.
 *
 * Exit codes, and only the first is a green light:
 *   0 every gate ran and passed · 1 a gate is violated · 2 no DATABASE_URL ·
 *   3 a gate could not be evaluated (UNKNOWN — never readable as PASS)
 */
import { spawnSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const PASS = "PASS";
export const FAIL = "FAIL";
export const UNVERIFIED = "UNVERIFIED";
export const GATE = "gate";
export const ADVISORY = "advisory";
export const MONEY = "money";
export const CLOSES = "closes";

/** The session is opened read-only and time-boxed before any statement runs. */
export const SESSION_GUARD = "SET default_transaction_read_only = on; SET statement_timeout = '20s';";

/** Tolerance everywhere in this money surface: one paisa. Every writer rounds to 2dp. */
export const TOLERANCE = 0.01;

/** The settlement statuses that do not represent money the ledger counts. */
export const UNCOUNTED_SETTLEMENT = ["superseded", "void", "failed", "reversed", "cancelled", "refund_failed"];
export const COUNTED_PAYMENT = `COALESCE(p.settlement_status,'') NOT IN (${UNCOUNTED_SETTLEMENT.map((s) => `'${s}'`).join(",")})`;

/**
 * Every check is wrapped by this, so the projection is fixed by code rather than by
 * whatever a later edit selects: one count, and up to five ROW IDS. A check cannot
 * print a patient name, an MRN, a bill number or an amount, because it has no way to
 * put one in the result set.
 *
 * The `FI|` marker is not decoration. `psql -Atc "SET …; SET …; SELECT …"` prints a
 * command tag for each utility statement before the row, and the tags a client emits
 * differ by version — measured: psql 18.3 on this box prints `SET`, `SET`, then the
 * row, while the NAS's own psql printed the row alone. A parser that read the first
 * line would therefore grade every money check as UNVERIFIED on some machines, which
 * is the failure shape where a gate goes permanently amber and gets ignored.
 */
export const RESULT_MARKER = "FI";
/**
 * How many row ids a finding may name. It is a constant rather than a literal inside
 * the SQL so a test can bound the number itself: an assertion that the statement
 * "contains LIMIT 5" is satisfied by `LIMIT 5000`, and a finding that prints 5,000 row
 * ids is a finding that prints a list of records.
 */
export const ID_SAMPLE_CAP = 5;
export function wrapCountAndIds(innerSelect) {
  const sql = innerSelect.trim().replace(/;+$/, "");
  return `WITH findings AS (${sql}) SELECT '${RESULT_MARKER}|' || (SELECT count(*)::text FROM findings) || '|' || COALESCE((SELECT string_agg(id::text, ',' ORDER BY id) FROM (SELECT id FROM findings ORDER BY id LIMIT ${ID_SAMPLE_CAP}) sample), '')`;
}

/**
 * The checks. `inner` must be exactly `SELECT <integer id> AS id FROM ...`.
 * Measured column results (2026-10-15, live clinic) are recorded beside each, because
 * the gate/advisory split is a claim about this clinic's data and must be re-checkable.
 */
export const CHECKS = [
  // ── money: the identities every writer maintains ──────────────────────────
  {
    id: "bills.total_identity",
    surface: MONEY,
    kind: GATE,
    claim: "total_amount = subtotal - discount + tax_amount",
    measured: "0 violations in 8,370 bills",
    inner: `SELECT id FROM bills
             WHERE ABS(COALESCE(total_amount,0) - (COALESCE(subtotal,0) - COALESCE(discount,0) + COALESCE(tax_amount,0))) > ${TOLERANCE}`,
  },
  {
    id: "bills.balance_identity",
    surface: MONEY,
    kind: GATE,
    claim: "balance_amount = max(0, total - paid - refund) for a bill that is not cancelled",
    measured: "0 violations; cancelled bills are pinned to 0.00 by routes/bills.ts:1853 and are excluded",
    inner: `SELECT id FROM bills
             WHERE status <> 'cancelled'
               AND ABS(COALESCE(balance_amount,0) - GREATEST(0, COALESCE(total_amount,0) - COALESCE(paid_amount,0) - COALESCE(refund_amount,0))) > ${TOLERANCE}`,
  },
  {
    id: "payments.collected_matches_ledger",
    surface: MONEY,
    kind: GATE,
    claim: "paid_amount = SUM(payment rows the ledger counts)",
    measured: "0 violations with the exclusion, and also 0 without it today — no superseded row exists yet (9,204 NULL, 3 captured), so the exclusion is what keeps this green the first time a double-post is superseded",
    inner: `SELECT b.id FROM bills b
             LEFT JOIN payments p ON p.bill_id = b.id AND ${COUNTED_PAYMENT}
             GROUP BY b.id, b.paid_amount
             HAVING ABS(b.paid_amount - COALESCE(SUM(p.amount),0)) > ${TOLERANCE}`,
  },
  {
    id: "bills.no_negative_amounts",
    surface: MONEY,
    kind: GATE,
    claim: "no stored money column is negative (refunds live in their own column)",
    measured: "0 negatives across subtotal/discount/tax/total/balance/refund/paid",
    inner: `SELECT id FROM bills
             WHERE subtotal < -0.005 OR discount < -0.005 OR tax_amount < -0.005
                OR total_amount < -0.005 OR balance_amount < -0.005
                OR refund_amount < -0.005 OR paid_amount < -0.005`,
  },
  {
    id: "bills.discount_within_subtotal",
    surface: MONEY,
    kind: GATE,
    claim: "discount never exceeds subtotal",
    measured: "0 violations",
    inner: `SELECT id FROM bills WHERE discount - subtotal > 0.005`,
  },
  {
    id: "bills.refund_within_collected",
    surface: MONEY,
    kind: GATE,
    claim: "refund_amount never exceeds the money actually collected on that bill",
    measured: "0 violations",
    inner: `SELECT b.id FROM bills b
             WHERE COALESCE(b.refund_amount,0) >
                     COALESCE((SELECT SUM(p.amount) FROM payments p
                                WHERE p.bill_id = b.id AND p.amount > 0 AND ${COUNTED_PAYMENT}), 0) + 0.005`,
  },
  {
    id: "bills.bill_number_unique_in_book",
    surface: MONEY,
    kind: GATE,
    claim: "one bill number per book — the real constraint (unique(ledger_id, bill_number))",
    measured: "0 duplicates within a book, while 140 numbers repeat ACROSS books",
    inner: `SELECT min(id) AS id FROM bills GROUP BY ledger_id, bill_number HAVING count(*) > 1`,
  },
  {
    id: "payments.bill_exists",
    surface: MONEY,
    kind: GATE,
    claim: "every payment row belongs to a bill that exists",
    measured: "0 orphans; the live database DOES carry payments_bill_id_bills_id_fk, so this is a tripwire against a future no-FK DDL path, not a new rule",
    inner: `SELECT p.id FROM payments p WHERE NOT EXISTS (SELECT 1 FROM bills b WHERE b.id = p.bill_id)`,
  },
  {
    id: "vouchers.no_self_cancelling_posting",
    surface: MONEY,
    kind: GATE,
    claim: "a voucher's two sides are different accounts",
    measured: "0 violations in 11,588 vouchers",
    inner: `SELECT id FROM vouchers WHERE debit_account_id = credit_account_id`,
  },
  {
    id: "vouchers.amount_positive",
    surface: MONEY,
    kind: GATE,
    claim: "voucher amount > 0 — the sign comes from type, never from the number",
    measured: "min(amount) = 0.01, max = 297,195.00, 0 non-positive",
    inner: `SELECT id FROM vouchers WHERE amount <= 0`,
  },
  {
    id: "vouchers.accounts_resolve",
    surface: MONEY,
    kind: GATE,
    claim: "both account references resolve to a row in the chart of accounts",
    measured: "0 unresolved and 0 non-numeric in 11,588 rows — these are free-text columns with no FK (routes hold 'id'::text), so this is the only thing that can notice one going stale",
    inner: `SELECT v.id FROM vouchers v
             WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id::text = v.debit_account_id)
                OR NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id::text = v.credit_account_id)`,
  },
  // ── day close: the cash the desk signed for ───────────────────────────────
  {
    id: "day_closures.expected_totals_sum",
    surface: CLOSES,
    kind: GATE,
    claim: "total_expected = the five method buckets added",
    measured: "0 violations in 51 clinic closures",
    inner: `SELECT id FROM day_closures
             WHERE ABS(COALESCE(total_expected,0) - (COALESCE(expected_cash,0)+COALESCE(expected_upi,0)+COALESCE(expected_card,0)+COALESCE(expected_cheque,0)+COALESCE(expected_other,0))) > ${TOLERANCE}`,
  },
  {
    id: "day_closures.variance_identity",
    surface: CLOSES,
    kind: GATE,
    claim: "variance = total_actual - total_expected",
    measured: "0 violations in 51 closures",
    inner: `SELECT id FROM day_closures
             WHERE ABS(COALESCE(variance,0) - (COALESCE(total_actual,0) - COALESCE(total_expected,0))) > ${TOLERANCE}`,
  },
  {
    id: "user_day_closures.expected_totals_sum",
    surface: CLOSES,
    kind: GATE,
    claim: "a staff drawer's total_expected = its own method buckets",
    measured: "0 violations in 255 staff closes",
    inner: `SELECT id FROM user_day_closures
             WHERE ABS(COALESCE(total_expected,0) - (COALESCE(expected_cash,0)+COALESCE(expected_upi,0)+COALESCE(expected_card,0)+COALESCE(expected_cheque,0)+COALESCE(expected_other,0))) > ${TOLERANCE}`,
  },
  {
    id: "user_day_closures.variance_identity",
    surface: CLOSES,
    kind: GATE,
    claim: "a staff drawer's variance = actual - expected",
    measured: "0 violations in 255 staff closes",
    inner: `SELECT id FROM user_day_closures
             WHERE ABS(COALESCE(variance,0) - (COALESCE(total_actual,0) - COALESCE(total_expected,0))) > ${TOLERANCE}`,
  },
  {
    id: "user_day_closures.denomination_total_matches_cash",
    surface: CLOSES,
    kind: GATE,
    claim: "where notes were counted, the denomination total equals the counted cash",
    measured: "7 closes carry a denomination tally; all 7 agree with actual_cash",
    inner: `SELECT id FROM user_day_closures
             WHERE denominations IS NOT NULL AND denomination_total IS NOT NULL
               AND ABS(COALESCE(denomination_total,0) - COALESCE(actual_cash,0)) > ${TOLERANCE}`,
  },
  // ── advisory: measured, real, and deliberately NOT a deploy blocker ──────
  {
    id: "bills.bill_number_repeats_across_books",
    surface: MONEY,
    kind: ADVISORY,
    claim: "the same bill number used in two different books",
    measured: "140 numbers — this is exactly what the audit SQL's DQC-01 reports as duplicates, and none of them is a defect",
    inner: `SELECT min(id) AS id FROM bills GROUP BY bill_number HAVING count(DISTINCT ledger_id) > 1`,
  },
  {
    id: "bills.cancelled_with_money_collected",
    surface: MONEY,
    kind: ADVISORY,
    claim: "a cancelled bill still showing collected money",
    measured: "1 row — legitimate when a refund is still in flight, so it is a review list",
    inner: `SELECT id FROM bills WHERE status = 'cancelled' AND COALESCE(paid_amount,0) > 0.005`,
  },
  {
    id: "orders.total_vs_active_lines",
    surface: MONEY,
    kind: ADVISORY,
    claim: "order total differs from the sum of its active line prices",
    measured: "52 orders — a real backlog, and a deploy gate built on it would be red forever",
    inner: `SELECT o.id FROM orders o
             WHERE ABS(COALESCE(o.total_amount,0) - COALESCE((SELECT SUM(ot.price) FROM order_tests ot
                    WHERE ot.order_id = o.id AND COALESCE(ot.status,'active') = 'active'),0)) > ${TOLERANCE}`,
  },
  {
    id: "payments.gateway_txn_reused_across_bills",
    surface: MONEY,
    kind: ADVISORY,
    claim: "one gateway transaction id paying more than one bill",
    measured: "0 today; uniqueness is only per bill (idx_payments_bill_gateway_txn_uq), so this can appear and would be invisible to any other check",
    inner: `SELECT min(p.id) AS id FROM payments p WHERE p.gateway_txn_id IS NOT NULL
             GROUP BY p.gateway_txn_id HAVING count(DISTINCT p.bill_id) > 1`,
  },
  {
    id: "vouchers.reference_points_at_no_bill",
    surface: MONEY,
    kind: ADVISORY,
    claim: "a voucher whose reference is not any current bill number",
    measured: "2,560 rows — includes expense and contra vouchers, whose reference was never a bill number, so the raw count is not a defect count",
    inner: `SELECT v.id FROM vouchers v
             WHERE v.bill_id IS NOT NULL AND COALESCE(v.reference,'') <> ''
               AND NOT EXISTS (SELECT 1 FROM bills b WHERE b.bill_number = v.reference)`,
  },
  {
    id: "day_closures.window_shape",
    surface: CLOSES,
    kind: ADVISORY,
    claim: "a closure whose coverage window is inverted, missing, or overlaps its neighbour",
    measured: "0 inverted, 1 missing the window columns entirely (closed before they existed), 2 overlapping pairs",
    inner: `SELECT id FROM day_closures
             WHERE (covered_from_ts IS NOT NULL AND covered_to_ts IS NOT NULL AND covered_from_ts >= covered_to_ts)
                OR (covered_from_ts IS NULL OR covered_to_ts IS NULL)`,
  },
  {
    id: "user_day_closures.perfect_count_never_taken",
    surface: CLOSES,
    kind: ADVISORY,
    claim: "a drawer closed as balanced, with zero variance, and no note count recorded",
    measured: "240 of 255 staff closes. The self-close form pre-fills the counted figures from the system's own expected totals, so the stored row cannot distinguish a counted drawer from an uncounted one — this is the control weakness, and it is an owner decision about process, not a data defect and not a deploy blocker",
    inner: `SELECT id FROM user_day_closures
             WHERE denominations IS NULL AND COALESCE(variance,0) = 0
               AND COALESCE(drawer_status,'') = 'balanced'`,
  },
];

const WRITE_VERB = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|vacuum|analyze|analyse|call|do|merge|refresh|reindex|lock|comment)\b/i;

/**
 * The read-only promise, checked before anything runs. Kept as a function so the test
 * can call it on the shipped list and so a caller cannot pass its own SQL in.
 */
export function assertReadOnly(inner) {
  const found = WRITE_VERB.exec(inner);
  if (found) throw new Error(`refusing to emit a statement containing "${found[1]}" — every check here is a SELECT`);
  if (!/^\s*(with|select)\b/i.test(inner)) throw new Error("a check must begin with SELECT or WITH");
  return true;
}

export function parseResult(text) {
  // Find the marked row anywhere in the output: the session `SET`s may or may not
  // echo a command tag, depending on the psql build, and a row is a row either way.
  const line = String(text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.startsWith(`${RESULT_MARKER}|`));
  if (!line) return null;
  const parts = line.split("|");
  // A marked row with nothing where the count should be is NOT zero violations. A
  // truncated or half-written row that read as 0 would be the greenest possible lie.
  if (!/^\d+$/.test(String(parts[1] ?? ""))) return null;
  const count = Number(parts[1]);
  if (!Number.isFinite(count) || count < 0) return null;
  return { count, ids: (parts[2] || "").split(",").map((s) => s.trim()).filter(Boolean) };
}

/** One shape for every verdict line: a count and ids, never a field of a patient. */
export function detailFor(check, result) {
  if (!result) return `no number came back — ${check.id} was not evaluated`;
  const where = result.ids.length ? ` (rows ${result.ids.join(", ")}${result.count > result.ids.length ? ", …" : ""})` : "";
  if (result.count === 0) return `0 violations`;
  return `${result.count} violation${result.count === 1 ? "" : "s"}${where}`;
}

export function evaluate(check, result) {
  if (!result) return { ...check, status: UNVERIFIED, detail: detailFor(check, null) };
  if (check.kind === ADVISORY) {
    return { ...check, status: result.count === 0 ? PASS : FAIL, ok: true, detail: detailFor(check, result), advisory: true };
  }
  return { ...check, status: result.count === 0 ? PASS : FAIL, ok: result.count === 0, detail: detailFor(check, result) };
}

export const defaultExec = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: opts.timeout ?? 45_000, cwd: opts.cwd ?? REPO });
  return { code: r.status, stdout: r.stdout || "", stderr: r.stderr || "", missing: r.error !== undefined };
};

/** A surface is the half of the money system one deploy-gate check answers for. */
export const SURFACES = {
  [MONEY]: { id: "financial.money_identity", title: "bills, payments and vouchers" },
  [CLOSES]: { id: "financial.day_close_identity", title: "clinic and staff day close" },
};

export function runSurface({ exec = defaultExec, env = process.env, surface, gatesOnly = false, log = () => {} }) {
  const url = (env.DATABASE_URL || "").trim();
  const surfaceId = SURFACES[surface].id;
  if (!url) {
    return {
      id: surfaceId,
      status: UNVERIFIED,
      critical: true,
      detail: `no DATABASE_URL: the money checks never ran, so nothing about ${SURFACES[surface].title} is being claimed`,
      remediation: "Run on the NAS host against the published port, or inside the database container: docker exec -i care-db sh -c 'psql -U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\" -X -f -' < the statement. Never print the connection string.",
      results: [],
    };
  }
  const results = [];
  let transportFailure = null;
  const surfaceChecks = CHECKS.filter((c) => c.surface === surface && (!gatesOnly || c.kind === GATE));
  for (const [i, check] of surfaceChecks.entries()) {
    assertReadOnly(check.inner);
    // The check id travels in a comment so a caller (or a test) can name the one
    // statement it is talking about without matching on a fragment of its SQL.
    const sql = `${SESSION_GUARD} /* financial-integrity:${check.id} */ ${wrapCountAndIds(check.inner)}`;
    const r = exec("psql", [url, "-Atc", sql], { timeout: 40_000 });
    if (r.code !== 0 || r.missing) {
      transportFailure = r.stderr ? String(r.stderr).split(/\r?\n/)[0] : `exit ${r.code}`;
      // Everything after the failed statement is equally unevaluated. Stopping with a
      // partial list would report "1 invariant could not be evaluated" over a surface
      // where none of them were, which reads far better than the truth.
      for (const rest of surfaceChecks.slice(i)) {
        results.push({ ...rest, status: UNVERIFIED, detail: `could not be evaluated (${transportFailure})` });
      }
      break;
    }
    results.push(evaluate(check, parseResult(r.stdout)));
  }
  const gates = results.filter((r) => r.kind === GATE);
  const failed = gates.filter((r) => r.status === FAIL);
  const unverified = gates.filter((r) => r.status === UNVERIFIED).length;
  const advisories = results.filter((r) => r.kind === ADVISORY && r.status === FAIL);
  const status = failed.length ? FAIL : unverified ? UNVERIFIED : gates.length === 0 ? UNVERIFIED : PASS;
  return {
    id: surfaceId,
    status,
    critical: true,
    detail: failed.length
      ? `${failed.length} of ${gates.length} ${SURFACES[surface].title} invariants violated: ${failed.map((f) => `${f.id} ${f.detail}`).join("; ")}`
      : unverified
        ? `${unverified} invariant(s) could not be evaluated${transportFailure ? ` (${transportFailure})` : ""} — absence is a finding, not a clean bill`
        : `${gates.length} ${SURFACES[surface].title} invariants hold${advisories.length ? `; ${advisories.length} advisory finding(s) reported, none blocking` : ""}`,
    remediation: failed.length
      ? "Do not deploy over this. A money invariant that disagrees with its own rows means a writer bypassed the recomputation — open the named rows, correct them through the application's own edit path, and re-run. Do not patch the database directly."
      : unverified
        ? "Make psql reachable with the supplied DATABASE_URL, then re-run. A money check that did not run is not a money check that passed."
        : "",
    results,
  };
}

const USAGE = `financial-integrity — read-only self-consistency of the clinic's money data

  node scripts/financial-integrity.mjs                 both surfaces, text
  node scripts/financial-integrity.mjs --surface=money
  node scripts/financial-integrity.mjs --json=output/financial-integrity.json
  node scripts/financial-integrity.mjs --gate          exit 0 only if every GATE passed

Writes nothing, reads no patient field, prints counts and row ids.
Exit 0 all gates pass · 1 a gate is violated · 2 no DATABASE_URL · 3 a gate could not run.`;

export async function main(argv = process.argv.slice(2), { exec = defaultExec, env = process.env, log = (s) => process.stdout.write(s + "\n") } = {}) {
  const args = Object.fromEntries(argv.filter((a) => a.startsWith("--")).map((a) => {
    const [k, ...rest] = a.replace(/^--/, "").split("=");
    return [k, rest.length ? rest.join("=") : true];
  }));
  if (args.help || args.h) { log(USAGE); return 0; }
  const wantAdvisory = Boolean(args.advisory);
  const surfaces = args.surface ? [args.surface] : Object.keys(SURFACES);
  for (const s of surfaces) if (!SURFACES[s]) { log(`UNVERIFIED: unknown --surface ${s} (expected ${Object.keys(SURFACES).join("|")})`); return 3; }

  const reports = surfaces.map((s) => runSurface({ exec, env, surface: s, log }));
  const all = reports.flatMap((r) => r.results);
  for (const r of reports) {
    log(`${r.status} ${r.id} — ${r.detail}`);
    if (r.remediation && r.status !== PASS) log(`   do this: ${r.remediation}`);
    for (const line of r.results) {
      if (line.kind === ADVISORY && line.status === PASS) continue;
      if (line.kind === ADVISORY && !wantAdvisory && r.status === PASS) continue;
      log(`     ${line.kind === ADVISORY ? "advisory" : line.status === PASS ? "ok      " : "FINDING "} ${line.id}: ${line.detail}`);
    }
  }
  const gates = all.filter((c) => c.kind === GATE);
  const failed = gates.filter((g) => g.status === FAIL);
  const unverified = gates.filter((g) => g.status === UNVERIFIED);
  const noUrl = reports.some((r) => r.status === UNVERIFIED && r.detail.startsWith("no DATABASE_URL"));

  if (typeof args.json === "string") {
    const target = path.resolve(REPO, args.json);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify({ generatedAt: new Date().toISOString(), reports }, null, 2) + "\n");
    log(`proof written to ${args.json}`);
  }

  const exit = noUrl ? 2 : failed.length ? 1 : unverified.length ? 3 : 0;
  const verdict = failed.length ? FAIL : unverified.length ? UNVERIFIED : PASS;
  log(`${verdict}: ${gates.length} gate check(s)${failed.length ? `, ${failed.length} violated` : ""}${unverified.length ? `, ${unverified.length} not evaluated` : ""} (exit ${exit})`);
  return exit;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) main().then((code) => { process.exitCode = code; });
