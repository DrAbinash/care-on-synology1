import { Router } from "express";
import { db, ordersTable, patientsTable, billsTable, paymentsTable, orderTestsTable, testsTable, samplesTable, sampleTestAssignmentsTable } from "@workspace/db";
import { accountsTable, vouchersTable } from "@workspace/db/schema";
import { eq, sql, gte, lte, and, desc, isNotNull, isNull, inArray, type SQL } from "drizzle-orm";
import { z } from "zod/v4";
import { GetRevenueReportQueryParams } from "@workspace/api-zod";

export const reportsRouter = Router();

// ─── Reusable query validation ──────────────────────────────────────────────

// Strict calendar-aware YYYY-MM-DD validator. Rejects both shape mismatches
// (`2026-1-1`) AND values that look right but aren't real dates
// (`2026-13-40`, `2026-02-31`). Without the calendar check `new Date(s)` would
// silently produce Invalid Date and bubble up as a 500 from Drizzle.
const IsoDate = z.string().refine((s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    !Number.isNaN(dt.getTime()) &&
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}, { message: "Invalid date — expected YYYY-MM-DD calendar date" });

const DateRangeQuery = z.object({
  from: IsoDate.optional(),
  to: IsoDate.optional(),
});

const SingleDateQuery = z.object({
  date: IsoDate.optional(),
});

// Resolve from/to into UTC-consistent ISO day strings + Date boundaries.
// Defaults to month-start..today using UTC parts so the range never inverts
// at timezone boundaries. Returns null if from > to.
function resolveDateRange(from: string | undefined, to: string | undefined) {
  const now = new Date();
  const istNow = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const [istY, istM] = istNow.split("-").map(Number);
  const monthStartIso = `${istY}-${String(istM).padStart(2, "0")}-01`;
  const todayIso = istNow;
  const fromIso = from ?? monthStartIso;
  const toIso = to ?? todayIso;
  if (fromIso > toIso) return null;
  return {
    fromIso,
    toIso,
    fromDate: new Date(fromIso + "T00:00:00.000Z"),
    toDate: new Date(toIso + "T23:59:59.999Z"),
  };
}

function formatCurrency(n: number) {
  return `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n)}`;
}

