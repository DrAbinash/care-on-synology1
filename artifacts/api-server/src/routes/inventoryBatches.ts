/**
 * inventoryBatches.ts — reagent/consumable batch (lot+expiry) tracking, FEFO
 * consumption, expiry reporting and reorder-point auto-reorder. Mounted under
 * /api/inventory alongside the existing inventory router (same staff guards), so
 * these live at /api/inventory/batches, /expiry-report, /reorder/*, etc.
 *
 * Additive and inert until used: no existing behaviour changes; the new tables
 * are empty until a batch is received. Nothing auto-orders — the reorder scan
 * only creates SUGGESTIONS an operator reviews and marks ordered.
 */
import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  inventoryItemsTable,
  inventoryTransactionsTable,
  inventoryBatchesTable,
  inventoryReorderRequestsTable,
  vendorsTable,
} from "@workspace/db/schema";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { fefoAllocate, classifyExpiry, needsReorder, suggestedReorderQty, type BatchLite } from "../lib/inventoryReagentLogic";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";

const router = Router();
const n = (v: unknown): number => (v == null ? 0 : Number(v));

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface ReceiveBatchParams {
  itemId: number;
  lotNumber?: string | null;
  expiryDate?: string | null;
  quantity: number;
  unitCost?: number | null;
  vendorId?: number | null;
  invoiceNumber?: string | null;
  notes?: string | null;
  performedBy?: string | null;
}

/**
 * Core "receive a lot" logic: insert the batch, bump the item's current
 * stock, log an inventory 'in' transaction, and close any open reorder
 * request for the item. Must run inside a caller-owned db.transaction — this
 * does not open its own, so multiple lines (e.g. every matched line item on
 * a scanned purchase invoice, see routes/purchaseInvoices.ts) can post
 * atomically as one transaction instead of each becoming its own commit.
 *
 * Extracted from the POST /batches handler below (which now just wraps this
 * in its own single-line transaction) so both callers share one code path
 * for the stock math instead of two copies drifting apart.
 */
export async function receiveBatchTx(tx: DbTx, b: ReceiveBatchParams): Promise<{ batch: typeof inventoryBatchesTable.$inferSelect; stock: number }> {
  const [item] = await tx.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, b.itemId)).limit(1);
  if (!item) throw new Error("ITEM_NOT_FOUND");
  const before = n(item.currentStock);
  const after = Math.round((before + b.quantity + Number.EPSILON) * 100) / 100;

  const [batch] = await tx.insert(inventoryBatchesTable).values({
    itemId: b.itemId,
    lotNumber: b.lotNumber ?? "",
    expiryDate: b.expiryDate ?? null,
    qtyReceived: String(b.quantity),
    qtyRemaining: String(b.quantity),
    unitCost: b.unitCost == null ? null : String(b.unitCost),
    vendorId: b.vendorId ?? null,
    invoiceNumber: b.invoiceNumber ?? null,
    status: "active",
    notes: b.notes ?? null,
  }).returning();

  await tx.update(inventoryItemsTable).set({ currentStock: String(after) }).where(eq(inventoryItemsTable.id, b.itemId));

  await tx.insert(inventoryTransactionsTable).values({
    itemId: b.itemId, type: "in", quantity: String(b.quantity),
    stockBefore: String(before), stockAfter: String(after),
    reason: "batch received" + (b.lotNumber ? ` (lot ${b.lotNumber})` : ""),
    reference: batch.invoiceNumber ?? null, performedBy: b.performedBy ?? null,
    vendorId: b.vendorId ?? null, invoiceNumber: b.invoiceNumber ?? null,
    unitCost: b.unitCost == null ? null : String(b.unitCost),
  });

  // close an open reorder request for this item, if any
  await tx.update(inventoryReorderRequestsTable)
    .set({ status: "received", receivedAt: new Date() })
    .where(and(eq(inventoryReorderRequestsTable.itemId, b.itemId), sql`${inventoryReorderRequestsTable.status} IN ('suggested','ordered')`));

  return { batch, stock: after };
}

// ── Batches ──────────────────────────────────────────────────────────────────

