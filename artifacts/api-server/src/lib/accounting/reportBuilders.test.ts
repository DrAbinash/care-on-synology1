import { describe, expect, test } from "vitest";
import {
  buildBalanceSheet,
  buildProfitLoss,
  buildTrialBalance,
  computeAccountBalances,
  type AmountMap,
  type ReportAccount,
} from "./reportBuilders";

// ── Tiny in-memory ledger helper ──────────────────────────────────────────────
// Post balanced vouchers (one debit account, one credit account, equal amount)
// and derive the drMap / crMap the pure builders expect — exactly what the SQL
// aggregation in the route produces, but without a database.

interface Voucher {
  debit: string; // account id
  credit: string; // account id
  amount: number;
}

function maps(vouchers: Voucher[]): { drMap: AmountMap; crMap: AmountMap } {
  const drMap: AmountMap = new Map();
  const crMap: AmountMap = new Map();
  for (const v of vouchers) {
    drMap.set(v.debit, (drMap.get(v.debit) ?? 0) + v.amount);
    crMap.set(v.credit, (crMap.get(v.credit) ?? 0) + v.amount);
  }
  return { drMap, crMap };
}

const acc = (id: number, name: string, type: string, tallyGroup?: string, opening?: { amount: number; type: "Dr" | "Cr" }): ReportAccount => ({
  id,
  name,
  type,
  tallyGroup: tallyGroup ?? null,
  openingBalance: opening ? opening.amount : "0",
  openingBalanceType: opening ? opening.type : "Dr",
});

