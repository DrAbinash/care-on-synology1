import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Voucher numbering must derive from MAX(issued), never count(*).
//
// PRODUCTION OUTAGE this pins: count(*) counts rows that SURVIVE, not numbers
// that were ISSUED. Once vouchers in a bucket are removed the count permanently
// trails the max by the number removed (D), so the retry loop's candidates
// count+1..count+3 == max-D+1..max-D+3 all sit inside the occupied range. At
// D>=3 every attempt collides, nothing inserts, count never moves, and the
// IDENTICAL three numbers are retried for every subsequent voucher — a permanent
// fixed point. Observed as ~20 payments losing their ledger entry with
// "duplicate key value violates unique constraint vouchers_voucher_number_unique"
// repeating on RV-202607-0006.
//
// MAX has the progress guarantee count(*) lacks: every successful insert raises
// max, so the candidate window strictly advances and the failure state is
// destroyed by the insert that caused it.
//
// There were FOUR count-based generators sharing one voucher_number namespace
// and one unique constraint. Fixing only one leaves the others able to
// re-manufacture the drift, so all four are asserted here.

const __dirname = dirname(fileURLToPath(import.meta.url));
const autoVoucher = readFileSync(join(__dirname, "auto-voucher.ts"), "utf8");
const accounting = readFileSync(join(__dirname, "..", "routes", "accounting.ts"), "utf8");

/** Source with `//` comment lines removed — the comments deliberately discuss
 *  count(*) at length to explain why it must not be used, so assertions about
 *  what the code DOES have to look at executable lines only. */
function code(src: string): string {
  return src
    .split("\n")
    .filter(line => !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*"))
    .join("\n");
}

/** The MAX-of-numeric-suffix aggregate, in whichever file. */
const MAX_EXPR = "coalesce(max(substring(";
/** The anchored all-digit guard that makes the ::int cast safe. */
const DIGIT_GUARD = "[0-9]+$";

describe("auto-voucher: receipts / refunds / expense vouchers", () => {
  test("nextVoucherNumber derives from MAX, not count(*)", () => {
    expect(autoVoucher).toContain(MAX_EXPR);
    // No count(*) may remain in the executable numbering path.
    expect(code(autoVoucher)).not.toContain("count(*)");
  });

  test("non-numeric suffixes are excluded before the ::int cast", () => {
    // The ledger view injects a synthetic non-numeric "OB" row; an unguarded
    // cast over the whole bucket would throw and kill voucher creation outright.
    expect(autoVoucher).toContain(DIGIT_GUARD);
    expect(autoVoucher).toContain("::int");
  });

  test("the retry loop is retained — MAX does not replace race handling", () => {
    expect(autoVoucher).toContain("for (let attempt = 0; attempt < 3; attempt++)");
    expect(autoVoucher).toContain('code === "23505"');
  });

  test("bucket scoping is unchanged (per type + per month)", () => {
    // Multiple ledgers share one namespace, so the max must be taken across the
    // whole bucket — that is what stops two ledgers being handed one number.
    expect(autoVoucher).toContain('type === "receipt" ? "RV"');
    expect(autoVoucher).toContain("padStart(4, \"0\")");
  });
});

describe("accounting routes: all three remaining generators", () => {
  test("a single shared MAX helper exists", () => {
    expect(accounting).toContain("async function maxVoucherSeq(bucket: string)");
    expect(accounting).toContain(MAX_EXPR);
    expect(accounting).toContain(DIGIT_GUARD);
  });

  test("manual POST /vouchers uses it", () => {
    expect(accounting).toContain("const next = (await maxVoucherSeq(bucket)) + 1 + attemptOffset;");
  });

  test("sync-billing seeds from MAX, so the backfill can actually run", () => {
    // Seeded from a row count, the very first backfill insert collided and — with
    // no try/catch on that insert — 500'd the whole request half-applied.
    expect(accounting).toContain("monthCounts.set(monthKey, await maxVoucherSeq(`${prefix}-${monthKey}-`));");
    expect(accounting).not.toContain("(await db.select().from(vouchersTable).where(like(vouchersTable.voucherNumber, `${prefix}-${monthKey}%`))).length");
  });

  test("bank import no longer double-advances the sequence", () => {
    // Old form: count re-queried each iteration PLUS `created` added on top, so
    // N imports took C+1, C+3, C+5 … manufacturing max>count drift with zero
    // deletions.
    expect(accounting).toContain("const monthMax = await maxVoucherSeq(`${prefix}-${monthKey}-`);");
    expect(accounting).toContain("String(monthMax + 1).padStart(4, \"0\")");
    expect(accounting).not.toContain("monthCount + created + 1");
  });

  test("no count(*)-based voucher numbering survives anywhere", () => {
    // Narrow to the numbering shape rather than banning count(*) outright —
    // accounting.ts legitimately counts rows for reports.
    expect(accounting).not.toMatch(/count\(\*\)`\s*\}\)\s*\n\s*\.from\(vouchersTable\)\s*\n\s*\.where\(like\(vouchersTable\.voucherNumber/);
  });
});
