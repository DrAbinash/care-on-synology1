import { Router } from "express";
import { db } from "@workspace/db";
import {
  doctorsTable,
  doctorPayoutsTable,
  commissionRulesTable,
  ordersTable,
  orderTestsTable,
  testsTable,
  billsTable,
  clinicSettingsTable,
  testTokensTable,
  patientReportsTable,
  radiologyStudiesTable,
  commissionStatusEventsTable,
  commissionPayoutLinesTable,
} from "@workspace/db/schema";
import { eq, desc, and, gte, lte, inArray, ne, sql } from "drizzle-orm";
import {
  CreateDoctorPayoutBody,
  CreateDoctorPayoutParams,
  DeleteDoctorPayoutParams,
  GetDoctorLedgerDetailParams,
  GetDoctorLedgerDetailQueryParams,
  UpdateDoctorPayoutBody,
  UpdateDoctorPayoutParams,
} from "@workspace/api-zod";
import {
  type EligibilityConfig,
  calcTestCommission,
  buildTestNameAliasIndex,
  rulesForDoctor,
  applyDiscountDeduction,
  computeCommissionHold,
  indexCommissionBillsByOrderId,
  NEEDS_REPORT_STATUS,
} from "../lib/commissionCalc";

export const doctorLedgerRouter = Router();

// ─── Commission calculation ───────────────────────────────────────────────────
// Imported from ../lib/commissionCalc, not re-implemented: the ledger must pay
// exactly what the Referral Report says is owed. This file used to carry its own
// copy of the maths and the two slowly diverged.

// Per-order report finalized/delivered flags (only queried for the report_*
// policies). An order counts as finalized/delivered only when EVERY non-cancelled
// order-test has a finalized/delivered report — pathology via patient_reports
// (verified/delivered), radiology via radiology_studies (reported_final/delivered).
async function fetchOrderReportStatus(
  orderIds: number[],
  activeOrderTestIdsByOrder: Map<number, number[]>,
): Promise<Map<number, { finalized: boolean; delivered: boolean }>> {
  const out = new Map<number, { finalized: boolean; delivered: boolean }>();
  if (!orderIds.length) return out;
  const [prs, rss] = await Promise.all([
    db.select({ orderTestId: patientReportsTable.orderTestId, status: patientReportsTable.status })
      .from(patientReportsTable).where(inArray(patientReportsTable.orderId, orderIds)),
    db.select({ orderTestId: radiologyStudiesTable.orderTestId, status: radiologyStudiesTable.status })
      .from(radiologyStudiesTable).where(inArray(radiologyStudiesTable.orderId, orderIds)),
  ]);
  const testFinal = new Set<number>();
  const testDeliv = new Set<number>();
  for (const r of prs) {
    if (r.orderTestId == null) continue;
    if (r.status === "verified" || r.status === "delivered") testFinal.add(r.orderTestId);
    if (r.status === "delivered") testDeliv.add(r.orderTestId);
  }
  for (const r of rss) {
    if (r.orderTestId == null) continue;
    if (r.status === "reported_final" || r.status === "delivered") testFinal.add(r.orderTestId);
    if (r.status === "delivered") testDeliv.add(r.orderTestId);
  }
  for (const [orderId, otIds] of activeOrderTestIdsByOrder) {
    out.set(orderId, {
      finalized: otIds.length > 0 && otIds.every(id => testFinal.has(id)),
      delivered: otIds.length > 0 && otIds.every(id => testDeliv.has(id)),
    });
  }
  return out;
}