describe("buildBalanceSheet — the fundamental invariant", () => {
  test("balances when a cash account is overdrawn (the reported bug scenario)", () => {
    // Reproduces the screenshot: ₹12 collected to a bank account, ₹19,515 of
    // expenses paid out of Cash-in-Hand (which had no opening balance), so cash
    // goes to a −19,515 CREDIT balance. The old builder dropped that credit
    // cash line and reported Liabilities = 0 / Difference = 19,515.
    const accounts = [
      acc(1, "UPI Collections", "bank", "Bank Accounts"),
      acc(2, "Cash in Hand", "cash", "Cash-in-Hand"),
      acc(3, "Diagnostic Services Revenue", "income", "Direct Income"),
      acc(4, "Expenses — Salary", "expense", "Indirect Expenses"),
    ];
    const { drMap, crMap } = maps([
      { debit: "1", credit: "3", amount: 12 }, // receipt: Dr Bank / Cr Revenue
      { debit: "4", credit: "2", amount: 19_515 }, // expense: Dr Expense / Cr Cash
    ]);

    const bs = buildBalanceSheet(accounts, drMap, crMap);

    expect(bs.balanced).toBe(true);
    expect(bs.totalAssets).toBeCloseTo(bs.totalLiabilities, 2);
    // Net loss = income 12 − expense 19,515 = −19,503
    expect(bs.netProfit).toBeCloseTo(-19_503, 2);
    // Cash's −19,515 credit balance must appear on the liabilities side, flagged abnormal
    const cashLine = bs.liabilities.find((l) => l.name === "Cash in Hand");
    expect(cashLine).toBeDefined();
    expect(cashLine!.amount).toBeCloseTo(19_515, 2);
    expect(cashLine!.abnormal).toBe(true);
    // Net loss is contra-ed onto the assets side
    expect(bs.assets.find((a) => a.name === "Net Loss for the Period")?.amount).toBeCloseTo(19_503, 2);
  });

  test("balances for a normal profit scenario with capital & receivables", () => {
    // NOTE: capital is introduced via a voucher (Dr Bank / Cr Capital), NOT an
    // opening balance. A balance sheet only balances when posted vouchers are
    // balanced AND any opening balances themselves net to zero — a lone
    // debit-only or credit-only opening is unbalanced input by definition.
    const accounts = [
      acc(1, "Owner Capital", "liability", "Capital Account"),
      acc(2, "Bank", "bank", "Bank Accounts"),
      acc(3, "Sundry Debtors", "asset", "Sundry Debtors"),
      acc(4, "Revenue", "income", "Direct Income"),
      acc(5, "Rent", "expense", "Indirect Expenses"),
    ];
    const { drMap, crMap } = maps([
      { debit: "2", credit: "1", amount: 100_000 }, // capital introduced into bank
      { debit: "3", credit: "4", amount: 40_000 }, // credit sale → debtor
      { debit: "2", credit: "3", amount: 25_000 }, // debtor pays into bank
      { debit: "5", credit: "2", amount: 10_000 }, // rent paid from bank
    ]);

    const bs = buildBalanceSheet(accounts, drMap, crMap);
    expect(bs.balanced).toBe(true);
    expect(bs.netProfit).toBeCloseTo(30_000, 2); // 40k income − 10k expense
    // Capital (100k) + net profit (30k) on the liabilities/capital side
    expect(bs.totalLiabilities).toBeCloseTo(130_000, 2);
    expect(bs.liabilities.find((l) => l.name === "Net Profit for the Period")?.amount).toBeCloseTo(30_000, 2);
    // Assets: bank 115k + debtors 15k = 130k
    expect(bs.totalAssets).toBeCloseTo(130_000, 2);
  });

  test("places an unmapped-group account by sign instead of dropping it", () => {
    const accounts = [
      acc(1, "Bank", "bank", "Bank Accounts"),
      acc(2, "Mystery Suspense", "asset", "Totally Unknown Group"),
    ];
    const { drMap, crMap } = maps([{ debit: "2", credit: "1", amount: 500 }]);
    const bs = buildBalanceSheet(accounts, drMap, crMap);
    expect(bs.balanced).toBe(true);
    expect(bs.assets.find((a) => a.name === "Mystery Suspense")?.amount).toBeCloseTo(500, 2);
    expect(bs.liabilities.find((l) => l.name === "Bank")?.amount).toBeCloseTo(500, 2);
  });

  test("balances from balanced opening balances alone (Dr opening = Cr opening)", () => {
    // Owner starts the business: ₹80,000 in the bank funded by ₹80,000 capital.
    // Opening debits (bank) equal opening credits (capital), so the sheet
    // balances before a single voucher is posted.
    const accounts = [
      acc(1, "Bank", "bank", "Bank Accounts", { amount: 80_000, type: "Dr" }),
      acc(2, "Capital", "liability", "Capital Account", { amount: 80_000, type: "Cr" }),
    ];
    const bs = buildBalanceSheet(accounts, new Map(), new Map());
    expect(bs.balanced).toBe(true);
    expect(bs.totalAssets).toBeCloseTo(80_000, 2);
    expect(bs.totalLiabilities).toBeCloseTo(80_000, 2);
  });

  test("stays balanced across a randomized stream of balanced vouchers", () => {
    const accounts = [
      acc(1, "Cash", "cash", "Cash-in-Hand"),
      acc(2, "Bank", "bank", "Bank Accounts"),
      acc(3, "Creditors", "liability", "Sundry Creditors"),
      acc(4, "Debtors", "asset", "Sundry Debtors"),
      acc(5, "Revenue", "income", "Direct Income"),
      acc(6, "Supplies", "expense", "Direct Expenses"),
      acc(7, "Capital", "liability", "Capital Account"),
    ];
    // A deterministic pseudo-random-ish stream (no Math.random — reproducible).
    const ids = ["1", "2", "3", "4", "5", "6"];
    const vouchers: Voucher[] = [];
    let seed = 7;
    for (let i = 0; i < 200; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const d = ids[seed % ids.length];
      const c = ids[(seed >> 3) % ids.length];
      if (d === c) continue;
      vouchers.push({ debit: d, credit: c, amount: (seed % 9973) / 7 });
    }
    const { drMap, crMap } = maps(vouchers);
    const bs = buildBalanceSheet(accounts, drMap, crMap);
    expect(bs.balanced).toBe(true);
    expect(Math.abs(bs.totalAssets - bs.totalLiabilities)).toBeLessThan(0.01);
  });
});

