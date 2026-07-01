import { db } from "@workspace/db";
import { accountsTable, vouchersTable } from "@workspace/db/schema";
import { eq, like, sql } from "drizzle-orm";
import { logger } from "./logger";
import { classifyPaymentMethod } from "./paymentMethodClassifier";

// Default accounts created automatically by payment method.
// Exact-match keyed, preserving each method's own historical ledger
// account — unchanged from before this fix, so existing Tally books keep
// posting to the same account names they always have.
const METHOD_ACCOUNTS: Record<string, { name: string; type: string; tallyGroup: string }> = {
  cash:      { name: "Cash in Hand",          type: "cash", tallyGroup: "Cash-in-Hand"  },
  upi:       { name: "UPI Collections",        type: "bank", tallyGroup: "Bank Accounts" },
  card:      { name: "Card Collections",       type: "bank", tallyGroup: "Bank Accounts" },
  online:    { name: "Online Collections",     type: "bank", tallyGroup: "Bank Accounts" },
  cheque:    { name: "Cheque Collections",     type: "bank", tallyGroup: "Bank Accounts" },
  bank:      { name: "Bank Account",           type: "bank", tallyGroup: "Bank Accounts" },
  neft:      { name: "NEFT/RTGS Collections",  type: "bank", tallyGroup: "Bank Accounts" },
  rtgs:      { name: "NEFT/RTGS Collections",  type: "bank", tallyGroup: "Bank Accounts" },
  // Previously missing entirely — an insurance payment fell through to
  // METHOD_ACCOUNTS["cash"] below and silently posted to Cash in Hand.
  insurance: { name: "Insurance Collections",  type: "bank", tallyGroup: "Bank Accounts" },
};

// A payment method the shared classifier does not recognize is routed
// here — a dedicated, clearly-named account — instead of silently
// defaulting to Cash in Hand (the exact "unknown → cash" defect fixed
// for reconciliation math in c92b80f7, now also fixed for voucher
// posting). "bank" type keeps it out of physical cash-in-hand; an
// accountant reviewing Tally will see this account name and know it
// needs manual reclassification, rather than it silently blending into
// the real cash balance.
const UNCLASSIFIED_ACCOUNT = {
  name: "Unclassified Collections (Needs Review)",
  type: "bank",
  tallyGroup: "Bank Accounts",
};

/**
 * Resolve which ledger account a payment method should post to.
 *
 * 1. Exact match against METHOD_ACCOUNTS first — preserves every existing
 *    method's historical account name unchanged (cash, upi, card, cheque,
 *    online, bank, neft, rtgs, insurance).
 * 2. Falls back to the shared classifier ONLY for methods that don't
 *    exactly match — this is what correctly routes gateway-qualified
 *    strings like "Online (ICICI Orange Pay)" / "Online (Razorpay)" to
 *    the existing "Online Collections" account (category "online") via
 *    prefix matching, instead of the previous exact-match failure that
 *    silently posted them to Cash in Hand.
 * 3. Anything the classifier still can't recognize goes to
 *    UNCLASSIFIED_ACCOUNT, never to cash.
 */
export function resolveMethodAccount(method: string): { name: string; type: string; tallyGroup: string } {
  const key = (method ?? "").trim().toLowerCase();
  const exact = METHOD_ACCOUNTS[key];
  if (exact) return exact;

  const classified = classifyPaymentMethod(method);
  if (classified.category === "online") return METHOD_ACCOUNTS.online;
  if (classified.category === "insurance") return METHOD_ACCOUNTS.insurance;
  // classified.category could theoretically be cash/upi/card/cheque here
  // too (e.g. mixed case or whitespace variants not caught by the exact
  // lowercased key match above — defensive, exact match already handles
  // the common cases via .toLowerCase()/.trim()), so fall through to the
  // classifier's category for those as well before giving up.
  if (classified.category !== "unknown" && METHOD_ACCOUNTS[classified.category]) {
    return METHOD_ACCOUNTS[classified.category];
  }
  return UNCLASSIFIED_ACCOUNT;
}

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

    const methodAccDef = resolveMethodAccount(method);
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
    // expenses.payment_mode is NOT NULL DEFAULT 'cash' in the schema (unlike
    // payments.method, which has no such default) — a missing/blank value
    // here means cash, not "unclassified". See day-close.ts's
    // splitCashExpenses() for the same distinction applied to reconciliation
    // math; this keeps voucher posting consistent with it.
    const modeAccDef = (paymentMode ?? "").trim() ? resolveMethodAccount(paymentMode) : METHOD_ACCOUNTS.cash;
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
