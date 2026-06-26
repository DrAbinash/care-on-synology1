import { Router } from "express";
import { db } from "@workspace/db";
import {
  commissionRulesTable,
  clinicSettingsTable,
  doctorsTable,
  orderTestsTable,
  ordersTable,
  testsTable,
  billsTable,
  patientsTable,
  testTokensTable,
} from "@workspace/db/schema";
import { eq, desc, and, gte, lte, inArray, ne, sql } from "drizzle-orm";
import {
  CreateCommissionRuleBody,
  UpdateCommissionRuleBody,
  UpdateCommissionRuleParams,
  DeleteCommissionRuleParams,
} from "@workspace/api-zod";

const router = Router();

// List commission rules (optionally filtered by doctorId)
router.get("/rules", async (req, res) => {
  const { doctorId } = req.query as Record<string, string>;
  const conditions = doctorId ? [eq(commissionRulesTable.doctorId, Number(doctorId))] : [];
  const rows = await db
    .select()
    .from(commissionRulesTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(commissionRulesTable.createdAt));
  res.json(rows.map(r => ({
    ...r,
    value: Number(r.value),
    categories: r.categories ? JSON.parse(r.categories) : [],
    testIds: r.testIds ? JSON.parse(r.testIds) : [],
  })));
});

// Create rule
router.post("/rules", async (req, res) => {
  const parsed = CreateCommissionRuleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }
  const { doctorId, name, type, value, scope, categories, testIds, isExclusive } = parsed.data;
  if (doctorId == null) {
    res.status(400).json({ error: "doctorId is required" });
    return;
  }
  const [rule] = await db
    .insert(commissionRulesTable)
    .values({
      doctorId,
      name,
      type,
      value: value.toString(),
      scope,
      categories: categories ? JSON.stringify(categories) : null,
      testIds: testIds ? JSON.stringify(testIds) : null,
      isExclusive: isExclusive ?? false,
    })
    .returning();
  res.status(201).json({ ...rule, value: Number(rule.value) });
});

// Update rule (partial)
const UpdateCommissionRuleBodyPartial = UpdateCommissionRuleBody.partial();
router.patch("/rules/:id", async (req, res) => {
  const paramsParsed = UpdateCommissionRuleParams.safeParse({ id: req.params.id });
  const bodyParsed = UpdateCommissionRuleBodyPartial.safeParse(req.body);
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
  if (data.name !== undefined) updates.name = data.name;
  if (data.type !== undefined) updates.type = data.type;
  if (data.value !== undefined) updates.value = data.value.toString();
  if (data.scope !== undefined) updates.scope = data.scope;
  if (data.categories !== undefined) updates.categories = data.categories ? JSON.stringify(data.categories) : null;
  if (data.testIds !== undefined) updates.testIds = data.testIds ? JSON.stringify(data.testIds) : null;
  if (data.doctorId != null) updates.doctorId = data.doctorId;
  if (data.isExclusive !== undefined) updates.isExclusive = data.isExclusive;
  // isActive is not part of the OpenAPI body schema; accept it directly when provided
  if (typeof req.body?.isActive === "boolean") updates.isActive = req.body.isActive;
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }
  const [rule] = await db.update(commissionRulesTable).set(updates).where(eq(commissionRulesTable.id, id)).returning();
  if (!rule) {
    res.status(404).json({ error: "Rule not found" });
    return;
  }
  res.json({ ...rule, value: Number(rule.value) });
});

// Delete rule
router.delete("/rules/:id", async (req, res) => {
  const parsed = DeleteCommissionRuleParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid id", details: parsed.error.issues });
    return;
  }
  await db.delete(commissionRulesTable).where(eq(commissionRulesTable.id, parsed.data.id));
  res.json({ ok: true });
});

