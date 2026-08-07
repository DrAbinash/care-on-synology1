import { Router } from "express";
import { db } from "@workspace/db";
import { billsTable, paymentsTable, billAuditsTable, patientsTable, ordersTable, doctorsTable, voucherAuditsTable, expensesTable } from "@workspace/db/schema";
import { sql, and, eq, gte, lt, notInArray } from "drizzle-orm";
import { FULL_ACCESS_ROLES } from "../middleware/requireStaffAuth";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";
import { getTransporter, getEmailSettings } from "../email";
import { classifyPaymentMethod, isPhysicalCash, isDigitalSettlement } from "../lib/paymentMethodClassifier";
import { computeRefundsOnCancelledBillsCreatedInPeriod, computeCollectibleForReconciliation } from "../lib/dailySummaryCollectible";
import { buildStaffActivityRows, BILL_AUDIT_OPERATIONAL_CHANGE_TYPES } from "../lib/staffActivityAttribution";
import { buildBillingVsPacsSummary } from "../lib/pacs/billingVsPacsSummary";
import {
  buildModalityBillingSummary,
  listModalityBills,
} from "../lib/pacs/modalityBillingSummary";
import { resolveModalityQuery } from "../lib/pacs/imagingModalityBucket";
import { buildLowStockSummary } from "../lib/inventoryLowStockSummary";

export const myDailySummaryRouter = Router();

function dayBoundsRange(from: string, to: string) {
  return {
    start: new Date(`${from}T00:00:00+05:30`),
    end: new Date(`${to}T23:59:59.999+05:30`),
  };
}

// POST /send-email — sends the pre-built HTML summary to a given email address.
// requireStaffAuth applied at routes/index.ts (covers all router methods).
myDailySummaryRouter.post("/send-email", async (req: StaffAuthRequest, res) => {
  const { to, subject, htmlBody } = req.body as {
    to?: string;
    subject?: string;
    htmlBody?: string;
  };

  if (!to || !subject || !htmlBody) {
    return res.status(400).json({ ok: false, error: "Missing required fields: to, subject, htmlBody" });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return res.status(400).json({ ok: false, error: "Invalid email address" });
  }

  const settings = await getEmailSettings();
  const transport = await getTransporter();

  if (!settings || !transport) {
    return res
      .status(503)
      .json({ ok: false, error: "Email not configured. Please set up SMTP in Settings → Email." });
  }

  try {
    await transport.sendMail({
      from: `"${settings.fromName}" <${settings.fromAddress}>`,
      to,
      subject,
      html: htmlBody,
    });
    return res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Send failed";
    req.log.error({ err }, "send-summary-email failed");
    return res.status(500).json({ ok: false, error: msg });
  }
});

