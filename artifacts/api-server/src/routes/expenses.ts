import { Router } from "express";
import { db } from "@workspace/db";
import { expensesTable, clinicSettingsTable } from "@workspace/db/schema";
import { eq, desc, and, gte, lte, ilike, sql } from "drizzle-orm";
import {
  CreateExpenseBody,
  UpdateExpenseBody,
  UpdateExpenseParams,
} from "@workspace/api-zod";
import { correctExpenseVoucher } from "../lib/auto-voucher";
import { preprocessScanImage } from "../lib/ocr/idCardPipeline";
import { ocrBill } from "../lib/ocr/localDocumentOcr";
import { auditFromRequest } from "../lib/audit";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";
import {
  createExpenseV2,
  enrichExpenseList,
  findDuplicateExpenses,
  hashReceiptImage,
  listExpenseCategories,
  listPayables,
  listPaymentsForExpense,
  recordExpensePayment,
  retryExpenseAccounting,
  voidExpense,
} from "../lib/expenseV2Service";

const router = Router();

function toNum(row: Record<string, unknown>) {
  return { ...row, amount: Number(row.amount ?? 0) };
}

function httpStatus(err: unknown): number {
  return typeof err === "object" && err !== null && "status" in err && typeof (err as { status: unknown }).status === "number"
    ? (err as { status: number }).status
    : 500;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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

function parseOptionalNumber(v: unknown): number | null | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// List expenses
router.get("/", async (req, res) => {
  const { category, from, to, paymentMode, search, paymentStatus } = req.query as Record<string, string>;

  const conditions = [
    category ? eq(expensesTable.category, category) : undefined,
    from ? gte(expensesTable.expenseDate, from) : undefined,
    to ? lte(expensesTable.expenseDate, to) : undefined,
    paymentMode ? eq(expensesTable.paymentMode, paymentMode) : undefined,
    paymentStatus ? eq(expensesTable.paymentStatus, paymentStatus) : undefined,
    search ? ilike(expensesTable.description, `%${search}%`) : undefined,
    sql`${expensesTable.paymentStatus} <> 'VOID'`,
  ].filter(Boolean);

  const rows = await db
    .select({
      id: expensesTable.id,
      expenseId: expensesTable.expenseId,
      category: expensesTable.category,
      description: expensesTable.description,
      amount: expensesTable.amount,
      billAmount: expensesTable.billAmount,
      taxAmount: expensesTable.taxAmount,
      expenseDate: expensesTable.expenseDate,
      paymentMode: expensesTable.paymentMode,
      paymentStatus: expensesTable.paymentStatus,
      accountingStatus: expensesTable.accountingStatus,
      paidTo: expensesTable.paidTo,
      vendorId: expensesTable.vendorId,
      vendorNameSnapshot: expensesTable.vendorNameSnapshot,
      invoiceNumber: expensesTable.invoiceNumber,
      invoiceDate: expensesTable.invoiceDate,
      departmentId: expensesTable.departmentId,
      categoryId: expensesTable.categoryId,
      subcategoryId: expensesTable.subcategoryId,
      voucherId: expensesTable.voucherId,
      accrualVoucherId: expensesTable.accrualVoucherId,
      approvedBy: expensesTable.approvedBy,
      notes: expensesTable.notes,
      hasReceipt: sql<boolean>`(${expensesTable.receiptImageUrl} is not null)`,
      createdAt: expensesTable.createdAt,
      updatedAt: expensesTable.updatedAt,
    })
    .from(expensesTable)
    .where(conditions.length ? and(...(conditions as Parameters<typeof and>)) : undefined)
    .orderBy(desc(expensesTable.expenseDate), desc(expensesTable.createdAt));

  const enriched = await enrichExpenseList(rows as Array<Record<string, unknown> & { id: number }>);
  return res.json(enriched);
});

// Summary by category
router.get("/summary", async (req, res) => {
  const { from, to } = req.query as Record<string, string>;

  const conditions = [
    from ? gte(expensesTable.expenseDate, from) : undefined,
    to ? lte(expensesTable.expenseDate, to) : undefined,
    sql`${expensesTable.paymentStatus} <> 'VOID'`,
  ].filter(Boolean);

  const rows = await db
    .select({
      category: expensesTable.category,
      total: sql<string>`sum(COALESCE(${expensesTable.billAmount}, ${expensesTable.amount}))`,
      count: sql<number>`count(*)`,
    })
    .from(expensesTable)
    .where(conditions.length ? and(...(conditions as Parameters<typeof and>)) : undefined)
    .groupBy(expensesTable.category)
    .orderBy(sql`sum(COALESCE(${expensesTable.billAmount}, ${expensesTable.amount})) desc`);

  return res.json(
    rows.map((r) => ({ category: r.category, total: Number(r.total ?? 0), count: Number(r.count) })),
  );
});

// V2 category master — register BEFORE /:id
router.get("/categories", async (_req, res) => {
  const rows = await listExpenseCategories();
  return res.json(rows);
});

// Open payables — register BEFORE /:id
router.get("/payables", async (req, res) => {
  const { from, to } = req.query as Record<string, string>;
  const result = await listPayables({ from, to });
  // { items, summary } — cash/digital totals come from expense_payments rows.
  return res.json(result);
});

// POST /api/expenses/scan-bill — Ollama vision (Gemini is not used).
router.post("/scan-bill", async (req, res) => {
  const { imageBase64, mimeType, useGeminiFallback } = req.body as {
    imageBase64?: string;
    mimeType?: string;
    useGeminiFallback?: boolean;
  };
  if (!imageBase64 || !mimeType) {
    return res.status(400).json({ error: "imageBase64 and mimeType are required" });
  }
  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];
  if (!allowedTypes.includes(mimeType)) {
    return res.status(400).json({ error: "Unsupported file type. Use JPEG, PNG, WebP, HEIC, or PDF." });
  }
  if (imageBase64.length > 11_000_000) {
    return res.status(400).json({ error: "File too large. Maximum 8 MB." });
  }
  try {
    const pre = await preprocessScanImage(imageBase64, mimeType);
    const result = await ocrBill(pre.buffer.toString("base64"), pre.mimeType, {
      useGeminiFallback: Boolean(useGeminiFallback),
    });
    return res.json({ ...result, blurScore: pre.blurScore, isBlurred: pre.isBlurred });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ error: "AI extraction failed: " + msg });
  }
});