// GET /api/inventory/batches?itemId=123 — all batches for one item (newest first)
router.get("/batches", async (req, res) => {
  const itemId = Number(req.query.itemId);
  if (!Number.isFinite(itemId)) { res.status(400).json({ error: "itemId required" }); return; }
  const rows = await db.select().from(inventoryBatchesTable)
    .where(eq(inventoryBatchesTable.itemId, itemId))
    .orderBy(desc(inventoryBatchesTable.receivedAt));
  res.json(rows.map((b) => ({ ...b, qtyReceived: n(b.qtyReceived), qtyRemaining: n(b.qtyRemaining), unitCost: b.unitCost == null ? null : n(b.unitCost) })));
});

const ReceiveBatchBody = z.object({
  itemId: z.number().int().positive(),
  lotNumber: z.string().trim().default(""),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  quantity: z.number().positive(),
  unitCost: z.number().nonnegative().nullish(),
  vendorId: z.number().int().positive().nullish(),
  invoiceNumber: z.string().trim().nullish(),
  notes: z.string().trim().nullish(),
});

// POST /api/inventory/batches — receive a lot (stock-in). Creates the batch, an
// inventory 'in' transaction, bumps the item's current stock, and closes any
// open reorder request for the item. Atomic.
router.post("/batches", async (req: StaffAuthRequest, res) => {
  const parsed = ReceiveBatchBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request", details: parsed.error.issues }); return; }
  const b = parsed.data;
  try {
    const result = await db.transaction((tx) => receiveBatchTx(tx, { ...b, performedBy: req.staffSession?.subjectName ?? null }));
    res.status(201).json({ ...result.batch, currentStock: result.stock });
  } catch (e: any) {
    if (String(e?.message) === "ITEM_NOT_FOUND") { res.status(404).json({ error: "Item not found" }); return; }
    res.status(500).json({ error: "Failed to receive batch" });
  }
});

// ── FEFO consumption ─────────────────────────────────────────────────────────

const ConsumeBody = z.object({
  quantity: z.number().positive(),
  reason: z.string().trim().nullish(),
  reference: z.string().trim().nullish(),
});

// POST /api/inventory/items/:id/consume-fefo — deduct quantity first-expiry-first-out.
// Expired batches are never consumed; if usable stock is short, nothing is
// consumed and 409 is returned with the shortfall + expired batch ids to quarantine.
router.post("/items/:id/consume-fefo", async (req: StaffAuthRequest, res) => {
  const itemId = Number(req.params.id);
  const parsed = ConsumeBody.safeParse(req.body);
  if (!Number.isFinite(itemId) || !parsed.success) { res.status(400).json({ error: "Invalid request", details: parsed.success ? undefined : parsed.error.issues }); return; }
  const { quantity, reason, reference } = parsed.data;
  try {
    const out = await db.transaction(async (tx) => {
      const [item] = await tx.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, itemId)).limit(1);
      if (!item) throw new Error("ITEM_NOT_FOUND");
      const batches = await tx.select().from(inventoryBatchesTable)
        .where(and(eq(inventoryBatchesTable.itemId, itemId), eq(inventoryBatchesTable.status, "active"), gt(inventoryBatchesTable.qtyRemaining, "0")));
      const lite: BatchLite[] = batches.map((b) => ({ id: b.id, expiryDate: b.expiryDate, qtyRemaining: n(b.qtyRemaining), status: b.status }));
      const plan = fefoAllocate(lite, quantity);
      if (plan.shortfall > 0) return { ok: false as const, plan };

      for (const a of plan.allocations) {
        const b = batches.find((x) => x.id === a.batchId)!;
        const rem = Math.round((n(b.qtyRemaining) - a.qty + Number.EPSILON) * 100) / 100;
        await tx.update(inventoryBatchesTable)
          .set({ qtyRemaining: String(rem), status: rem <= 0 ? "depleted" : "active" })
          .where(eq(inventoryBatchesTable.id, a.batchId));
      }
      const before = n(item.currentStock);
      const after = Math.round((before - quantity + Number.EPSILON) * 100) / 100;
      await tx.update(inventoryItemsTable).set({ currentStock: String(after) }).where(eq(inventoryItemsTable.id, itemId));
      await tx.insert(inventoryTransactionsTable).values({
        itemId, type: "out", quantity: String(quantity), stockBefore: String(before), stockAfter: String(after),
        reason: reason ?? "FEFO consumption", reference: reference ?? null, performedBy: req.staffSession?.subjectName ?? null,
      });
      return { ok: true as const, plan, currentStock: after };
    });

    if (!out.ok) {
      res.status(409).json({ error: "Insufficient usable (non-expired) stock", shortfall: out.plan.shortfall, allocated: out.plan.allocated, quarantineExpiredBatchIds: out.plan.skippedExpired });
      return;
    }
    res.json({ consumed: quantity, allocations: out.plan.allocations, skippedExpiredBatchIds: out.plan.skippedExpired, currentStock: out.currentStock });
  } catch (e: any) {
    if (String(e?.message) === "ITEM_NOT_FOUND") { res.status(404).json({ error: "Item not found" }); return; }
    res.status(500).json({ error: "Consumption failed" });
  }
});

