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
  patientReportsTable,
  radiologyStudiesTable,
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

// ─── CSV helpers (import/export) ──────────────────────────────────────────────
const CSV_HEADER = ["doctorName", "name", "type", "value", "scope", "categories", "testIds", "isExclusive", "isActive"] as const;

function csvEscape(v: unknown): string {
  let s = String(v ?? "");
  // CSV formula-injection guard: neutralise cells that a spreadsheet would
  // otherwise interpret as a formula.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// Minimal RFC-4180-ish CSV parser → array of records (each an array of raw
// field strings). Handles quoted fields, escaped quotes ("") and
// commas / newlines inside quotes. Blank lines become empty records.
function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  const src = text.replace(/\r\n?/g, "\n"); // normalise CRLF / CR → LF
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      record.push(field); field = "";
    } else if (ch === "\n") {
      record.push(field); records.push(record); record = []; field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || record.length > 0) { record.push(field); records.push(record); }
  return records;
}

// ─── GET /rules/export : unified commission CSV for ALL doctors ────────────────
// Commission is configured in two places, both inside the super-admin panel:
//   1) explicit commission_rules entries (Commission Rules → "Add Rule")
//   2) a per-doctor defaultCommission on the doctor profile (Doctor Manager)
// The export unifies both so every doctor with any commission info appears:
// each explicit rule is a row, and a doctor whose profile carries a default
// (and has no active catch-all rule to supersede it) gets one synthesised
// "Profile Default" row (scope="all"). Optional ?doctorId= limits to one doctor.
router.get("/rules/export", async (req, res) => {
  const { doctorId } = req.query as Record<string, string>;
  const wantDoctorId = doctorId ? Number(doctorId) : null;

  const doctors = await db.select().from(doctorsTable);
  const rules = await db.select().from(commissionRulesTable).orderBy(desc(commissionRulesTable.createdAt));

  const rulesByDoctor = new Map<number, RuleInfo[]>();
  for (const r of rules) {
    if (!rulesByDoctor.has(r.doctorId)) rulesByDoctor.set(r.doctorId, []);
    rulesByDoctor.get(r.doctorId)!.push(r);
  }

  const line = (
    doctorName: string, name: string, type: string, value: number, scope: string,
    categories: string, testIds: string, isExclusive: boolean, isActive: boolean,
  ) => [
    csvEscape(doctorName), csvEscape(name), csvEscape(type), csvEscape(value), csvEscape(scope),
    csvEscape(categories), csvEscape(testIds), csvEscape(isExclusive ? "true" : "false"), csvEscape(isActive ? "true" : "false"),
  ].join(",");

  const lines = [CSV_HEADER.join(",")];
  const doctorList = doctors
    .filter(d => wantDoctorId == null || d.id === wantDoctorId)
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const d of doctorList) {
    const dRules = rulesByDoctor.get(d.id) ?? [];
    for (const r of dRules) {
      lines.push(line(
        d.name, r.name, r.type, Number(r.value), r.scope,
        safeParseArray<string>(r.categories).join(";"),
        safeParseArray<number>(r.testIds).join(";"),
        r.isExclusive, r.isActive,
      ));
    }
    const defVal = Number(d.defaultCommission ?? 0);
    const hasActiveCatchAll = dRules.some(r => r.isActive && r.scope === "all");
    if (defVal > 0 && !hasActiveCatchAll) {
      lines.push(line(d.name, "Profile Default", d.defaultCommissionType || "percentage", defVal, "all", "", "", false, true));
    }
  }

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="commission_rules_${wantDoctorId ?? "all"}.csv"`);
  res.send(lines.join("\n"));
});

// ─── POST /rules/import : create rules row-by-row from CSV text ────────────────
// Accepts { csv } JSON (or a raw text body). Matches doctors by name
// case-insensitively, validates each row, and creates commission_rules
// entries — reporting per-row skips so a partial file still imports the good
// rows. A row named "Profile Default"/scope="all" imports as an ordinary
// catch-all rule (materialising the profile default into the super-admin
// panel), which round-trips the unified export.
router.post("/rules/import", async (req, res) => {
  const csv: string = typeof req.body === "string"
    ? req.body
    : (typeof req.body?.csv === "string" ? req.body.csv : "");
  if (!csv.trim()) {
    res.status(400).json({ error: "CSV text is required (send JSON { csv } or a text/csv body)." });
    return;
  }

  const records = parseCsv(csv);
  // Keep every record (don't pre-filter) so reported line numbers match the
  // original file; blank data rows are skipped inside the loop below.
  const hasDataRow = records.slice(1).some(rec => rec.some(c => (c ?? "").trim() !== ""));
  if (records.length < 2 || !hasDataRow) {
    res.status(400).json({ error: "CSV must have a header row and at least one data row." });
    return;
  }

  const header = records[0].map(h => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name.toLowerCase());
  const idx = {
    doctorName: col("doctorName"), name: col("name"), type: col("type"), value: col("value"),
    scope: col("scope"), categories: col("categories"), testIds: col("testIds"),
    isExclusive: col("isExclusive"), isActive: col("isActive"),
  };
  if (idx.doctorName < 0 || idx.name < 0 || idx.value < 0) {
    res.status(400).json({ error: "CSV header must include at least doctorName, name and value." });
    return;
  }

  const doctors = await db.select({ id: doctorsTable.id, name: doctorsTable.name }).from(doctorsTable);
  const doctorIdByName = new Map<string, number>();
  for (const d of doctors) doctorIdByName.set(d.name.trim().toLowerCase(), d.id);

  const parseBool = (v: string, dflt: boolean) => (v.trim() === "" ? dflt : /^(true|1|yes|y)$/i.test(v.trim()));
  const splitList = (v: string) => v.split(/[;,]/).map(s => s.trim()).filter(Boolean);

  const toInsert: (typeof commissionRulesTable.$inferInsert)[] = [];
  const errors: { line: number; doctorName: string; error: string }[] = [];

  for (let i = 1; i < records.length; i++) {
    const rec = records[i];
    if (rec.every(c => (c ?? "").trim() === "")) continue; // skip blank lines
    const lineNo = i + 1; // human-facing line number (1-based, header is line 1)
    const at = (c: number) => (c >= 0 ? (rec[c] ?? "").trim() : "");
    const doctorName = at(idx.doctorName);
    const name = at(idx.name);
    const type = (at(idx.type) || "percentage").toLowerCase();
    const valueRaw = at(idx.value);
    const scope = (at(idx.scope) || "all").toLowerCase();

    if (!doctorName) { errors.push({ line: lineNo, doctorName, error: "Missing doctorName" }); continue; }
    const dId = doctorIdByName.get(doctorName.toLowerCase());
    if (dId == null) { errors.push({ line: lineNo, doctorName, error: `No doctor matches "${doctorName}"` }); continue; }
    if (!name) { errors.push({ line: lineNo, doctorName, error: "Missing rule name" }); continue; }
    if (type !== "percentage" && type !== "fixed") { errors.push({ line: lineNo, doctorName, error: `Invalid type "${type}" (expected percentage or fixed)` }); continue; }
    const value = Number(valueRaw);
    if (!Number.isFinite(value)) { errors.push({ line: lineNo, doctorName, error: `Invalid value "${valueRaw}"` }); continue; }
    if (scope !== "all" && scope !== "category" && scope !== "test") { errors.push({ line: lineNo, doctorName, error: `Invalid scope "${scope}" (expected all, category or test)` }); continue; }

    const categories = scope === "category" ? splitList(at(idx.categories)) : [];
    const testIds = scope === "test" ? splitList(at(idx.testIds)).map(Number).filter(n => Number.isFinite(n)) : [];

    toInsert.push({
      doctorId: dId,
      name,
      type,
      value: value.toString(),
      scope,
      categories: categories.length ? JSON.stringify(categories) : null,
      testIds: testIds.length ? JSON.stringify(testIds) : null,
      isExclusive: parseBool(at(idx.isExclusive), false),
      isActive: parseBool(at(idx.isActive), true),
    });
  }

  let created = 0;
  if (toInsert.length) {
    const inserted = await db.insert(commissionRulesTable).values(toInsert).returning({ id: commissionRulesTable.id });
    created = inserted.length;
  }

  // 400 only when nothing at all could be imported; otherwise 200 with a
  // per-row error list so the UI can report partial success.
  res.status(created === 0 && errors.length > 0 ? 400 : 200).json({
    ok: errors.length === 0,
    created,
    skipped: errors.length,
    total: records.length - 1,
    errors,
  });
});

// ─── Commission calculation helper ────────────────────────────────────────────
type TestInfo = { id: number; name: string; category: string | null; price: number };
type RuleInfo = typeof import("@workspace/db/schema").commissionRulesTable.$inferSelect;
type DoctorInfo = typeof import("@workspace/db/schema").doctorsTable.$inferSelect;

function safeParseArray<T = unknown>(s: string | null | undefined): T[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

// Single source of truth for "which rule applies to this test line".
//
// Precedence (must stay in lock-step with every report that displays the
// matched rule's value/type — otherwise the UI shows a rule the calculation
// never used, which is exactly the "rule not selected" bug):
//   1) exclusive test/category rule
//   2) non-exclusive test/category rule
//   3) catch-all (scope="all") rule
// Returns undefined when nothing matches (caller falls back to the doctor's
// profile default).
//
// `category` is the test's category, or null when the test row is unknown —
// in which case category-scoped rules never match (mirrors the old guard that
// required `test` to be defined before comparing categories).
function findMatchingRule(
  testId: number,
  category: string | null,
  rules: RuleInfo[],
): RuleInfo | undefined {
  const testMatch = (r: RuleInfo) => !!r.testIds && safeParseArray<number>(r.testIds).includes(testId);
  const catMatch = (r: RuleInfo) => category !== null && !!r.categories && safeParseArray<string>(r.categories).includes(category || "");
  const specific = (r: RuleInfo) => (r.scope === "test" && testMatch(r)) || (r.scope === "category" && catMatch(r));

  // 1) Exclusive specific rules (test-scoped or category-scoped)
  let matched = rules.find(r => r.isActive && r.isExclusive && specific(r));
  // 2) Non-exclusive specific rules
  if (!matched) matched = rules.find(r => r.isActive && specific(r));
  // 3) Catch-all rule
  if (!matched) matched = rules.find(r => r.isActive && r.scope === "all");
  return matched;
}

function calcTestCommission(
  ot: { id?: number; testId: number; price: string },
  test: TestInfo | undefined,
  rules: RuleInfo[],
  doctor: DoctorInfo,
  vipOrderTestIds?: Set<number>,
  vipPct?: number,
): { commission: number; ruleName: string; ruleType: string; ruleValue: number } {
  let price = Number(ot.price);
  if (ot.id && vipOrderTestIds?.has(ot.id) && vipPct) {
    price = price / (1 + vipPct / 100);
  }

  const matched = findMatchingRule(ot.testId, test ? (test.category ?? "") : null, rules);
  if (matched) {
    const val = Number(matched.value);
    return {
      commission: matched.type === "percentage" ? (price * val) / 100 : val,
      ruleName: matched.name,
      ruleType: matched.type,
      ruleValue: val,
    };
  }

  // Doctor default
  const defVal = Number(doctor.defaultCommission);
  const defType = doctor.defaultCommissionType || "percentage";
  if (defVal > 0) {
    return {
      commission: defType === "percentage" ? (price * defVal) / 100 : defVal,
      ruleName: "Default",
      ruleType: defType,
      ruleValue: defVal,
    };
  }

  return { commission: 0, ruleName: "None", ruleType: defType, ruleValue: 0 };
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

// ── Commission eligibility (payment / report-aware hold) ──────────────────────
// Decides whether an order's commission is payable yet or held. Mirrors
// doctor-ledger.ts. Cancelled bill → never payable.
type EligibilityConfig = { policy: string; minAmount: number };
const NEEDS_REPORT_STATUS = (policy: string) => policy === "report_finalized" || policy === "report_delivered";

function computeCommissionHold(opts: {
  cfg: EligibilityConfig;
  hasBill: boolean;
  billStatus: string | null;
  paidAmount: number;
  balanceAmount: number;
  reportFinalized: boolean;
  reportDelivered: boolean;
  commissionAmount: number;
}): { held: boolean; reason: string | null } {
  const rs = (n: number) => `Rs.${Math.round(n).toLocaleString("en-IN")}`;
  if (opts.billStatus === "cancelled") return { held: true, reason: "Bill cancelled" };
  if (!opts.hasBill) return { held: true, reason: "Not billed" };
  switch (opts.cfg.policy) {
    case "report_finalized":
      return opts.reportFinalized ? { held: false, reason: null } : { held: true, reason: "Report not finalized" };
    case "report_delivered":
      return opts.reportDelivered ? { held: false, reason: null } : { held: true, reason: "Report not delivered" };
    case "min_amount_collected":
      return opts.paidAmount + 0.005 >= opts.cfg.minAmount
        ? { held: false, reason: null }
        : { held: true, reason: `Collected ${rs(opts.paidAmount)} < min ${rs(opts.cfg.minAmount)}` };
    case "full_payment_collected":
      return opts.balanceAmount <= 0.005
        ? { held: false, reason: null }
        : { held: true, reason: `Outstanding dues ${rs(opts.balanceAmount)}` };
    case "collected_ge_commission":
      return opts.paidAmount + 0.005 >= opts.commissionAmount
        ? { held: false, reason: null }
        : { held: true, reason: `Collected ${rs(opts.paidAmount)} < commission ${rs(opts.commissionAmount)}` };
    case "bill_created":
    default:
      return { held: false, reason: null };
  }
}

// Per-order finalized/delivered flags (only for report_* policies): an order is
// finalized/delivered only when every non-cancelled order-test has a
// finalized/delivered report (pathology via patient_reports, radiology via
// radiology_studies).
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
      ruleType: string; ruleValue: number;
    };
    const testRows: TestRow[] = [];

    for (const order of doctorOrders) {
      const ots = orderTests.filter(ot => ot.orderId === order.id);
      for (const ot of ots) {
        const test = testMap.get(ot.testId);
        const { commission, ruleName, ruleType, ruleValue } = calcTestCommission(ot, test, rules, doctor, vipOrderTestIds, vipPct);
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
          ruleType,
          ruleValue,
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
          // ruleType/ruleValue come straight from calcTestCommission's actual
          // decision (row.ruleType / row.ruleValue), so the displayed rate is
          // always the one that produced this commission. (Previously a
          // separate rules.find() re-derived it with different precedence and
          // could show a catch-all rule that was never applied.)
          byTest[row.testId] = { testId: row.testId, testName: row.testName, category: row.category, count: 0, revenue: 0, commission: 0, ruleName: row.ruleName, ruleValue: row.ruleValue, ruleType: row.ruleType };
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
      commissionEligibilityPolicy: clinicSettingsTable.commissionEligibilityPolicy,
      commissionEligibilityMinAmount: clinicSettingsTable.commissionEligibilityMinAmount,
    })
    .from(clinicSettingsTable).limit(1);
  const commissionDiscountMode = clinicRow?.commissionDiscountMode ?? "none";
  const vipPct = clinicRow?.vipPercentage ? Number(clinicRow.vipPercentage) : 50.00;
  const eligCfg: EligibilityConfig = {
    policy: clinicRow?.commissionEligibilityPolicy ?? "full_payment_collected",
    minAmount: Number(clinicRow?.commissionEligibilityMinAmount ?? 0),
  };

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
        .select({ orderId: billsTable.orderId, billNumber: billsTable.billNumber, discount: billsTable.discount, subtotal: billsTable.subtotal, status: billsTable.status, paidAmount: billsTable.paidAmount, balanceAmount: billsTable.balanceAmount })
        .from(billsTable).where(inArray(billsTable.orderId, orderIds))
    : [];

  const billByOrderId = new Map<number, { billNumber: string; discount: number; subtotal: number; status: string | null; paid: number; balance: number }>();
  for (const b of billsForOrders) {
    if (b.orderId != null) billByOrderId.set(b.orderId, { billNumber: b.billNumber, discount: Number(b.discount ?? 0), subtotal: Number(b.subtotal ?? 0), status: b.status ?? null, paid: Number(b.paidAmount ?? 0), balance: Number(b.balanceAmount ?? 0) });
  }

  const tokens = orderIds.length
    ? await db.select({ orderTestId: testTokensTable.orderTestId })
        .from(testTokensTable)
        .where(and(inArray(testTokensTable.orderId, orderIds), sql`${testTokensTable.priority} > 0`))
    : [];
  const vipOrderTestIds = new Set(tokens.map(t => t.orderTestId).filter(Boolean) as number[]);

  // Report finalized/delivered per order — only fetched for the report_* policies.
  let reportStatusByOrder = new Map<number, { finalized: boolean; delivered: boolean }>();
  if (NEEDS_REPORT_STATUS(eligCfg.policy)) {
    const activeOrderTestIdsByOrder = new Map<number, number[]>();
    for (const ot of orderTests) {
      const arr = activeOrderTestIdsByOrder.get(ot.orderId) ?? [];
      arr.push(ot.id);
      activeOrderTestIdsByOrder.set(ot.orderId, arr);
    }
    reportStatusByOrder = await fetchOrderReportStatus(orderIds, activeOrderTestIdsByOrder);
  }

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
    // "actual" — commission after the clinic's bill-discount deduction
    // (commissionDiscountMode) is applied at order level and spread per row.
    commission: number;
    // "expected" — the commission before any discount deduction. The referral
    // report's discount breakdown shows: expected − (expected−actual) = actual,
    // where the deducted amount is the referral discount given up on the bill.
    grossCommission: number;
    // Bill-level discount context (repeated on each test row of the bill) for
    // the selectable Bill-Discount column shown as ₹ or % of subtotal.
    billDiscount: number;
    billSubtotal: number;
    // Payment-aware eligibility: whether this order's commission is on hold
    // (excluded from payable) and why (repeated on each test row of the order).
    held: boolean;
    holdReason: string | null;
    ruleType: string;
    ruleValue: number;
    ruleName: string;
    // "Why this amount?" drill-down: the price actually used as the commission
    // base (VIP surcharge stripped) and whether that stripping happened, so the
    // UI can show base = price ÷ (1 + vip%) → expected → −discount → actual.
    commissionBase: number;
    vipAdjusted: boolean;
  };

  const result = filteredDoctors.map(doctor => {
    const doctorOrders = ordersWithPatients.filter(o => o.doctorId === doctor.id);
    const rules = allRules.filter(r => r.doctorId === doctor.id);

    // Build per-order discount-adjusted commission ratio + eligibility hold
    const orderAdjustRatio = new Map<number, number>();
    const orderHold = new Map<number, { held: boolean; reason: string | null }>();
    for (const order of doctorOrders) {
      const ots = orderTests.filter(ot => ot.orderId === order.orderId);
      const rawOrderComm = ots.reduce((s, ot) => s + calcTestCommission(ot, testMap.get(ot.testId), rules, doctor, vipOrderTestIds, vipPct).commission, 0);
      const bill = billByOrderId.get(order.orderId);
      const { net } = applyDiscountDeduction(rawOrderComm, bill?.discount ?? 0, commissionDiscountMode);
      orderAdjustRatio.set(order.orderId, rawOrderComm > 0 ? net / rawOrderComm : 1);
      const rep = reportStatusByOrder.get(order.orderId);
      orderHold.set(order.orderId, computeCommissionHold({
        cfg: eligCfg,
        hasBill: !!bill,
        billStatus: bill?.status ?? null,
        paidAmount: bill?.paid ?? 0,
        balanceAmount: bill?.balance ?? 0,
        reportFinalized: rep?.finalized ?? false,
        reportDelivered: rep?.delivered ?? false,
        commissionAmount: net,
      }));
    }

    const rows: PatientRow[] = [];
    for (const order of doctorOrders) {
      const ots = orderTests.filter(ot => ot.orderId === order.orderId);
      const bill = billByOrderId.get(order.orderId);
      const ratio = orderAdjustRatio.get(order.orderId) ?? 1;

      for (const ot of ots) {
        const test = testMap.get(ot.testId);
        // ruleType/ruleValue come from the same decision that produced the
        // commission (calcTestCommission → findMatchingRule), so the displayed
        // rate always reflects the rule actually applied.
        const { commission: rawComm, ruleName, ruleType, ruleValue } = calcTestCommission(ot, test, rules, doctor, vipOrderTestIds, vipPct);
        // Mirror the VIP-surcharge stripping calcTestCommission does internally,
        // so the drill-down can display the exact base the rate was applied to.
        const vipAdjusted = !!ot.id && vipOrderTestIds.has(ot.id) && vipPct > 0;
        const commissionBase = vipAdjusted ? Number(ot.price) / (1 + vipPct / 100) : Number(ot.price);
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
          commission: rawComm * ratio,   // actual (net of discount deduction)
          grossCommission: rawComm,      // expected (before discount deduction)
          billDiscount: bill?.discount ?? 0,
          billSubtotal: bill?.subtotal ?? 0,
          held: orderHold.get(order.orderId)?.held ?? false,
          holdReason: orderHold.get(order.orderId)?.reason ?? null,
          ruleType,
          ruleValue,
          ruleName,
          commissionBase,
          vipAdjusted,
        });
      }
    }

    rows.sort((a, b) => a.date.localeCompare(b.date));
    const totalCommission = rows.reduce((s, r) => s + r.commission, 0);           // actual (all)
    const payableCommission = rows.filter(r => !r.held).reduce((s, r) => s + r.commission, 0);  // eligible now
    const heldCommission = rows.filter(r => r.held).reduce((s, r) => s + r.commission, 0);       // on hold
    const totalExpectedCommission = rows.reduce((s, r) => s + r.grossCommission, 0); // expected
    const totalRevenue = rows.reduce((s, r) => s + r.price, 0);
    const uniqueOrders = new Set(rows.map(r => r.orderId)).size;

    return {
      doctor: { id: doctor.id, name: doctor.name, specialization: doctor.specialization },
      rows,
      totalCommission,
      payableCommission,
      heldCommission,
      totalExpectedCommission,
      totalDiscount: totalExpectedCommission - totalCommission,
      totalRevenue,
      orderCount: uniqueOrders,
      testCount: rows.length,
    };
  }).filter(d => d.rows.length > 0);

  res.json({
    report: result,
    // Clinic-level context for the "Why this amount?" drill-down.
    settings: { vipPct, commissionDiscountMode },
    grandTotal: {
      doctors: result.length,
      orders: result.reduce((s, d) => s + d.orderCount, 0),
      revenue: result.reduce((s, d) => s + d.totalRevenue, 0),
      commission: result.reduce((s, d) => s + d.totalCommission, 0),
      payableCommission: result.reduce((s, d) => s + d.payableCommission, 0),
      heldCommission: result.reduce((s, d) => s + d.heldCommission, 0),
      expectedCommission: result.reduce((s, d) => s + d.totalExpectedCommission, 0),
      discount: result.reduce((s, d) => s + d.totalDiscount, 0),
    },
  });
});

export default router;