// Get single expense
router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid id" });
  const [row] = await db.select().from(expensesTable).where(eq(expensesTable.id, id));
  if (!row) return res.status(404).json({ error: "Expense not found" });
  const [enriched] = await enrichExpenseList([row as unknown as Record<string, unknown> & { id: number }]);
  return res.json(enriched);
});

router.get("/:id/payments", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid id" });
  const [expense] = await db.select({ id: expensesTable.id }).from(expensesTable).where(eq(expensesTable.id, id));
  if (!expense) return res.status(404).json({ error: "Expense not found" });
  const payments = await listPaymentsForExpense(id);
  return res.json(
    payments.map((p) => ({
      ...p,
      amount: Number(p.amount),
    })),
  );
});

router.post("/:id/payments", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid id" });

  const body = req.body as Record<string, unknown>;
  const amount = Number(body.amount);
  const paymentDate = typeof body.paymentDate === "string" ? body.paymentDate.trim() : "";
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "Payment amount must be greater than zero" });
  }
  if (!paymentDate) {
    return res.status(400).json({ error: "paymentDate is required" });
  }

  const session = (req as StaffAuthRequest).staffSession;
  const createdBy = session?.subjectName?.trim() || null;

  try {
    const result = await recordExpensePayment({
      expensePk: id,
      amount,
      paymentDate,
      paymentMode: typeof body.paymentMode === "string" ? body.paymentMode : undefined,
      paidFromAccountId: parseOptionalNumber(body.paidFromAccountId) ?? null,
      referenceNumber: typeof body.referenceNumber === "string" ? body.referenceNumber : null,
      notes: typeof body.notes === "string" ? body.notes : null,
      createdBy,
    });
    return res.status(201).json({
      expense: toNum(result.expense as unknown as Record<string, unknown>),
      payment: { ...result.payment, amount: Number(result.payment.amount) },
      money: result.money,
    });
  } catch (err) {
    return res.status(httpStatus(err)).json({ error: errMessage(err) });
  }
});

router.post("/:id/void", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid id" });

  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (reason.length < 3) {
    return res.status(400).json({ error: "Void reason is required (min 3 characters)" });
  }

  const session = (req as StaffAuthRequest).staffSession;
  const voidedBy = session?.subjectName?.trim() || "staff";

  try {
    const expense = await voidExpense({ expensePk: id, reason, voidedBy });
    return res.json(toNum(expense as unknown as Record<string, unknown>));
  } catch (err) {
    return res.status(httpStatus(err)).json({ error: errMessage(err) });
  }
});