// ── Expiry report ────────────────────────────────────────────────────────────

// GET /api/inventory/expiry-report?days=90 — expired + expiring-soon batches.
router.get("/expiry-report", async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 90, 1), 3650);
  const rows = await db.select({
    id: inventoryBatchesTable.id, itemId: inventoryBatchesTable.itemId, itemName: inventoryItemsTable.name,
    lotNumber: inventoryBatchesTable.lotNumber, expiryDate: inventoryBatchesTable.expiryDate,
    qtyRemaining: inventoryBatchesTable.qtyRemaining, status: inventoryBatchesTable.status,
  }).from(inventoryBatchesTable)
    .innerJoin(inventoryItemsTable, eq(inventoryBatchesTable.itemId, inventoryItemsTable.id))
    .where(eq(inventoryBatchesTable.status, "active"));
  const lite: (BatchLite & { itemName: string; lotNumber: string; itemId: number })[] = rows.map((r) => ({
    id: r.id, itemId: r.itemId, itemName: r.itemName, lotNumber: r.lotNumber, expiryDate: r.expiryDate, qtyRemaining: n(r.qtyRemaining), status: r.status,
  }));
  const { expired, nearExpiry } = classifyExpiry(lite, new Date(), days);
  const key = (b: any) => rows.find((r) => r.id === b.id);
  res.json({ days, expired: expired.map(key), nearExpiry: nearExpiry.map(key) });
});

// ── Reorder config + workflow ────────────────────────────────────────────────

const ReorderConfigBody = z.object({
  trackExpiry: z.boolean().optional(),
  reorderPoint: z.number().nonnegative().nullish(),
  reorderQuantity: z.number().nonnegative().nullish(),
  autoReorderEnabled: z.boolean().optional(),
  storageTemp: z.string().trim().nullish(),
  openStabilityDays: z.number().int().nonnegative().nullish(),
});
router.patch("/items/:id/reorder-config", async (req, res) => {
  const itemId = Number(req.params.id);
  const parsed = ReorderConfigBody.safeParse(req.body);
  if (!Number.isFinite(itemId) || !parsed.success) { res.status(400).json({ error: "Invalid request", details: parsed.success ? undefined : parsed.error.issues }); return; }
  const d = parsed.data;
  const patch: Record<string, unknown> = {};
  if (d.trackExpiry !== undefined) patch.trackExpiry = d.trackExpiry;
  if (d.reorderPoint !== undefined) patch.reorderPoint = d.reorderPoint == null ? null : String(d.reorderPoint);
  if (d.reorderQuantity !== undefined) patch.reorderQuantity = d.reorderQuantity == null ? null : String(d.reorderQuantity);
  if (d.autoReorderEnabled !== undefined) patch.autoReorderEnabled = d.autoReorderEnabled;
  if (d.storageTemp !== undefined) patch.storageTemp = d.storageTemp ?? null;
  if (d.openStabilityDays !== undefined) patch.openStabilityDays = d.openStabilityDays ?? null;
  if (Object.keys(patch).length === 0) { res.status(400).json({ error: "No fields to update" }); return; }
  const [row] = await db.update(inventoryItemsTable).set(patch).where(eq(inventoryItemsTable.id, itemId)).returning();
  if (!row) { res.status(404).json({ error: "Item not found" }); return; }
  res.json(row);
});

