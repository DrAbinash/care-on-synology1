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
} from "@workspace/db/schema";
import { eq, desc, and, gte, lte, inArray, sql } from "drizzle-orm";
import {
  CreateDoctorPayoutBody,
  CreateDoctorPayoutParams,
  DeleteDoctorPayoutParams,
  GetDoctorLedgerDetailParams,
  GetDoctorLedgerDetailQueryParams,
  UpdateDoctorPayoutBody,
  UpdateDoctorPayoutParams,
} from "@workspace/api-zod";

export const doctorLedgerRouter = Router();

// ─── Commission helper (mirrors commission.ts) ────────────────────────────────
type TestInfo = { id: number; name: string; category: string | null; price: number };
type RuleInfo = typeof commissionRulesTable.$inferSelect;
type DoctorInfo = typeof doctorsTable.$inferSelect;

function safeParseArray<T = unknown>(s: string | null | undefined): T[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

function calcTestCommission(
  ot: { id?: number; testId: number; price: string },
  test: TestInfo | undefined,
  rules: RuleInfo[],
  doctor: DoctorInfo,
  vipOrderTestIds?: Set<number>,
  vipPct?: number,
): { commission: number; ruleName: string } {
  let price = Number(ot.price);
  if (ot.id && vipOrderTestIds?.has(ot.id) && vipPct) {
    price = price / (1 + vipPct / 100);
  }
  let matched = rules.find(r => {
    if (!r.isExclusive || !r.isActive) return false;
    if (r.scope === "test" && r.testIds) return safeParseArray<number>(r.testIds).includes(ot.testId);
    if (r.scope === "category" && r.categories && test) return safeParseArray<string>(r.categories).includes(test.category || "");
    return false;
  });
  if (!matched) {
    matched = rules.find(r => {
      if (!r.isActive) return false;
      if (r.scope === "test" && r.testIds) return safeParseArray<number>(r.testIds).includes(ot.testId);
      if (r.scope === "category" && r.categories && test) return safeParseArray<string>(r.categories).includes(test.category || "");
      return false;
    });
  }
  if (!matched) matched = rules.find(r => r.isActive && r.scope === "all");
  if (matched) {
    const val = Number(matched.value);
    return { commission: matched.type === "percentage" ? (price * val) / 100 : val, ruleName: matched.name };
  }
  const defVal = Number(doctor.defaultCommission);
  if (defVal > 0) {
    return { commission: doctor.defaultCommissionType === "percentage" ? (price * defVal) / 100 : defVal, ruleName: "Default" };
  }
  return { commission: 0, ruleName: "None" };
}

// Compute commission earned per doctor over a date range (or lifetime when from/to omitted).
async function computeEarned(opts: { from?: string; to?: string; doctorId?: number }) {
  const [clinicRow] = await db.select({
    vipPercentage: clinicSettingsTable.vipPercentage,
  }).from(clinicSettingsTable).limit(1);
  const vipPct = clinicRow?.vipPercentage ? Number(clinicRow.vipPercentage) : 50.00;

  const doctors = await db.select().from(doctorsTable);
  const allRules = await db.select().from(commissionRulesTable);
  const allTests = await db.select().from(testsTable);
  const testMap = new Map(allTests.map(t => [t.id, { id: t.id, name: t.name, category: t.category, price: Number(t.price) }]));

  const conditions = [];
  if (opts.doctorId) conditions.push(eq(ordersTable.doctorId, opts.doctorId));
  if (opts.from) conditions.push(gte(ordersTable.createdAt, new Date(opts.from)));
  if (opts.to) conditions.push(lte(ordersTable.createdAt, new Date(opts.to + "T23:59:59Z")));

  const orders = await db.select().from(ordersTable).where(conditions.length ? and(...conditions) : undefined);
  const orderIds = orders.map(o => o.id);
  const orderTests = orderIds.length ? await db.select().from(orderTestsTable).where(inArray(orderTestsTable.orderId, orderIds)) : [];

  const tokens = orderIds.length
    ? await db.select({ orderTestId: testTokensTable.orderTestId })
        .from(testTokensTable)
        .where(and(inArray(testTokensTable.orderId, orderIds), sql`${testTokensTable.priority} > 0`))
    : [];
  const vipOrderTestIds = new Set(tokens.map(t => t.orderTestId).filter(Boolean) as number[]);

  const filteredDoctors = opts.doctorId ? doctors.filter(d => d.id === opts.doctorId) : doctors;

  return filteredDoctors.map(doctor => {
    const doctorOrders = orders.filter(o => o.doctorId === doctor.id);
    const rules = allRules.filter(r => r.doctorId === doctor.id);
    let totalRevenue = 0, totalCommission = 0;
    const orderRows: { orderId: number; orderNumber: string; date: string; revenue: number; commission: number; testCount: number }[] = [];
    for (const order of doctorOrders) {
      const tests = orderTests.filter(ot => ot.orderId === order.id);
      let r = 0, c = 0;
      for (const ot of tests) {
        const test = testMap.get(ot.testId);
        const { commission } = calcTestCommission(ot, test, rules, doctor, vipOrderTestIds, vipPct);
        r += Number(ot.price);
        c += commission;
      }
      totalRevenue += r;
      totalCommission += c;
      if (tests.length > 0) {
        orderRows.push({
          orderId: order.id,
          orderNumber: order.orderNumber,
          date: order.createdAt.toISOString().split("T")[0],
          revenue: r,
          commission: c,
          testCount: tests.length,
        });
      }
    }
    return {
      doctor,
      totalRevenue,
      totalCommission,
      orderCount: doctorOrders.length,
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

    // Lifetime earned for each doctor (for outstanding balance even when window is set)
    const lifetimeEarned = (from || to) ? await computeEarned({}) : earnedByDoctor;
    const lifetimeEarnedMap = new Map(lifetimeEarned.map(r => [r.doctor.id, r.totalCommission]));

    const term = (search || "").trim().toLowerCase();

    const rows = earnedByDoctor
      .map(r => {
        const earnedWindow = r.totalCommission;
        const paidW = paidWindow.get(r.doctor.id) ?? 0;
        const earnedLife = lifetimeEarnedMap.get(r.doctor.id) ?? 0;
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
          paidWindow: paidW,
          dueWindow: earnedWindow - paidW,
          earnedLifetime: earnedLife,
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
        paidWindow: acc.paidWindow + r.paidWindow,
        dueWindow: acc.dueWindow + r.dueWindow,
        outstanding: acc.outstanding + r.outstanding,
      }),
      { doctors: 0, earnedWindow: 0, paidWindow: 0, dueWindow: 0, outstanding: 0 },
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
    const totalEarned = earnedReport[0]?.totalCommission ?? 0;
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
      entries.push({
        kind: "earned",
        date: o.date,
        particular: `Commission · Order ${o.orderNumber} (${o.testCount} test${o.testCount === 1 ? "" : "s"})`,
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

    // Lifetime totals (for outstanding regardless of window)
    const lifetimeEarned = (from || to)
      ? (await computeEarned({ doctorId }))[0]?.totalCommission ?? 0
      : totalEarned;
    const lifetimePaidRow = await db
      .select({ total: sql<string>`COALESCE(SUM(${doctorPayoutsTable.amount}), 0)` })
      .from(doctorPayoutsTable)
      .where(eq(doctorPayoutsTable.doctorId, doctorId));
    const lifetimePaid = Number(lifetimePaidRow[0]?.total ?? 0);

    res.json({
      doctor: {
        ...doctor,
        defaultCommission: Number(doctor.defaultCommission),
      },
      window: { from: from ?? null, to: to ?? null },
      summary: {
        totalRevenue,
        totalEarned,
        totalPaid,
        dueWindow: totalEarned - totalPaid,
        lifetimeEarned,
        lifetimePaid,
        outstanding: lifetimeEarned - lifetimePaid,
        orderCount: earnedRows.length,
        payoutCount: payouts.length,
      },
      earnedOrders: earnedRows,
      payouts: payouts.map(p => ({ ...p, amount: Number(p.amount) })),
      ledger,
    });
  } catch (err) {
    req.log?.error({ err }, "doctor-ledger detail failed");
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── POST /:doctorId/payouts : record a new payout ─────────────────────────────
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

    res.status(201).json({ ...row, amount: Number(row.amount) });
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
    res.json({ ok: true });
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
    for (const o of earnedRows) entries.push({ date: o.date, kind: "Commission", particular: `Order ${o.orderNumber} (${o.testCount} tests)`, credit: o.commission, debit: 0, reference: o.orderNumber });
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
    const totalEarned = earnedRows.reduce((s, r) => s + r.commission, 0);
    const totalPaid = payouts.reduce((s, p) => s + Number(p.amount), 0);
    lines.push("");
    lines.push([esc(""), esc("TOTAL EARNED"), esc(""), totalEarned.toFixed(2), "", "", ""].join(","));
    lines.push([esc(""), esc("TOTAL PAID"), esc(""), "", totalPaid.toFixed(2), "", ""].join(","));
    lines.push([esc(""), esc("BALANCE DUE"), esc(""), "", "", (totalEarned - totalPaid).toFixed(2), ""].join(","));

    const safeName = doctor.name.replace(/[^a-z0-9]+/gi, "_");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="doctor_ledger_${safeName}_${from ?? "all"}_${to ?? "all"}.csv"`);
    res.send(lines.join("\n"));
  } catch (err) {
    req.log?.error({ err }, "doctor-ledger export failed");
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
