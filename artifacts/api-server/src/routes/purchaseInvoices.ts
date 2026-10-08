/**
 * purchaseInvoices.ts — scan a supplier/vendor invoice (image or PDF), OCR +
 * catalog-match its line items, and post it as stock-in once staff confirm
 * the extraction. Mounted under /api/purchase-invoices, same /inventory
 * permission as the manual "Stock In" flow this complements — a scanned
 * invoice with N line items is just N Stock-In calls with one shared
 * vendor/invoice#, atomically posted together instead of typed one at a time.
 *
 * Flow:
 *   1. POST /scan       — OCR the invoice, fuzzy-match every line against the
 *                          inventory catalog, return suggestions. Nothing is
 *                          persisted here — pure "what does the invoice say".
 *   2. (staff reviews/edits vendor, matches, quantities, costs in the UI)
 *   3. POST /            — persist the reviewed header + line items as a
 *                          DRAFT invoice. No stock impact yet.
 *   4. POST /:id/post    — post a draft: every line with a matched itemId and
 *                          quantity > 0 becomes an inventoryBatchesTable +
 *                          inventoryTransactionsTable row via the same
 *                          receiveBatchTx() the manual flow uses, all in one
 *                          transaction. Unmatched lines are skipped, not
 *                          blocking — reported back so staff can match them
 *                          later via the ordinary Stock-In form.
 */
import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  purchaseInvoicesTable,
  purchaseInvoiceLineItemsTable,
  inventoryItemsTable,
  vendorsTable,
} from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { preprocessScanImage } from "../lib/ocr/idCardPipeline";
import { ocrInvoice } from "../lib/ocr/localDocumentOcr";
import { matchInvoiceLineToCatalog, AUTO_MATCH_THRESHOLD } from "../lib/invoiceLineMatching";
import { receiveBatchTx } from "./inventoryBatches";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";

const router = Router();
const n = (v: unknown): number => (v == null ? 0 : Number(v));

interface RawLineItem { description: string; quantity: number; unitCost: number; lineTotal: number }

/** Best-effort vendor match by exact/case-insensitive name — shared by both
 *  /scan (Gemini) and /match-lines (Tesseract fallback), since either path
 *  starts from the same free-text vendor name a document actually printed. */
async function lookupVendorByName(name: string): Promise<number | null> {
  if (!name.trim()) return null;
  const vendors = await db.select({ id: vendorsTable.id, name: vendorsTable.name })
    .from(vendorsTable).where(eq(vendorsTable.isActive, true));
  const hit = vendors.find((v) => v.name.trim().toLowerCase() === name.trim().toLowerCase());
  return hit?.id ?? null;
}

/** Fuzzy-match every line against the live inventory catalog. Shared by both
 *  /scan and /match-lines so a catalog-matching change (threshold, scoring)
 *  applies identically no matter which OCR engine produced the line items. */
async function matchLinesToCatalog(lineItems: RawLineItem[]) {
  const catalog = await db.select({ id: inventoryItemsTable.id, name: inventoryItemsTable.name })
    .from(inventoryItemsTable).where(eq(inventoryItemsTable.isActive, true));
  return lineItems.map((li) => {
    const match = matchInvoiceLineToCatalog(li.description, catalog);
    return {
      descriptionRaw: li.description,
      quantity: li.quantity,
      unitCost: li.unitCost,
      lineTotal: li.lineTotal,
      suggestedItemId: match.confidence >= AUTO_MATCH_THRESHOLD ? match.itemId : null,
      suggestedItemName: match.confidence >= AUTO_MATCH_THRESHOLD ? match.itemName : null,
      matchConfidence: match.confidence,
    };
  });
}