// Compute commission earned per doctor over a date range (or lifetime when from/to omitted).
// Splits each doctor's commission into payable (eligible now) and held (waiting on
// the eligibility condition), per the clinic's commission_eligibility_policy.
async function computeEarned(opts: { from?: string; to?: string; doctorId?: number }) {
  const [clinicRow] = await db.select({
    vipPercentage: clinicSettingsTable.vipPercentage,
    commissionDiscountMode: clinicSettingsTable.commissionDiscountMode,
    commissionEligibilityPolicy: clinicSettingsTable.commissionEligibilityPolicy,
    commissionEligibilityMinAmount: clinicSettingsTable.commissionEligibilityMinAmount,
    commissionOutsourcedBasis: clinicSettingsTable.commissionOutsourcedBasis,
  }).from(clinicSettingsTable).limit(1);
  const vipPct = clinicRow?.vipPercentage ? Number(clinicRow.vipPercentage) : 50.00;
  const discountMode = clinicRow?.commissionDiscountMode ?? "none";
  // 'price' | 'margin' — on outsourced work, whether the rate applies to the
  // full price or only to what the clinic keeps after the external lab's cost.
  const outsourcedBasis = clinicRow?.commissionOutsourcedBasis ?? "price";
  const cfg: EligibilityConfig = {
    policy: clinicRow?.commissionEligibilityPolicy ?? "full_payment_collected",
    minAmount: Number(clinicRow?.commissionEligibilityMinAmount ?? 0),
  };

  const doctors = await db.select().from(doctorsTable);
  const allRules = await db.select().from(commissionRulesTable).orderBy(commissionRulesTable.id);
  const allTests = await db.select().from(testsTable);
  const testMap = new Map(allTests.map(t => [t.id, { id: t.id, name: t.name, category: t.category, price: Number(t.price), testType: t.testType }]));
  const testAliasIndex = buildTestNameAliasIndex(allTests);

  const conditions = [];
  if (opts.doctorId) conditions.push(eq(ordersTable.doctorId, opts.doctorId));
  if (opts.from) conditions.push(gte(ordersTable.createdAt, new Date(opts.from)));
  if (opts.to) conditions.push(lte(ordersTable.createdAt, new Date(opts.to + "T23:59:59Z")));

  const orders = await db.select().from(ordersTable).where(conditions.length ? and(...conditions) : undefined);
  const orderIds = orders.map(o => o.id);
  // Exclude cancelled tests from commission — matches commission.ts / the other
  // report endpoints, otherwise cancelled tests inflate the ledger's earned total.
  const orderTests = orderIds.length ? await db.select().from(orderTestsTable).where(and(inArray(orderTestsTable.orderId, orderIds), ne(orderTestsTable.status, "cancelled"))) : [];

  const tokens = orderIds.length
    ? await db.select({ orderTestId: testTokensTable.orderTestId })
        .from(testTokensTable)
        .where(and(inArray(testTokensTable.orderId, orderIds), sql`${testTokensTable.priority} > 0`))
    : [];
  const vipOrderTestIds = new Set(tokens.map(t => t.orderTestId).filter(Boolean) as number[]);

  // Bill payment state per order (for payment-based eligibility policies).
  // Billed + non-cancelled only — unbilled duplicates never enter earned totals.
  const billsForOrders = orderIds.length
    ? await db.select({ orderId: billsTable.orderId, status: billsTable.status, paidAmount: billsTable.paidAmount, balanceAmount: billsTable.balanceAmount, discount: billsTable.discount })
        .from(billsTable).where(inArray(billsTable.orderId, orderIds))
    : [];
  const billByOrderRaw = indexCommissionBillsByOrderId(billsForOrders);
  const billByOrderId = new Map<number, { status: string | null; paid: number; balance: number; discount: number }>();
  for (const [oid, b] of billByOrderRaw) {
    billByOrderId.set(oid, {
      status: b.status ?? null,
      paid: Number(b.paidAmount ?? 0),
      balance: Number(b.balanceAmount ?? 0),
      discount: Number(b.discount ?? 0),
    });
  }

  // Report finalized/delivered per order — only fetched for the report_* policies.
  let reportStatusByOrder = new Map<number, { finalized: boolean; delivered: boolean }>();
  if (NEEDS_REPORT_STATUS(cfg.policy)) {
    const activeOrderTestIdsByOrder = new Map<number, number[]>();
    for (const ot of orderTests) {
      if (!billByOrderId.has(ot.orderId)) continue;
      const arr = activeOrderTestIdsByOrder.get(ot.orderId) ?? [];
      arr.push(ot.id);
      activeOrderTestIdsByOrder.set(ot.orderId, arr);
    }
    reportStatusByOrder = await fetchOrderReportStatus(
      [...billByOrderId.keys()],
      activeOrderTestIdsByOrder,
    );
  }

  // Orders already settled by a recorded payout. Their commission is read from
  // the snapshot taken at payout time rather than recomputed, so editing a slab
  // today cannot change what a statement already handed over says. See
  // commission_payout_lines.
  const frozenRows = orderIds.length
    ? await db.select().from(commissionPayoutLinesTable).where(inArray(commissionPayoutLinesTable.orderId, orderIds))
    : [];
  const frozenByOrder = new Map<number, { commission: number; gross: number; revenue: number; payoutId: number; ruleSummary: string }>();
  for (const f of frozenRows) {
    frozenByOrder.set(f.orderId, {
      commission: Number(f.commissionAmount),
      gross: Number(f.grossCommission),
      revenue: Number(f.revenue),
      payoutId: f.payoutId,
      ruleSummary: f.ruleSummary,
    });
  }

  const filteredDoctors = opts.doctorId ? doctors.filter(d => d.id === opts.doctorId) : doctors;

  return filteredDoctors.map(doctor => {
    const doctorOrders = orders.filter(o => o.doctorId === doctor.id && billByOrderId.has(o.id));
    const rules = rulesForDoctor(allRules, doctor.id);
    let totalRevenue = 0, totalCommission = 0, payableCommission = 0, heldCommission = 0;
    const orderRows: { orderId: number; orderNumber: string; date: string; revenue: number; commission: number; grossCommission: number; testCount: number; held: boolean; holdReason: string | null; frozen: boolean; payoutId: number | null; ruleSummary: string }[] = [];
    for (const order of doctorOrders) {
      const tests = orderTests.filter(ot => ot.orderId === order.id);
      if (tests.length === 0) continue;
      let r = 0, rawC = 0;
      const ruleNames = new Set<string>();
      for (const ot of tests) {
        const test = testMap.get(ot.testId);
        const { commission, ruleName, ruleType, ruleValue } = calcTestCommission(ot, test, rules, doctor, vipOrderTestIds, vipPct, outsourcedBasis, testAliasIndex);
        r += Number(ot.price);
        rawC += commission;
        if (ruleName && ruleName !== "None") {
          ruleNames.add(`${ruleName} (${ruleType === "percentage" ? `${ruleValue}%` : `Rs.${ruleValue}`})`);
        }
      }
      const bill = billByOrderId.get(order.id);
      if (!bill) continue;
      // Net of the bill-discount deduction — same NET the Referral Report pays.
      const { net: liveNet } = applyDiscountDeduction(rawC, bill?.discount ?? 0, discountMode);
      const rep = reportStatusByOrder.get(order.id);
      const live = computeCommissionHold({
        cfg,
        hasBill: !!bill,
        billStatus: bill?.status ?? null,
        paidAmount: bill?.paid ?? 0,
        balanceAmount: bill?.balance ?? 0,
        reportFinalized: rep?.finalized ?? false,
        reportDelivered: rep?.delivered ?? false,
        commissionAmount: liveNet,
      });

      // A settled order uses its snapshot, and is by definition no longer held:
      // it was eligible when it was paid, and it has been paid.
      const frozen = frozenByOrder.get(order.id);
      const c = frozen ? frozen.commission : liveNet;
      const gross = frozen ? frozen.gross : rawC;
      const revenue = frozen ? frozen.revenue : r;
      const held = frozen ? false : live.held;
      const reason = frozen ? null : live.reason;

      totalRevenue += revenue;
      totalCommission += c;
      if (held) heldCommission += c; else payableCommission += c;
      orderRows.push({
        orderId: order.id,
        orderNumber: order.orderNumber,
        date: order.createdAt.toISOString().split("T")[0],
        revenue,
        commission: c,
        grossCommission: gross,
        testCount: tests.length,
        held,
        holdReason: reason,
        frozen: !!frozen,
        payoutId: frozen?.payoutId ?? null,
        ruleSummary: frozen ? frozen.ruleSummary : [...ruleNames].join(", "),
      });
    }
    return {
      doctor,
      totalRevenue,
      totalCommission,        // gross — all orders in window (reference)
      payableCommission,      // eligible now — this is what's owed / due
      heldCommission,         // held pending the eligibility condition
      orderCount: orderRows.length,
      orders: orderRows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    };
  });
}