// ─── Commission calculation helper ────────────────────────────────────────────
type TestInfo = { id: number; name: string; category: string | null; price: number };
type RuleInfo = typeof import("@workspace/db/schema").commissionRulesTable.$inferSelect;
type DoctorInfo = typeof import("@workspace/db/schema").doctorsTable.$inferSelect;

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

  // 1) Exclusive rules first (test-scoped then category-scoped)
  let matched = rules.find(r => {
    if (!r.isExclusive || !r.isActive) return false;
    if (r.scope === "test" && r.testIds) return (JSON.parse(r.testIds) as number[]).includes(ot.testId);
    if (r.scope === "category" && r.categories && test) return (JSON.parse(r.categories) as string[]).includes(test.category || "");
    return false;
  });

  // 2) Non-exclusive specific rules
  if (!matched) {
    matched = rules.find(r => {
      if (!r.isActive) return false;
      if (r.scope === "test" && r.testIds) return (JSON.parse(r.testIds) as number[]).includes(ot.testId);
      if (r.scope === "category" && r.categories && test) return (JSON.parse(r.categories) as string[]).includes(test.category || "");
      return false;
    });
  }

  // 3) Catch-all rule
  if (!matched) matched = rules.find(r => r.isActive && r.scope === "all");

  if (matched) {
    const val = Number(matched.value);
    return {
      commission: matched.type === "percentage" ? (price * val) / 100 : val,
      ruleName: matched.name,
    };
  }

  // 4) Doctor default
  const defVal = Number(doctor.defaultCommission);
  if (defVal > 0) {
    return {
      commission: doctor.defaultCommissionType === "percentage" ? (price * defVal) / 100 : defVal,
      ruleName: "Default",
    };
  }

  return { commission: 0, ruleName: "None" };
}

// ── Commission discount deduction helper ──────────────────────────────────────
// Applies the clinic-level commissionDiscountMode rule to an order's raw
// commission and the bill discount for that order.
//   "none"            → no change (returns rawCommission unchanged)
//   "deduct"          → commission − discount, floored at 0
//   "deduct_rollover" → commission − discount, can be negative
function applyDiscountDeduction(
  rawCommission: number,
  billDiscount: number,
  mode: string,
): { net: number; deducted: number } {
  if (mode === "deduct") {
    const net = Math.max(0, rawCommission - billDiscount);
    return { net, deducted: rawCommission - net };
  }
  if (mode === "deduct_rollover") {
    const net = rawCommission - billDiscount;
    return { net, deducted: billDiscount };
  }
  return { net: rawCommission, deducted: 0 };
}