function buildReportHtml(title: string, subtitle: string, rows: { label: string; value: string }[], signatureName = "Authorized Signature") {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
    <style>
      @page { size: A4; margin: 12mm; }
      body { font-family: Arial, sans-serif; color:#000; margin:0; }
      .hdr { text-align:center; border-bottom:2px solid #000; padding-bottom:8px; margin-bottom:12px; }
      .title { font-size:18px; font-weight:700; }
      .sub { font-size:11px; color:#555; }
      .rows { width:100%; border-collapse:collapse; }
      .rows td { padding:6px 0; font-size:12px; }
      .rows td:last-child { text-align:right; font-weight:700; }
      .sig { margin-top:28px; display:flex; justify-content:space-between; }
      .sig div { width:45%; border-top:1px solid #000; padding-top:6px; text-align:center; font-size:11px; }
      .ftr { margin-top:18px; font-size:10px; color:#555; text-align:center; border-top:1px solid #bbb; padding-top:8px; }
    </style></head><body>
      <div class="hdr">
        <div class="title">Diagnostic Centre</div>
        <div>${title}</div>
        <div class="sub">${subtitle}</div>
      </div>
      <table class="rows">${rows.map((r) => `<tr><td>${r.label}</td><td>${r.value}</td></tr>`).join("")}</table>
      <div class="sig"><div>${signatureName}</div><div>Admin Signature</div></div>
      <div class="ftr">Generated on ${new Date().toLocaleString("en-IN")}</div>
      <script>window.onload = () => { window.print(); setTimeout(() => window.close(), 300); };</script>
    </body></html>`;
}

reportsRouter.get("/dashboard", async (_req, res) => {
  // Use IST-aware day boundaries so "today" counts are correct regardless of
  // the server's timezone (UTC). Without this fix bills created after 18:30 UTC
  // (= midnight IST) were counted as "tomorrow" and todayBills showed 0.
  const todayISTStr = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const [istY, istM] = todayISTStr.split("-").map(Number);
  const today = new Date(`${todayISTStr}T00:00:00+05:30`);
  const endOfDay = new Date(`${todayISTStr}T23:59:59.999+05:30`);
  const startOfMonth = new Date(`${istY}-${String(istM).padStart(2, "0")}-01T00:00:00+05:30`);
  const startOfTodayIso = today.toISOString();
  const endOfTodayIso = endOfDay.toISOString();

  const [
    totalPatients,
    todayOrders,
    pendingOrders,
    todayRevenue,
    allRevenue,
    monthRevenue,
    pendingPayments,
    todayPendingPayments,
    completedTests,
    ordersByStatus,
    totalBills,
    todayBills,
    referralOrders,
    pendingReports,
    overdueAlerts,
    recentBills,
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(patientsTable),
    db.select({ count: sql<number>`count(*)` }).from(ordersTable).where(and(gte(ordersTable.createdAt, today), lte(ordersTable.createdAt, endOfDay))),
    db.select({ count: sql<number>`count(*)` }).from(ordersTable).where(eq(ordersTable.status, "pending")),
    db.select({ sum: sql<number>`coalesce(sum(amount), 0)` }).from(paymentsTable).where(and(gte(paymentsTable.createdAt, today), lte(paymentsTable.createdAt, endOfDay))),
    db.select({ sum: sql<number>`coalesce(sum(amount), 0)` }).from(paymentsTable),
    db.select({ sum: sql<number>`coalesce(sum(amount), 0)` }).from(paymentsTable).where(gte(paymentsTable.createdAt, startOfMonth)),
    db.select({ sum: sql<number>`coalesce(sum(balance_amount), 0)` }).from(billsTable).where(sql`status IN ('pending','partial')`),
    db.select({ sum: sql<number>`coalesce(sum(balance_amount), 0)` }).from(billsTable).where(and(sql`status IN ('pending','partial')`, gte(billsTable.createdAt, today), lte(billsTable.createdAt, endOfDay))),
    db.select({ count: sql<number>`count(*)` }).from(ordersTable).where(eq(ordersTable.status, "completed")),
    db.select({ status: ordersTable.status, count: sql<number>`count(*)` }).from(ordersTable).groupBy(ordersTable.status),
    db.select({ count: sql<number>`count(*)` }).from(billsTable),
    db.select({ count: sql<number>`count(*)` }).from(billsTable).where(and(gte(billsTable.createdAt, today), lte(billsTable.createdAt, endOfDay))),
    db.select({ sum: sql<number>`coalesce(sum(o.total_amount), 0)` })
      .from(sql`orders o`)
      .where(sql`o.doctor_id IS NOT NULL`),
    db.select({ count: sql<number>`count(*)` }).from(ordersTable).where(sql`status IN ('pending','collected','processing')`),
    db.select({
      billNumber: billsTable.billNumber,
      balanceAmount: billsTable.balanceAmount,
      dueDate: billsTable.dueDate,
      patientId: billsTable.patientId,
    })
      .from(billsTable)
      .where(and(sql`status IN ('pending','partial')`, sql`balance_amount > 0`))
      .orderBy(desc(billsTable.balanceAmount))
      .limit(5),
    db.select({
      id: billsTable.id,
      billNumber: billsTable.billNumber,
      totalAmount: billsTable.totalAmount,
      paidAmount: billsTable.paidAmount,
      balanceAmount: billsTable.balanceAmount,
      status: billsTable.status,
      createdAt: billsTable.createdAt,
      patientFirstName: patientsTable.firstName,
      patientLastName: patientsTable.lastName,
      patientId: patientsTable.patientId,
    })
      .from(billsTable)
      .leftJoin(patientsTable, eq(billsTable.patientId, patientsTable.id))
      .orderBy(desc(billsTable.createdAt))
      .limit(8),
  ]);

  res.json({
    totalPatients: Number(totalPatients[0]?.count ?? 0),
    todayOrders: Number(todayOrders[0]?.count ?? 0),
    pendingOrders: Number(pendingOrders[0]?.count ?? 0),
    todayRevenue: Number(todayRevenue[0]?.sum ?? 0),
    allRevenue: Number(allRevenue[0]?.sum ?? 0),
    monthRevenue: Number(monthRevenue[0]?.sum ?? 0),
    pendingPayments: Number(pendingPayments[0]?.sum ?? 0),
    todayPendingPayments: Number(todayPendingPayments[0]?.sum ?? 0),
    completedTests: Number(completedTests[0]?.count ?? 0),
    ordersByStatus: ordersByStatus.map((row) => ({ status: row.status, count: Number(row.count) })),
    totalBills: Number(totalBills[0]?.count ?? 0),
    todayBills: Number(todayBills[0]?.count ?? 0),
    referralPayouts: Number(referralOrders[0]?.sum ?? 0),
    pendingReports: Number(pendingReports[0]?.count ?? 0),
    overdueAlerts: overdueAlerts.map((a) => ({
      billNumber: a.billNumber,
      balanceAmount: Number(a.balanceAmount),
      dueDate: a.dueDate,
    })),
    recentBills: recentBills.map((b) => ({
      id: b.id,
      billNumber: b.billNumber,
      totalAmount: Number(b.totalAmount),
      paidAmount: Number(b.paidAmount),
      balanceAmount: Number(b.balanceAmount),
      status: b.status,
      createdAt: b.createdAt?.toISOString() ?? "",
      patientName: b.patientFirstName ? `${b.patientFirstName} ${b.patientLastName}` : "Unknown",
      patientCode: b.patientId ?? "",
    })),
  });
});

reportsRouter.get("/revenue", async (req, res) => {
  const parsed = GetRevenueReportQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }
  const period = parsed.data.period ?? "monthly";

  let groupBy: string;
  let labelFormat: string;
  let limit: number;

  if (period === "daily") {
    groupBy = "DATE(created_at AT TIME ZONE 'UTC')";
    labelFormat = "YYYY-MM-DD";
    limit = 30;
  } else if (period === "weekly") {
    groupBy = "DATE_TRUNC('week', created_at AT TIME ZONE 'UTC')";
    labelFormat = "YYYY-\"W\"IW";
    limit = 12;
  } else {
    groupBy = "DATE_TRUNC('month', created_at AT TIME ZONE 'UTC')";
    labelFormat = "Mon YYYY";
    limit = 12;
  }

  const rows = await db.execute(sql`
    SELECT
      TO_CHAR(${sql.raw(groupBy)}, ${labelFormat}) as label,
      COALESCE(SUM(amount), 0) as revenue,
      COUNT(*) as orders
    FROM payments
    GROUP BY ${sql.raw(groupBy)}
    ORDER BY ${sql.raw(groupBy)} DESC
    LIMIT ${limit}
  `);

  const data = (rows.rows as { label: string; revenue: string; orders: string }[]).reverse().map((row) => ({
    label: row.label,
    revenue: Number(row.revenue),
    orders: Number(row.orders),
  }));

  const totalRevenue = data.reduce((sum, d) => sum + d.revenue, 0);
  const totalOrders = data.reduce((sum, d) => sum + d.orders, 0);

  res.json({ period, data, totalRevenue, totalOrders });
});

reportsRouter.get("/popular-tests", async (_req, res) => {
  const rows = await db
    .select({
      testId: testsTable.id,
      testName: testsTable.name,
      testCode: testsTable.code,
      category: testsTable.category,
      orderCount: sql<number>`count(${orderTestsTable.id})`,
      revenue: sql<number>`coalesce(sum(${orderTestsTable.price}), 0)`,
    })
    .from(orderTestsTable)
    .leftJoin(testsTable, eq(orderTestsTable.testId, testsTable.id))
    .groupBy(testsTable.id, testsTable.name, testsTable.code, testsTable.category)
    .orderBy(sql`count(${orderTestsTable.id}) DESC`)
    .limit(10);

  res.json({
    tests: rows.map((r) => ({
      testId: r.testId ?? 0,
      testName: r.testName ?? "",
      testCode: r.testCode ?? "",
      category: r.category ?? "",
      orderCount: Number(r.orderCount),
      revenue: Number(r.revenue),
    })),
  });
});

reportsRouter.get("/recent-activity", async (_req, res) => {
  const recentOrders = await db
    .select({ order: ordersTable, patient: patientsTable })
    .from(ordersTable)
    .leftJoin(patientsTable, eq(ordersTable.patientId, patientsTable.id))
    .orderBy(desc(ordersTable.createdAt))
    .limit(5);

  const recentPayments = await db
    .select({ payment: paymentsTable, bill: billsTable, patient: patientsTable })
    .from(paymentsTable)
    .leftJoin(billsTable, eq(paymentsTable.billId, billsTable.id))
    .leftJoin(patientsTable, eq(billsTable.patientId, patientsTable.id))
    .orderBy(desc(paymentsTable.createdAt))
    .limit(5);

  const recentPatients = await db
    .select()
    .from(patientsTable)
    .orderBy(desc(patientsTable.createdAt))
    .limit(3);

  const activities = [
    ...recentOrders.map((r) => ({
      id: `order-${r.order.id}`,
      type: r.order.status === "completed" ? "order_completed" : "order_created",
      description: r.order.status === "completed" ? `Order ${r.order.orderNumber} completed` : `New order ${r.order.orderNumber} created`,
      patientName: r.patient ? `${r.patient.firstName} ${r.patient.lastName}` : "Unknown",
      amount: Number(r.order.totalAmount),
      createdAt: r.order.createdAt.toISOString(),
    })),
    ...recentPayments.map((r) => ({
      id: `payment-${r.payment.id}`,
      type: "payment_received",
      description: `Payment of ₹${Number(r.payment.amount).toFixed(2)} received`,
      patientName: r.patient ? `${r.patient.firstName} ${r.patient.lastName}` : "Unknown",
      amount: Number(r.payment.amount),
      createdAt: r.payment.createdAt.toISOString(),
    })),
    ...recentPatients.map((p) => ({
      id: `patient-${p.id}`,
      type: "patient_registered",
      description: `New patient ${p.firstName} ${p.lastName} registered`,
      patientName: `${p.firstName} ${p.lastName}`,
      amount: null,
      createdAt: p.createdAt.toISOString(),
    })),
  ]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 10);

  res.json({ activities });
});

// Income / Expense daily breakdown  ─────────────────────────────────────────
reportsRouter.get("/income-expense", async (req, res) => {
  const q = DateRangeQuery.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: "Invalid request", details: q.error.issues }); return; }
  const range = resolveDateRange(q.data.from, q.data.to);
  if (!range) { res.status(400).json({ error: "Invalid range: 'from' must be on or before 'to'" }); return; }
  const { fromIso, toIso, fromDate, toDate } = range;

  // Payments received (income by day + method)
  const payments = await db.select().from(paymentsTable)
    .where(and(gte(paymentsTable.createdAt, fromDate), lte(paymentsTable.createdAt, toDate)));

  // Vouchers that are expenses — vouchers.date is stored as text (YYYY-MM-DD),
  // so compare against ISO strings, not Date objects.
  const rawVouchers = await db.select().from(vouchersTable)
    .where(and(gte(vouchersTable.date, fromIso), lte(vouchersTable.date, toIso)));
  const allAccounts = rawVouchers.length
    ? await db.select().from(accountsTable)
    : [];
  const accountMap = new Map(allAccounts.map(a => [String(a.id), a]));
  const vouchers = rawVouchers.map(v => ({ v, a: accountMap.get(v.debitAccountId) ?? null }));

  // Group payments by date
  const incomeByDay: Record<string, { date: string; cash: number; upi: number; card: number; bank: number; insurance: number; cheque: number; total: number }> = {};
  for (const p of payments) {
    const day = p.createdAt.toISOString().split("T")[0];
    if (!incomeByDay[day]) incomeByDay[day] = { date: day, cash: 0, upi: 0, card: 0, bank: 0, insurance: 0, cheque: 0, total: 0 };
    const method = (p.method || "cash") as string;
    const amt = Number(p.amount);
    const m = incomeByDay[day];
    if (method === "cash") m.cash += amt;
    else if (method === "upi") m.upi += amt;
    else if (method === "card" || method === "credit_card" || method === "debit_card") m.card += amt;
    else if (method === "bank_transfer" || method === "neft" || method === "rtgs" || method === "imps") m.bank += amt;
    else if (method === "insurance") m.insurance += amt;
    else if (method === "cheque") m.cheque += amt;
    m.total += amt;
  }

  // Expense vouchers by day (payments / purchase vouchers)
  const expenseByDay: Record<string, { date: string; amount: number; count: number }> = {};
  for (const row of vouchers) {
    if (!row.v || !["payment","purchase"].includes(row.v.type)) continue;
    const acc = row.a;
    if (!acc) continue;
    const isExpense = acc.tallyGroup && ["Direct Expenses","Indirect Expenses","Purchase Accounts"].some(g => acc.tallyGroup?.includes(g));
    if (!isExpense && acc.type !== "expense") continue;
    const day = row.v.date;
    if (!expenseByDay[day]) expenseByDay[day] = { date: day, amount: 0, count: 0 };
    expenseByDay[day].amount += Number(row.v.amount);
    expenseByDay[day].count++;
  }

  const allDays = [...new Set([...Object.keys(incomeByDay), ...Object.keys(expenseByDay)])].sort();
  const rows = allDays.map(day => ({
    date: day,
    income: incomeByDay[day] ?? { date: day, cash: 0, upi: 0, card: 0, bank: 0, insurance: 0, cheque: 0, total: 0 },
    expense: expenseByDay[day] ?? { date: day, amount: 0, count: 0 },
    net: (incomeByDay[day]?.total ?? 0) - (expenseByDay[day]?.amount ?? 0),
  }));

  const totals = {
    income: rows.reduce((s, r) => s + r.income.total, 0),
    expense: rows.reduce((s, r) => s + r.expense.amount, 0),
    net: rows.reduce((s, r) => s + r.net, 0),
    cash: rows.reduce((s, r) => s + r.income.cash, 0),
    upi: rows.reduce((s, r) => s + r.income.upi, 0),
    card: rows.reduce((s, r) => s + r.income.card, 0),
    bank: rows.reduce((s, r) => s + r.income.bank, 0),
    insurance: rows.reduce((s, r) => s + r.income.insurance, 0),
    cheque: rows.reduce((s, r) => s + r.income.cheque, 0),
  };

  // ── User-wise income breakdown ───────────────────────────────────────────
  // Aggregate every payment in the date range by `recorded_by_name`. Vouchers
  // (expenses) don't store a user, so this section is income-only.
  type UserIncome = {
    userName: string;
    count: number;
    total: number;
    cash: number; upi: number; card: number; bank: number; insurance: number; cheque: number;
  };
  const incomeByUser = new Map<string, UserIncome>();
  for (const p of payments) {
    const key = (p.recordedByName && p.recordedByName.trim()) || (p.referenceNumber && p.referenceNumber.trim()) || "Unknown User";
    let u = incomeByUser.get(key);
    if (!u) {
      u = { userName: key, count: 0, total: 0, cash: 0, upi: 0, card: 0, bank: 0, insurance: 0, cheque: 0 };
      incomeByUser.set(key, u);
    }
    const amt = Number(p.amount);
    const method = (p.method || "cash") as string;
    u.count += 1;
    u.total += amt;
    if (method === "cash") u.cash += amt;
    else if (method === "upi") u.upi += amt;
    else if (method === "card" || method === "credit_card" || method === "debit_card") u.card += amt;
    else if (method === "bank_transfer" || method === "neft" || method === "rtgs" || method === "imps") u.bank += amt;
    else if (method === "insurance") u.insurance += amt;
    else if (method === "cheque") u.cheque += amt;
  }
  const byUser = Array.from(incomeByUser.values()).sort((a, b) => b.total - a.total);

  res.json({ rows, totals, byUser });
});

// Payment method summary  ─────────────────────────────────────────────────────
reportsRouter.get("/payment-methods", async (req, res) => {
  const q = DateRangeQuery.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: "Invalid request", details: q.error.issues }); return; }
  const range = resolveDateRange(q.data.from, q.data.to);
  if (!range) { res.status(400).json({ error: "Invalid range: 'from' must be on or before 'to'" }); return; }
  const { fromDate, toDate } = range;

  const payments = await db.select({
    payment: paymentsTable, bill: billsTable, patient: patientsTable,
  })
    .from(paymentsTable)
    .leftJoin(billsTable, eq(paymentsTable.billId, billsTable.id))
    .leftJoin(patientsTable, eq(billsTable.patientId, patientsTable.id))
    .where(and(gte(paymentsTable.createdAt, fromDate), lte(paymentsTable.createdAt, toDate)))
    .orderBy(desc(paymentsTable.createdAt));

  const byMethod: Record<string, { method: string; count: number; total: number; transactions: typeof payments }> = {};
  for (const row of payments) {
    const method = row.payment.method || "cash";
    if (!byMethod[method]) byMethod[method] = { method, count: 0, total: 0, transactions: [] };
    byMethod[method].count++;
    byMethod[method].total += Number(row.payment.amount);
    byMethod[method].transactions.push(row);
  }

  const methods = Object.values(byMethod).sort((a, b) => b.total - a.total);
  const grandTotal = methods.reduce((s, m) => s + m.total, 0);

  res.json({
    methods: methods.map(m => ({
      method: m.method,
      count: m.count,
      total: m.total,
      percentage: grandTotal > 0 ? Number(((m.total / grandTotal) * 100).toFixed(1)) : 0,
      transactions: m.transactions.map(r => ({
        id: r.payment.id,
        date: r.payment.createdAt.toISOString().split("T")[0],
        time: r.payment.createdAt.toTimeString().slice(0,5),
        amount: Number(r.payment.amount),
        billNumber: (r.bill as { billNumber?: string } | null)?.billNumber ?? "",
        patientName: r.patient ? `${r.patient.firstName} ${r.patient.lastName}` : "Unknown",
        reference: r.payment.referenceNumber ?? "",
      })),
    })),
    grandTotal,
  });
});

// IST-aware date boundaries helper.
// Bills are created with server-local timestamps. Replit servers run in UTC,
// but the clinic operates in IST (UTC+5:30). Without this correction, a query
// for "2026-05-11" would use UTC midnight boundaries and miss all bills
// created between IST 00:00–05:30 (which are UTC May 10 18:30–May 11 00:00).
function istDayBounds(dateIso: string): { fromDate: Date; toDate: Date } {
  return {
    fromDate: new Date(`${dateIso}T00:00:00+05:30`),
    toDate:   new Date(`${dateIso}T23:59:59.999+05:30`),
  };
}

// Daily full summary (single date) ────────────────────────────────────────────
reportsRouter.get("/daily-summary", async (req, res) => {
  const q = SingleDateQuery.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: "Invalid request", details: q.error.issues }); return; }
  const date = q.data.date || new Date().toISOString().split("T")[0];
  const { fromDate, toDate } = istDayBounds(date);

  const [bills, payments, orders, expenseVouchers] = await Promise.all([
    db.select({ b: billsTable, p: patientsTable })
      .from(billsTable)
      .leftJoin(patientsTable, eq(billsTable.patientId, patientsTable.id))
      .where(and(gte(billsTable.createdAt, fromDate), lte(billsTable.createdAt, toDate)))
      .orderBy(desc(billsTable.createdAt)),
    db.select().from(paymentsTable)
      .where(and(gte(paymentsTable.createdAt, fromDate), lte(paymentsTable.createdAt, toDate))),
    db.select().from(ordersTable)
      .where(and(gte(ordersTable.createdAt, fromDate), lte(ordersTable.createdAt, toDate))),
    db.select({ v: vouchersTable, a: accountsTable })
      .from(vouchersTable)
      .leftJoin(accountsTable, sql`${vouchersTable.debitAccountId}::integer = ${accountsTable.id}`)
      .where(and(gte(vouchersTable.date, date), lte(vouchersTable.date, date))),
  ]);

  const activeBills = bills.filter((r) => r.b.status !== "cancelled");
  const totalBilled   = activeBills.reduce((s, r) => s + Number(r.b.totalAmount), 0);
  const totalReceived = payments.reduce((s, p) => s + Number(p.amount), 0);
  const outstanding   = Math.max(0, totalBilled - totalReceived);

  const byMethod: Record<string, number> = {};
  for (const p of payments) {
    const m = p.method || "cash";
    byMethod[m] = (byMethod[m] || 0) + Number(p.amount);
  }

  const billsByStatus = {
    paid:     activeBills.filter(r => r.b.status === "paid").length,
    partial:  activeBills.filter(r => r.b.status === "partial").length,
    pending:  activeBills.filter(r => r.b.status === "pending").length,
    cancelled:bills.filter(r => r.b.status === "cancelled").length,
  };

  // ── User-wise breakdown ────────────────────────────────────────────────
  // Group bills by `created_by_name` (the staff who issued the bill) and
  // payments by `recorded_by_name` (the staff who collected the payment).
  // The two sets are merged on user name so a single staff row shows
  // BOTH how many bills they raised and how much cash/UPI they took in.
  type UserAgg = {
    userName: string;
    billCount: number;
    billed: number;
    received: number;
    methods: Record<string, number>;
  };
  const byUserMap = new Map<string, UserAgg>();
  const ensureUser = (name: string | null | undefined): UserAgg => {
    const key = (name && name.trim()) || "Unknown User";
    let row = byUserMap.get(key);
    if (!row) {
      row = { userName: key, billCount: 0, billed: 0, received: 0, methods: {} };
      byUserMap.set(key, row);
    }
    return row;
  };
  for (const r of activeBills) {
    const fallbackName = payments.find((p) => p.billId === r.b.id)?.recordedByName ?? null;
    const u = ensureUser(r.b.createdByName ?? fallbackName);
    u.billCount += 1;
    u.billed   += Number(r.b.totalAmount);
  }
  for (const p of payments) {
    // Fall back to the bill's creator when the payment has no recorder name.
    const recorder =
      (p.recordedByName && p.recordedByName.trim())
        ? p.recordedByName
        : (activeBills.find((r) => r.b.id === p.billId)?.b.createdByName ?? null);
    const u = ensureUser(recorder);
    const amt = Number(p.amount);
    u.received += amt;
    const m = p.method || "cash";
    u.methods[m] = (u.methods[m] || 0) + amt;
  }
  const byUser = Array.from(byUserMap.values()).sort((a, b) => b.received - a.received);

  const totalExpense = expenseVouchers
    .filter(({ a }) => a?.type === "expense")
    .reduce((s, { v }) => s + Number(v.amount), 0);
  const grandTotal = totalReceived - totalExpense;

  res.json({
    date,
    summary: { totalBilled, totalReceived, outstanding, billCount: activeBills.length, orderCount: orders.length },
    byMethod,
    billsByStatus,
    byUser,
    totalExpense,
    grandTotal,
    bills: bills.map(r => ({
      id: r.b.id,
      billNumber: r.b.billNumber,
      patientName: r.p ? `${r.p.firstName} ${r.p.lastName}` : "Unknown",
      totalAmount: Number(r.b.totalAmount),
      paidAmount: Number(r.b.paidAmount),
      status: r.b.status,
      createdAt: r.b.createdAt.toISOString(),
      createdByName: r.b.createdByName ?? "",
    })),
  });
});

reportsRouter.get("/daily-summary/pdf", async (req, res) => {
  const q = SingleDateQuery.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: "Invalid request", details: q.error.issues }); return; }
  const date = q.data.date || new Date().toISOString().split("T")[0];
  const { fromDate, toDate } = istDayBounds(date);

  const [bills, payments] = await Promise.all([
    db.select({ b: billsTable }).from(billsTable).where(and(gte(billsTable.createdAt, fromDate), lte(billsTable.createdAt, toDate))),
    db.select().from(paymentsTable).where(and(gte(paymentsTable.createdAt, fromDate), lte(paymentsTable.createdAt, toDate))),
  ]);

  const activeBills = bills.filter((r) => r.b.status !== "cancelled");
  const totalBilled = activeBills.reduce((s, r) => s + Number(r.b.totalAmount), 0);
  const totalReceived = payments.reduce((s, p) => s + Number(p.amount), 0);
  const outstanding = Math.max(0, totalBilled - totalReceived);
  const paidBills = activeBills.filter((r) => r.b.status === "paid").length;
  const partialBills = activeBills.filter((r) => r.b.status === "partial").length;
  const pendingBills = activeBills.filter((r) => r.b.status === "pending").length;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(buildReportHtml(
    `Daily Report ${date}`,
    `Date: ${date}`,
    [
      { label: "Total Billed", value: formatCurrency(totalBilled) },
      { label: "Total Received", value: formatCurrency(totalReceived) },
      { label: "Outstanding", value: formatCurrency(outstanding) },
      { label: "Bills Created", value: String(bills.length) },
      { label: "Paid / Partial / Pending", value: `${paidBills} / ${partialBills} / ${pendingBills}` },
    ],
    "Prepared By Accounts / Admin",
  ));
});

reportsRouter.get("/outsourced-cost", async (req, res) => {
  const q = DateRangeQuery.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: "Invalid request", details: q.error.issues }); return; }
  const range = resolveDateRange(q.data.from, q.data.to);
  if (!range) { res.status(400).json({ error: "Invalid range: 'from' must be on or before 'to'" }); return; }
  const { fromDate, toDate } = range;
  const labFilter = req.query.lab ? String(req.query.lab).trim() : undefined;
  const statusFilter = req.query.status ? String(req.query.status).trim() : undefined;

  const conds: SQL[] = [isNotNull(samplesTable.outsourceSentAt)];
  if (fromDate) conds.push(gte(samplesTable.outsourceSentAt, fromDate));
  if (toDate) conds.push(lte(samplesTable.outsourceSentAt, toDate));
  if (labFilter) conds.push(eq(samplesTable.outsourceLab, labFilter));
  if (statusFilter === "sent") conds.push(isNull(samplesTable.outsourceReceivedAt));
  if (statusFilter === "received") conds.push(isNotNull(samplesTable.outsourceReceivedAt));

  const rows = await db
    .select()
    .from(samplesTable)
    .where(and(...conds))
    .orderBy(desc(samplesTable.outsourceSentAt));

  const sampleIds = rows.map((r) => r.id);
  const assignRows = sampleIds.length > 0
    ? await db.select().from(sampleTestAssignmentsTable).where(inArray(sampleTestAssignmentsTable.sampleId, sampleIds))
    : [];
  const orderTestIds = [...new Set(assignRows.map((a) => a.orderTestId))];
  const orderTestRows = orderTestIds.length > 0
    ? await db.select({ id: orderTestsTable.id, testId: orderTestsTable.testId }).from(orderTestsTable).where(inArray(orderTestsTable.id, orderTestIds))
    : [];
  const testIds = [...new Set(orderTestRows.map((r) => r.testId))];
  const testRows = testIds.length > 0
    ? await db.select({ id: testsTable.id, name: testsTable.name, code: testsTable.code }).from(testsTable).where(inArray(testsTable.id, testIds))
    : [];

  const testMap = new Map(testRows.map((t) => [t.id, t]));
  const otTestMap = new Map(orderTestRows.map((r) => [r.id, r.testId]));
  const assignsBySample = new Map<number, number[]>();
  for (const a of assignRows) {
    const list = assignsBySample.get(a.sampleId) ?? [];
    list.push(a.orderTestId);
    assignsBySample.set(a.sampleId, list);
  }

  const mappedRows = rows.map((r) => {
    const otIds = assignsBySample.get(r.id) ?? [];
    const tests = otIds.map((otId) => {
      const testId = otTestMap.get(otId);
      const test = testId ? testMap.get(testId) : undefined;
      return { name: test?.name ?? "Unknown", code: test?.code ?? "" };
    });
    return {
      sampleId: r.id,
      barcode: r.barcode,
      status: r.status,
      outsourceLab: r.outsourceLab,
      outsourceSentAt: r.outsourceSentAt,
      outsourceReceivedAt: r.outsourceReceivedAt,
      outsourceCostAmount: r.outsourceCostAmount,
      outsourceCostOverride: r.outsourceCostOverride,
      outsourcePatientBill: r.outsourcePatientBill,
      outsourceMargin: r.outsourceMargin,
      tests,
    };
  });

  res.json({ rows: mappedRows });
});

reportsRouter.get("/outsourced", async (req, res) => {
  const q = DateRangeQuery.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: "Invalid request", details: q.error.issues }); return; }
  const range = resolveDateRange(q.data.from, q.data.to);
  if (!range) { res.status(400).json({ error: "Invalid range: 'from' must be on or before 'to'" }); return; }
  const { fromDate, toDate } = range;
  const conds = [isNotNull(samplesTable.outsourceSentAt)];
  if (fromDate) conds.push(gte(samplesTable.outsourceSentAt, fromDate));
  if (toDate) conds.push(lte(samplesTable.outsourceSentAt, toDate));

  const rows = await db
    .select({
      id: samplesTable.id,
      barcode: samplesTable.barcode,
      sampleType: samplesTable.sampleType,
      status: samplesTable.status,
      outsourceLab: samplesTable.outsourceLab,
      outsourceSentAt: samplesTable.outsourceSentAt,
      outsourceExpectedAt: samplesTable.outsourceExpectedAt,
      outsourceReceivedAt: samplesTable.outsourceReceivedAt,
      outsourceTrackingId: samplesTable.outsourceTrackingId,
      orderId: samplesTable.orderId,
      patientId: samplesTable.patientId,
    })
    .from(samplesTable)
    .where(and(...conds))
    .orderBy(desc(samplesTable.outsourceSentAt));

  const patientIds = [...new Set(rows.map((r) => r.patientId))];
  const orderIds = [...new Set(rows.map((r) => r.orderId))];

  const patients = patientIds.length > 0
    ? await db.select({ id: patientsTable.id, firstName: patientsTable.firstName, lastName: patientsTable.lastName })
        .from(patientsTable).where(sql`${patientsTable.id} = ANY(${patientIds})`)
    : [];
  const orders = orderIds.length > 0
    ? await db.select({ id: ordersTable.id, orderNumber: ordersTable.orderNumber })
        .from(ordersTable).where(sql`${ordersTable.id} = ANY(${orderIds})`)
    : [];

  const patientMap = new Map(patients.map((p) => [p.id, `${p.firstName} ${p.lastName}`]));
  const orderMap = new Map(orders.map((o) => [o.id, o.orderNumber]));

  const byLab: Record<string, { sent: number; received: number; pending: number }> = {};
  for (const r of rows) {
    const lab = r.outsourceLab ?? "Unknown";
    if (!byLab[lab]) byLab[lab] = { sent: 0, received: 0, pending: 0 };
    byLab[lab].sent++;
    if (r.outsourceReceivedAt) byLab[lab].received++;
    else byLab[lab].pending++;
  }

  const mappedRows = rows.map((r) => ({
    id: r.id,
    barcode: r.barcode,
    sampleType: r.sampleType,
    status: r.status,
    outsourceLab: r.outsourceLab,
    outsourceSentAt: r.outsourceSentAt?.toISOString() ?? null,
    outsourceExpectedAt: r.outsourceExpectedAt,
    outsourceReceivedAt: r.outsourceReceivedAt?.toISOString() ?? null,
    outsourceTrackingId: r.outsourceTrackingId,
    patientName: patientMap.get(r.patientId) ?? "—",
    orderNumber: orderMap.get(r.orderId) ?? "—",
    tests: [] as Array<{ testName: string; testCode: string }>,
  }));

  res.json({ rows: mappedRows, byLab });
});