/** Admin-oriented idempotent accounting retry for FAILED/PENDING bills. */
router.post("/:id/accounting/retry", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid id" });
  const session = (req as StaffAuthRequest).staffSession;
  try {
    const result = await retryExpenseAccounting({
      expensePk: id,
      performedBy: session?.subjectName?.trim() || null,
    });
    return res.json({
      skipped: result.skipped,
      expense: toNum(result.expense as unknown as Record<string, unknown>),
      payments: result.payments.map((p) => ({ ...p, amount: Number(p.amount) })),
    });
  } catch (err) {
    return res.status(httpStatus(err)).json({ error: errMessage(err) });
  }
});

// Create expense (legacy + V2)
router.post("/", async (req, res) => {
  const parsed = CreateExpenseBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
  }
  const { category, description, amount, expenseDate, paymentMode, paidTo, approvedBy, notes } = parsed.data;

  const createdBy = (req as StaffAuthRequest).staffSession?.subjectName?.trim() || null;
  const approvedByInput = typeof approvedBy === "string" ? approvedBy.trim() || null : null;
  const allowSelf = await isSelfApprovalAllowed();

  if (approvedByInput && !allowSelf && sameActor(approvedByInput, createdBy)) {
    return res.status(400).json({
      error: "Self-approval is currently disabled. This expense must be approved by someone other than its creator.",
    });
  }

  const resolvedApprovedBy = approvedByInput ?? (allowSelf && createdBy ? createdBy : null);

  const raw = req.body as Record<string, unknown>;
  const rawReceipt = raw.receiptImageUrl;
  const receiptImageUrl =
    typeof rawReceipt === "string" && rawReceipt.length > 0 && rawReceipt.length <= 6_000_000
      ? rawReceipt
      : null;

  const billAmount = parseOptionalNumber(raw.billAmount);
  const initialPaymentAmount = parseOptionalNumber(raw.initialPaymentAmount);
  const taxAmount = parseOptionalNumber(raw.taxAmount);
  const vendorId = parseOptionalNumber(raw.vendorId);
  const departmentId = parseOptionalNumber(raw.departmentId);
  const categoryId = parseOptionalNumber(raw.categoryId);
  const subcategoryId = parseOptionalNumber(raw.subcategoryId);
  const paidFromAccountId = parseOptionalNumber(raw.paidFromAccountId);

  const receiptHash = hashReceiptImage(receiptImageUrl);
  const dupes = await findDuplicateExpenses({
    vendorId: vendorId ?? null,
    vendorName: typeof raw.vendorNameSnapshot === "string" ? raw.vendorNameSnapshot : paidTo,
    invoiceNumber: typeof raw.invoiceNumber === "string" ? raw.invoiceNumber : null,
    billAmount: billAmount ?? amount,
    expenseDate,
    receiptImageHash: receiptHash,
  });

  try {
    const result = await createExpenseV2({
      category,
      description,
      amount,
      billAmount: billAmount ?? undefined,
      taxAmount: taxAmount ?? null,
      initialPaymentAmount: initialPaymentAmount ?? undefined,
      expenseDate,
      paymentMode: paymentMode || "cash",
      paidTo: paidTo ?? null,
      approvedBy: resolvedApprovedBy,
      createdBy,
      notes: notes ?? null,
      receiptImageUrl,
      vendorId: vendorId ?? null,
      vendorNameSnapshot: typeof raw.vendorNameSnapshot === "string" ? raw.vendorNameSnapshot : null,
      invoiceNumber: typeof raw.invoiceNumber === "string" ? raw.invoiceNumber : null,
      invoiceDate: typeof raw.invoiceDate === "string" ? raw.invoiceDate : null,
      departmentId: departmentId ?? null,
      categoryId: categoryId ?? null,
      subcategoryId: subcategoryId ?? null,
      paidFromAccountId: paidFromAccountId ?? null,
      referenceNumber: typeof raw.referenceNumber === "string" ? raw.referenceNumber : null,
      paymentDate: typeof raw.paymentDate === "string" ? raw.paymentDate : null,
      ocrMetaJson: typeof raw.ocrMetaJson === "string" ? raw.ocrMetaJson : null,
    });

    // If the create carried an AI-scan / form receipt data-URL, also persist it
    // as a filesystem attachment so the same document appears under Attachments
    // without requiring a second upload. Does not change money/accounting.
    let attachments: unknown[] = [];
    if (receiptImageUrl) {
      try {
        const { attachFromReceiptDataUrl, toAttachmentDto } = await import("../lib/expenseAttachments");
        const staff = (req as StaffAuthRequest).staffSession;
        const linked = await attachFromReceiptDataUrl({
          expensePk: result.expense.id,
          receiptImageUrl,
          uploadedBy: createdBy,
          uploadedById: staff?.subjectId ?? null,
          attachAnyway: true,
        });
        attachments = [toAttachmentDto(linked.attachment)];
      } catch (attachErr) {
        // Non-fatal: expense is already created; attachment can be added later.
        console.warn("[expenses] failed to persist AI-scan receipt as attachment", attachErr);
      }
    }

    return res.status(201).json({
      ...toNum(result.expense as unknown as Record<string, unknown>),
      billAmount: result.money.billAmount,
      totalPaid: result.money.totalPaid,
      balanceDue: result.money.balanceDue,
      paymentStatus: result.money.paymentStatus,
      duplicateWarnings: dupes.strong.length || dupes.soft.length ? dupes : undefined,
      attachments,
      attachmentCount: attachments.length,
    });
  } catch (err) {
    return res.status(httpStatus(err)).json({ error: errMessage(err) });
  }
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
  const [before] = await db.select().from(expensesTable).where(eq(expensesTable.id, paramsParsed.data.id));
  if (!before) return res.status(404).json({ error: "Expense not found" });

  // V2: expense_payments is canonical. Never let header financial fields diverge —
  // require Void + re-enter for amount / paymentMode / category on any bill that
  // has a billAmount, payments, or non-null accounting status other than blank legacy.
  const touchingFinancial =
    bodyParsed.data.amount !== undefined ||
    bodyParsed.data.paymentMode !== undefined ||
    bodyParsed.data.category !== undefined;
  if (touchingFinancial) {
    return res.status(400).json({
      error:
        "Cannot edit amount / payment mode / category on a posted expense. Void and re-enter the bill (metadata-only fields remain editable).",
    });
  }

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

  const session = (req as StaffAuthRequest).staffSession;
  const amountChanged = bodyParsed.data.amount !== undefined && Number(bodyParsed.data.amount) !== Number(before.amount);
  const modeChanged = bodyParsed.data.paymentMode !== undefined && bodyParsed.data.paymentMode !== before.paymentMode;
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
      reason:
        (typeof req.body?.reason === "string" && req.body.reason.trim()) ||
        "expense edited — ledger voucher reversed and reposted",
    });
    correctExpenseVoucher({
      expenseId: expense.expenseId,
      amount: Number(expense.amount),
      paymentMode: expense.paymentMode || "cash",
      category: expense.category,
      description: expense.description,
      performedBy: session?.subjectName ?? expense.approvedBy ?? null,
    }).catch(() => {
      /* already logged inside */
    });
  }

  return res.json(toNum(expense as unknown as Record<string, unknown>));
});

