import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

/**
 * The Bills page exports a whole period's register, which is thousands of rows.
 * `GET /api/bills` hydrates patients, orders, referral doctors and every order
 * line for whatever it returns, and the financial pages refresh every 15 s — so
 * the one change that would quietly take the NAS down is putting the register's
 * limit on the polled query. These assertions bind each fetch limit to its
 * refresh policy instead of just checking that both numbers exist somewhere.
 */
const src = readFileSync(new URL("./Billing.tsx", import.meta.url), "utf8");

/** Every `useQuery<BillsListResponse>` block in the page, up to its closing brace. */
function listQueryBlocks(): string[] {
  const parts = src.split("useQuery<BillsListResponse>({").slice(1);
  return parts.map((p) => p.slice(0, p.indexOf("});")));
}

function blockFetching(limitExpr: RegExp): string {
  const found = listQueryBlocks().find((b) => limitExpr.test(b));
  if (!found) throw new Error(`no bills query fetches ${limitExpr}`);
  return found;
}

describe("Bills register fetch plan", () => {
  test("the register limit covers a busy period, not one screen", () => {
    expect(src).toMatch(/const REGISTER_FETCH_LIMIT = 5000;/);
  });

  test("the 15 s refresh stays on the 20-row page", () => {
    expect(blockFetching(/billsUrl\(20/)).toContain("...FINANCIAL_QUERY_OPTIONS");
    expect(blockFetching(/billsUrl\(REGISTER_FETCH_LIMIT\)/)).not.toContain("FINANCIAL_QUERY_OPTIONS");
    expect(blockFetching(/billsUrl\(REGISTER_FETCH_LIMIT\)/)).not.toMatch(/refetchInterval/);
  });

  test("the register fetches once, only when the operator asks", () => {
    const register = blockFetching(/billsUrl\(REGISTER_FETCH_LIMIT\)/);
    expect(register).toMatch(/enabled:\s*registerArmed/);
    // Tab focus and remounts must not re-issue a thousands-row query.
    expect(register).toContain("staleTime: Infinity");
    expect(register).toContain("refetchOnWindowFocus: false");
  });

  test("arming is keyed to the filters, so a new filter never refetches behind a keystroke", () => {
    expect(src).toMatch(/const registerArmed = registerArmedFor === filterSignature;/);
    expect(src).toMatch(/queryKey: \["bills-register", status, dateFrom, dateTo, createdBy, q, referralDoctorId, testId]/);
  });

  test("the exported document prefers the complete register and admits the shortfall", () => {
    expect(src).toContain("const exportSource = registerData ?? data;");
    // buildBillsRegisterExport labels the sheet PARTIAL from these two numbers.
    expect(src).toMatch(/matchedRows: exportSource\.total/);
    expect(src).toContain("exportSource.bills");
  });

  test("the operator is told the register covers only part of the filter", () => {
    expect(src).toContain("Loading complete register…");
    expect(src).toContain("narrow the date range");
  });
});