// ─── GET / : Summary table — Earned vs Paid vs Due per doctor ──────────────────
doctorLedgerRouter.get("/", async (req, res) => {
  try {
    const { from, to, search } = req.query as Record<string, string | undefined>;
    const earnedByDoctor = await computeEarned({ from, to });

    // Sum payouts per doctor in same window (or lifetime). Always include lifetime totals too for an Outstanding column.
    const payoutCondsWindow = [];
    if (from) payoutCondsWindow.push(gte(doctorPayoutsTable.paymentDate, from));
    if (to) payoutCondsWindow.push(lte(doctorPayoutsTable.paymentDate, to));
    const paidWindowRows = await db
      .select({ doctorId: doctorPayoutsTable.doctorId, total: sql<string>`SUM(${doctorPayoutsTable.amount})` })
      .from(doctorPayoutsTable)
      .where(payoutCondsWindow.length ? and(...payoutCondsWindow) : undefined)
      .groupBy(doctorPayoutsTable.doctorId);
    const paidWindow = new Map(paidWindowRows.map(r => [r.doctorId, Number(r.total)]));

    const paidLifetimeRows = await db
      .select({ doctorId: doctorPayoutsTable.doctorId, total: sql<string>`SUM(${doctorPayoutsTable.amount})` })
      .from(doctorPayoutsTable)
      .groupBy(doctorPayoutsTable.doctorId);
    const paidLifetime = new Map(paidLifetimeRows.map(r => [r.doctorId, Number(r.total)]));

    // Lifetime payable/held per doctor (for outstanding + held columns even when a window is set)
    const lifetimeEarned = (from || to) ? await computeEarned({}) : earnedByDoctor;
    const lifetimePayableMap = new Map(lifetimeEarned.map(r => [r.doctor.id, r.payableCommission]));
    const lifetimeHeldMap = new Map(lifetimeEarned.map(r => [r.doctor.id, r.heldCommission]));

    const term = (search || "").trim().toLowerCase();

    const rows = earnedByDoctor
      .map(r => {
        // Only eligible (non-held) commission is owed; held commission is excluded
        // from Due / Outstanding and reported separately.
        const earnedWindow = r.payableCommission;
        const paidW = paidWindow.get(r.doctor.id) ?? 0;
        const earnedLife = lifetimePayableMap.get(r.doctor.id) ?? 0;
        const paidLife = paidLifetime.get(r.doctor.id) ?? 0;
        return {
          doctorId: r.doctor.id,
          doctorName: r.doctor.name,
          specialization: r.doctor.specialization,
          phone: r.doctor.phone,
          email: r.doctor.email,
          orderCount: r.orderCount,
          revenueWindow: r.totalRevenue,
          earnedWindow,
          heldWindow: r.heldCommission,
          paidWindow: paidW,
          dueWindow: earnedWindow - paidW,
          earnedLifetime: earnedLife,
          heldLifetime: lifetimeHeldMap.get(r.doctor.id) ?? 0,
          paidLifetime: paidLife,
          outstanding: earnedLife - paidLife,
        };
      })
      .filter(r => {
        if (!term) return true;
        return (
          r.doctorName.toLowerCase().includes(term) ||
          (r.specialization || "").toLowerCase().includes(term)
        );
      })
      .sort((a, b) => b.outstanding - a.outstanding);

    const totals = rows.reduce(
      (acc, r) => ({
        doctors: acc.doctors + 1,
        earnedWindow: acc.earnedWindow + r.earnedWindow,
        heldWindow: acc.heldWindow + r.heldWindow,
        paidWindow: acc.paidWindow + r.paidWindow,
        dueWindow: acc.dueWindow + r.dueWindow,
        outstanding: acc.outstanding + r.outstanding,
      }),
      { doctors: 0, earnedWindow: 0, heldWindow: 0, paidWindow: 0, dueWindow: 0, outstanding: 0 },
    );

    res.json({ rows, totals, window: { from: from ?? null, to: to ?? null } });
  } catch (err) {
    req.log?.error({ err }, "doctor-ledger summary failed");
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── GET /:doctorId : per-doctor detailed ledger ───────────────────────────────
doctorLedgerRouter.get("/:doctorId", async (req, res) => {
  try {
    const paramsParsed = GetDoctorLedgerDetailParams.safeParse({ doctorId: req.params.doctorId });
    const queryParsed = GetDoctorLedgerDetailQueryParams.safeParse(req.query);
    if (!paramsParsed.success || !queryParsed.success) {
      res.status(400).json({
        error: "Invalid request",
        details: [
          ...(paramsParsed.success ? [] : paramsParsed.error.issues),
          ...(queryParsed.success ? [] : queryParsed.error.issues),
        ],
      });
      return;
    }
    const doctorId = paramsParsed.data.doctorId;
    const { from, to } = queryParsed.data;

    const [doctor] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, doctorId));
    if (!doctor) {
      res.status(404).json({ error: "Doctor not found" });
      return;
    }

    const earnedReport = await computeEarned({ from, to, doctorId });
    const earnedRows = earnedReport[0]?.orders ?? [];
    const totalEarned = earnedReport[0]?.payableCommission ?? 0;   // eligible (owed)
    const totalHeld = earnedReport[0]?.heldCommission ?? 0;        // on hold (not owed)
    const totalRevenue = earnedReport[0]?.totalRevenue ?? 0;

    const conds = [eq(doctorPayoutsTable.doctorId, doctorId)];
    if (from) conds.push(gte(doctorPayoutsTable.paymentDate, from));
    if (to) conds.push(lte(doctorPayoutsTable.paymentDate, to));
    const payouts = await db
      .select()
      .from(doctorPayoutsTable)
      .where(and(...conds))
      .orderBy(desc(doctorPayoutsTable.paymentDate), desc(doctorPayoutsTable.id));

    // Build merged ledger entries (earned = credit to doctor, paid = debit).
    type Entry = { kind: "earned" | "paid"; date: string; particular: string; credit: number; debit: number; ref?: string | null; id?: number };
    const entries: Entry[] = [];
    for (const o of earnedRows) {
      // Held commission is not yet owed — it stays out of the running balance
      // until its eligibility condition is met (it's listed under heldOrders).
      if (o.held) continue;
      entries.push({
        kind: "earned",
        date: o.date,
        // A settled order is marked so the reader can tell a frozen figure from
        // a live one — the frozen figure will not move if a slab changes later.
        particular: `Commission · Order ${o.orderNumber} (${o.testCount} test${o.testCount === 1 ? "" : "s"})${o.frozen ? " · settled" : ""}`,
        credit: o.commission,
        debit: 0,
        ref: o.orderNumber,
      });
    }
    for (const p of payouts) {
      entries.push({
        kind: "paid",
        date: p.paymentDate,
        particular: `Payout · ${p.paymentMethod}${p.reference ? ` (${p.reference})` : ""}${p.notes ? ` — ${p.notes}` : ""}`,
        credit: 0,
        debit: Number(p.amount),
        ref: p.reference,
        id: p.id,
      });
    }
    entries.sort((a, b) => {
      const d = new Date(a.date).getTime() - new Date(b.date).getTime();
      if (d !== 0) return d;
      // Within the same day, earned should come before paid so balance shows the right intra-day flow
      if (a.kind !== b.kind) return a.kind === "earned" ? -1 : 1;
      return 0;
    });
    let running = 0;
    const ledger = entries.map(e => {
      running += e.credit - e.debit;
      return { ...e, balance: running };
    });

    const totalPaid = payouts.reduce((s, p) => s + Number(p.amount), 0);

    // Lifetime totals (for outstanding regardless of window) — payable only
    const lifetimeEarned = (from || to)
      ? (await computeEarned({ doctorId }))[0]?.payableCommission ?? 0
      : totalEarned;
    const lifetimePaidRow = await db
      .select({ total: sql<string>`COALESCE(SUM(${doctorPayoutsTable.amount}), 0)` })
      .from(doctorPayoutsTable)
      .where(eq(doctorPayoutsTable.doctorId, doctorId));
    const lifetimePaid = Number(lifetimePaidRow[0]?.total ?? 0);

    // ── Clawback: orders whose commission had become eligible (payable) and has
    // since been reversed back to On Hold — typically a bill cancelled or refunded
    // after the fact. Sourced from the append-only status-event audit trail so the
    // reversal is visible even though the live order now simply reads "on hold".
    // This is informational only: the running balance already excludes held orders,
    // so a clawback needs no separate debit — it just explains *why* a previously
    // payable amount is no longer in the due total.
    const cbEvents = await db
      .select({
        orderId: commissionStatusEventsTable.orderId,
        commissionAmount: commissionStatusEventsTable.commissionAmount,
        oldStatus: commissionStatusEventsTable.oldStatus,
        newStatus: commissionStatusEventsTable.newStatus,
        reason: commissionStatusEventsTable.reason,
        createdAt: commissionStatusEventsTable.createdAt,
      })
      .from(commissionStatusEventsTable)
      .where(eq(commissionStatusEventsTable.doctorId, doctorId))
      .orderBy(desc(commissionStatusEventsTable.createdAt), desc(commissionStatusEventsTable.id));
    const latestEventByOrder = new Map<number, (typeof cbEvents)[number]>();
    for (const e of cbEvents) if (!latestEventByOrder.has(e.orderId)) latestEventByOrder.set(e.orderId, e);
    const clawbacks = [...latestEventByOrder.values()]
      .filter(e => e.newStatus === "on_hold" && e.oldStatus === "eligible")
      .map(e => ({
        orderId: e.orderId,
        amount: Number(e.commissionAmount),
        reason: e.reason ?? "Reversed to On Hold",
        at: e.createdAt,
      }))
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    const totalClawback = clawbacks.reduce((s, e) => s + e.amount, 0);

    res.json({
      doctor: {
        ...doctor,
        defaultCommission: Number(doctor.defaultCommission),
      },
      window: { from: from ?? null, to: to ?? null },
      summary: {
        totalRevenue,
        totalEarned,
        totalHeld,
        totalPaid,
        totalClawback,
        dueWindow: totalEarned - totalPaid,
        lifetimeEarned,
        lifetimePaid,
        outstanding: lifetimeEarned - lifetimePaid,
        orderCount: earnedRows.length,
        heldOrderCount: earnedRows.filter(o => o.held).length,
        clawbackCount: clawbacks.length,
        payoutCount: payouts.length,
      },
      earnedOrders: earnedRows,
      payouts: payouts.map(p => ({ ...p, amount: Number(p.amount) })),
      clawbacks,
      ledger,
    });
  } catch (err) {
    req.log?.error({ err }, "doctor-ledger detail failed");
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── POST /:doctorId/payouts : record a new payout ─────────────────────────────
// Freeze the orders a payout settles. Called immediately after the payout row
// is written, so the figures captured are the ones the operator was looking at
// when they pressed Record.
//
// Only eligible (non-held) orders are frozen — held commission is not being paid
// — and an order already frozen by an earlier payout is left alone, so two
// payouts in the same period cannot double-settle it. Returns how many were
// frozen so the caller can report it.
async function freezeOrdersForPayout(opts: {
  payoutId: number;
  doctorId: number;
  periodFrom: string | null;
  periodTo: string | null;
}): Promise<number> {
  const earned = await computeEarned({
    doctorId: opts.doctorId,
    from: opts.periodFrom ?? undefined,
    to: opts.periodTo ?? undefined,
  });
  const rows = earned[0]?.orders ?? [];
  // `frozen` is already true for anything a previous payout settled, because
  // computeEarned reads the snapshot back.
  const toFreeze = rows.filter(o => !o.held && !o.frozen);
  if (!toFreeze.length) return 0;

  await db.insert(commissionPayoutLinesTable).values(toFreeze.map(o => ({
    payoutId: opts.payoutId,
    doctorId: opts.doctorId,
    orderId: o.orderId,
    orderNumber: o.orderNumber,
    orderDate: o.date,
    commissionAmount: o.commission.toFixed(2),
    grossCommission: o.grossCommission.toFixed(2),
    revenue: o.revenue.toFixed(2),
    testCount: o.testCount,
    ruleSummary: o.ruleSummary.slice(0, 500),
  })));
  return toFreeze.length;
}

doctorLedgerRouter.post("/:doctorId/payouts", async (req, res) => {
  try {
    const paramsParsed = CreateDoctorPayoutParams.safeParse({ doctorId: req.params.doctorId });
    const bodyParsed = CreateDoctorPayoutBody.safeParse(req.body);
    if (!paramsParsed.success || !bodyParsed.success) {
      res.status(400).json({
        error: "Invalid request",
        details: [
          ...(paramsParsed.success ? [] : paramsParsed.error.issues),
          ...(bodyParsed.success ? [] : bodyParsed.error.issues),
        ],
      });
      return;
    }
    const doctorId = paramsParsed.data.doctorId;
    const data = bodyParsed.data;

    if (data.amount <= 0) {
      res.status(400).json({ error: "amount must be a positive number" });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.paymentDate)) {
      res.status(400).json({ error: "Invalid paymentDate" });
      return;
    }
    const allowedMethods = ["cash", "bank", "upi", "cheque", "card", "other"];
    if (!allowedMethods.includes(data.paymentMethod)) {
      res.status(400).json({ error: "Invalid paymentMethod" });
      return;
    }
    if (data.periodFrom && !/^\d{4}-\d{2}-\d{2}$/.test(data.periodFrom)) {
      res.status(400).json({ error: "Invalid periodFrom" });
      return;
    }
    if (data.periodTo && !/^\d{4}-\d{2}-\d{2}$/.test(data.periodTo)) {
      res.status(400).json({ error: "Invalid periodTo" });
      return;
    }

    const [doctor] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, doctorId));
    if (!doctor) {
      res.status(404).json({ error: "Doctor not found" });
      return;
    }

    const trim = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    const performedBy = trim((req.body ?? {}).performedBy);

    const [row] = await db
      .insert(doctorPayoutsTable)
      .values({
        doctorId,
        amount: data.amount.toFixed(2),
        paymentDate: data.paymentDate,
        paymentMethod: data.paymentMethod,
        reference: trim(data.reference),
        periodFrom: data.periodFrom ?? null,
        periodTo: data.periodTo ?? null,
        notes: trim(data.notes),
        performedBy,
      })
      .returning();

    // Freeze what this payout settled. A failure here must not lose the payout
    // itself — the money moved — so it is reported, not thrown: the ledger falls
    // back to live recomputation exactly as it did before this existed.
    let frozenCount = 0;
    try {
      frozenCount = await freezeOrdersForPayout({
        payoutId: row.id,
        doctorId,
        periodFrom: data.periodFrom ?? null,
        periodTo: data.periodTo ?? null,
      });
    } catch (freezeErr) {
      req.log?.error({ err: freezeErr, payoutId: row.id }, "doctor-ledger payout snapshot failed");
    }

    res.status(201).json({ ...row, amount: Number(row.amount), frozenOrders: frozenCount });
  } catch (err) {
    req.log?.error({ err }, "doctor-ledger payout create failed");
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── PATCH /payouts/:id : edit an existing payout ─────────────────────────────
doctorLedgerRouter.patch("/payouts/:id", async (req, res) => {
  try {
    const paramsParsed = UpdateDoctorPayoutParams.safeParse({ id: req.params.id });
    const bodyParsed = UpdateDoctorPayoutBody.safeParse(req.body);
    if (!paramsParsed.success || !bodyParsed.success) {
      res.status(400).json({
        error: "Invalid request",
        details: [
          ...(paramsParsed.success ? [] : paramsParsed.error.issues),
          ...(bodyParsed.success ? [] : bodyParsed.error.issues),
        ],
      });
      return;
    }
    const id = paramsParsed.data.id;
    const data = bodyParsed.data;
    const updates: Record<string, unknown> = {};
    if (data.amount !== undefined) {
      if (data.amount <= 0) {
        res.status(400).json({ error: "amount must be positive" });
        return;
      }
      updates.amount = data.amount.toFixed(2);
    }
    if (data.paymentDate !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data.paymentDate)) {
        res.status(400).json({ error: "Invalid paymentDate" });
        return;
      }
      updates.paymentDate = data.paymentDate;
    }
    if (data.paymentMethod !== undefined) {
      const allowed = ["cash", "bank", "upi", "cheque", "card", "other"];
      if (!allowed.includes(data.paymentMethod)) {
        res.status(400).json({ error: "Invalid paymentMethod" });
        return;
      }
      updates.paymentMethod = data.paymentMethod;
    }
    if (data.reference !== undefined) updates.reference = data.reference || null;
    if (data.notes !== undefined) updates.notes = data.notes || null;
    if (data.periodFrom !== undefined) updates.periodFrom = data.periodFrom || null;
    if (data.periodTo !== undefined) updates.periodTo = data.periodTo || null;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    const [row] = await db
      .update(doctorPayoutsTable)
      .set(updates)
      .where(eq(doctorPayoutsTable.id, id))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Payout not found" });
      return;
    }
    res.json({ ...row, amount: Number(row.amount) });
  } catch (err) {
    req.log?.error({ err }, "doctor-ledger payout patch failed");
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── DELETE /payouts/:id ───────────────────────────────────────────────────────
doctorLedgerRouter.delete("/payouts/:id", async (req, res) => {
  try {
    const parsed = DeleteDoctorPayoutParams.safeParse({ id: req.params.id });
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid payout id", details: parsed.error.issues });
      return;
    }
    const id = parsed.data.id;
    const result = await db.delete(doctorPayoutsTable).where(eq(doctorPayoutsTable.id, id)).returning();
    if (result.length === 0) {
      res.status(404).json({ error: "Payout not found" });
      return;
    }
    // Reversing the payout reverses the freeze: those orders go back to being
    // computed live, and become payable again.
    const unfrozen = await db.delete(commissionPayoutLinesTable)
      .where(eq(commissionPayoutLinesTable.payoutId, id)).returning({ id: commissionPayoutLinesTable.id });
    res.json({ ok: true, unfrozenOrders: unfrozen.length });
  } catch (err) {
    req.log?.error({ err }, "doctor-ledger payout delete failed");
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── GET /:doctorId/export : CSV export of the ledger window ──────────────────
doctorLedgerRouter.get("/:doctorId/export", async (req, res) => {
  try {
    const paramsParsed = GetDoctorLedgerDetailParams.safeParse({ doctorId: req.params.doctorId });
    const queryParsed = GetDoctorLedgerDetailQueryParams.safeParse(req.query);
    if (!paramsParsed.success || !queryParsed.success) {
      res.status(400).json({
        error: "Invalid request",
        details: [
          ...(paramsParsed.success ? [] : paramsParsed.error.issues),
          ...(queryParsed.success ? [] : queryParsed.error.issues),
        ],
      });
      return;
    }
    const doctorId = paramsParsed.data.doctorId;
    const [doctor] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, doctorId));
    if (!doctor) {
      res.status(404).json({ error: "Doctor not found" });
      return;
    }
    const { from, to } = queryParsed.data;

    const earnedReport = await computeEarned({ from, to, doctorId });
    const earnedRows = earnedReport[0]?.orders ?? [];
    const conds = [eq(doctorPayoutsTable.doctorId, doctorId)];
    if (from) conds.push(gte(doctorPayoutsTable.paymentDate, from));
    if (to) conds.push(lte(doctorPayoutsTable.paymentDate, to));
    const payouts = await db.select().from(doctorPayoutsTable).where(and(...conds));

    type Row = { date: string; kind: string; particular: string; credit: number; debit: number; reference: string };
    const entries: Row[] = [];
    for (const o of earnedRows) {
      if (o.held) continue; // held commission stays out of the running balance
      entries.push({ date: o.date, kind: "Commission", particular: `Order ${o.orderNumber} (${o.testCount} tests)`, credit: o.commission, debit: 0, reference: o.orderNumber });
    }
    for (const p of payouts) entries.push({ date: p.paymentDate, kind: "Payout", particular: `${p.paymentMethod}${p.notes ? " — " + p.notes : ""}`, credit: 0, debit: Number(p.amount), reference: p.reference || "" });
    entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || (a.kind === "Commission" ? -1 : 1));

    const esc = (v: unknown) => {
      let s = String(v ?? "");
      // CSV formula-injection guard: prefix with single quote if cell starts with =, +, -, @, tab, or CR
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    let running = 0;
    const lines = [["Date", "Type", "Particular", "Credit", "Debit", "Balance", "Reference"].join(",")];
    for (const e of entries) {
      running += e.credit - e.debit;
      lines.push([esc(e.date), esc(e.kind), esc(e.particular), e.credit ? e.credit.toFixed(2) : "", e.debit ? e.debit.toFixed(2) : "", running.toFixed(2), esc(e.reference)].join(","));
    }
    const totalEarned = earnedRows.filter(o => !o.held).reduce((s, r) => s + r.commission, 0);
    const totalPaid = payouts.reduce((s, p) => s + Number(p.amount), 0);
    lines.push("");
    lines.push([esc(""), esc("TOTAL EARNED (payable)"), esc(""), totalEarned.toFixed(2), "", "", ""].join(","));
    lines.push([esc(""), esc("TOTAL PAID"), esc(""), "", totalPaid.toFixed(2), "", ""].join(","));
    lines.push([esc(""), esc("BALANCE DUE"), esc(""), "", "", (totalEarned - totalPaid).toFixed(2), ""].join(","));

    // On-hold commission — excluded from Balance Due, listed with reasons.
    const heldRows = earnedRows.filter(o => o.held);
    if (heldRows.length) {
      const totalHeld = heldRows.reduce((s, r) => s + r.commission, 0);
      lines.push("");
      lines.push([esc(""), esc("ON HOLD — not payable yet"), esc(""), "", "", "", ""].join(","));
      for (const o of heldRows) {
        lines.push([esc(o.date), esc("On Hold"), esc(`Order ${o.orderNumber} — ${o.holdReason ?? "held"}`), o.commission.toFixed(2), "", "", esc(o.orderNumber)].join(","));
      }
      lines.push([esc(""), esc("TOTAL ON HOLD"), esc(""), totalHeld.toFixed(2), "", "", ""].join(","));
    }

    const safeName = doctor.name.replace(/[^a-z0-9]+/gi, "_");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="doctor_ledger_${safeName}_${from ?? "all"}_${to ?? "all"}.csv"`);
    res.send(lines.join("\n"));
  } catch (err) {
    req.log?.error({ err }, "doctor-ledger export failed");
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