// Delete expense → void (requires reason)
router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid id" });

  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (reason.length < 3) {
    return res.status(400).json({ error: "Void reason is required (min 3 characters)" });
  }

  const [expense] = await db.select().from(expensesTable).where(eq(expensesTable.id, id));
  if (!expense) return res.status(404).json({ error: "Expense not found" });

  const session = (req as StaffAuthRequest).staffSession;
  const voidedBy = session?.subjectName?.trim() || "staff";

  try {
    const voided = await voidExpense({ expensePk: id, reason, voidedBy });

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
      reason: reason || "expense voided",
    });

    return res.json({ success: true, expense: toNum(voided as unknown as Record<string, unknown>) });
  } catch (err) {
    return res.status(httpStatus(err)).json({ error: errMessage(err) });
  }
});


// ── Attachments (documentary only — no accounting side effects) ─────────────

router.get("/:id/attachments", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  try {
    const { listExpenseAttachments, toAttachmentDto } = await import("../lib/expenseAttachments");
    const rows = await listExpenseAttachments(id);
    return res.json(rows.map(toAttachmentDto));
  } catch (err) {
    return res.status(httpStatus(err)).json({ error: errMessage(err) });
  }
});

router.post("/:id/attachments", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });

  const body = req.body as Record<string, unknown>;
  const fileName = typeof body.fileName === "string" ? body.fileName : "";
  const mimeType = typeof body.mimeType === "string" ? body.mimeType : "";
  const base64Data = typeof body.base64Data === "string" ? body.base64Data : "";
  const sourceRaw = typeof body.source === "string" ? body.source : "MANUAL_UPLOAD";
  const documentType =
    typeof body.documentType === "string" ? body.documentType : "supporting_document";
  const attachAnyway = body.attachAnyway === true || body.attachAnyway === "true";
  const notes = typeof body.notes === "string" ? body.notes : null;

  if (!fileName || !mimeType || !base64Data) {
    return res.status(400).json({ error: "fileName, mimeType, and base64Data are required" });
  }

  const source =
    sourceRaw === "CAMERA" || sourceRaw === "AI_SCAN" || sourceRaw === "MANUAL_UPLOAD"
      ? sourceRaw
      : "MANUAL_UPLOAD";

  try {
    const {
      createExpenseAttachment,
      decodeDataUrlOrBase64,
      toAttachmentDto,
      findDuplicateExpenseAttachments,
      hashFileBuffer,
      findLegacyReceiptHashDuplicates,
      legacyReceiptHashFromDataUrl,
    } = await import("../lib/expenseAttachments");

    const { buffer } = decodeDataUrlOrBase64(
      base64Data.startsWith("data:") ? base64Data : `data:${mimeType};base64,${base64Data}`,
    );

    if (!attachAnyway) {
      const contentHash = hashFileBuffer(buffer);
      const dups = await findDuplicateExpenseAttachments(contentHash);
      const legacyHash = legacyReceiptHashFromDataUrl(
        base64Data.startsWith("data:") ? base64Data : `data:${mimeType};base64,${base64Data}`,
      );
      const legacyDups = legacyHash ? await findLegacyReceiptHashDuplicates(legacyHash) : [];
      const all = [...dups, ...legacyDups];
      if (all.length) {
        return res.status(409).json({
          error: "Duplicate document detected",
          duplicates: all,
        });
      }
    }

    const staff = (req as StaffAuthRequest).staffSession;
    const result = await createExpenseAttachment({
      expensePk: id,
      buffer,
      mimeType,
      originalFilename: fileName,
      source,
      documentType: documentType as
        | "bill"
        | "invoice"
        | "receipt"
        | "cash_memo"
        | "supporting_document",
      uploadedBy: staff?.subjectName ?? null,
      uploadedById: staff?.subjectId ?? null,
      notes,
      attachAnyway,
    });

    return res.status(201).json({
      attachment: toAttachmentDto(result.attachment),
      duplicates: result.duplicates.length ? result.duplicates : undefined,
    });
  } catch (err) {
    const status = httpStatus(err);
    const duplicates =
      typeof err === "object" && err !== null && "duplicates" in err
        ? (err as { duplicates: unknown }).duplicates
        : undefined;
    return res.status(status).json({ error: errMessage(err), duplicates });
  }
});