// GET / — staff daily summary (session-scoped)
// requireStaffAuth applied at routes/index.ts
myDailySummaryRouter.get("/", async (req: StaffAuthRequest, res) => {
  const session = req.staffSession!;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const from = typeof req.query.from === "string" ? req.query.from : today;
  const to = typeof req.query.to === "string" ? req.query.to : from;

  // Admin/superadmin may pass staffName to view another user's data.
  // null = all-staff aggregate (super-admin ONLY); regular staff always see their own data.
  const isOwner = FULL_ACCESS_ROLES.has(session.role);
  const isSuperAdmin = session.role === "super_admin";
  const staffName: string | null =
    isOwner && typeof req.query.staffName === "string" && req.query.staffName.trim()
      ? req.query.staffName.trim()
      : isSuperAdmin
        ? null           // super-admin with no filter → aggregate all staff
        : session.subjectName;
  const displayName = staffName ?? "All Staff";

  const { start, end } = dayBoundsRange(from, to);

  // ── Bills created by this staff (for display + gross billing) ──────────
  const allBillRows = await db
    .select({
      id: billsTable.id,
      billNumber: billsTable.billNumber,
      totalAmount: billsTable.totalAmount,
      paidAmount: billsTable.paidAmount,
      balanceAmount: billsTable.balanceAmount,
      refundAmount: billsTable.refundAmount,
      discount: billsTable.discount,
      discountReason: billsTable.discountReason,
      discountReasonNote: billsTable.discountReasonNote,
      status: billsTable.status,
      createdAt: billsTable.createdAt,
      createdByName: billsTable.createdByName,
      cancelledByName: billsTable.cancelledByName,
      patientFirstName: patientsTable.firstName,
      patientLastName: patientsTable.lastName,
      referringDoctor: doctorsTable.name,
    })
    .from(billsTable)
    .leftJoin(patientsTable, eq(billsTable.patientId, patientsTable.id))
    .leftJoin(ordersTable, eq(billsTable.orderId, ordersTable.id))
    .leftJoin(doctorsTable, eq(ordersTable.doctorId, doctorsTable.id))
    .where(and(
      gte(billsTable.createdAt, start),
      lt(billsTable.createdAt, end),
      ...(staffName !== null ? [eq(billsTable.createdByName, staffName)] : []),
    ))
    .orderBy(sql`${billsTable.createdAt} DESC`);

  // ── Bills cancelled BY this staff (for cancellation accountability) ─────
  // Whoever physically cancels a bill and returns money to the patient is
  // accountable for the refund — NOT the original creator of the bill.
  // We query by cancelledByName + cancelledAt so the liability is correctly
  // attributed to the person who performed the cancellation action.
  const cancelledByMeRows = await db
    .select({
      id: billsTable.id,
      billNumber: billsTable.billNumber,
      totalAmount: billsTable.totalAmount,
      createdByName: billsTable.createdByName,
      cancelledByName: billsTable.cancelledByName,
      cancelledAt: billsTable.cancelledAt,
    })
    .from(billsTable)
    .where(and(
      gte(billsTable.cancelledAt, start),
      lt(billsTable.cancelledAt, end),
      ...(staffName !== null ? [eq(billsTable.cancelledByName, staffName)] : []),
    ));

  // ── Payments recorded by this staff ────────────────────────────────────
  const allPaymentRows = await db
    .select({
      id: paymentsTable.id,
      billId: paymentsTable.billId,
      amount: paymentsTable.amount,
      method: paymentsTable.method,
      recordedByName: paymentsTable.recordedByName,
      createdAt: paymentsTable.createdAt,
      billCreatedAt: billsTable.createdAt,
      billStatus: billsTable.status,
    })
    .from(paymentsTable)
    .innerJoin(billsTable, eq(paymentsTable.billId, billsTable.id))
    .where(and(
      gte(paymentsTable.createdAt, start),
      lt(paymentsTable.createdAt, end),
      ...(staffName !== null ? [eq(paymentsTable.recordedByName, staffName)] : []),
    ))
    .orderBy(sql`${paymentsTable.createdAt} DESC`);

  // ── Dues collected: payments in this range on bills created BEFORE start ─
  // "Dues collection" = a follow-up payment on an old outstanding/partial bill.
  // We pull every positive payment in the period whose parent bill was created
  // before the period start, then aggregate by bill in JS.
  const duesPaymentRows = await db
    .select({
      paymentId: paymentsTable.id,
      paymentAmount: paymentsTable.amount,
      paymentMethod: paymentsTable.method,
      billId: billsTable.id,
      billNumber: billsTable.billNumber,
      totalAmount: billsTable.totalAmount,
      balanceAmount: billsTable.balanceAmount,
      refundAmount: billsTable.refundAmount,
      billStatus: billsTable.status,
      billCreatedAt: billsTable.createdAt,
      patientFirstName: patientsTable.firstName,
      patientLastName: patientsTable.lastName,
      referringDoctor: doctorsTable.name,
      createdByName: billsTable.createdByName,
      recordedByName: paymentsTable.recordedByName,
    })
    .from(paymentsTable)
    .innerJoin(billsTable, eq(paymentsTable.billId, billsTable.id))
    .leftJoin(patientsTable, eq(billsTable.patientId, patientsTable.id))
    .leftJoin(ordersTable, eq(billsTable.orderId, ordersTable.id))
    .leftJoin(doctorsTable, eq(ordersTable.doctorId, doctorsTable.id))
    .where(and(
      gte(paymentsTable.createdAt, start),
      lt(paymentsTable.createdAt, end),
      lt(billsTable.createdAt, start),           // bill predates the period
      sql`${paymentsTable.amount}::numeric > 0`, // positive payments only
      ...(staffName !== null ? [eq(paymentsTable.recordedByName, staffName)] : []),
    ))
    .orderBy(sql`${billsTable.id} ASC`);

  // Aggregate dues rows by bill
  type DuesBillAgg = {
    billId: number; billNumber: string;
    patientName: string; referringDoctor: string | null;
    createdByName: string | null;
    totalAmount: number; duesCollected: number; remainingDues: number;
    billStatus: string;
  };
  const duesByBillMap = new Map<number, DuesBillAgg>();
  for (const r of duesPaymentRows) {
    if (!duesByBillMap.has(r.billId)) {
      duesByBillMap.set(r.billId, {
        billId: r.billId,
        billNumber: r.billNumber,
        patientName: r.patientFirstName
          ? `${r.patientFirstName} ${r.patientLastName ?? ""}`.trim()
          : "Unknown",
        referringDoctor: r.referringDoctor ?? null,
        createdByName: r.createdByName ?? null,
        totalAmount: Number(r.totalAmount),
        duesCollected: 0,
        remainingDues: Math.max(0, Number(r.balanceAmount ?? 0)),
        billStatus: r.billStatus ?? "pending",
      });
    }
    duesByBillMap.get(r.billId)!.duesCollected += Number(r.paymentAmount);
  }
  const duesBills = Array.from(duesByBillMap.values())
    .sort((a, b) => b.duesCollected - a.duesCollected);

  // ── Bill audits by this staff ──────────────────────────────────────────
  const billEditsRaw = await db
    .select({
      id: billAuditsTable.id,
      billId: billAuditsTable.billId,
      editedBy: billAuditsTable.editedBy,
      reason: billAuditsTable.reason,
      changeType: billAuditsTable.changeType,
      oldValue: billAuditsTable.oldValue,
      newValue: billAuditsTable.newValue,
      createdAt: billAuditsTable.createdAt,
      billNumber: billsTable.billNumber,
    })
    .from(billAuditsTable)
    .leftJoin(billsTable, eq(billAuditsTable.billId, billsTable.id))
    .where(and(
      gte(billAuditsTable.createdAt, start),
      lt(billAuditsTable.createdAt, end),
      notInArray(billAuditsTable.changeType, [...BILL_AUDIT_OPERATIONAL_CHANGE_TYPES]),
      ...(staffName !== null ? [eq(billAuditsTable.editedBy, staffName)] : []),
    ))
    .orderBy(sql`${billAuditsTable.createdAt} DESC`)
    .limit(50);

  // Referral name edits by this staff (changeType = "referral")
  const referralEditsRaw = await db
    .select({
      id: billAuditsTable.id,
      billId: billAuditsTable.billId,
      editedBy: billAuditsTable.editedBy,
      reason: billAuditsTable.reason,
      changeType: billAuditsTable.changeType,
      oldValue: billAuditsTable.oldValue,
      newValue: billAuditsTable.newValue,
      createdAt: billAuditsTable.createdAt,
      billNumber: billsTable.billNumber,
    })
    .from(billAuditsTable)
    .leftJoin(billsTable, eq(billAuditsTable.billId, billsTable.id))
    .where(and(
      gte(billAuditsTable.createdAt, start),
      lt(billAuditsTable.createdAt, end),
      eq(billAuditsTable.changeType, "referral"),
      ...(staffName !== null ? [eq(billAuditsTable.editedBy, staffName)] : []),
    ))
    .orderBy(sql`${billAuditsTable.createdAt} DESC`)
    .limit(50);

  // ── Voucher audits by this staff ──────────────────────────────────────
  const voucherAuditFilters = [
    gte(voucherAuditsTable.createdAt, start),
    lt(voucherAuditsTable.createdAt, end),
  ];
  if (staffName !== null) voucherAuditFilters.push(eq(voucherAuditsTable.editedBy, staffName));
  const voucherEditsRaw = await db
    .select()
    .from(voucherAuditsTable)
    .where(and(...voucherAuditFilters))
    .orderBy(sql`${voucherAuditsTable.createdAt} DESC`)
    .limit(200);

  // ── Refunds recorded by this staff ─────────────────────────────────────
  // ── Expenses approved_by this staff (cash + digital) ─────────────────
  // RECONCILIATION POSTING-DATE RULE (see DAILY_FINANCIAL_RECONCILIATION_
  // SPECIFICATION.md §16.5): expense_date is a free-text, backdatable
  // display/accounting field — it must NOT drive cash-drawer reconciliation,
  // because a backdated entry would retroactively change an already-closed
  // day's expected cash. Reconciliation always uses `created_at`, the
  // immutable timestamp of when the expense was actually posted — the same
  // instant the cash physically left the drawer. This matches day-close.ts,
  // which already windows expenses by created_at.
  //
  // CASH CLASSIFICATION (kept in raw SQL, deliberately not routed through
  // the shared classifier — see ../lib/paymentMethodClassifier.ts): this is
  // a single-row SQL aggregation (SUM ... FILTER), not a JS array filter,
  // so swapping it to call the classifier would require restructuring this
  // into a per-row fetch + JS reduce. The classification RULE is already
  // identical to isPhysicalCash() — exact match on the literal string
  // "cash" (case-insensitive) — so there is no behavioral gap today. If
  // this rule ever changes, update it here, in the twin query below, and
  // in day-close.ts's/daily-summary.ts's isCashExpense helpers together.
  const expRaw = await db.execute<{
    cash_expenses: string;
    digital_expenses: string;
  }>(sql`
    SELECT
      COALESCE(SUM(amount::numeric) FILTER (WHERE LOWER(payment_mode) = 'cash'), 0)::text AS cash_expenses,
      COALESCE(SUM(amount::numeric) FILTER (WHERE LOWER(payment_mode) <> 'cash'), 0)::text AS digital_expenses
    FROM expenses
    WHERE created_at >= ${start.toISOString()} AND created_at < ${end.toISOString()}
    ${staffName !== null ? sql`AND approved_by = ${staffName}` : sql``}
  `);

  // ── Compute summary ─────────────────────────────────────────────────────
  // activeBills = bills CREATED by this staff that are still live (not cancelled).
  // cancelledBills = bills CANCELLED BY this staff (may include bills they didn't create).
  //   This is the correct attribution: whoever cancels a bill and returns money to the
  //   patient is accountable for it — not the person who originally created the bill.
  const activeBills = allBillRows.filter((r) => r.status !== "cancelled");
  // Bills this user created that were later cancelled by SOMEONE ELSE — shown in the
  // bills list for transparency but NOT counted against this user's financial metrics.
  const cancelledByOthers = allBillRows.filter(
    (r) => r.status === "cancelled" && r.cancelledByName !== staffName,
  );
  // Bills this user both created AND cancelled themselves.
  const cancelledBySelf = allBillRows.filter(
    (r) => r.status === "cancelled" && r.cancelledByName === staffName,
  );
  // All bills cancelled by this staff (includes bills they didn't create).
  // Used for the financial cancellation metric.
  const cancelledByMe = cancelledByMeRows;

  const paymentItems = allPaymentRows.filter((p) => Number(p.amount) > 0);
  const refundItems = allPaymentRows.filter((p) => Number(p.amount) < 0);

  // balance_amount is now defined as: total − paid − refund
  // It already represents the true net money still owed by the patient.
  // No further adjustment needed — balance = trueOutstanding directly.
  const trueOutstanding = (r: typeof allBillRows[0]) => {
    return Math.max(0, Number(r.balanceAmount ?? 0));
  };

  // ── My Billing side (bills I created in the date range) ────────────────
  // Equation that balances:
  //   Gross Billed (incl. cancelled)
  //   − Cancelled (bills I created that were cancelled by anyone)
  //   − Outstanding (current balance on non-cancelled bills I created)
  //   = Net Collected on my bills
  // NOTE: totalAmount is stored post-discount (subtotal − discount + tax),
  // so "Gross Billed" here is net of discounts.
  const grossBilledIncludingCancelled = allBillRows.reduce(
    (s, r) => s + Number(r.totalAmount),
    0,
  );
  const cancelledOnMyBills = allBillRows
    .filter((r) => r.status === "cancelled")
    .reduce((s, r) => s + Number(r.totalAmount), 0);
  const grossBilling = activeBills.reduce((s, r) => s + Number(r.totalAmount), 0);
  const outstanding = activeBills.reduce(
    (s, r) => s + trueOutstanding(r),
    0,
  );
  const netCollectedOnMyBills = grossBilling - outstanding;
  const discountsGiven = activeBills.reduce((s, r) => s + Number(r.discount ?? 0), 0);
  const duesCollectedTotal = duesBills.reduce((s, b) => s + b.duesCollected, 0);
  const duesBillsCount = duesBills.length;

  // ── My Cashbox side (money I personally handled) ───────────────────────
  // Equation that balances:
  //   Cash In − Cash Refunded − Cash Expenses = Physical Cash in Hand
  //   Digital In − Digital Refunded         = Net Digital Collection
  // Classification is delegated entirely to the shared classifier
  // (../lib/paymentMethodClassifier.ts) — the single source of truth used
  // identically by daily-summary.ts and day-close.ts. This fixes the
  // critical defect where gateway-qualified strings like
  // "Online (ICICI Orange Pay)" / "Online (Razorpay)" / "Online (PhonePe)" /
  // "Online (BharatPe)" failed an exact "online" match and were silently
  // counted as physical cash, and where "insurance" fell into the same trap.
  //
  // Any payment method the classifier does NOT recognize is routed to the
  // suspense/exception bucket below — it is EXCLUDED from cashIn, digitalIn,
  // cashRefunded, and digitalRefunded. An unrecognized method must never be
  // silently assumed to be cash (or digital); it must be visible for admin
  // correction instead (see `suspensePayments` in the response).
  const formatMethod = (m: string | null | undefined): string => {
    const methodStr = m ?? "cash";
    if (methodStr.toLowerCase().startsWith("online")) {
      return methodStr.replace(/^online/i, "Web booking");
    }
    return methodStr;
  };
  const unknownPaymentItems = paymentItems.filter((p) => !classifyPaymentMethod(p.method).isKnown);
  const unknownRefundItems = refundItems.filter((p) => !classifyPaymentMethod(p.method).isKnown);
  const knownPaymentItems = paymentItems.filter((p) => classifyPaymentMethod(p.method).isKnown);
  const knownRefundItems = refundItems.filter((p) => classifyPaymentMethod(p.method).isKnown);

  const cashIn = knownPaymentItems.reduce(
    (s, p) => s + (isPhysicalCash(p.method) ? Number(p.amount) : 0),
    0,
  );
  const digitalIn = knownPaymentItems.reduce(
    (s, p) => s + (isDigitalSettlement(p.method) ? Number(p.amount) : 0),
    0,
  );
  const cashRefunded = knownRefundItems.reduce(
    (s, p) => s + (isPhysicalCash(p.method) ? Math.abs(Number(p.amount)) : 0),
    0,
  );
  const digitalRefunded = knownRefundItems.reduce(
    (s, p) => s + (isDigitalSettlement(p.method) ? Math.abs(Number(p.amount)) : 0),
    0,
  );
  const suspensePaymentAmount = unknownPaymentItems.reduce((s, p) => s + Number(p.amount), 0);
  const suspenseRefundAmount = unknownRefundItems.reduce((s, p) => s + Math.abs(Number(p.amount)), 0);
  const cashExpenses = Number(expRaw.rows[0]?.cash_expenses ?? 0);
  const digitalExpenses = Number(expRaw.rows[0]?.digital_expenses ?? 0);
  const totalExpenses = cashExpenses + digitalExpenses;
  const totalReceived = paymentItems.reduce((s, p) => s + Number(p.amount), 0);
  const refundAmount = refundItems.reduce((s, p) => s + Math.abs(Number(p.amount)), 0);
  // Refunds issued today whose bill is NOT cancelled — e.g. a staff member
  // refunds money to a patient (partial refund, overcharge correction, test
  // swap) without cancelling any test on the bill. These are invisible in
  // both "Discounts Given" and "Cancellation Count" today, so flagged here
  // as their own metric.
  const refundsWithoutCancellationAmount = refundItems
    .filter((p) => p.billStatus !== "cancelled")
    .reduce((s, p) => s + Math.abs(Number(p.amount)), 0);
  const refundsWithoutCancellationCount = refundItems.filter((p) => p.billStatus !== "cancelled").length;
  // Refunds on bills created in this period that are now cancelled — already
  // removed from collectible via cancelledOnMyBills; exclude from refund
  // deduction so same-day cancel+refund does not double-subtract.
  const refundsOnCancelledBillsCreatedInPeriod = computeRefundsOnCancelledBillsCreatedInPeriod(
    knownRefundItems,
    start,
    end,
  );
  // Bills CANCELLED BY this staff (informational — accountability of canceller)
  const cancelledAmount = cancelledByMe.reduce((s, r) => s + Number(r.totalAmount), 0);
  // FIXED: cashCollection now subtracts cash refunds (was previously gross cash in)
  const cashCollection = cashIn - cashRefunded;
  const netDigital = digitalIn - digitalRefunded;
  const physicalCashInHand = cashCollection - cashExpenses;
  // Legacy/compat: digitalCollection used to mean "digital In" (gross)
  const digitalCollection = digitalIn;
  // Legacy/compat: refundsAndCancellations field kept but no longer used in the
  // headline reconciliation (it mixed two unrelated data sets).
  const refundsAndCancellations = refundAmount + cancelledAmount;

  const byMethod: Record<string, number> = {};
  for (const p of paymentItems) {
    const m = formatMethod(p.method).toLowerCase();
    byMethod[m] = (byMethod[m] ?? 0) + Number(p.amount);
  }

  // ── All staff names who appear in the data (for the filter dropdown) ──
  const staffSet = new Set<string>();
  for (const r of allBillRows) if (r.createdByName) staffSet.add(r.createdByName);
  for (const p of allPaymentRows) if (p.recordedByName) staffSet.add(p.recordedByName);
  for (const r of cancelledByMeRows) if (r.cancelledByName) staffSet.add(r.cancelledByName);
  const staffNames = Array.from(staffSet).sort();

  // ── Per-staff breakdown (only when viewing All Staff aggregate) ──
  type StaffRow = {
    name: string;
    billsCreated: number;
    cashCollected: number;
    billsCancelled: number;
    cashRefunded: number;
    grossBilled: number;
    activeBilling: number;
    cancelled: number;
    outstanding: number;
    netCollected: number;
    billCount: number;
    cashIn: number;
    digitalIn: number;
    digitalRefunded: number;
    netCash: number;
    netDigital: number;
    totalReceived: number;
    cashExpenses: number;
    digitalExpenses: number;
    totalExpenses: number;
    physicalCashInHand: number;
    duesCollected: number;
    discountsGiven: number;
    cancellationCount: number;
  };
  let byStaff: StaffRow[] | undefined;
  if (staffName === null) {
    // Collect all unique staff names from bills and payments
    const staffSet = new Set<string>();
    for (const r of allBillRows) if (r.createdByName) staffSet.add(r.createdByName);
    for (const p of allPaymentRows) if (p.recordedByName) staffSet.add(p.recordedByName);
    for (const r of cancelledByMeRows) if (r.cancelledByName) staffSet.add(r.cancelledByName);
    const names = Array.from(staffSet).sort();

    // Expenses per person (cash + digital, only needed for all-staff mode)
    // Same posting-date rule as the aggregate query above — created_at, not
    // the backdatable expense_date. Same SQL-level cash classification note
    // as the aggregate query above — kept in sync with isPhysicalCash().
    type ExpRow = { approved_by: string; cash: string; digital: string };
    const cashExpPerPerson: Record<string, number> = {};
    const digitalExpPerPerson: Record<string, number> = {};
    const expRows = await db.execute<ExpRow>(sql`
      SELECT
        approved_by,
        COALESCE(SUM(amount::numeric) FILTER (WHERE LOWER(payment_mode) = 'cash'), 0)::text AS cash,
        COALESCE(SUM(amount::numeric) FILTER (WHERE LOWER(payment_mode) <> 'cash'), 0)::text AS digital
      FROM expenses
      WHERE created_at >= ${start.toISOString()} AND created_at < ${end.toISOString()}
        AND approved_by IS NOT NULL
      GROUP BY approved_by
    `);
    for (const r of expRows.rows) {
      cashExpPerPerson[r.approved_by] = Number(r.cash);
      digitalExpPerPerson[r.approved_by] = Number(r.digital);
    }

    byStaff = (() => {
      const activity = buildStaffActivityRows({
        staffNames: names,
        bills: allBillRows.map((r) => ({
          createdByName: r.createdByName,
          totalAmount: r.totalAmount,
          status: r.status,
        })),
        cancelledByActor: cancelledByMeRows.map((r) => ({
          cancelledByName: r.cancelledByName,
          totalAmount: r.totalAmount,
        })),
        payments: allPaymentRows.map((p) => {
          const cls = classifyPaymentMethod(p.method);
          return {
            recordedByName: p.recordedByName,
            amount: p.amount,
            method: p.method,
            isCash: isPhysicalCash(p.method),
            isDigital: isDigitalSettlement(p.method),
            isKnown: cls.isKnown,
          };
        }),
      });

      return activity.map((act) => {
        const name = act.name;
        const sbills = allBillRows.filter((r) => r.createdByName === name);
        const sactive = sbills.filter((r) => r.status !== "cancelled");
        const spayPos = allPaymentRows.filter((p) => p.recordedByName === name && Number(p.amount) > 0);
        // Action-based: Bills Created stays on creator even after cancel (act.billsCreated).
        // Bills Cancelled attributed to canceller (act.billsCancelled), NOT creator.
        // Cash Collected / Cash Refunded attributed to payment/refund recorder.
        const sOutstanding = sactive.reduce((s, r) => s + trueOutstanding(r), 0);
        const sCashExp = cashExpPerPerson[name] ?? 0;
        const sDigitalExp = digitalExpPerPerson[name] ?? 0;
        const sTotalExp = sCashExp + sDigitalExp;
        const sNetCash = act.cashCollected - act.cashRefunded;
        const sNetDigital = act.digitalCollected - act.digitalRefunded;
        const sDues = duesPaymentRows
          .filter((d) => d.recordedByName === name)
          .reduce((s, d) => s + Number(d.paymentAmount), 0);
        const sDiscounts = sactive.reduce((s, r) => s + Number(r.discount ?? 0), 0);
        const sActiveBilling = sactive.reduce((s, r) => s + Number(r.totalAmount), 0);

        return {
          name,
          // Staff Activity primary columns (action-based, immutable per actor)
          billsCreated: act.billsCreated,
          cashCollected: act.cashCollected,
          billsCancelled: act.billsCancelled,
          cashRefunded: act.cashRefunded,
          // Legacy aliases used by existing UI/export
          grossBilled: act.billsCreated,
          activeBilling: sActiveBilling,
          cancelled: act.billsCancelled,
          outstanding: sOutstanding,
          // Do NOT redefine "net collected" as active−outstanding for staff activity —
          // that wrongly zeroes User1 after User2 cancels. Keep field for compatibility
          // but set to cash+digital collected (what this person took in).
          netCollected: act.cashCollected + act.digitalCollected,
          billCount: act.billCreateCount,
          cashIn: act.cashCollected,
          digitalIn: act.digitalCollected,
          digitalRefunded: act.digitalRefunded,
          netCash: sNetCash,
          netDigital: sNetDigital,
          totalReceived: spayPos.reduce((s, p) => s + Number(p.amount), 0),
          cashExpenses: sCashExp,
          digitalExpenses: sDigitalExp,
          totalExpenses: sTotalExp,
          // Not a personal drawer shortage — retained for day-close expense view only.
          physicalCashInHand: sNetCash - sCashExp,
          duesCollected: sDues,
          discountsGiven: sDiscounts,
          cancellationCount: act.cancellationCount,
        };
      });
    })();
  }

  res.json({
    staffName: displayName,
    isFiltered: staffName !== null && isSuperAdmin && staffName !== session.subjectName,
    from,
    to,
    staffNames,
    byStaff,
    summary: {
      grossBilling,
      grossBilledIncludingCancelled,
      cancelledOnMyBills,
      netCollectedOnMyBills,
      outstanding,
      refundsAndCancellations,
      refundAmount,
      refundsWithoutCancellationAmount,
      refundsWithoutCancellationCount,
      refundsOnCancelledBillsCreatedInPeriod,
      collectible: computeCollectibleForReconciliation({
        grossBilledIncludingCancelled,
        duesCollectedTotal,
        cancelledOnMyBills,
        cashRefunded,
        digitalRefunded,
        refundsOnCancelledBillsCreatedInPeriod,
        outstanding,
      }),
      cancelledAmount,
      cashExpenses,
      digitalExpenses,
      totalExpenses,
      totalReceived,
      digitalCollection,
      cashIn,
      digitalIn,
      cashRefunded,
      digitalRefunded,
      /**
       * Net Cash Available (doctor primary figure) — PHYSICAL CASH ONLY.
       * = completed cash collections − completed cash refunds.
       * UPI / card / bank / online / insurance are excluded (see digitalIn / digitalRefunded).
       */
      netClinicCash: cashIn - cashRefunded,
      netDigital,
      cashCollection,
      physicalCashInHand,
      discountsGiven,
      duesCollectedTotal,
      duesBillsCount,
      // cancellationCount = bills cancelled BY this staff (not bills they created that got cancelled)
      cancellationCount: cancelledByMe.length,
      billCount: activeBills.length,
      // How many bills this user created were cancelled by someone else (informational)
      cancelledByOthersCount: cancelledByOthers.length,
      cancelledBySelfCount: cancelledBySelf.length,
      closingCashBalance: physicalCashInHand,
      // ── Suspense / exception bucket (see LOCKED BUSINESS RULE #6) ──────
      // Payments/refunds whose method string was not recognized by the
      // shared classifier. Deliberately EXCLUDED from cashIn/digitalIn/
      // cashRefunded/digitalRefunded above — an unknown method must never
      // silently become cash or digital. Surfaced here so an admin can
      // correct the underlying payment row.
      suspensePaymentCount: unknownPaymentItems.length,
      suspensePaymentAmount,
      suspenseRefundCount: unknownRefundItems.length,
      suspenseRefundAmount,
    },
    byMethod,
    bills: allBillRows.map((r) => ({
      id: r.id,
      billNumber: r.billNumber,
      patientName: r.patientFirstName
        ? `${r.patientFirstName} ${r.patientLastName ?? ""}`.trim()
        : "Unknown",
      totalAmount: Number(r.totalAmount),
      paidAmount: Number(r.paidAmount),
      balanceAmount: Number(r.balanceAmount ?? 0),
      discount: Number(r.discount ?? 0),
      status: r.status,
      referringDoctor: r.referringDoctor ?? null,
      createdAt:
        r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    })),
    payments: paymentItems.map((p) => ({
      id: p.id,
      billId: p.billId,
      amount: Number(p.amount),
      method: formatMethod(p.method),
      createdAt:
        p.createdAt instanceof Date ? p.createdAt.toISOString() : String(p.createdAt),
      billCreatedAt:
        p.billCreatedAt instanceof Date ? p.billCreatedAt.toISOString() : String(p.billCreatedAt),
    })),
    // Unrecognized-method payments/refunds — NOT included in any cash/digital
    // total above. Shown separately so an admin can correct the payment row
    // (fix the method string) rather than have it silently misclassified.
    suspensePayments: [...unknownPaymentItems, ...unknownRefundItems].map((p) => ({
      id: p.id,
      billId: p.billId,
      amount: Number(p.amount),
      rawMethod: p.method,
      recordedByName: p.recordedByName,
      createdAt:
        p.createdAt instanceof Date ? p.createdAt.toISOString() : String(p.createdAt),
    })),
    billEdits: billEditsRaw.map((r) => ({
      id: r.id,
      billId: r.billId,
      billNumber: r.billNumber ?? `#${r.billId}`,
      editedBy: r.editedBy,
      reason: r.reason,
      changeType: r.changeType,
      oldValue: r.oldValue,
      newValue: r.newValue,
      createdAt:
        r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    })),
    referralEdits: referralEditsRaw.map((r) => ({
      id: r.id,
      billId: r.billId,
      billNumber: r.billNumber ?? `#${r.billId}`,
      editedBy: r.editedBy,
      reason: r.reason,
      changeType: r.changeType,
      oldValue: r.oldValue,
      newValue: r.newValue,
      createdAt:
        r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    })),
    // Bills this staff cancelled today (may include bills created by other staff).
    // Financial liability for the refund sits with the canceller, not the creator.
    cancelledByMe: cancelledByMe.map((r) => ({
      id: r.id,
      billNumber: r.billNumber,
      totalAmount: Number(r.totalAmount),
      originalCreator: r.createdByName ?? "Unknown",
      cancelledAt:
        r.cancelledAt instanceof Date ? r.cancelledAt.toISOString() : String(r.cancelledAt ?? ""),
    })),
    // Discounted bills (active only — same scope as summary.discountsGiven).
    discountBills: activeBills
      .filter((r) => Number(r.discount ?? 0) > 0)
      .map((r) => ({
        billId: r.id,
        billNumber: r.billNumber,
        patientName: r.patientFirstName
          ? `${r.patientFirstName} ${r.patientLastName ?? ""}`.trim()
          : "Unknown",
        referringDoctor: r.referringDoctor ?? null,
        createdByName: r.createdByName ?? null,
        totalAmount: Number(r.totalAmount),      // post-discount (net)
        discountGiven: Number(r.discount ?? 0),
        grossAmount: Number(r.totalAmount) + Number(r.discount ?? 0),
        balanceAmount: Math.max(0, Number(r.balanceAmount ?? 0)),
        discountReason: r.discountReason ?? null,
        discountReasonNote: r.discountReasonNote ?? null,
        status: r.status,
      })),
    // Dues collected: payments today on old bills (created before this period).
    duesBills,
    // Outstanding bills: active bills created in this period that still have a balance.
    outstandingBills: activeBills
      .filter((r) => trueOutstanding(r) > 0)
      .map((r) => ({
        billId: r.id,
        billNumber: r.billNumber,
        patientName: r.patientFirstName
          ? `${r.patientFirstName} ${r.patientLastName ?? ""}`.trim()
          : "Unknown",
        referringDoctor: r.referringDoctor ?? null,
        createdByName: r.createdByName ?? null,
        totalAmount: Number(r.totalAmount),
        paidAmount: Number(r.paidAmount ?? 0),
        outstanding: trueOutstanding(r),
        status: r.status,
      }))
      .sort((a, b) => b.outstanding - a.outstanding),
    voucherEdits: voucherEditsRaw.map((r) => ({
      id: r.id,
      voucherId: r.voucherId,
      changeType: r.changeType,
      reason: r.reason,
      oldValue: r.oldValue,
      newValue: r.newValue,
      editedBy: r.editedBy,
      createdAt:
        r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    })),
    refunds: refundItems.slice(0, 50).map((p) => ({
      id: p.id,
      billId: p.billId,
      amount: Number(p.amount),
      method: formatMethod(p.method),
      recordedBy: p.recordedByName ?? null,
      createdAt:
        p.createdAt instanceof Date ? p.createdAt.toISOString() : String(p.createdAt),
      billCreatedAt:
        p.billCreatedAt instanceof Date ? p.billCreatedAt.toISOString() : String(p.billCreatedAt),
    })),
  });
});

