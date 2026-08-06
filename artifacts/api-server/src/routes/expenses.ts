import { Router } from "express";
import { db } from "@workspace/db";
import { expensesTable, expenseCounterTable, clinicSettingsTable } from "@workspace/db/schema";
import { eq, desc, and, gte, lte, ilike, sql } from "drizzle-orm";
import {
  CreateExpenseBody,
  UpdateExpenseBody,
  UpdateExpenseParams,
} from "@workspace/api-zod";
import { geminiOcrBill } from "@workspace/integrations-gemini-ai";
import { getProviderApiKey } from "@workspace/ai-providers";
import { autoVoucherForExpense, correctExpenseVoucher } from "../lib/auto-voucher";
import { preprocessScanImage } from "../lib/ocr/idCardPipeline";
import { auditFromRequest } from "../lib/audit";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";

const router = Router();

function toNum(row: Record<string, unknown>) {
  return { ...row, amount: Number(row.amount ?? 0) };
}

// Admin-configurable separation-of-duties switch (Settings). Defaults to
// allowed (true) when the settings row doesn't exist yet, matching the
// clinic_settings.expense_self_approval_allowed column default — self-approval
// is today's real behaviour, not a regression, until an admin turns it off.
async function isSelfApprovalAllowed(): Promise<boolean> {
  const [row] = await db
    .select({ v: clinicSettingsTable.expenseSelfApprovalAllowed })
    .from(clinicSettingsTable)
    .limit(1);
  return row?.v ?? true;
}

