import { Router } from "express";
import { db } from "@workspace/db";
import { billsTable, paymentsTable, billAuditsTable, patientsTable, ordersTable, doctorsTable, voucherAuditsTable, expensesTable } from "@workspace/db/schema";
import { sql, and, eq, gte, lt } from "drizzle-orm";
import { FULL_ACCESS_ROLES } from "../middleware/requireStaffAuth";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";
import { getTransporter, getEmailSettings } from "../email";

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
    })
    .from(paymentsTable)
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
        remainingDues: Math.max(0, Number(r.balanceAmount ?? 0)) - Math.max(0, Number(r.refundAmount ?? 0)),
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
  const expRaw = await db.execute<{
    cash_expenses: string;
    digital_expenses: string;
  }>(sql`
    SELECT
      COALESCE(SUM(amount::numeric) FILTER (WHERE LOWER(payment_mode) = 'cash'), 0)::text AS cash_expenses,
      COALESCE(SUM(amount::numeric) FILTER (WHERE LOWER(payment_mode) <> 'cash'), 0)::text AS digital_expenses
    FROM expenses
    WHERE expense_date >= ${from} AND expense_date <= ${to}
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

  // Refunds increase balanceAmount (paidAmount goes down), so the refunded
  // portion shows up as "still pending" if we use balanceAmount directly.
  // True outstanding = balance − cumulative refund (the returned money is
  // NOT money still owed by the patient).
  const trueOutstanding = (r: typeof allBillRows[0]) => {
    const bal = Math.max(0, Number(r.balanceAmount ?? 0));
    const ref = Math.max(0, Number(r.refundAmount ?? 0));
    return Math.max(0, bal - ref);
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
  // Shared helper
  const isDigital = (m: string | null | undefined) =>
    ["upi", "card", "online", "bank", "cheque", "neft", "rtgs"].includes(
      (m ?? "").toLowerCase(),
    );
  const cashIn = paymentItems.reduce(
    (s, p) => s + (isDigital(p.method) ? 0 : Number(p.amount)),
    0,
  );
  const digitalIn = paymentItems.reduce(
    (s, p) => s + (isDigital(p.method) ? Number(p.amount) : 0),
    0,
  );
  const cashRefunded = refundItems.reduce(
    (s, p) => s + (isDigital(p.method) ? 0 : Math.abs(Number(p.amount))),
    0,
  );
  const digitalRefunded = refundItems.reduce(
    (s, p) => s + (isDigital(p.method) ? Math.abs(Number(p.amount)) : 0),
    0,
  );
  const cashExpenses = Number(expRaw.rows[0]?.cash_expenses ?? 0);
  const digitalExpenses = Number(expRaw.rows[0]?.digital_expenses ?? 0);
  const totalExpenses = cashExpenses + digitalExpenses;
  const totalReceived = paymentItems.reduce((s, p) => s + Number(p.amount), 0);
  const refundAmount = refundItems.reduce((s, p) => s + Math.abs(Number(p.amount)), 0);
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
    const m = (p.method ?? "cash").toLowerCase();
    byMethod[m] = (byMethod[m] ?? 0) + Number(p.amount);
  }

  // ── All staff names who appear in the data (for the filter dropdown) ──
  const staffSet = new Set<string>();
  for (const r of allBillRows) if (r.createdByName) staffSet.add(r.createdByName);
  for (const p of allPaymentRows) if (p.recordedByName) staffSet.add(p.recordedByName);
  for (const r of cancelledByMeRows) if (r.createdByName) staffSet.add(r.createdByName);
  const staffNames = Array.from(staffSet).sort();

  // ── Per-staff breakdown (only when viewing All Staff aggregate) ──
  type StaffRow = {
    name: string;
    grossBilled: number;
    activeBilling: number;
    cancelled: number;
    outstanding: number;
    netCollected: number;
    billCount: number;
    cashIn: number;
    digitalIn: number;
    cashRefunded: number;
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
    for (const r of cancelledByMeRows) if (r.createdByName) staffSet.add(r.createdByName);
    const names = Array.from(staffSet).sort();

    // Expenses per person (cash + digital, only needed for all-staff mode)
    type ExpRow = { approved_by: string; cash: string; digital: string };
    const cashExpPerPerson: Record<string, number> = {};
    const digitalExpPerPerson: Record<string, number> = {};
    const expRows = await db.execute<ExpRow>(sql`
      SELECT
        approved_by,
        COALESCE(SUM(amount::numeric) FILTER (WHERE LOWER(payment_mode) = 'cash'), 0)::text AS cash,
        COALESCE(SUM(amount::numeric) FILTER (WHERE LOWER(payment_mode) <> 'cash'), 0)::text AS digital
      FROM expenses
      WHERE expense_date >= ${from} AND expense_date <= ${to}
        AND approved_by IS NOT NULL
      GROUP BY approved_by
    `);
    for (const r of expRows.rows) {
      cashExpPerPerson[r.approved_by] = Number(r.cash);
      digitalExpPerPerson[r.approved_by] = Number(r.digital);
    }

    byStaff = staffNames.map((name) => {
      const sbills = allBillRows.filter((r) => r.createdByName === name);
      const sactive = sbills.filter((r) => r.status !== "cancelled");
      const scancelled = sbills.filter((r) => r.status === "cancelled");
      const spayPos = allPaymentRows.filter((p) => p.recordedByName === name && Number(p.amount) > 0);
      const spayNeg = allPaymentRows.filter((p) => p.recordedByName === name && Number(p.amount) < 0);
      const scancelledByMe = cancelledByMeRows.filter((r) => r.createdByName === name);

      const sGrossBilled = sbills.reduce((s, r) => s + Number(r.totalAmount), 0);
      const sActiveBilling = sactive.reduce((s, r) => s + Number(r.totalAmount), 0);
      const sCancelled = scancelled.reduce((s, r) => s + Number(r.totalAmount), 0);
      const sOutstanding = sactive.reduce((s, r) => s + trueOutstanding(r), 0);
      const sNetCollected = sActiveBilling - sOutstanding;
      const sCashIn = spayPos.reduce((s, p) => s + (isDigital(p.method) ? 0 : Number(p.amount)), 0);
      const sDigitalIn = spayPos.reduce((s, p) => s + (isDigital(p.method) ? Number(p.amount) : 0), 0);
      const sCashRef = spayNeg.reduce((s, p) => s + (isDigital(p.method) ? 0 : Math.abs(Number(p.amount))), 0);
      const sDigitalRef = spayNeg.reduce((s, p) => s + (isDigital(p.method) ? Math.abs(Number(p.amount)) : 0), 0);
      const sNetCash = sCashIn - sCashRef;
      const sNetDigital = sDigitalIn - sDigitalRef;
      const sTotalRec = spayPos.reduce((s, p) => s + Number(p.amount), 0);
      const sCashExp = cashExpPerPerson[name] ?? 0;
      const sDigitalExp = digitalExpPerPerson[name] ?? 0;
      const sTotalExp = sCashExp + sDigitalExp;
      const sPhysCash = sNetCash - sCashExp;
      const sDues = duesBills.filter((d) => d.createdByName === name).reduce((s, d) => s + d.duesCollected, 0);
      const sDiscounts = sactive.reduce((s, r) => s + Number(r.discount ?? 0), 0);

      return {
        name,
        grossBilled: sGrossBilled,
        activeBilling: sActiveBilling,
        cancelled: sCancelled,
        outstanding: sOutstanding,
        netCollected: sNetCollected,
        billCount: sactive.length,
        cashIn: sCashIn,
        digitalIn: sDigitalIn,
        cashRefunded: sCashRef,
        digitalRefunded: sDigitalRef,
        netCash: sNetCash,
        netDigital: sNetDigital,
        totalReceived: sTotalRec,
        cashExpenses: sCashExp,
        digitalExpenses: sDigitalExp,
        totalExpenses: sTotalExp,
        physicalCashInHand: sPhysCash,
        duesCollected: sDues,
        discountsGiven: sDiscounts,
        cancellationCount: scancelledByMe.length,
      };
    });
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
      method: p.method ?? "cash",
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
      method: p.method ?? "cash",
      recordedBy: p.recordedByName ?? null,
      createdAt:
        p.createdAt instanceof Date ? p.createdAt.toISOString() : String(p.createdAt),
    })),
  });
});