// ── GET /drilldown — detail records behind a single summary card ──────────
// Mounted at /api/dashboard/my-daily-summary/drilldown (same router prefix
// as the summary above — this stays alongside the existing endpoint rather
// than introducing a separate top-level route). requireStaffAuth applied at
// routes/index.ts, same as every other route on this router.
//
// IMPORTANT: this endpoint performs NO new calculations. Every number and
// filter here mirrors the exact logic already used by GET / above — same
// dayBoundsRange(), same staffName resolution (staff see only their own
// data; owner/admin/super-admin may view another staff member or the
// all-staff aggregate), same paymentMethodClassifier for cash/digital
// splits, same "dues = payment on a bill created before the period" rule,
// same cancellation-attributed-to-canceller rule. It only ever LISTS the
// underlying rows that the summary numbers above are already built from.
const DRILLDOWN_TYPES = [
  "totalBills", "duesCollected", "cancellations", "outstandingDues",
  "collectibleAmount", "netDigitalCollection", "totalExpenses",
  "expectedPhysicalCash", "totalReceived", "discountsGiven",
  "cancellationCount", "averageBillValue", "refundsWithoutCancellation",
] as const;
type DrilldownType = typeof DRILLDOWN_TYPES[number];

myDailySummaryRouter.get("/drilldown", async (req: StaffAuthRequest, res) => {
  const session = req.staffSession!;
  const type = req.query.type as string;
  if (!DRILLDOWN_TYPES.includes(type as DrilldownType)) {
    return res.status(400).json({ error: `Unknown drilldown type. Supported: ${DRILLDOWN_TYPES.join(", ")}` });
  }

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const from = typeof req.query.from === "string" ? req.query.from : today;
  const to = typeof req.query.to === "string" ? req.query.to : from;

  const isOwner = FULL_ACCESS_ROLES.has(session.role);
  const isSuperAdmin = session.role === "super_admin";
  const staffName: string | null =
    isOwner && typeof req.query.staffName === "string" && req.query.staffName.trim()
      ? req.query.staffName.trim()
      : isSuperAdmin
        ? null
        : session.subjectName;

  const { start, end } = dayBoundsRange(from, to);
  const fmtDate = (d: Date | string | null) =>
    d ? (d instanceof Date ? d.toISOString() : String(d)) : null;
  const formatMethod = (m: string | null | undefined): string => {
    const methodStr = m ?? "cash";
    if (methodStr.toLowerCase().startsWith("online")) {
      return methodStr.replace(/^online/i, "Web booking");
    }
    return methodStr;
  };

  // Bills created in range — the base row-set for several drilldowns below.
  const billsInRange = await db
    .select({
      id: billsTable.id,
      billNumber: billsTable.billNumber,
      totalAmount: billsTable.totalAmount,
      balanceAmount: billsTable.balanceAmount,
      discount: billsTable.discount,
      discountReason: billsTable.discountReason,
      status: billsTable.status,
      createdAt: billsTable.createdAt,
      createdByName: billsTable.createdByName,
      patientFirstName: patientsTable.firstName,
      patientLastName: patientsTable.lastName,
      referringDoctor: doctorsTable.name,
    })
    .from(billsTable)
    .leftJoin(patientsTable, eq(billsTable.patientId, patientsTable.id))
    .leftJoin(ordersTable, eq(billsTable.orderId, ordersTable.id))
    .leftJoin(doctorsTable, eq(ordersTable.doctorId, doctorsTable.id))
    .where(and(
      gte(billsTable.createdAt, start),
      lt(billsTable.createdAt, end),
      ...(staffName !== null ? [eq(billsTable.createdByName, staffName)] : []),
    ))
    .orderBy(sql`${billsTable.createdAt} DESC`);
  const patientNameOf = (r: { patientFirstName: string | null; patientLastName: string | null }) =>
    r.patientFirstName ? `${r.patientFirstName} ${r.patientLastName ?? ""}`.trim() : "Unknown";

  type Table = { label: string; columns: string[]; rows: (string | number | null)[][] };
  let result: Table;

  switch (type as DrilldownType) {
    case "totalBills":
    case "averageBillValue": {
      result = {
        label: type === "averageBillValue" ? "Average Bill Value — Bills Included" : "Total Bills Generated",
        columns: ["Bill #", "Patient", "Referring Doctor", "Amount", "Status", "Created At"],
        rows: billsInRange.map((r) => [
          r.billNumber, patientNameOf(r), r.referringDoctor ?? "—",
          Number(r.totalAmount), r.status, fmtDate(r.createdAt),
        ]),
      };
      break;
    }

    case "discountsGiven": {
      const withDiscount = billsInRange.filter((r) => r.status !== "cancelled" && Number(r.discount ?? 0) > 0);
      result = {
        label: "Discounts Given",
        columns: ["Bill #", "Patient", "Bill Amount", "Discount", "Reason"],
        rows: withDiscount.map((r) => [
          r.billNumber, patientNameOf(r), Number(r.totalAmount), Number(r.discount ?? 0), r.discountReason ?? "—",
        ]),
      };
      break;
    }

    case "outstandingDues": {
      const withBalance = billsInRange.filter((r) => r.status !== "cancelled" && Number(r.balanceAmount ?? 0) > 0);
      result = {
        label: "Outstanding / Dues",
        columns: ["Bill #", "Patient", "Bill Amount", "Balance Due", "Created At"],
        rows: withBalance.map((r) => [
          r.billNumber, patientNameOf(r), Number(r.totalAmount), Number(r.balanceAmount ?? 0), fmtDate(r.createdAt),
        ]),
      };
      break;
    }

    case "cancellations":
    case "cancellationCount": {
      const cancelledRows = await db
        .select({
          billNumber: billsTable.billNumber,
          totalAmount: billsTable.totalAmount,
          createdByName: billsTable.createdByName,
          cancelledByName: billsTable.cancelledByName,
          cancelledAt: billsTable.cancelledAt,
        })
        .from(billsTable)
        .where(and(
          gte(billsTable.cancelledAt, start),
          lt(billsTable.cancelledAt, end),
          ...(staffName !== null ? [eq(billsTable.cancelledByName, staffName)] : []),
        ))
        .orderBy(sql`${billsTable.cancelledAt} DESC`);
      result = {
        label: "Cancellations",
        columns: ["Bill #", "Amount", "Created By", "Cancelled By", "Cancelled At"],
        rows: cancelledRows.map((r) => [
          r.billNumber, Number(r.totalAmount), r.createdByName ?? "—", r.cancelledByName ?? "—", fmtDate(r.cancelledAt),
        ]),
      };
      break;
    }

    case "duesCollected": {
      const duesPaymentRows = await db
        .select({
          paymentAmount: paymentsTable.amount,
          billNumber: billsTable.billNumber,
          balanceAmount: billsTable.balanceAmount,
          patientFirstName: patientsTable.firstName,
          patientLastName: patientsTable.lastName,
          createdAt: paymentsTable.createdAt,
        })
        .from(paymentsTable)
        .innerJoin(billsTable, eq(paymentsTable.billId, billsTable.id))
        .leftJoin(patientsTable, eq(billsTable.patientId, patientsTable.id))
        .where(and(
          gte(paymentsTable.createdAt, start),
          lt(paymentsTable.createdAt, end),
          lt(billsTable.createdAt, start),
          sql`${paymentsTable.amount}::numeric > 0`,
          ...(staffName !== null ? [eq(paymentsTable.recordedByName, staffName)] : []),
        ))
        .orderBy(sql`${paymentsTable.createdAt} DESC`);
      result = {
        label: "Dues Collected (payments on bills from earlier days)",
        columns: ["Bill #", "Patient", "Amount Collected", "Remaining Balance", "Paid At"],
        rows: duesPaymentRows.map((r) => [
          r.billNumber, patientNameOf(r), Number(r.paymentAmount), Number(r.balanceAmount ?? 0), fmtDate(r.createdAt),
        ]),
      };
      break;
    }

    case "totalReceived":
    case "netDigitalCollection": {
      const paymentRows = await db
        .select({
          billNumber: billsTable.billNumber,
          amount: paymentsTable.amount,
          method: paymentsTable.method,
          createdAt: paymentsTable.createdAt,
        })
        .from(paymentsTable)
        .innerJoin(billsTable, eq(paymentsTable.billId, billsTable.id))
        .where(and(
          gte(paymentsTable.createdAt, start),
          lt(paymentsTable.createdAt, end),
          ...(staffName !== null ? [eq(paymentsTable.recordedByName, staffName)] : []),
        ))
        .orderBy(sql`${paymentsTable.createdAt} DESC`);
      const filtered = type === "netDigitalCollection"
        ? paymentRows.filter((p) => classifyPaymentMethod(p.method).isKnown && isDigitalSettlement(p.method))
        : paymentRows.filter((p) => Number(p.amount) > 0);
      result = {
        label: type === "netDigitalCollection" ? "Net Digital Collection (UPI/Card/Online, incl. refunds)" : "Total Received",
        columns: ["Bill #", "Amount", "Method", "Recorded At"],
        rows: filtered.map((r) => [r.billNumber, Number(r.amount), formatMethod(r.method), fmtDate(r.createdAt)]),
      };
      break;
    }

    case "totalExpenses": {
      const expenseFilter = staffName !== null ? sql`AND approved_by = ${staffName}` : sql``;
      const expenseRows = await db.execute<{
        expense_id: string; category: string; description: string;
        amount: string; payment_mode: string; paid_to: string | null; created_at: string;
      }>(sql`
        SELECT expense_id, category, description, amount, payment_mode, paid_to, created_at
        FROM expenses
        WHERE created_at >= ${start.toISOString()} AND created_at < ${end.toISOString()}
        ${expenseFilter}
        ORDER BY created_at DESC
      `);
      result = {
        label: "Total Expenses",
        columns: ["Expense #", "Category", "Description", "Amount", "Mode", "Paid To", "Date"],
        rows: expenseRows.rows.map((r) => [
          r.expense_id, r.category, r.description, Number(r.amount), r.payment_mode, r.paid_to ?? "—", fmtDate(r.created_at),
        ]),
      };
      break;
    }

    case "collectibleAmount":
    case "expectedPhysicalCash": {
      // These two are FORMULA results (multiple signed components summed),
      // not a single record list — see UnifiedReconciliationPanel and the
      // KPI formula row on My Daily Summary for the exact same breakdown.
      // Rather than inventing a fake per-record table, show the same
      // component breakdown transparently as its own small table.
      const cashPayments = await db
        .select({
          amount: paymentsTable.amount,
          method: paymentsTable.method,
          billStatus: billsTable.status,
          billCreatedAt: billsTable.createdAt,
        })
        .from(paymentsTable)
        .innerJoin(billsTable, eq(paymentsTable.billId, billsTable.id))
        .where(and(
          gte(paymentsTable.createdAt, start),
          lt(paymentsTable.createdAt, end),
          ...(staffName !== null ? [eq(paymentsTable.recordedByName, staffName)] : []),
        ));
      const cashIn = cashPayments.filter((p) => Number(p.amount) > 0 && classifyPaymentMethod(p.method).isKnown && isPhysicalCash(p.method))
        .reduce((s, p) => s + Number(p.amount), 0);
      const cashRefunded = cashPayments.filter((p) => Number(p.amount) < 0 && classifyPaymentMethod(p.method).isKnown && isPhysicalCash(p.method))
        .reduce((s, p) => s + Math.abs(Number(p.amount)), 0);
      const digitalIn = cashPayments.filter((p) => Number(p.amount) > 0 && classifyPaymentMethod(p.method).isKnown && isDigitalSettlement(p.method))
        .reduce((s, p) => s + Number(p.amount), 0);
      const digitalRefunded = cashPayments.filter((p) => Number(p.amount) < 0 && classifyPaymentMethod(p.method).isKnown && isDigitalSettlement(p.method))
        .reduce((s, p) => s + Math.abs(Number(p.amount)), 0);
      const expFilter = staffName !== null ? sql`AND approved_by = ${staffName}` : sql``;
      const expRows = await db.execute<{ cash_expenses: string; digital_expenses: string }>(sql`
        SELECT
          COALESCE(SUM(amount::numeric) FILTER (WHERE LOWER(payment_mode) = 'cash'), 0)::text AS cash_expenses,
          COALESCE(SUM(amount::numeric) FILTER (WHERE LOWER(payment_mode) <> 'cash'), 0)::text AS digital_expenses
        FROM expenses
        WHERE created_at >= ${start.toISOString()} AND created_at < ${end.toISOString()}
        ${expFilter}
      `);
      const cashExpenses = Number(expRows.rows[0]?.cash_expenses ?? 0);
      const digitalExpenses = Number(expRows.rows[0]?.digital_expenses ?? 0);
      const billsIncl = billsInRange.reduce((s, r) => s + Number(r.totalAmount), 0);
      const cancelledOnBills = billsInRange.filter((r) => r.status === "cancelled").reduce((s, r) => s + Number(r.totalAmount), 0);
      const outstandingBills = billsInRange.filter((r) => r.status !== "cancelled").reduce((s, r) => s + Number(r.balanceAmount ?? 0), 0);

      if (type === "expectedPhysicalCash") {
        result = {
          label: "Expected Physical Cash — Breakdown",
          columns: ["Component", "Amount"],
          rows: [
            ["Cash Collected", cashIn],
            ["− Cash Refunded", -cashRefunded],
            ["− Cash Expenses", -cashExpenses],
            ["= Expected Physical Cash", cashIn - cashRefunded - cashExpenses],
          ],
        };
      } else {
        // Same formula as the headline "Collectible Amount" KPI on the
        // summary route above (computeCollectibleForReconciliation): must
        // include Old Dues Collected and subtract Refunds (excluding
        // refunds already accounted for via cancelled-bill removal, so a
        // same-day cancel+refund does not double-subtract).
        const duesPaymentRowsForCollectible = await db
          .select({ paymentAmount: paymentsTable.amount })
          .from(paymentsTable)
          .innerJoin(billsTable, eq(paymentsTable.billId, billsTable.id))
          .where(and(
            gte(paymentsTable.createdAt, start),
            lt(paymentsTable.createdAt, end),
            lt(billsTable.createdAt, start),
            sql`${paymentsTable.amount}::numeric > 0`,
            ...(staffName !== null ? [eq(paymentsTable.recordedByName, staffName)] : []),
          ));
        const duesCollectedTotal = duesPaymentRowsForCollectible.reduce((s, r) => s + Number(r.paymentAmount), 0);
        const refundsOnCancelledBillsCreatedInPeriod = computeRefundsOnCancelledBillsCreatedInPeriod(
          cashPayments.map((p) => ({ amount: p.amount, billStatus: p.billStatus, billCreatedAt: p.billCreatedAt })),
          start,
          end,
        );
        const collectibleAmount = computeCollectibleForReconciliation({
          grossBilledIncludingCancelled: billsIncl,
          duesCollectedTotal,
          cancelledOnMyBills: cancelledOnBills,
          cashRefunded,
          digitalRefunded,
          refundsOnCancelledBillsCreatedInPeriod,
          outstanding: outstandingBills,
        });
        const refundsForCollectible = Math.max(0, cashRefunded + digitalRefunded - refundsOnCancelledBillsCreatedInPeriod);
        result = {
          label: "Collectible Amount — Breakdown",
          columns: ["Component", "Amount"],
          rows: [
            ["Total Bills Generated (incl. cancelled)", billsIncl],
            ["+ Old Dues Collected", duesCollectedTotal],
            ["− Cancelled Bills", -cancelledOnBills],
            ["− Refunds (excl. same-period cancel+refund)", -refundsForCollectible],
            ["− Outstanding / Dues", -outstandingBills],
            ["= Collectible Amount", collectibleAmount],
          ],
        };
      }
      break;
    }

    case "refundsWithoutCancellation": {
      const refundRows = await db
        .select({
          billNumber: billsTable.billNumber,
          amount: paymentsTable.amount,
          method: paymentsTable.method,
          status: billsTable.status,
          patientFirstName: patientsTable.firstName,
          patientLastName: patientsTable.lastName,
          recordedByName: paymentsTable.recordedByName,
          createdAt: paymentsTable.createdAt,
        })
        .from(paymentsTable)
        .innerJoin(billsTable, eq(paymentsTable.billId, billsTable.id))
        .leftJoin(patientsTable, eq(billsTable.patientId, patientsTable.id))
        .where(and(
          gte(paymentsTable.createdAt, start),
          lt(paymentsTable.createdAt, end),
          sql`${paymentsTable.amount}::numeric < 0`,
          ...(staffName !== null ? [eq(paymentsTable.recordedByName, staffName)] : []),
        ))
        .orderBy(sql`${paymentsTable.createdAt} DESC`);
      const notCancelled = refundRows.filter((r) => r.status !== "cancelled");
      result = {
        label: "Refunds (No Cancellation)",
        columns: ["Bill #", "Patient", "Amount", "Method", "Recorded By", "Refunded At"],
        rows: notCancelled.map((r) => [
          r.billNumber, patientNameOf(r), Math.abs(Number(r.amount)), formatMethod(r.method), r.recordedByName ?? "—", fmtDate(r.createdAt),
        ]),
      };
      break;
    }

    default:
      return res.status(400).json({ error: "Unsupported drilldown type" });
  }

  return res.json({
    type,
    from, to, staffName: staffName ?? "All Staff",
    ...result,
  });
});

