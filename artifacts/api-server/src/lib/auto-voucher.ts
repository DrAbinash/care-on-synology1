import { db } from "@workspace/db";
import { accountsTable, vouchersTable } from "@workspace/db/schema";
import { eq, like, sql } from "drizzle-orm";
import { logger } from "./logger";

// Default accounts created automatically by payment method
const METHOD_ACCOUNTS: Record<string, { name: string; type: string; tallyGroup: string }> = {
  cash:   { name: "Cash in Hand",          type: "cash", tallyGroup: "Cash-in-Hand"  },
  upi:    { name: "UPI Collections",        type: "bank", tallyGroup: "Bank Accounts" },
  card:   { name: "Card Collections",       type: "bank", tallyGroup: "Bank Accounts" },
  online: { name: "Online Collections",     type: "bank", tallyGroup: "Bank Accounts" },
  cheque: { name: "Cheque Collections",     type: "bank", tallyGroup: "Bank Accounts" },
  bank:   { name: "Bank Account",           type: "bank", tallyGroup: "Bank Accounts" },
  neft:   { name: "NEFT/RTGS Collections",  type: "bank", tallyGroup: "Bank Accounts" },
  rtgs:   { name: "NEFT/RTGS Collections",  type: "bank", tallyGroup: "Bank Accounts" },
};

const REVENUE_ACCOUNT = {
  name: "Diagnostic Services Revenue",
  type: "income",
  tallyGroup: "Direct Income",
};

async function ensureAccount(name: string, type: string, tallyGroup: string): Promise<string> {
  const [existing] = await db
    .select({ id: accountsTable.id })
    .from(accountsTable)
    .where(eq(accountsTable.name, name))
    .limit(1);
  if (existing) return existing.id.toString();
  const [created] = await db
    .insert(accountsTable)
    .values({ name, type, tallyGroup, openingBalance: "0", openingBalanceType: "Dr" })
    .returning({ id: accountsTable.id });
  return created.id.toString();
}

function voucherBucketPrefix(type: string): string {
  const prefix = type === "receipt" ? "RV" : type === "payment" ? "PV" : "JV";
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${prefix}-${y}${m}-`;
}

async function nextVoucherNumber(type: string, offset = 0): Promise<string> {
  const bucket = voucherBucketPrefix(type);
  const [r] = await db
    .select({ c: sql<number>`count(*)` })
    .from(vouchersTable)
    .where(like(vouchersTable.voucherNumber, `${bucket}%`));
  const next = Number(r?.c ?? 0) + 1 + offset;
  return `${bucket}${String(next).padStart(4, "0")}`;
}

function istDateStr(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/**
 * Auto-generate an accounting voucher for a billing payment.
 *
 * amount > 0  → Receipt Voucher (RV):
 *     Debit  payment-method account  (where money goes in)
 *     Credit Diagnostic Services Revenue
 *
 * amount < 0  → Payment Voucher (PV, refund):
 *     Debit  Diagnostic Services Revenue  (reversing income)
 *     Credit payment-method account       (where money goes out)
 *
 * Never throws — any failure is logged but NEVER blocks billing operations.
 */
export async function autoVoucherForPayment(opts: {
  billId: number;
  amount: number;
  method: string;
  billNumber: string;
  patientName?: string | null;
  performedBy?: string | null;
}): Promise<void> {
  try {
    const { billId, amount, method, billNumber, patientName, performedBy } = opts;
    if (!Number.isFinite(amount) || amount === 0) return;

    const methodKey = (method ?? "cash").toLowerCase();
    const methodAccDef = METHOD_ACCOUNTS[methodKey] ?? METHOD_ACCOUNTS["cash"];
    const isRefund = amount < 0;
    const absAmount = Math.abs(amount);

    const [methodAccId, revenueAccId] = await Promise.all([
      ensureAccount(methodAccDef.name, methodAccDef.type, methodAccDef.tallyGroup),
      ensureAccount(REVENUE_ACCOUNT.name, REVENUE_ACCOUNT.type, REVENUE_ACCOUNT.tallyGroup),
    ]);

    const vType = isRefund ? "payment" : "receipt";
    const debitAccId  = isRefund ? revenueAccId : methodAccId;
    const creditAccId = isRefund ? methodAccId  : revenueAccId;

    const particular = isRefund
      ? `Refund${patientName ? " - " + patientName : ""} | Bill ${billNumber}`
      : `Receipt${patientName ? " - " + patientName : ""} | Bill ${billNumber}`;

    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      const voucherNumber = await nextVoucherNumber(vType, attempt);
      try {
        await db.insert(vouchersTable).values({
          voucherNumber,
          type: vType,
          date: istDateStr(),
          debitAccountId: debitAccId,
          creditAccountId: creditAccId,
          amount: absAmount.toFixed(2),
          particular,
          billId,
          performedBy: performedBy ?? null,
          narration: "Auto-generated from billing system",
          reference: billNumber,
        });
        return;
      } catch (err: unknown) {
        if ((err as { code?: string }).code === "23505") { lastErr = err; continue; }
        throw err;
      }
    }
    throw lastErr;
  } catch (err) {
    logger.warn({ err }, "[auto-voucher] Failed to generate accounting voucher (non-fatal)");
  }
}

/**
 * Auto-generate a Payment Voucher (PV) for an operational expense.
 *
 * Payment Voucher:
 *     Debit  Expenses — <Category>   (money spent on operations)
 *     Credit Cash in Hand / Bank     (where money came from)
 *
 * Never throws — non-fatal, fire-and-forget from the expenses route.
 */
export async function autoVoucherForExpense(opts: {
  expenseId: string;
  amount: number;
  paymentMode: string;
  category: string;
  description: string;
  performedBy?: string | null;
}): Promise<void> {
  try {
    const { expenseId, amount, paymentMode, category, description, performedBy } = opts;
    if (!Number.isFinite(amount) || amount <= 0) return;

    // Debit: expense category account (e.g. "Expenses — Salary", "Expenses — Office")
    const expAccName = `Expenses — ${category.trim() || "General"}`;
    const expAccId = await ensureAccount(expAccName, "expense", "Indirect Expenses");

    // Credit: the payment-mode account (cash or bank)
    const modeKey = (paymentMode ?? "cash").toLowerCase();
    const modeAccDef = METHOD_ACCOUNTS[modeKey] ?? METHOD_ACCOUNTS["cash"];
    const modeAccId = await ensureAccount(modeAccDef.name, modeAccDef.type, modeAccDef.tallyGroup);

    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      const voucherNumber = await nextVoucherNumber("payment", attempt);
      try {
        await db.insert(vouchersTable).values({
          voucherNumber,
          type: "payment",
          date: istDateStr(),
          debitAccountId: expAccId,
          creditAccountId: modeAccId,
          amount: amount.toFixed(2),
          particular: `${category} | ${description}`,
          billId: null,
          performedBy: performedBy ?? null,
          narration: `Auto-generated from expense ${expenseId}`,
          reference: expenseId,
        });
        return;
      } catch (err: unknown) {
        if ((err as { code?: string }).code === "23505") { lastErr = err; continue; }
        throw err;
      }
    }
    throw lastErr;
  } catch (err) {
    logger.warn({ err }, "[auto-voucher] Failed to generate expense voucher (non-fatal)");
  }
}