// ── POST /scan — OCR + catalog-match, no persistence ──────────────────────
router.post("/scan", async (req, res) => {
  const { imageBase64, mimeType, useGeminiFallback } = req.body as {
    imageBase64?: string; mimeType?: string; useGeminiFallback?: boolean;
  };
  if (!imageBase64 || !mimeType) {
    res.status(400).json({ error: "imageBase64 and mimeType are required" });
    return;
  }
  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];
  if (!allowedTypes.includes(mimeType)) {
    res.status(400).json({ error: "Unsupported file type. Use JPEG, PNG, WebP, HEIC, or PDF." });
    return;
  }
  if (imageBase64.length > 11_000_000) {
    res.status(400).json({ error: "File too large. Maximum 8 MB." });
    return;
  }

  try {
    const pre = await preprocessScanImage(imageBase64, mimeType);
    const ocr = await ocrInvoice(pre.buffer.toString("base64"), pre.mimeType, {
      useGeminiFallback: Boolean(useGeminiFallback),
    });

    const [vendorId, lineItems] = await Promise.all([
      lookupVendorByName(ocr.vendor),
      matchLinesToCatalog(ocr.lineItems),
    ]);

    res.json({
      vendor: ocr.vendor,
      vendorId,
      invoiceNumber: ocr.invoiceNumber,
      date: ocr.date,
      subtotal: ocr.subtotal,
      gstAmount: ocr.gstAmount,
      totalAmount: ocr.totalAmount,
      confidence: ocr.confidence,
      confidencePercent: ocr.confidencePercent,
      ocrProvider: ocr.ocrProvider,
      tesseractFallbackSuggested: ocr.tesseractFallbackSuggested,
      geminiFallbackAvailable: ocr.geminiFallbackAvailable,
      lineItems,
      blurScore: pre.blurScore,
      isBlurred: pre.isBlurred,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: "AI extraction failed: " + msg });
  }
});

// ── POST /match-lines — catalog-match ONLY, no OCR call ────────────────────
// Used by the fully-offline Tesseract.js fallback (PurchaseInvoiceScannerPanel):
// the client runs OCR + a deterministic text parser locally (no server round
// trip, no Gemini/cloud dependency for the extraction itself), then calls
// this to get the same catalog-match suggestions /scan would have produced —
// matching needs the live DB catalog, so it can't happen fully client-side
// regardless of which OCR engine ran.
const MatchLinesBody = z.object({
  vendor: z.string().trim().default(""),
  lineItems: z.array(z.object({
    description: z.string().trim().min(1),
    quantity: z.number(),
    unitCost: z.number(),
    lineTotal: z.number(),
  })),
});

router.post("/match-lines", async (req, res) => {
  const parsed = MatchLinesBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request", details: parsed.error.issues }); return; }
  const { vendor, lineItems } = parsed.data;

  const [vendorId, matched] = await Promise.all([
    lookupVendorByName(vendor),
    matchLinesToCatalog(lineItems),
  ]);
  res.json({ vendorId, lineItems: matched });
});

// ── POST / — persist the reviewed invoice as a draft (no stock impact) ────
const LineItemBody = z.object({
  itemId: z.number().int().positive().nullish(),
  descriptionRaw: z.string().trim().min(1),
  matchConfidence: z.number().min(0).max(100).nullish(),
  quantity: z.number().positive(),
  unitCost: z.number().nonnegative(),
  lineTotal: z.number().nonnegative(),
  lotNumber: z.string().trim().nullish(),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});

const CreateInvoiceBody = z.object({
  invoiceNumber: z.string().trim().min(1),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  vendorId: z.number().int().positive().nullish(),
  vendorNameRaw: z.string().trim().nullish(),
  subtotal: z.number().nonnegative().default(0),
  gstAmount: z.number().nonnegative().default(0),
  totalAmount: z.number().nonnegative().default(0),
  sourceImageUrl: z.string().nullish(),
  ocrConfidence: z.enum(["high", "medium", "low"]).nullish(),
  ocrConfidencePercent: z.number().int().min(0).max(100).nullish(),
  notes: z.string().trim().nullish(),
  lineItems: z.array(LineItemBody).min(1),
});

router.post("/", async (req: StaffAuthRequest, res) => {
  const parsed = CreateInvoiceBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request", details: parsed.error.issues }); return; }
  const b = parsed.data;

  try {
    const result = await db.transaction(async (tx) => {
      const [invoice] = await tx.insert(purchaseInvoicesTable).values({
        invoiceNumber: b.invoiceNumber,
        invoiceDate: b.invoiceDate ?? null,
        vendorId: b.vendorId ?? null,
        vendorNameRaw: b.vendorNameRaw ?? null,
        subtotal: String(b.subtotal),
        gstAmount: String(b.gstAmount),
        totalAmount: String(b.totalAmount),
        status: "draft",
        sourceImageUrl: b.sourceImageUrl ?? null,
        ocrConfidence: b.ocrConfidence ?? null,
        ocrConfidencePercent: b.ocrConfidencePercent ?? null,
        notes: b.notes ?? null,
        createdBy: req.staffSession?.subjectName ?? null,
      }).returning();

      const lines = await tx.insert(purchaseInvoiceLineItemsTable).values(
        b.lineItems.map((li) => ({
          invoiceId: invoice.id,
          itemId: li.itemId ?? null,
          descriptionRaw: li.descriptionRaw,
          matchConfidence: li.matchConfidence == null ? null : String(li.matchConfidence),
          quantity: String(li.quantity),
          unitCost: String(li.unitCost),
          lineTotal: String(li.lineTotal),
          lotNumber: li.lotNumber ?? null,
          expiryDate: li.expiryDate ?? null,
        }))
      ).returning();

      return { invoice, lines };
    });
    res.status(201).json(result);
  } catch {
    res.status(500).json({ error: "Failed to save invoice" });
  }
});