// Commission payout report (consolidated — for backwards compat)
router.get("/report", async (req, res) => {
  const { from, to, doctorId } = req.query as Record<string, string>;

  // Fetch clinic settings to determine commission discount mode.
  const [clinicRow] = await db.select({
    commissionDiscountMode: clinicSettingsTable.commissionDiscountMode,
    vipPercentage: clinicSettingsTable.vipPercentage,
  }).from(clinicSettingsTable).limit(1);
  const commissionDiscountMode = clinicRow?.commissionDiscountMode ?? "none";
  const vipPct = clinicRow?.vipPercentage ? Number(clinicRow.vipPercentage) : 50.00;

  const doctors = await db.select().from(doctorsTable);
  const allRules = await db.select().from(commissionRulesTable);
  const allTests = await db.select().from(testsTable);
  const testMap = new Map(allTests.map(t => [t.id, { id: t.id, name: t.name, category: t.category, price: Number(t.price) }]));

  const conditions = [];
  if (doctorId) conditions.push(eq(ordersTable.doctorId, Number(doctorId)));
  if (from) conditions.push(gte(ordersTable.createdAt, new Date(from)));
  if (to) conditions.push(lte(ordersTable.createdAt, new Date(to + "T23:59:59Z")));

  const orders = await db.select().from(ordersTable).where(conditions.length ? and(...conditions) : undefined);
  const orderIds = orders.map(o => o.id);
  const orderTests = orderIds.length ? await db.select().from(orderTestsTable).where(and(inArray(orderTestsTable.orderId, orderIds), ne(orderTestsTable.status, "cancelled"))) : [];
  const billsForOrders = orderIds.length ? await db.select().from(billsTable).where(inArray(billsTable.orderId, orderIds)) : [];
  const discountedOrderIds = new Set(billsForOrders.filter(b => Number(b.discount) > 0).map(b => b.orderId));
  // Map orderId → bill discount amount for the deduction logic.
  const billDiscountByOrderId = new Map<number, number>();
  for (const b of billsForOrders) {
    if (b.orderId != null) billDiscountByOrderId.set(b.orderId, Number(b.discount ?? 0));
  }

  const tokens = orderIds.length
    ? await db.select({ orderTestId: testTokensTable.orderTestId })
        .from(testTokensTable)
        .where(and(inArray(testTokensTable.orderId, orderIds), sql`${testTokensTable.priority} > 0`))
    : [];
  const vipOrderTestIds = new Set(tokens.map(t => t.orderTestId).filter(Boolean) as number[]);

  const report = doctors
    .filter(d => !doctorId || d.id === Number(doctorId))
    .map(doctor => {
      const doctorOrders = orders.filter(o => o.doctorId === doctor.id);
      const rules = allRules.filter(r => r.doctorId === doctor.id);
      let totalRevenue = 0, totalCommission = 0, totalDiscountDeducted = 0;
      let testsFullPrice = 0, testsDiscounted = 0;
      let revenueFullPrice = 0, revenueDiscounted = 0;
      let commissionFullPrice = 0, commissionDiscounted = 0;
      let ordersFullPrice = 0, ordersDiscounted = 0;
      const orderDetails: { orderId: number; orderNumber: string; date: string; revenue: number; commission: number; rawCommission: number; discountDeducted: number; commissionRule: string; isDiscounted: boolean }[] = [];

      for (const order of doctorOrders) {
        const tests = orderTests.filter(ot => ot.orderId === order.id);
        const isDisc = discountedOrderIds.has(order.id);
        let orderRevenue = 0, rawOrderCommission = 0, lastRule = "Default";
        for (const ot of tests) {
          const test = testMap.get(ot.testId);
          const { commission, ruleName } = calcTestCommission(ot, test, rules, doctor, vipOrderTestIds, vipPct);
          orderRevenue += Number(ot.price);
          rawOrderCommission += commission;
          lastRule = ruleName;
          if (isDisc) testsDiscounted++; else testsFullPrice++;
        }
        const billDiscount = billDiscountByOrderId.get(order.id) ?? 0;
        const { net: orderCommission, deducted } = applyDiscountDeduction(rawOrderCommission, billDiscount, commissionDiscountMode);
        totalRevenue += orderRevenue;
        totalCommission += orderCommission;
        totalDiscountDeducted += deducted;
        if (isDisc) { ordersDiscounted++; revenueDiscounted += orderRevenue; commissionDiscounted += orderCommission; }
        else        { ordersFullPrice++;  revenueFullPrice  += orderRevenue; commissionFullPrice  += orderCommission; }
        orderDetails.push({ orderId: order.id, orderNumber: order.orderNumber, date: order.createdAt.toISOString().split("T")[0], revenue: orderRevenue, commission: orderCommission, rawCommission: rawOrderCommission, discountDeducted: deducted, commissionRule: lastRule, isDiscounted: isDisc });
      }

      return {
        doctorId: doctor.id,
        doctorName: doctor.name,
        specialization: doctor.specialization ?? "",
        totalOrders: doctorOrders.length,
        totalBilled: totalRevenue,
        commissionAmount: totalCommission,
        totalDiscountDeducted,
        commissionDiscountMode,
        commissionType: doctor.defaultCommissionType ?? "percentage",
        commissionValue: Number(doctor.defaultCommission ?? 0),
        // Discount-aware breakdown
        ordersFullPrice,
        ordersDiscounted,
        testsFullPrice,
        testsDiscounted,
        revenueFullPrice,
        revenueDiscounted,
        commissionFullPrice,
        commissionDiscounted,
        doctor: { ...doctor, defaultCommission: Number(doctor.defaultCommission) },
        orders: orderDetails,
      };
    });

  res.json(report);
});

