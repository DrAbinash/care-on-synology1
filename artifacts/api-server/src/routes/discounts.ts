import { Router } from "express";
import { db } from "@workspace/db";
import { discountRulesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router = Router();

type RuleCondition =
  | { type: "age_gte"; value: number }
  | { type: "age_lte"; value: number }
  | { type: "referral_doctor_id"; value: number };

// ── Per-item discount models ─────────────────────────────────────────────────
type CategoryItem = { name: string; type: "percentage" | "fixed"; value: number };
type TestItem     = { testId: number; type: "percentage" | "fixed"; value: number };

function parseConditions(raw: string | null | undefined): RuleCondition[] {
  try { return JSON.parse(raw || "[]"); } catch { return []; }
}

// Handle both legacy string[] and new CategoryItem[]
function parseCategoryItems(raw: string | null | undefined, globalType: string, globalValue: number): CategoryItem[] {
  try {
    const arr: unknown[] = JSON.parse(raw || "[]");
    if (!Array.isArray(arr) || arr.length === 0) return [];
    if (typeof arr[0] === "string") {
      // Legacy format: ["Haematology", "Biochemistry"]
      return (arr as string[]).map(name => ({ name, type: globalType as "percentage" | "fixed", value: globalValue }));
    }
    return arr as CategoryItem[];
  } catch { return []; }
}

// Handle both legacy number[] and new TestItem[]
function parseTestItems(raw: string | null | undefined, globalType: string, globalValue: number): TestItem[] {
  try {
    const arr: unknown[] = JSON.parse(raw || "[]");
    if (!Array.isArray(arr) || arr.length === 0) return [];
    if (typeof arr[0] === "number") {
      // Legacy format: [1, 2, 3]
      return (arr as number[]).map(testId => ({ testId, type: globalType as "percentage" | "fixed", value: globalValue }));
    }
    return arr as TestItem[];
  } catch { return []; }
}

function ageFromDob(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

function serializeRule(r: typeof discountRulesTable.$inferSelect) {
  const gType  = r.type;
  const gValue = Number(r.value);
  return {
    ...r,
    value: gValue,
    categoryItems: parseCategoryItems(r.categories, gType, gValue),
    testItems:     parseTestItems(r.testIds, gType, gValue),
    // keep legacy fields for backward compat
    categories: parseCategoryItems(r.categories, gType, gValue).map(c => c.name),
    testIds:    parseTestItems(r.testIds, gType, gValue).map(t => t.testId),
    conditions: parseConditions(r.conditions),
  };
}

router.get("/", async (_req, res) => {
  const rules = await db.select().from(discountRulesTable).orderBy(discountRulesTable.createdAt);
  res.json(rules.map(serializeRule));
});

router.post("/", async (req, res) => {
  const { name, type, value, scope, categoryItems, testItems, expiresAt, reason, conditions } = req.body;
  if (!name || !type || value === undefined) {
    res.status(400).json({ error: "name, type and value are required" });
    return;
  }
  const [rule] = await db.insert(discountRulesTable).values({
    name,
    type,
    value: String(value),
    scope: scope ?? "all",
    categories: JSON.stringify(categoryItems ?? []),
    testIds: JSON.stringify(testItems ?? []),
    conditions: JSON.stringify(conditions ?? []),
    expiresAt: expiresAt || null,
    reason: reason || null,
  }).returning();
  res.status(201).json(serializeRule(rule));
});

router.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { name, type, value, scope, categoryItems, testItems, expiresAt, reason, isActive, conditions } = req.body;
  const updates: Record<string, unknown> = {};
  if (name !== undefined)          updates.name = name;
  if (type !== undefined)          updates.type = type;
  if (value !== undefined)         updates.value = String(value);
  if (scope !== undefined)         updates.scope = scope;
  if (categoryItems !== undefined) updates.categories = JSON.stringify(categoryItems);
  if (testItems !== undefined)     updates.testIds = JSON.stringify(testItems);
  if (conditions !== undefined)    updates.conditions = JSON.stringify(conditions);
  if (expiresAt !== undefined)     updates.expiresAt = expiresAt || null;
  if (reason !== undefined)        updates.reason = reason;
  if (isActive !== undefined)      updates.isActive = isActive;
  const [updated] = await db.update(discountRulesTable).set(updates).where(eq(discountRulesTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(serializeRule(updated));
});

router.delete("/:id", async (req, res) => {
  await db.delete(discountRulesTable).where(eq(discountRulesTable.id, Number(req.params.id)));
  res.json({ ok: true });
});

// ── Compute applicable discount ───────────────────────────────────────────────
// Returns the best-matching rule's total discount amount across the given tests.
// scope="all"      → single %-or-fixed applied to the whole subtotal
// scope="category" → per-category discount summed across matching tests
// scope="test"     → per-test discount summed across matching tests
router.post("/apply", async (req, res) => {
  const {
    tests,
    maxAllowed,
    patientDob,
    doctorId,
  } = req.body as {
    tests: { testId: number; category: string; price: number }[];
    maxAllowed?: number;
    patientDob?: string | null;
    doctorId?: number | null;
  };

  const now = new Date().toISOString().split("T")[0];
  const rules = await db.select().from(discountRulesTable)
    .where(eq(discountRulesTable.isActive, true));

  const patientAge = ageFromDob(patientDob ?? null);
  const activeRules = rules.filter(r => !r.expiresAt || r.expiresAt >= now);
  const subtotal = (tests ?? []).reduce((s, t) => s + t.price, 0);

  let bestDiscount = 0;
  let bestRule: (typeof rules[0]) | null = null;

  for (const rule of activeRules) {
    const gType  = rule.type;
    const gValue = Number(rule.value);
    const catItems  = parseCategoryItems(rule.categories, gType, gValue);
    const testItems = parseTestItems(rule.testIds, gType, gValue);
    const conditions = parseConditions(rule.conditions);

    // ── Scope check ──────────────────────────────────────────────
    let applicable = false;
    if (rule.scope === "all") {
      applicable = true;
    } else if (rule.scope === "category") {
      const catNames = new Set(catItems.map(c => c.name));
      applicable = (tests ?? []).some(t => catNames.has(t.category));
    } else if (rule.scope === "test") {
      const tids = new Set(testItems.map(t => t.testId));
      applicable = (tests ?? []).some(t => tids.has(t.testId));
    }
    if (!applicable) continue;

    // ── Conditions check (ALL must pass) ─────────────────────────
    let conditionsMet = true;
    for (const cond of conditions) {
      if (cond.type === "age_gte") {
        if (patientAge === null || patientAge < cond.value) { conditionsMet = false; break; }
      } else if (cond.type === "age_lte") {
        if (patientAge === null || patientAge > cond.value) { conditionsMet = false; break; }
      } else if (cond.type === "referral_doctor_id") {
        if (!doctorId || doctorId !== cond.value) { conditionsMet = false; break; }
      }
    }
    if (!conditionsMet) continue;

    // ── Calculate discount amount ─────────────────────────────────
    let discountAmt = 0;

    if (rule.scope === "all") {
      if (gType === "percentage") discountAmt = (subtotal * gValue) / 100;
      else discountAmt = gValue;
    } else if (rule.scope === "category") {
      const catMap = new Map(catItems.map(c => [c.name, c]));
      for (const t of (tests ?? [])) {
        const item = catMap.get(t.category);
        if (!item) continue;
        if (item.type === "percentage") discountAmt += (t.price * item.value) / 100;
        else discountAmt += item.value;
      }
    } else if (rule.scope === "test") {
      const testMap = new Map(testItems.map(t => [t.testId, t]));
      for (const t of (tests ?? [])) {
        const item = testMap.get(t.testId);
        if (!item) continue;
        if (item.type === "percentage") discountAmt += (t.price * item.value) / 100;
        else discountAmt += item.value;
      }
    }

    // Cap by staff's max allowed %
    if (maxAllowed !== undefined) {
      const maxDiscountAmt = (subtotal * maxAllowed) / 100;
      discountAmt = Math.min(discountAmt, maxDiscountAmt);
    }

    if (discountAmt > bestDiscount) {
      bestDiscount = discountAmt;
      bestRule = rule;
    }
  }

  res.json({
    discount: Math.round(bestDiscount * 100) / 100,
    rule: bestRule ? { id: bestRule.id, name: bestRule.name, reason: bestRule.reason } : null,
  });
});

export default router;