// GET /billing-vs-pacs — clinic-wide billed vs PACS intake by modality (date range)
myDailySummaryRouter.get("/billing-vs-pacs", async (req: StaffAuthRequest, res) => {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const from = typeof req.query.from === "string" ? req.query.from : today;
  const to = typeof req.query.to === "string" ? req.query.to : from;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return res.status(400).json({ error: "Invalid date format — use YYYY-MM-DD" });
  }
  if (from > to) {
    return res.status(400).json({ error: "from must be on or before to" });
  }

  try {
    const summary = await buildBillingVsPacsSummary(from, to);
    return res.json(summary);
  } catch (err) {
    req.log.error({ err, from, to }, "billing-vs-pacs summary failed");
    return res.status(500).json({ error: "Failed to load imaging reconciliation summary" });
  }
});

// GET /modality-billing — clinic-wide MRI/CT/USG/X-Ray billed counts (bill date)
myDailySummaryRouter.get("/modality-billing", async (req: StaffAuthRequest, res) => {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const from = typeof req.query.from === "string" ? req.query.from : today;
  const to = typeof req.query.to === "string" ? req.query.to : from;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return res.status(400).json({ error: "Invalid date format — use YYYY-MM-DD" });
  }
  if (from > to) {
    return res.status(400).json({ error: "from must be on or before to" });
  }

  try {
    const summary = await buildModalityBillingSummary(from, to);
    return res.json(summary);
  } catch (err) {
    req.log.error({ err, from, to }, "modality-billing summary failed");
    return res.status(500).json({ error: "Failed to load modality billing summary" });
  }
});