// ─── Detailed commission report (test-wise / category-wise / consolidated) ────
router.get("/report-detailed", async (req, res) => {
  const { from, to, doctorId, groupBy = "order" } = req.query as Record<string, string>;

  // Fetch clinic settings for commission discount mode.
  const [clinicRow] = await db.select({
    commissionDiscountMode: clinicSettingsTable.commissionDiscountMode,
    vipPercentage: clinicSettingsTable.vipPercentage,
  }).from(clinicSettingsTable).limit(1);
  const commissionDiscountMode = clinicRow?.commissionDiscountMode ?? "none";
  const vipPct = clinicRow?.vipPercentage ? Number(clinicRow.vipPercentage) : 50.00;

  const doctors = await db.select().from(doctorsTable);
  const allRules = await db.select().from(commissionRulesTable);
  const allTests = await db.select().from(testsTable);
  const testMap = new Map(allTests.map(t => [t.id, { id: t.id, name: t.name, category: t.category ?? "Other", price: Number(t.price) }]));

  const conditions = [];
  if (doctorId) conditions.push(eq(ordersTable.doctorId, Number(doctorId)));
  if (from) conditions.push(gte(ordersTable.createdAt, new Date(from)));
  if (to) conditions.push(lte(ordersTable.createdAt, new Date(to + "T23:59:59Z")));

  const orders = await db.select().from(ordersTable).where(conditions.length ? and(...conditions) : undefined);
  const orderIds = orders.map(o => o.id);
  const orderTests = orderIds.length ? await db.select().from(orderTestsTable).where(and(inArray(orderTestsTable.orderId, orderIds), ne(orderTestsTable.status, "cancelled"))) : [];
  // Fetch bills to get discount amounts per order.
  const billsForOrders = orderIds.length ? await db.select({ orderId: billsTable.orderId, discount: billsTable.discount }).from(billsTable).where(inArray(billsTable.orderId, orderIds)) : [];
  const billDiscountByOrderId = new Map<number, number>();
  for (const b of billsForOrders) {
    if (b.orderId != null) billDiscountByOrderId.set(b.orderId, Number(b.discount ?? 0));
  }

  const tokens = orderIds.length
    ? await db.select({ orderTestId: testTokensTable.orderTestId })
        .from(testTokensTable)
        .where(and(inArray(testTokensTable.orderId, orderIds), sql`${testTokensTable.priority} > 0`))
    : [];
  const vipOrderTestIds = new Set(tokens.map(t => t.orderTestId).filter(Boolean) as number[]);

  const filteredDoctors = doctors.filter(d => !doctorId || d.id === Number(doctorId));

  const result = filteredDoctors.map(doctor => {
    const doctorOrders = orders.filter(o => o.doctorId === doctor.id);
    const rules = allRules.filter(r => r.doctorId === doctor.id);

    // Build flat test-level rows
    type TestRow = {
      testId: number; testName: string; category: string;
      orderId: number; orderNumber: string; orderDate: string;
      price: number; commission: number; ruleName: string;
    };
    const testRows: TestRow[] = [];

    for (const order of doctorOrders) {
      const ots = orderTests.filter(ot => ot.orderId === order.id);
      for (const ot of ots) {
        const test = testMap.get(ot.testId);
        const { commission, ruleName } = calcTestCommission(ot, test, rules, doctor, vipOrderTestIds, vipPct);
        testRows.push({
          testId: ot.testId,
          testName: test?.name ?? "Unknown",
          category: test?.category ?? "Other",
          orderId: order.id,
          orderNumber: order.orderNumber,
          orderDate: order.createdAt.toISOString().split("T")[0],
          price: Number(ot.price),
          commission,
          ruleName,
        });
      }
    }

    const totalRevenue = testRows.reduce((s, r) => s + r.price, 0);

    // Compute per-order adjusted commissions and total deduction for this doctor.
    // Discount deduction is applied at order level, not per-test, because the
    // bill discount belongs to the whole order (bill), not individual test lines.
    const orderAdjustedCommission = new Map<number, number>(); // orderId → adjusted
    let totalDiscountDeducted = 0;
    {
      const orderIdsForDoctor = [...new Set(testRows.map(r => r.orderId))];
      for (const oid of orderIdsForDoctor) {
        const rawOrderCommission = testRows.filter(r => r.orderId === oid).reduce((s, r) => s + r.commission, 0);
        const billDiscount = billDiscountByOrderId.get(oid) ?? 0;
        const { net, deducted } = applyDiscountDeduction(rawOrderCommission, billDiscount, commissionDiscountMode);
        orderAdjustedCommission.set(oid, net);
        totalDiscountDeducted += deducted;
      }
    }
    const totalCommission = [...orderAdjustedCommission.values()].reduce((s, v) => s + v, 0);

    // Build groupBy views
    let grouped: unknown = null;

    if (groupBy === "test") {
      const byTest: Record<number, { testId: number; testName: string; category: string; count: number; revenue: number; commission: number; ruleName: string; ruleValue: number; ruleType: string }> = {};
      for (const row of testRows) {
        if (!byTest[row.testId]) {
          // Find the matching rule to get its value and type
          const matchedRule = rules.find(r => {
            if (!r.isActive) return false;
            if (r.isExclusive && r.scope === "test" && r.testIds) return (JSON.parse(r.testIds) as number[]).includes(row.testId);
            if (r.isExclusive && r.scope === "category" && r.categories) return (JSON.parse(r.categories) as string[]).includes(row.category);
            if (r.scope === "test" && r.testIds) return (JSON.parse(r.testIds) as number[]).includes(row.testId);
            if (r.scope === "category" && r.categories) return (JSON.parse(r.categories) as string[]).includes(row.category);
            return r.scope === "all";
          });
          const ruleValue = matchedRule ? Number(matchedRule.value) : Number(doctor.defaultCommission);
          const ruleType = matchedRule ? matchedRule.type : (doctor.defaultCommissionType || "percentage");
          byTest[row.testId] = { testId: row.testId, testName: row.testName, category: row.category, count: 0, revenue: 0, commission: 0, ruleName: row.ruleName, ruleValue, ruleType };
        }
        byTest[row.testId].count++;
        byTest[row.testId].revenue += row.price;
        byTest[row.testId].commission += row.commission;
      }
      grouped = Object.values(byTest).sort((a, b) => b.commission - a.commission);
    } else if (groupBy === "category") {
      const byCat: Record<string, { category: string; testCount: number; orderCount: number; revenue: number; commission: number }> = {};
      for (const row of testRows) {
        if (!byCat[row.category]) byCat[row.category] = { category: row.category, testCount: 0, orderCount: 0, revenue: 0, commission: 0 };
        byCat[row.category].testCount++;
        byCat[row.category].revenue += row.price;
        byCat[row.category].commission += row.commission;
      }
      // Count unique orders per category
      for (const row of testRows) {
        const cat = byCat[row.category];
        cat.orderCount = new Set(testRows.filter(r => r.category === row.category).map(r => r.orderId)).size;
      }
      grouped = Object.values(byCat).sort((a, b) => b.commission - a.commission);
    } else if (groupBy === "order") {
      const byOrder: Record<number, { orderId: number; orderNumber: string; orderDate: string; testCount: number; revenue: number; commission: number; rawCommission: number; discountDeducted: number; tests: TestRow[] }> = {};
      for (const row of testRows) {
        if (!byOrder[row.orderId]) {
          const adjusted = orderAdjustedCommission.get(row.orderId) ?? 0;
          const rawOrderComm = testRows.filter(r => r.orderId === row.orderId).reduce((s, r) => s + r.commission, 0);
          byOrder[row.orderId] = { orderId: row.orderId, orderNumber: row.orderNumber, orderDate: row.orderDate, testCount: 0, revenue: 0, commission: adjusted, rawCommission: rawOrderComm, discountDeducted: rawOrderComm - adjusted, tests: [] };
        }
        byOrder[row.orderId].testCount++;
        byOrder[row.orderId].revenue += row.price;
        byOrder[row.orderId].tests.push(row);
      }
      grouped = Object.values(byOrder).sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime());
    } else {
      grouped = null; // consolidated — just totals
    }

    return {
      doctor: { id: doctor.id, name: doctor.name, specialization: doctor.specialization, defaultCommission: Number(doctor.defaultCommission), defaultCommissionType: doctor.defaultCommissionType },
      orderCount: doctorOrders.length,
      testCount: testRows.length,
      totalRevenue,
      totalCommission,
      totalDiscountDeducted,
      commissionDiscountMode,
      effectiveRate: totalRevenue > 0 ? Number(((totalCommission / totalRevenue) * 100).toFixed(2)) : 0,
      grouped,
      testRows: groupBy === "test" ? testRows : undefined,
    };
  });

  const grandTotal = {
    doctors: result.filter(r => r.orderCount > 0).length,
    orders: result.reduce((s, r) => s + r.orderCount, 0),
    revenue: result.reduce((s, r) => s + r.totalRevenue, 0),
    commission: result.reduce((s, r) => s + r.totalCommission, 0),
    totalDiscountDeducted: result.reduce((s, r) => s + r.totalDiscountDeducted, 0),
  };

  res.json({ report: result.filter(r => r.orderCount > 0), grandTotal });
});