// POST /api/inventory/reorder/scan — create 'suggested' reorder requests for
// items at/below their reorder point. Idempotent: the partial unique index keeps
// at most one open request per item, so re-scanning never duplicates.
router.post("/reorder/scan", async (req: StaffAuthRequest, res) => {
  const autoOnly = req.query.scope === "auto";
  const items = await db
    .select()
    .from(inventoryItemsTable)
    .where(eq(inventoryItemsTable.isActive, true));
  let created = 0, considered = 0;
  for (const it of items) {
    if (autoOnly && !it.autoReorderEnabled) continue;
    const item = { reorderPoint: it.reorderPoint == null ? null : n(it.reorderPoint), reorderQuantity: it.reorderQuantity == null ? null : n(it.reorderQuantity), minStock: n(it.minStock), autoReorderEnabled: it.autoReorderEnabled };
    const stock = n(it.currentStock);
    if (!needsReorder(item, stock)) continue;
    considered++;
    const qty = suggestedReorderQty(item, stock);
    try {
      await db.insert(inventoryReorderRequestsTable).values({
        itemId: it.id, currentStock: String(stock), reorderPoint: it.reorderPoint ?? null,
        suggestedQty: String(qty), preferredVendorId: it.preferredVendorId ?? null,
        status: "suggested", source: "auto", createdBy: req.staffSession?.subjectName ?? "reorder-scan",
      });
      created++;
    } catch { /* open request already exists for this item (unique index) — skip */ }
  }
  res.json({ scanned: items.length, atOrBelowReorderPoint: considered, newSuggestions: created });
});

// GET /api/inventory/reorder/requests?status=suggested
router.get("/reorder/requests", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const base = db.select({
    id: inventoryReorderRequestsTable.id, itemId: inventoryReorderRequestsTable.itemId, itemName: inventoryItemsTable.name,
    currentStock: inventoryReorderRequestsTable.currentStock, reorderPoint: inventoryReorderRequestsTable.reorderPoint,
    suggestedQty: inventoryReorderRequestsTable.suggestedQty, status: inventoryReorderRequestsTable.status,
    source: inventoryReorderRequestsTable.source, vendorName: vendorsTable.name, createdAt: inventoryReorderRequestsTable.createdAt,
  }).from(inventoryReorderRequestsTable)
    .innerJoin(inventoryItemsTable, eq(inventoryReorderRequestsTable.itemId, inventoryItemsTable.id))
    .leftJoin(vendorsTable, eq(inventoryReorderRequestsTable.preferredVendorId, vendorsTable.id))
    .orderBy(desc(inventoryReorderRequestsTable.createdAt));
  const rows = status ? await base.where(eq(inventoryReorderRequestsTable.status, status)) : await base;
  res.json(rows.map((r) => ({ ...r, currentStock: n(r.currentStock), reorderPoint: r.reorderPoint == null ? null : n(r.reorderPoint), suggestedQty: n(r.suggestedQty) })));
});

// Status transitions: order / receive / cancel
function transition(from: string[], to: string, stamp?: "orderedAt" | "receivedAt") {
  return async (req: any, res: any) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
    const patch: Record<string, unknown> = { status: to };
    if (stamp) patch[stamp] = new Date();
    const [row] = await db.update(inventoryReorderRequestsTable).set(patch)
      .where(and(eq(inventoryReorderRequestsTable.id, id), sql`${inventoryReorderRequestsTable.status} IN (${sql.join(from.map((s) => sql`${s}`), sql`, `)})`))
      .returning();
    if (!row) { res.status(409).json({ error: `request not in ${from.join("/")} state` }); return; }
    res.json(row);
  };
}
router.post("/reorder/requests/:id/order", transition(["suggested"], "ordered", "orderedAt"));
router.post("/reorder/requests/:id/receive", transition(["suggested", "ordered"], "received", "receivedAt"));
router.post("/reorder/requests/:id/cancel", transition(["suggested", "ordered"], "cancelled"));

export default router;