// GET /modality-bills — bills containing a modality in the date range (drill-down)
myDailySummaryRouter.get("/modality-bills", async (req: StaffAuthRequest, res) => {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const from = typeof req.query.from === "string" ? req.query.from : today;
  const to = typeof req.query.to === "string" ? req.query.to : from;
  const modalityRaw = typeof req.query.modality === "string" ? req.query.modality : "";
  const modality = resolveModalityQuery(modalityRaw);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return res.status(400).json({ error: "Invalid date format — use YYYY-MM-DD" });
  }
  if (from > to) {
    return res.status(400).json({ error: "from must be on or before to" });
  }
  if (!modality) {
    return res.status(400).json({
      error: "Invalid modality — use MRI, CT, CT Scan, USG, X-Ray, or OPG",
    });
  }

  try {
    const result = await listModalityBills(from, to, modality);
    return res.json(result);
  } catch (err) {
    req.log.error({ err, from, to, modality }, "modality-bills drilldown failed");
    return res.status(500).json({ error: "Failed to load modality bills" });
  }
});

// GET /low-stock — clinic-wide stock alert summary for Daily Summary KPI
myDailySummaryRouter.get("/low-stock", async (_req, res) => {
  try {
    const summary = await buildLowStockSummary(15);
    return res.json(summary);
  } catch (err) {
    return res.status(500).json({ error: "Failed to load low stock summary" });
  }
});
