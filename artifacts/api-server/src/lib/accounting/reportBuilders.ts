/**
 * reportBuilders.ts — Pure, database-free builders for the three headline
 * accounting reports: Trial Balance, Profit & Loss, and Balance Sheet.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The `/api/accounting/*` report endpoints used to inline all of this logic.
 * The math is the financially-sensitive part, so it lives here as pure
 * functions that take already-aggregated debit/credit totals and return the
 * report shape. Keeping them pure means they can be unit-tested exhaustively
 * WITHOUT a database (see reportBuilders.test.ts) — including the fundamental
 * double-entry invariants that must never drift.
 *
 * THE INVARIANT THAT WAS BEING VIOLATED
 * -------------------------------------
 * Every voucher posts an equal debit and credit, so across ALL accounts
 *   Σ (dr − cr) = 0.
 * Splitting accounts into assets / liabilities / income / expense, that means
 * a balance sheet derived from the ledger MUST always balance:
 *   TotalAssets = TotalLiabilities + NetProfit.
 * The previous Balance Sheet builder only placed an account on the sheet when
 * its balance sign matched a hard-coded expectation (asset ⇒ debit balance,
 * liability ⇒ credit balance) AND it recognised the account's group. Any
 * account that did not match — e.g. a Cash-in-Hand account that has gone to a
 * *credit* (overdrawn) balance, or an account with an unmapped group — was
 * silently dropped. Dropping any non-zero balance breaks the equation, which
 * is exactly why the on-screen sheet showed a non-zero "Difference".
 *
 * THE FIX
 * -------
 * A trial-balance-derived balance sheet places every non-P&L account by the
 * SIGN of its closing balance: a debit balance is an asset/receivable, a
 * credit balance is a liability/payable. Nothing is ever dropped, so the sheet
 * balances for any sequence of balanced vouchers. The account's Tally group is
 * still carried through as `group` so the printed statement can arrange lines
 * under Schedule III headings, and `naturalSide` records where the account
 * would sit under normal conditions (useful for surfacing "abnormal balance"
 * lines in the UI).
 */

// A minimal account shape — only the fields the report math needs. Accepting a
// structural type (rather than the Drizzle row) keeps this module free of any
// DB import and makes it trivial to unit-test.
export interface ReportAccount {
  id: number | string;
  name: string;
  type: string;
  tallyGroup?: string | null;
  openingBalance?: number | string | null;
  openingBalanceType?: string | null;
}

export type AmountMap = Map<string, number>;