/** Case/whitespace-insensitive name compare — both sides are free text. */
function sameActor(a: string | null | undefined, b: string | null | undefined): boolean {
  const an = (a ?? "").trim().toLowerCase();
  const bn = (b ?? "").trim().toLowerCase();
  return an.length > 0 && an === bn;
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

  // Explicit column list that EXCLUDES receipt_image_url — the scanned image can
  // be large, and selecting it for every row would bloat this list response.
  // A lightweight `hasReceipt` flag lets the UI show an indicator; the image
  // itself is fetched only via GET /expenses/:id when a receipt is opened.
  const rows = await db
    .select({
      id: expensesTable.id,
      expenseId: expensesTable.expenseId,
      category: expensesTable.category,
      description: expensesTable.description,
      amount: expensesTable.amount,
      expenseDate: expensesTable.expenseDate,
      paymentMode: expensesTable.paymentMode,
      paidTo: expensesTable.paidTo,
      voucherId: expensesTable.voucherId,
      approvedBy: expensesTable.approvedBy,
      notes: expensesTable.notes,
      hasReceipt: sql<boolean>`(${expensesTable.receiptImageUrl} is not null)`,
      createdAt: expensesTable.createdAt,
      updatedAt: expensesTable.updatedAt,
    })
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

  // Session-derived, never client-editable — same convention as the audit
  // actors in bills.ts. This is what the approval-separation check below
  // compares approvedBy against.
  const createdBy = (req as StaffAuthRequest).staffSession?.subjectName?.trim() || null;

  if (approvedBy && !(await isSelfApprovalAllowed()) && sameActor(approvedBy, createdBy)) {
    return res.status(400).json({
      error: "Self-approval is currently disabled. This expense must be approved by someone other than its creator.",
    });
  }

  // Optional scanned receipt image (data URL). Read directly from the body —
  // it's not part of the generated CreateExpenseBody schema (which strips it),
  // so no generated code needs changing. Bounded to ~6MB of base64 to reject
  // absurd payloads while comfortably fitting an enhanced JPEG.
  const rawReceipt = (req.body as Record<string, unknown>)?.receiptImageUrl;
  const receiptImageUrl =
    typeof rawReceipt === "string" && rawReceipt.length > 0 && rawReceipt.length <= 6_000_000
      ? rawReceipt
      : null;

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
      createdBy,
      notes: notes ?? null,
      receiptImageUrl,
    })
    .returning();

  // Auto-generate Payment Voucher for the expense (fire-and-forget, non-blocking)
  autoVoucherForExpense({
    expenseId: expId,
    amount,
    paymentMode: paymentMode || "cash",
    category,
    description,
    performedBy: approvedBy ?? null,
  }).catch(() => {/* already logged inside */});

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
  // Snapshot the pre-edit row so the audit trail records what actually changed.
  const [before] = await db.select().from(expensesTable).where(eq(expensesTable.id, paramsParsed.data.id));
  if (!before) return res.status(404).json({ error: "Expense not found" });

  if (
    typeof updates.approvedBy === "string" &&
    updates.approvedBy &&
    !(await isSelfApprovalAllowed()) &&
    sameActor(updates.approvedBy, before.createdBy)
  ) {
    return res.status(400).json({
      error: "Self-approval is currently disabled. This expense must be approved by someone other than its creator.",
    });
  }

  const [expense] = await db
    .update(expensesTable)
    .set(updates)
    .where(eq(expensesTable.id, paramsParsed.data.id))
    .returning();
  if (!expense) return res.status(404).json({ error: "Expense not found" });

  // Amount / payment-mode edits: reverse the original PV and post the corrected
  // amount so the ledger matches the expense row (no silent double-count).
  const session = (req as StaffAuthRequest).staffSession;
  const amountChanged = bodyParsed.data.amount !== undefined && Number(bodyParsed.data.amount) !== Number(before.amount);
  const modeChanged   = bodyParsed.data.paymentMode !== undefined && bodyParsed.data.paymentMode !== before.paymentMode;
  const categoryChanged = bodyParsed.data.category !== undefined && bodyParsed.data.category !== before.category;
  if (amountChanged || modeChanged || categoryChanged) {
    await auditFromRequest(req, {
      userId: session?.subjectId ?? null,
      userName: session?.subjectName ?? "staff",
      role: session?.role ?? "staff",
      action: "edit",
      module: "accounting",
      entityType: "expense",
      entityId: before.expenseId,
      oldValue: JSON.stringify({ amount: before.amount, paymentMode: before.paymentMode, category: before.category }),
      newValue: JSON.stringify({ amount: expense.amount, paymentMode: expense.paymentMode, category: expense.category }),
      reason: (typeof req.body?.reason === "string" && req.body.reason.trim())
        || "expense edited — ledger voucher reversed and reposted",
    });
    correctExpenseVoucher({
      expenseId: expense.expenseId,
      amount: Number(expense.amount),
      paymentMode: expense.paymentMode || "cash",
      category: expense.category,
      description: expense.description,
      performedBy: session?.subjectName ?? expense.approvedBy ?? null,
    }).catch(() => {/* already logged inside */});
  }

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
  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];
  if (!allowedTypes.includes(mimeType)) {
    return res.status(400).json({ error: "Unsupported file type. Use JPEG, PNG, WebP, HEIC, or PDF." });
  }
  // Reject files >8 MB (base64 is ~33% larger than raw bytes)
  if (imageBase64.length > 11_000_000) {
    return res.status(400).json({ error: "File too large. Maximum 8 MB." });
  }
  try {
    // Same shared pre-processing (auto-orient/trim/normalize + blur score)
    // used by Form F's ID-card OCR — wraps, does not replace, geminiOcrBill.
    // Resolve the Gemini key from DB-backed AI Provider Settings first, env
    // var fallback second — same fix applied to Form F's OCR in an earlier
    // phase, applied here too so a key configured in Settings isn't ignored.
    const pre = await preprocessScanImage(imageBase64, mimeType);
    const dbApiKey = await getProviderApiKey("gemini").catch(() => null);
    const result = await geminiOcrBill(
      pre.buffer.toString("base64"),
      pre.mimeType,
      dbApiKey ? { apiKey: dbApiKey } : {},
    );
    return res.json({ ...result, blurScore: pre.blurScore, isBlurred: pre.isBlurred });
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

  // Deleting an expense previously left no trace and orphaned its payment
  // voucher in the ledger. Record who deleted what — including the still-posted
  // voucherId — in the tamper-evident audit trail so the deletion is
  // attributable and the orphaned PV is traceable for reversal. (Auto-posting
  // the reversing voucher needs the locked-vouchers reversal path and is a
  // separate change.)
  const session = (req as StaffAuthRequest).staffSession;
  await auditFromRequest(req, {
    userId: session?.subjectId ?? null,
    userName: session?.subjectName ?? "staff",
    role: session?.role ?? "staff",
    action: "delete",
    module: "accounting",
    entityType: "expense",
    entityId: expense.expenseId,
    oldValue: JSON.stringify({
      amount: expense.amount,
      paymentMode: expense.paymentMode,
      category: expense.category,
      voucherId: expense.voucherId ?? null,
    }),
    reason: (typeof req.body?.reason === "string" && req.body.reason.trim())
      || "expense deleted (ledger voucher reversal pending)",
  });

  return res.json({ success: true });
});

export { router as expensesRouter };
