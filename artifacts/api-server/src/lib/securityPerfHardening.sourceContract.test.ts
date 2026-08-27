import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Source contracts for the security / perf hardening batch.
 * Prefer runtime tests where possible; these catch regressions that
 * strip the SQL filter or re-introduce local todayISO copies.
 */
describe("security-perf hardening source contracts", () => {
  it("ledger pushes date/account filters into SQL instead of full-table JS filter", () => {
    const src = readFileSync(
      resolve(__dirname, "../routes/accounting.ts"),
      "utf8",
    );
    const ledgerStart = src.indexOf('router.get("/ledger"');
    const ledgerEnd = src.indexOf('router.get("/trial-balance"');
    expect(ledgerStart).toBeGreaterThan(-1);
    const ledger = src.slice(ledgerStart, ledgerEnd);
    expect(ledger).toContain("gte(vouchersTable.date");
    expect(ledger).toContain("lte(vouchersTable.date");
    expect(ledger).not.toContain("const allVouchers = await db.select().from(vouchersTable).orderBy");
    expect(ledger).not.toContain("!from || v.date >=");
  });

  it("staff-change-pin revokes other sessions after PIN update", () => {
    const src = readFileSync(resolve(__dirname, "../routes/portal.ts"), "utf8");
    expect(src).toContain("invalidateStaffSessionsForUser(user.id, { keepToken: token })");
  });

  it("production boots fail-fast when helmet cannot load", () => {
    const src = readFileSync(resolve(__dirname, "../app.ts"), "utf8");
    expect(src).toContain("helmet is required in production");
    expect(src).toContain('X-Frame-Options", "DENY"');
    expect(src).toContain('Referrer-Policy", "no-referrer"');
  });

  it("queue routes use todayIST instead of local getFullYear todayISO", () => {
    for (const rel of [
      "../routes/tokens.ts",
      "../routes/test-tokens.ts",
      "../routes/display.ts",
      "../lib/queueDisplayPingScheduler.ts",
    ]) {
      const src = readFileSync(resolve(__dirname, rel), "utf8");
      expect(src).toMatch(/todayIST/);
      expect(src).not.toMatch(/function todayISO\(\)/);
    }
  });

  it("vouchers query-index migration exists", () => {
    const sql = readFileSync(
      resolve(__dirname, "../../../../migrations/zzzzzzzzzzzzzzz_vouchers_query_indexes.sql"),
      "utf8",
    );
    expect(sql).toContain("idx_vouchers_date");
    expect(sql).toContain("idx_vouchers_type_date");
    expect(sql).toContain("idx_vouchers_bill_id");
    expect(sql).toContain("idx_vouchers_debit_account_date");
    expect(sql).toContain("idx_payments_created_at");
  });
});