export interface AccountBalance {
  id: string;
  name: string;
  type: string;
  group: string;
  dr: number;
  cr: number;
  balance: number; // dr − cr (positive = debit balance)
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

// ── Classification helpers ────────────────────────────────────────────────────
// Group-string / type driven, matching the historical behaviour of the routes.

export function isIncomeAccount(a: ReportAccount): boolean {
  const grp = a.tallyGroup || "";
  return grp.includes("Income") || a.type === "income";
}

export function isExpenseAccount(a: ReportAccount): boolean {
  const grp = a.tallyGroup || "";
  return grp.includes("Expense") || a.type === "expense";
}

/** True when the account belongs on the Profit & Loss statement (not the sheet). */
export function isProfitLossAccount(a: ReportAccount): boolean {
  return isIncomeAccount(a) || isExpenseAccount(a);
}

/**
 * The side an account would naturally sit on under normal (non-abnormal)
 * balances — used only for display grouping, never for placement.
 */
export function naturalSide(a: ReportAccount): "asset" | "liability" {
  const grp = a.tallyGroup || "";
  const liability =
    grp.includes("Liabilities") ||
    grp.includes("Creditors") ||
    grp.includes("Capital") ||
    grp.includes("Reserves") ||
    grp.includes("Loans (Liability)") ||
    grp.includes("Unsecured Loans") ||
    grp.includes("Bank OD") ||
    grp.includes("Duties & Taxes") ||
    a.type === "liability";
  return liability ? "liability" : "asset";
}

// ── Per-account closing balances ──────────────────────────────────────────────

/**
 * Fold opening balances + posted debit/credit totals into a single closing
 * balance per account. `drMap`/`crMap` are keyed by the account id as a string.
 */
export function computeAccountBalances(
  accounts: ReportAccount[],
  drMap: AmountMap,
  crMap: AmountMap,
): AccountBalance[] {
  return accounts.map((account) => {
    const accId = account.id.toString();
    const openBal = Number(account.openingBalance || 0);
    const openType = account.openingBalanceType || "Dr";
    const openDr = openType === "Dr" ? openBal : 0;
    const openCr = openType === "Cr" ? openBal : 0;

    const dr = round2(openDr + (drMap.get(accId) ?? 0));
    const cr = round2(openCr + (crMap.get(accId) ?? 0));
    return {
      id: accId,
      name: account.name,
      type: account.type,
      group: account.tallyGroup || account.type,
      dr,
      cr,
      balance: round2(dr - cr),
    };
  });
}

// ── Trial Balance ─────────────────────────────────────────────────────────────

export interface TrialBalanceRow {
  id: number | string;
  name: string;
  type: string;
  tallyGroup: string;
  parent: string;
  dr: number;
  cr: number;
  balance: number;
  balanceDr: number;
  balanceCr: number;
}

export interface TrialBalance {
  rows: TrialBalanceRow[];
  totalDr: number;
  totalCr: number;
  balanced: boolean;
}

export function buildTrialBalance(
  accounts: ReportAccount[],
  drMap: AmountMap,
  crMap: AmountMap,
  tallyParent: Record<string, string> = {},
): TrialBalance {
  const balances = computeAccountBalances(accounts, drMap, crMap);

  const rows: TrialBalanceRow[] = balances
    .map((b, i) => {
      const account = accounts[i];
      const tallyGroup = account.tallyGroup || account.type;
      const parent = tallyParent[tallyGroup] || account.type;
      const balance = b.balance;
      return {
        id: account.id,
        name: b.name,
        type: b.type,
        tallyGroup,
        parent,
        dr: b.dr,
        cr: b.cr,
        balance,
        balanceDr: balance > 0 ? balance : 0,
        balanceCr: balance < 0 ? round2(Math.abs(balance)) : 0,
      };
    })
    .filter((r) => r.dr > 0 || r.cr > 0);

  const totalDr = round2(rows.reduce((s, r) => s + r.balanceDr, 0));
  const totalCr = round2(rows.reduce((s, r) => s + r.balanceCr, 0));
  return { rows, totalDr, totalCr, balanced: Math.abs(totalDr - totalCr) < 0.01 };
}

// ── Profit & Loss ─────────────────────────────────────────────────────────────

export interface PLLine {
  name: string;
  group: string;
  amount: number;
}

export interface ProfitLoss {
  income: PLLine[];
  expenses: PLLine[];
  totalIncome: number;
  totalExpenses: number;
  netProfit: number;
}

export function buildProfitLoss(
  accounts: ReportAccount[],
  drMap: AmountMap,
  crMap: AmountMap,
): ProfitLoss {
  const income: PLLine[] = [];
  const expenses: PLLine[] = [];

  for (const account of accounts) {
    const isIncome = isIncomeAccount(account);
    const isExpense = isExpenseAccount(account);
    if (!isIncome && !isExpense) continue;

    const accId = account.id.toString();
    const dr = round2(drMap.get(accId) ?? 0);
    const cr = round2(crMap.get(accId) ?? 0);
    const grp = account.tallyGroup || "";

    if (isIncome) {
      const amount = round2(cr - dr);
      if (amount !== 0) income.push({ name: account.name, group: grp || "Income", amount });
    } else {
      const amount = round2(dr - cr);
      if (amount !== 0) expenses.push({ name: account.name, group: grp || "Expenses", amount });
    }
  }

  const totalIncome = round2(income.reduce((s, r) => s + r.amount, 0));
  const totalExpenses = round2(expenses.reduce((s, r) => s + r.amount, 0));
  return { income, expenses, totalIncome, totalExpenses, netProfit: round2(totalIncome - totalExpenses) };
}

// ── Balance Sheet ─────────────────────────────────────────────────────────────

export interface BalanceSheetLine {
  name: string;
  group: string;
  amount: number;
  /** Where the account would normally sit — for surfacing abnormal balances. */
  naturalSide?: "asset" | "liability";
  /** True when the closing balance sign is opposite to `naturalSide`. */
  abnormal?: boolean;
}

export interface BalanceSheet {
  assets: BalanceSheetLine[];
  liabilities: BalanceSheetLine[];
  totalAssets: number;
  totalLiabilities: number;
  netProfit: number;
  balanced: boolean;
}

/**
 * Build a Balance Sheet from opening balances + posted totals.
 *
 * Placement rule (the fix): every non-P&L account with a non-zero closing
 * balance is placed by the SIGN of that balance —
 *   • debit  balance (> 0) → Assets   (what the business owns / is owed)
 *   • credit balance (< 0) → Liabilities & Capital (what it owes)
 * The period's net profit/loss (income − expense) is then added to the capital
 * side (profit) or contra-ed against assets (loss), exactly mirroring how a
 * real balance sheet carries the current-period result into owner's funds.
 *
 * Because nothing is dropped, `totalAssets === totalLiabilities` for ANY set of
 * balanced vouchers — the "Difference" can never be non-zero again.
 */
export function buildBalanceSheet(
  accounts: ReportAccount[],
  drMap: AmountMap,
  crMap: AmountMap,
): BalanceSheet {
  const assets: BalanceSheetLine[] = [];
  const liabilities: BalanceSheetLine[] = [];

  let netIncomeTotal = 0;
  let netExpenseTotal = 0;

  for (const account of accounts) {
    const grp = account.tallyGroup || "";
    const accId = account.id.toString();
    const openBal = Number(account.openingBalance || 0);
    const openType = account.openingBalanceType || "Dr";
    const openDr = openType === "Dr" ? openBal : 0;
    const openCr = openType === "Cr" ? openBal : 0;
    const dr = round2(openDr + (drMap.get(accId) ?? 0));
    const cr = round2(openCr + (crMap.get(accId) ?? 0));
    const balance = round2(dr - cr);

    if (isIncomeAccount(account)) {
      netIncomeTotal = round2(netIncomeTotal + (cr - dr));
      continue;
    }
    if (isExpenseAccount(account)) {
      netExpenseTotal = round2(netExpenseTotal + (dr - cr));
      continue;
    }
    if (balance === 0) continue;

    const side = naturalSide(account);
    if (balance > 0) {
      // Debit balance → asset side. Abnormal if the account is naturally a
      // liability (e.g. a Sundry Creditor paid in advance → now a receivable).
      assets.push({
        name: account.name,
        group: grp || account.type,
        amount: balance,
        naturalSide: side,
        abnormal: side === "liability",
      });
    } else {
      // Credit balance → liability/capital side. Abnormal if the account is
      // naturally an asset (e.g. an overdrawn Cash/Bank account → book overdraft).
      liabilities.push({
        name: account.name,
        group: grp || account.type,
        amount: round2(Math.abs(balance)),
        naturalSide: side,
        abnormal: side === "asset",
      });
    }
  }

  const netProfit = round2(netIncomeTotal - netExpenseTotal);
  if (netProfit > 0) {
    liabilities.push({ name: "Net Profit for the Period", group: "Capital Account", amount: netProfit, naturalSide: "liability" });
  } else if (netProfit < 0) {
    assets.push({ name: "Net Loss for the Period", group: "Capital Account", amount: round2(Math.abs(netProfit)), naturalSide: "asset" });
  }

  const totalAssets = round2(assets.reduce((s, r) => s + r.amount, 0));
  const totalLiabilities = round2(liabilities.reduce((s, r) => s + r.amount, 0));
  return {
    assets,
    liabilities,
    totalAssets,
    totalLiabilities,
    netProfit,
    balanced: Math.abs(totalAssets - totalLiabilities) < 0.01,
  };
}
