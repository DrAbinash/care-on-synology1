import { Router } from "express";
import { db } from "@workspace/db";
import { expensesTable, expenseCounterTable } from "@workspace/db/schema";
import { eq, desc, and, gte, lte, ilike, sql } from "drizzle-orm";
import {
  CreateExpenseBody,
  UpdateExpenseBody,
  UpdateExpenseParams,
} from "@workspace/api-zod";
import { geminiOcrBill } from "@workspace/integrations-gemini-ai";

const router = Router();

function toNum(row: Record<string, unknown>) {
  return { ...row, amount: Number(row.amount ?? 0) };
}

async function generateExpenseId(): Promise<string> {
  const [counter] = await db.select().from(expenseCounterTable).limit(1);
  let seq = 1;
  if (counter) {
    seq = counter.counter + 1;
    await db.update(expenseCounterTable).set({ counter: seq }).where(eq(expenseCounterTable.id, counter.id));
  } else {
    await db.insert(expenseCounterTable).values({ counter: 1 });
  }
  const now = new Date();
  const yymm = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}`;
  return `EXP-${yymm}-${String(seq).padStart(4, "0")}`;
}

// List expenses
router.get("/", async (req, res) => {
  const { category, from, to, paymentMode, search } = req.query as Record<string, string>;

  const conditions = [
    category ? eq(expensesTable.category, category) : undefined,
    from ? gte(expensesTable.expenseDate, from) : undefined,
    to ? lte(expensesTable.expenseDate, to) : undefined,
    paymentMode ? eq(expensesTable.paymentMode, paymentMode) : undefined,
    search ? ilike(expensesTable.description, `%${search}%`) : undefined,
  ].filter(Boolean);

  const rows = await db
    .select()
    .from(expensesTable)
    .where(conditions.length ? and(...(conditions as Parameters<typeof and>)) : undefined)
    .orderBy(desc(expensesTable.expenseDate), desc(expensesTable.createdAt));

  return res.json(rows.map((r) => toNum(r as unknown as Record<string, unknown>)));
});

// Summary by category
router.get("/summary", async (req, res) => {
  const { from, to } = req.query as Record<string, string>;

  const conditions = [
    from ? gte(expensesTable.expenseDate, from) : undefined,
    to ? lte(expensesTable.expenseDate, to) : undefined,
  ].filter(Boolean);

  const rows = await db
    .select({
      category: expensesTable.category,
      total: sql<string>`sum(${expensesTable.amount})`,
      count: sql<number>`count(*)`,
    })
    .from(expensesTable)
    .where(conditions.length ? and(...(conditions as Parameters<typeof and>)) : undefined)
    .groupBy(expensesTable.category)
    .orderBy(sql`sum(${expensesTable.amount}) desc`);

  return res.json(
    rows.map((r) => ({ category: r.category, total: Number(r.total ?? 0), count: Number(r.count) }))
  );
});

// Get single expense
router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid id" });
  const [row] = await db.select().from(expensesTable).where(eq(expensesTable.id, id));
  if (!row) return res.status(404).json({ error: "Expense not found" });
  return res.json(toNum(row as unknown as Record<string, unknown>));
});

// Create expense
router.post("/", async (req, res) => {
  const parsed = CreateExpenseBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
  }
  const { category, description, amount, expenseDate, paymentMode, paidTo, approvedBy, notes } = parsed.data;

  const expId = await generateExpenseId();
  const [expense] = await db
    .insert(expensesTable)
    .values({
      expenseId: expId,
      category,
      description,
      amount: String(amount),
      expenseDate,
      paymentMode: paymentMode || "cash",
      paidTo: paidTo ?? null,
      approvedBy: approvedBy ?? null,
      notes: notes ?? null,
    })
    .returning();

  return res.status(201).json(toNum(expense as unknown as Record<string, unknown>));
});

// Update expense
router.patch("/:id", async (req, res) => {
  const paramsParsed = UpdateExpenseParams.safeParse({ id: Number(req.params.id) });
  if (!paramsParsed.success) {
    return res.status(400).json({ error: "Invalid id" });
  }
  const bodyParsed = UpdateExpenseBody.safeParse(req.body);
  if (!bodyParsed.success) {
    return res.status(400).json({ error: "Invalid body", details: bodyParsed.error.issues });
  }
  const updates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(bodyParsed.data)) {
    if (v === undefined) continue;
    updates[k] = k === "amount" ? String(v) : v;
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: "No valid fields to update" });
  }
  const [expense] = await db
    .update(expensesTable)
    .set(updates)
    .where(eq(expensesTable.id, paramsParsed.data.id))
    .returning();
  if (!expense) return res.status(404).json({ error: "Expense not found" });
  return res.json(toNum(expense as unknown as Record<string, unknown>));
});

// ── Bill scan via Gemini Vision ────────────────────────────────────────────
// POST /api/expenses/scan-bill
// Body: { imageBase64: string; mimeType: string }
// Returns the extracted expense fields so the client can review before saving.
router.post("/scan-bill", async (req, res) => {
  const { imageBase64, mimeType } = req.body as { imageBase64?: string; mimeType?: string };
  if (!imageBase64 || !mimeType) {
    return res.status(400).json({ error: "imageBase64 and mimeType are required" });
  }
  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
  if (!allowedTypes.includes(mimeType)) {
    return res.status(400).json({ error: "Unsupported image type. Use JPEG, PNG, WebP, or HEIC." });
  }
  // Reject images >8 MB (base64 is ~33% larger than raw bytes)
  if (imageBase64.length > 11_000_000) {
    return res.status(400).json({ error: "Image too large. Maximum 8 MB." });
  }
  try {
    const result = await geminiOcrBill(imageBase64, mimeType);
    return res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ error: "AI extraction failed: " + msg });
  }
});

// Delete expense
router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid id" });
  const [expense] = await db.delete(expensesTable).where(eq(expensesTable.id, id)).returning();
  if (!expense) return res.status(404).json({ error: "Expense not found" });
  return res.json({ success: true });
});

export { router as expensesRouter };