router.get("/:id/attachments/:attachmentId/file", async (req, res) => {
  const id = Number(req.params.id);
  const attachmentId = Number(req.params.attachmentId);
  if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(attachmentId) || attachmentId <= 0) {
    return res.status(400).json({ error: "Invalid id" });
  }
  try {
    const { getExpenseAttachment, readAttachmentFile } = await import("../lib/expenseAttachments");
    const row = await getExpenseAttachment(id, attachmentId);
    if (!row) return res.status(404).json({ error: "Attachment not found" });
    const buf = readAttachmentFile(row.storagePath);
    const asDownload = req.query.download === "1" || req.query.download === "true";
    res.setHeader("Content-Type", row.mimeType);
    res.setHeader("Content-Length", String(buf.byteLength));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Disposition",
      `${asDownload ? "attachment" : "inline"}; filename="${row.originalFilename.replace(/"/g, "")}"`,
    );
    res.setHeader("Cache-Control", "private, max-age=3600");
    return res.send(buf);
  } catch (err) {
    return res.status(httpStatus(err)).json({ error: errMessage(err) });
  }
});

router.delete("/:id/attachments/:attachmentId", async (req, res) => {
  const id = Number(req.params.id);
  const attachmentId = Number(req.params.attachmentId);
  if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(attachmentId) || attachmentId <= 0) {
    return res.status(400).json({ error: "Invalid id" });
  }
  try {
    const { softDeleteExpenseAttachment, toAttachmentDto } = await import("../lib/expenseAttachments");
    const staff = (req as StaffAuthRequest).staffSession;
    const updated = await softDeleteExpenseAttachment({
      expensePk: id,
      attachmentId,
      deletedBy: staff?.subjectName ?? null,
    });
    return res.json({ success: true, attachment: toAttachmentDto(updated) });
  } catch (err) {
    return res.status(httpStatus(err)).json({ error: errMessage(err) });
  }
});


export { router as expensesRouter };