// ── Referral Report by Patient (per-visit, per-test rows) ─────────────────────
// Returns each referral doctor's rows: one row per test per patient visit,
// with patient name, date, bill number, commission, and rule details.
// Used by the "Referral Report (Doctor Name)" page in the super-admin portal.
router.get("/report-by-patient", async (req, res) => {
  const { from, to, doctorId } = req.query as Record<string, string>;

  const [clinicRow] = await db
    .select({
      commissionDiscountMode: clinicSettingsTable.commissionDiscountMode,
      vipPercentage: clinicSettingsTable.vipPercentage,
    })
    .from(clinicSettingsTable).limit(1);
  const commissionDiscountMode = clinicRow?.commissionDiscountMode ?? "none";
  const vipPct = clinicRow?.vipPercentage ? Number(clinicRow.vipPercentage) : 50.00;

  const doctors = await db.select().from(doctorsTable);
  const allRules = await db.select().from(commissionRulesTable);
  const allTests = await db.select().from(testsTable);
  const testMap = new Map(allTests.map(t => [t.id, { id: t.id, name: t.name, category: t.category ?? "Other", price: Number(t.price) }]));

  const conditions = [];
  if (doctorId) conditions.push(eq(ordersTable.doctorId, Number(doctorId)));
  if (from) conditions.push(gte(ordersTable.createdAt, new Date(from)));
  if (to) conditions.push(lte(ordersTable.createdAt, new Date(to + "T23:59:59Z")));

  // Fetch orders joined with patient names
  const ordersWithPatients = await db
    .select({
      orderId: ordersTable.id,
      orderNumber: ordersTable.orderNumber,
      orderDate: ordersTable.createdAt,
      doctorId: ordersTable.doctorId,
      patientFirstName: patientsTable.firstName,
      patientLastName: patientsTable.lastName,
      patientPid: patientsTable.patientId,
    })
    .from(ordersTable)
    .innerJoin(patientsTable, eq(ordersTable.patientId, patientsTable.id))
    .where(conditions.length ? and(...conditions) : undefined);

  const orderIds = ordersWithPatients.map(o => o.orderId);
  const orderTests = orderIds.length
    ? await db.select().from(orderTestsTable)
        .where(and(inArray(orderTestsTable.orderId, orderIds), ne(orderTestsTable.status, "cancelled")))
    : [];

  const billsForOrders = orderIds.length
    ? await db
        .select({ orderId: billsTable.orderId, billNumber: billsTable.billNumber, discount: billsTable.discount })
        .from(billsTable).where(inArray(billsTable.orderId, orderIds))
    : [];

  const billByOrderId = new Map<number, { billNumber: string; discount: number }>();
  for (const b of billsForOrders) {
    if (b.orderId != null) billByOrderId.set(b.orderId, { billNumber: b.billNumber, discount: Number(b.discount ?? 0) });
  }

  const tokens = orderIds.length
    ? await db.select({ orderTestId: testTokensTable.orderTestId })
        .from(testTokensTable)
        .where(and(inArray(testTokensTable.orderId, orderIds), sql`${testTokensTable.priority} > 0`))
    : [];
  const vipOrderTestIds = new Set(tokens.map(t => t.orderTestId).filter(Boolean) as number[]);

  const filteredDoctors = doctors.filter(d => !doctorId || d.id === Number(doctorId));

  type PatientRow = {
    date: string;
    patientName: string;
    patientPid: string;
    orderId: number;
    orderNumber: string;
    billNumber: string;
    testId: number;
    testName: string;
    category: string;
    price: number;
    commission: number;
    ruleType: string;
    ruleValue: number;
    ruleName: string;
  };

  const result = filteredDoctors.map(doctor => {
    const doctorOrders = ordersWithPatients.filter(o => o.doctorId === doctor.id);
    const rules = allRules.filter(r => r.doctorId === doctor.id);

    // Build per-order discount-adjusted commission ratio
    const orderAdjustRatio = new Map<number, number>();
    for (const order of doctorOrders) {
      const ots = orderTests.filter(ot => ot.orderId === order.orderId);
      const rawOrderComm = ots.reduce((s, ot) => s + calcTestCommission(ot, testMap.get(ot.testId), rules, doctor, vipOrderTestIds, vipPct).commission, 0);
      const billDiscount = billByOrderId.get(order.orderId)?.discount ?? 0;
      const { net } = applyDiscountDeduction(rawOrderComm, billDiscount, commissionDiscountMode);
      orderAdjustRatio.set(order.orderId, rawOrderComm > 0 ? net / rawOrderComm : 1);
    }

    const rows: PatientRow[] = [];
    for (const order of doctorOrders) {
      const ots = orderTests.filter(ot => ot.orderId === order.orderId);
      const bill = billByOrderId.get(order.orderId);
      const ratio = orderAdjustRatio.get(order.orderId) ?? 1;

      for (const ot of ots) {
        const test = testMap.get(ot.testId);
        const { commission: rawComm, ruleName } = calcTestCommission(ot, test, rules, doctor, vipOrderTestIds, vipPct);
        const matchedRule = rules.find(r => {
          if (!r.isActive) return false;
          if (r.isExclusive && r.scope === "test" && r.testIds) return (JSON.parse(r.testIds) as number[]).includes(ot.testId);
          if (r.isExclusive && r.scope === "category" && r.categories && test) return (JSON.parse(r.categories) as string[]).includes(test.category ?? "");
          if (r.scope === "test" && r.testIds) return (JSON.parse(r.testIds) as number[]).includes(ot.testId);
          if (r.scope === "category" && r.categories && test) return (JSON.parse(r.categories) as string[]).includes(test.category ?? "");
          return r.scope === "all";
        });
        rows.push({
          date: order.orderDate.toISOString().split("T")[0],
          patientName: `${order.patientFirstName} ${order.patientLastName}`.trim().toUpperCase(),
          patientPid: order.patientPid,
          orderId: order.orderId,
          orderNumber: order.orderNumber,
          billNumber: bill?.billNumber ?? "",
          testId: ot.testId,
          testName: test?.name ?? "Unknown",
          category: test?.category ?? "Other",
          price: Number(ot.price),
          commission: rawComm * ratio,
          ruleType: matchedRule ? matchedRule.type : (doctor.defaultCommissionType || "percentage"),
          ruleValue: matchedRule ? Number(matchedRule.value) : Number(doctor.defaultCommission),
          ruleName,
        });
      }
    }

    rows.sort((a, b) => a.date.localeCompare(b.date));
    const totalCommission = rows.reduce((s, r) => s + r.commission, 0);
    const totalRevenue = rows.reduce((s, r) => s + r.price, 0);
    const uniqueOrders = new Set(rows.map(r => r.orderId)).size;

    return {
      doctor: { id: doctor.id, name: doctor.name, specialization: doctor.specialization },
      rows,
      totalCommission,
      totalRevenue,
      orderCount: uniqueOrders,
      testCount: rows.length,
    };
  }).filter(d => d.rows.length > 0);

  res.json({
    report: result,
    grandTotal: {
      doctors: result.length,
      orders: result.reduce((s, d) => s + d.orderCount, 0),
      revenue: result.reduce((s, d) => s + d.totalRevenue, 0),
      commission: result.reduce((s, d) => s + d.totalCommission, 0),
    },
  });
});

export default router;
