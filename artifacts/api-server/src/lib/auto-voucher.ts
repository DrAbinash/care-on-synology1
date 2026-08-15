import { db } from "@workspace/db";
import { accountsTable, vouchersTable } from "@workspace/db/schema";
import { and, eq, like, sql } from "drizzle-orm";
import { logger } from "./logger";
import { classifyPaymentMethod } from "./paymentMethodClassifier";
import { isClinicPeakHours } from "./clinicPeakHours";

/** Drizzle wraps node-pg errors; 23505 may live on err.cause.code. */
function isPgUniqueViolation(err: unknown): boolean {
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur && typeof cur === "object"; i++) {
    const e = cur as { code?: string; message?: string; cause?: unknown };
    if (e.code === "23505") return true;
    if (/duplicate key value violates unique constraint/i.test(e.message ?? "")) return true;
    cur = e.cause;
  }
  return false;
}

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

export async function ensureAccount(name: string, type: string, tallyGroup: string): Promise<string> {
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

// Next sequence in a per-type/per-month bucket, derived from the HIGHEST number
// already issued — deliberately not count(*).
//
// count(*) counts rows that SURVIVE, not numbers that were ISSUED, so once any
// voucher in the bucket is removed the count permanently trails the max by the
// number removed (D). The retry loop's candidates are count+1..count+3, i.e.
// max-D+1..max-D+3 — inside the already-occupied range. At D>=3 all three
// attempts hit existing rows, nothing inserts, so count never changes and the
// IDENTICAL three numbers are retried for every subsequent voucher: a permanent
// fixed point. That is what broke production —
//   duplicate key value violates unique constraint "vouchers_voucher_number_unique"
// repeating on RV-202607-0006 for every receipt in the month.
//
// MAX has the progress guarantee count(*) lacks: every successful insert raises
// max, so the candidate window strictly advances and there is no fixed point.
// A 23505 is then only possible from a genuine concurrent commit, which is
// exactly what the surrounding 5-attempt retry loop is sized for.
//
// The regex is anchored and requires an all-digit suffix, so a hand-entered or
// synthetic number (the ledger view injects a non-numeric "OB" opening-balance
// row) is filtered out BEFORE the ::int cast — Postgres only evaluates the
// aggregate argument for rows passing every WHERE qual, so the cast cannot throw.
// Gaps left where a voucher was deleted are correct and intentional: each
// deletion already writes a voucher_audits row, whereas count(*) would silently
// RE-ISSUE that number to a different transaction.
async function nextVoucherNumber(type: string, offset = 0): Promise<string> {
  return nextVoucherNumberTx(db, type, offset);
}

/** Transaction-aware variant — accepts a db or tx handle so the caller can
 *  run this inside a pg_advisory_xact_lock transaction.
 *
 *  FIX (voucher duplicate-key): The bucket prefix contains regex special
 *  characters (dashes), which must be escaped in the ~ regex. The old code
 *  used `^${bucket}[0-9]+$` which produced `^RV-202608-[0-9]+$` — the dashes
 *  are literal in regex, so this SHOULD have worked. The actual root cause
 *  of the duplicate-key errors was a genuine concurrency race: two concurrent
 *  bill saves both calling nextVoucherNumber before the advisory lock was
 *  added. Now that the lock is in place, the regex escaping ensures the MAX
 *  query reliably finds the highest existing number. */
async function nextVoucherNumberTx(dbHandle: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0], type: string, offset = 0): Promise<string> {
  const bucket = voucherBucketPrefix(type);
  // Escape regex special characters in the bucket (dashes are literal in regex
  // but escape them anyway for safety — future bucket formats might include + or .)
  const escapedBucket = bucket.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const [r] = await dbHandle
    .select({
      m: sql<number>`coalesce(max(substring(${vouchersTable.voucherNumber} from ${bucket.length + 1})::int), 0)`,
    })
    .from(vouchersTable)
    .where(
      and(
        like(vouchersTable.voucherNumber, `${bucket}%`),
        sql`${vouchersTable.voucherNumber} ~ ${`^${escapedBucket}[0-9]+$`}`,
      ),
    );
  const next = Number(r?.m ?? 0) + 1 + offset;
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
  /**
   * F2 — the payment this voucher records. When provided, the voucher row is
   * linked via payment_id (the shared dedup key with sync-billing) AND this
   * function becomes idempotent for that payment: a second call for the same
   * paymentId is a no-op, so a real-time voucher + a later sync can never
   * double it. `reference` still carries the bill number (Tally unchanged).
   */
  paymentId?: number | null;
  /**
   * Bypass peak-hour deferral (off-peak backfill cron / admin sync). Desk
   * capture paths omit this so voucher MAX+lock work does not contend with
   * billing during 08:00–16:00 IST.
   */
  force?: boolean;
}): Promise<void> {
  try {
    const { billId, amount, method, billNumber, patientName, performedBy, paymentId, force } = opts;
    if (!Number.isFinite(amount) || amount === 0) return;

    // Peak-hour deferral: skip capture-time voucher posting while the desk is
    // hot. Idempotent off-peak backfill (and admin sync-billing) catch up.
    if (!force && isClinicPeakHours()) {
      return;
    }

    // Idempotency by payment: never post a second voucher for a payment that
    // already has one (real-time retry, or a real-time voucher followed by a
    // sync run).
    if (paymentId != null) {
      const [existing] = await db
        .select({ id: vouchersTable.id })
        .from(vouchersTable)
        .where(and(eq(vouchersTable.paymentId, paymentId), eq(vouchersTable.billId, billId)))
        .limit(1);
      if (existing) return;
    }

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
    for (let attempt = 0; attempt < 5; attempt++) {
      // FIX (BIZ-voucher-race): Wrap the MAX-read + INSERT in a transaction
      // with pg_advisory_xact_lock to serialize concurrent voucher generation.
      // Previously, two concurrent bill saves could both read the same MAX,
      // both try to INSERT the same number, and one hit a 23505 unique
      // violation. DB logs showed 8+ such violations. The advisory lock
      // ensures only one voucher generation runs at a time per type.
      try {
        const voucherNumber = await db.transaction(async (tx) => {
          // Lock per voucher type so receipt vouchers and payment vouchers
          // don't block each other, but concurrent receipts serialize.
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'care_erp_voucher_' + vType}))`);
          const num = await nextVoucherNumberTx(tx, vType, attempt);
          await tx.insert(vouchersTable).values({
            voucherNumber: num,
            type: vType,
            date: istDateStr(),
            debitAccountId: debitAccId,
            creditAccountId: creditAccId,
            amount: absAmount.toFixed(2),
            particular,
            billId,
            paymentId: paymentId ?? null,
            performedBy: performedBy ?? null,
            narration: "Auto-generated from billing system",
            reference: billNumber,
          });
          return num;
        });
        return;
      } catch (err: unknown) {
        if (isPgUniqueViolation(err)) { lastErr = err; continue; }
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
    for (let attempt = 0; attempt < 5; attempt++) {
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
        if (isPgUniqueViolation(err)) { lastErr = err; continue; }
        throw err;
      }
    }
    throw lastErr;
  } catch (err) {
    logger.warn({ err }, "[auto-voucher] Failed to generate expense voucher (non-fatal)");
  }
}

/**
 * Correct the ledger after an expense amount/mode edit:
 *   1. Reverse every prior auto PV for this expenseId (swap Dr/Cr)
 *   2. Post a fresh PV for the corrected amount/mode
 *
 * Never throws — non-fatal, same as autoVoucherForExpense.
 */
export async function correctExpenseVoucher(opts: {
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

    const prior = await db
      .select()
      .from(vouchersTable)
      .where(and(
        eq(vouchersTable.reference, expenseId),
        eq(vouchersTable.type, "payment"),
      ));

    // Only reverse original / corrected expense PVs — skip rows already marked reversed.
    const toReverse = prior.filter((v) =>
      !(v.narration ?? "").toLowerCase().includes("reversal of expense"),
    );

    for (const v of toReverse) {
      let lastErr: unknown;
      let posted = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        const voucherNumber = await nextVoucherNumber("payment", attempt);
        try {
          await db.insert(vouchersTable).values({
            voucherNumber,
            type: "payment",
            date: istDateStr(),
            // Swap sides to reverse the original PV
            debitAccountId: v.creditAccountId,
            creditAccountId: v.debitAccountId,
            amount: v.amount,
            particular: `Reversal | ${v.particular ?? expenseId}`,
            billId: null,
            performedBy: performedBy ?? null,
            narration: `Reversal of expense ${expenseId} (edit correction)`,
            reference: expenseId,
          });
          posted = true;
          break;
        } catch (err: unknown) {
          if (isPgUniqueViolation(err)) { lastErr = err; continue; }
          throw err;
        }
      }
      if (!posted && lastErr) throw lastErr;
    }

    await autoVoucherForExpense({
      expenseId,
      amount,
      paymentMode,
      category,
      description,
      performedBy,
    });
  } catch (err) {
    logger.warn({ err }, "[auto-voucher] Failed to correct expense voucher (non-fatal)");
  }
}

/**
 * Off-peak catch-up for payments whose capture-time voucher was deferred
 * during clinic peak hours. Idempotent via payment_id (force=true).
 */
export async function backfillDeferredPaymentVouchers(opts?: {
  limit?: number;
}): Promise<{ attempted: number; skippedPeak: boolean }> {
  if (isClinicPeakHours()) {
    return { attempted: 0, skippedPeak: true };
  }
  const limit = Math.max(1, Math.min(opts?.limit ?? 25, 100));

  // Recent positive, non-superseded payments with no payment_id-linked voucher.
  const rows = await db.execute(sql`
    SELECT p.id AS payment_id,
           p.bill_id AS bill_id,
           p.amount AS amount,
           p.method AS method,
           b.bill_number AS bill_number
    FROM payments p
    INNER JOIN bills b ON b.id = p.bill_id
    WHERE p.amount::numeric > 0
      AND (p.settlement_status IS NULL OR p.settlement_status <> 'superseded')
      AND NOT EXISTS (
        SELECT 1 FROM vouchers v
        WHERE v.payment_id = p.id AND v.bill_id = p.bill_id
      )
    ORDER BY p.id DESC
    LIMIT ${limit}
  `);

  const list = Array.isArray(rows)
    ? rows
    : ((rows as { rows?: unknown[] }).rows ?? []);

  let attempted = 0;
  for (const raw of list) {
    const r = raw as {
      payment_id?: number | string;
      bill_id?: number | string;
      amount?: number | string;
      method?: string | null;
      bill_number?: string | null;
    };
    const paymentId = Number(r.payment_id);
    const billId = Number(r.bill_id);
    const amount = Number(r.amount);
    if (!Number.isFinite(paymentId) || !Number.isFinite(billId) || !Number.isFinite(amount)) continue;
    attempted++;
    await autoVoucherForPayment({
      billId,
      amount,
      method: r.method || "cash",
      billNumber: r.bill_number || `Bill #${billId}`,
      paymentId,
      force: true,
    });
  }
  return { attempted, skippedPeak: false };
}