describe("cross-report consistency", () => {
  test("Balance Sheet netProfit equals P&L netProfit; sheet balances", () => {
    const accounts = [
      acc(1, "Bank", "bank", "Bank Accounts"),
      acc(2, "Revenue", "income", "Direct Income"),
      acc(3, "Other Income", "income", "Indirect Income"),
      acc(4, "Salary", "expense", "Indirect Expenses"),
      acc(5, "Capital", "liability", "Capital Account"),
    ];
    const { drMap, crMap } = maps([
      { debit: "1", credit: "5", amount: 20_000 },
      { debit: "1", credit: "2", amount: 15_000 },
      { debit: "1", credit: "3", amount: 2_000 },
      { debit: "4", credit: "1", amount: 6_000 },
    ]);
    const pl = buildProfitLoss(accounts, drMap, crMap);
    const bs = buildBalanceSheet(accounts, drMap, crMap);
    expect(pl.netProfit).toBeCloseTo(11_000, 2); // 17k income − 6k expense
    expect(bs.netProfit).toBeCloseTo(pl.netProfit, 2);
    expect(bs.balanced).toBe(true);
  });

  test("Trial Balance total Dr equals total Cr", () => {
    const accounts = [
      acc(1, "Cash", "cash", "Cash-in-Hand"),
      acc(2, "Revenue", "income", "Direct Income"),
      acc(3, "Rent", "expense", "Indirect Expenses"),
    ];
    const { drMap, crMap } = maps([
      { debit: "1", credit: "2", amount: 5_000 },
      { debit: "3", credit: "1", amount: 1_200 },
    ]);
    const tb = buildTrialBalance(accounts, drMap, crMap);
    expect(tb.balanced).toBe(true);
    expect(tb.totalDr).toBeCloseTo(tb.totalCr, 2);
    // Only accounts with movement appear
    expect(tb.rows).toHaveLength(3);
  });
});

describe("buildProfitLoss", () => {
  test("nets debit contra entries against income (e.g. sales returns)", () => {
    const accounts = [acc(1, "Revenue", "income", "Direct Income"), acc(2, "Cash", "cash", "Cash-in-Hand")];
    const { drMap, crMap } = maps([
      { debit: "2", credit: "1", amount: 10_000 }, // income
      { debit: "1", credit: "2", amount: 1_500 }, // refund reverses income
    ]);
    const pl = buildProfitLoss(accounts, drMap, crMap);
    expect(pl.totalIncome).toBeCloseTo(8_500, 2);
    expect(pl.income.find((i) => i.name === "Revenue")?.amount).toBeCloseTo(8_500, 2);
  });

  test("omits zero-net accounts from the statement", () => {
    const accounts = [acc(1, "Revenue", "income", "Direct Income"), acc(2, "Cash", "cash", "Cash-in-Hand")];
    const { drMap, crMap } = maps([
      { debit: "2", credit: "1", amount: 3_000 },
      { debit: "1", credit: "2", amount: 3_000 },
    ]);
    const pl = buildProfitLoss(accounts, drMap, crMap);
    expect(pl.income).toHaveLength(0);
    expect(pl.netProfit).toBeCloseTo(0, 2);
  });
});

describe("computeAccountBalances", () => {
  test("folds opening balances of both signs into the closing balance", () => {
    const accounts = [
      acc(1, "Bank", "bank", "Bank Accounts", { amount: 1_000, type: "Dr" }),
      acc(2, "Loan", "liability", "Loans (Liability)", { amount: 5_000, type: "Cr" }),
    ];
    const { drMap, crMap } = maps([{ debit: "1", credit: "2", amount: 500 }]);
    const balances = computeAccountBalances(accounts, drMap, crMap);
    expect(balances[0].balance).toBeCloseTo(1_500, 2); // 1000 Dr opening + 500 Dr
    expect(balances[1].balance).toBeCloseTo(-5_500, 2); // 5000 Cr opening + 500 Cr
  });
});