// ── GET / — list invoices (newest first) ───────────────────────────────────
router.get("/", async (_req, res) => {
  const rows = await db.select().from(purchaseInvoicesTable).orderBy(desc(purchaseInvoicesTable.createdAt)).limit(200);
  res.json(rows.map((r) => ({
    ...r, subtotal: n(r.subtotal), gstAmount: n(r.gstAmount), totalAmount: n(r.totalAmount),
  })));
});

// ── GET /:id — invoice + line items ─────────────────────────────────────────
router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) { res.status(400).json({ error: "Invalid id" }); return; }
  const [invoice] = await db.select().from(purchaseInvoicesTable).where(eq(purchaseInvoicesTable.id, id)).limit(1);
  if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }
  const lines = await db.select().from(purchaseInvoiceLineItemsTable).where(eq(purchaseInvoiceLineItemsTable.invoiceId, id));
  res.json({
    ...invoice, subtotal: n(invoice.subtotal), gstAmount: n(invoice.gstAmount), totalAmount: n(invoice.totalAmount),
    lineItems: lines.map((l) => ({
      ...l, quantity: n(l.quantity), unitCost: n(l.unitCost), lineTotal: n(l.lineTotal),
      matchConfidence: l.matchConfidence == null ? null : n(l.matchConfidence),
    })),
  });
});

// ── POST /:id/post — fan matched line items out into stock-in, atomically ──
router.post("/:id/post", async (req: StaffAuthRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const result = await db.transaction(async (tx) => {
      const [invoice] = await tx.select().from(purchaseInvoicesTable).where(eq(purchaseInvoicesTable.id, id)).limit(1);
      if (!invoice) throw new Error("NOT_FOUND");
      if (invoice.status !== "draft") throw new Error("NOT_DRAFT");

      const lines = await tx.select().from(purchaseInvoiceLineItemsTable).where(eq(purchaseInvoiceLineItemsTable.invoiceId, id));

      const posted: number[] = [];
      const skipped: { lineItemId: number; descriptionRaw: string; reason: string }[] = [];
      for (const line of lines) {
        const qty = n(line.quantity);
        if (!line.itemId) { skipped.push({ lineItemId: line.id, descriptionRaw: line.descriptionRaw, reason: "not matched to a catalog item" }); continue; }
        if (qty <= 0) { skipped.push({ lineItemId: line.id, descriptionRaw: line.descriptionRaw, reason: "quantity is zero" }); continue; }
        await receiveBatchTx(tx, {
          itemId: line.itemId,
          lotNumber: line.lotNumber ?? "",
          expiryDate: line.expiryDate ?? null,
          quantity: qty,
          unitCost: n(line.unitCost),
          vendorId: invoice.vendorId,
          invoiceNumber: invoice.invoiceNumber,
          performedBy: req.staffSession?.subjectName ?? null,
        });
        posted.push(line.id);
      }

      const [updated] = await tx.update(purchaseInvoicesTable)
        .set({ status: "posted", postedAt: new Date() })
        .where(eq(purchaseInvoicesTable.id, id))
        .returning();

      return { invoice: updated, posted, skipped };
    });
    res.json(result);
  } catch (e: unknown) {
    const msg = String((e as Error)?.message);
    if (msg === "NOT_FOUND") { res.status(404).json({ error: "Invoice not found" }); return; }
    if (msg === "NOT_DRAFT") { res.status(409).json({ error: "Invoice is not a draft — it was already posted or cancelled" }); return; }
    res.status(500).json({ error: "Failed to post invoice" });
  }
});

// ── POST /:id/cancel — cancel a draft (no stock impact to undo) ────────────
router.post("/:id/cancel", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) { res.status(400).json({ error: "Invalid id" }); return; }
  const [invoice] = await db.select().from(purchaseInvoicesTable).where(eq(purchaseInvoicesTable.id, id)).limit(1);
  if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }
  if (invoice.status !== "draft") { res.status(409).json({ error: "Only a draft invoice can be cancelled" }); return; }
  const [updated] = await db.update(purchaseInvoicesTable).set({ status: "cancelled" }).where(eq(purchaseInvoicesTable.id, id)).returning();
  res.json(updated);
});

export { router as purchaseInvoicesRouter };
