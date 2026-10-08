import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  inventoryDemandRequestsTable,
  inventoryItemsTable,
  inventoryTransactionsTable,
} from "@workspace/db/schema";
import { and, desc, eq } from "drizzle-orm";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";

const router = Router();
const n = (v: unknown): number => (v == null ? 0 : Number(v));

function mapDemand(row: typeof inventoryDemandRequestsTable.$inferSelect, itemUnit?: string | null) {
  return {
    ...row,
    quantity: n(row.quantity),
    itemUnit: itemUnit ?? row.unit,
  };
}

const CreateDemandBody = z.object({
  itemId: z.number().int().positive().optional(),
  itemName: z.string().trim().min(1).max(200).optional(),
  quantity: z.number().positive(),
  unit: z.string().trim().max(32).optional(),
  department: z.string().trim().max(120).optional(),
  urgency: z.enum(["normal", "urgent"]).optional(),
  notes: z.string().trim().max(500).optional(),
});

// GET /api/inventory/demands?status=pending
router.get("/demands", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const base = db
    .select({
      demand: inventoryDemandRequestsTable,
      currentStock: inventoryItemsTable.currentStock,
      itemUnit: inventoryItemsTable.unit,
    })
    .from(inventoryDemandRequestsTable)
    .leftJoin(inventoryItemsTable, eq(inventoryDemandRequestsTable.itemId, inventoryItemsTable.id))
    .orderBy(desc(inventoryDemandRequestsTable.createdAt));

  const rows = status
    ? await base.where(eq(inventoryDemandRequestsTable.status, status))
    : await base;

  res.json(rows.map((r) => ({
    ...mapDemand(r.demand, r.itemUnit),
    currentStock: r.currentStock == null ? null : n(r.currentStock),
  })));
});

// POST /api/inventory/demands — staff submit a demand
router.post("/demands", async (req: StaffAuthRequest, res) => {
  const parsed = CreateDemandBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }
  const session = req.staffSession!;
  let itemName = parsed.data.itemName?.trim() ?? "";
  let unit = parsed.data.unit?.trim() || "pcs";
  let itemId: number | null = parsed.data.itemId ?? null;

  if (itemId) {
    const [item] = await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, itemId)).limit(1);
    if (!item) {
      res.status(404).json({ error: "Item not found" });
      return;
    }
    itemName = item.name;
    unit = parsed.data.unit?.trim() || item.unit;
  }

  if (!itemName) {
    res.status(400).json({ error: "itemId or itemName required" });
    return;
  }

  const [row] = await db.insert(inventoryDemandRequestsTable).values({
    itemId,
    itemName,
    quantity: String(parsed.data.quantity),
    unit,
    department: parsed.data.department ?? null,
    urgency: parsed.data.urgency ?? "normal",
    notes: parsed.data.notes ?? null,
    status: "pending",
    requestedBy: session.subjectName,
    requestedById: session.subjectId ?? null,
  }).returning();

  res.status(201).json(mapDemand(row));
});

// POST /api/inventory/demands/:id/approve
router.post("/demands/:id/approve", async (req: StaffAuthRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const [row] = await db.update(inventoryDemandRequestsTable)
    .set({
      status: "approved",
      reviewedBy: req.staffSession?.subjectName ?? null,
      reviewedAt: new Date(),
      rejectionReason: null,
    })
    .where(and(eq(inventoryDemandRequestsTable.id, id), eq(inventoryDemandRequestsTable.status, "pending")))
    .returning();
  if (!row) { res.status(404).json({ error: "Demand not found or not pending" }); return; }
  res.json(mapDemand(row));
});

// POST /api/inventory/demands/:id/reject
router.post("/demands/:id/reject", async (req: StaffAuthRequest, res) => {
  const id = Number(req.params.id);
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const [row] = await db.update(inventoryDemandRequestsTable)
    .set({
      status: "rejected",
      reviewedBy: req.staffSession?.subjectName ?? null,
      reviewedAt: new Date(),
      rejectionReason: reason || "Rejected",
    })
    .where(and(
      eq(inventoryDemandRequestsTable.id, id),
      eq(inventoryDemandRequestsTable.status, "pending"),
    ))
    .returning();
  if (!row) { res.status(404).json({ error: "Demand not found or not pending" }); return; }
  res.json(mapDemand(row));
});

// POST /api/inventory/demands/:id/issue — stock-out + mark issued
router.post("/demands/:id/issue", async (req: StaffAuthRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }

  const [demand] = await db.select().from(inventoryDemandRequestsTable).where(eq(inventoryDemandRequestsTable.id, id)).limit(1);
  if (!demand) { res.status(404).json({ error: "Demand not found" }); return; }
  if (demand.status !== "pending" && demand.status !== "approved") {
    res.status(400).json({ error: `Cannot issue demand in status ${demand.status}` });
    return;
  }
  if (!demand.itemId) {
    res.status(400).json({ error: "Link this demand to a catalog item before issuing stock" });
    return;
  }

  const qty = n(demand.quantity);
  const actor = req.staffSession?.subjectName ?? "store";

  try {
    const result = await db.transaction(async (tx) => {
      const [item] = await tx.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, demand.itemId!)).limit(1);
      if (!item) throw new Error("ITEM_NOT_FOUND");
      const before = n(item.currentStock);
      if (before < qty) throw new Error("INSUFFICIENT_STOCK");
      const after = Math.round((before - qty) * 100) / 100;

      await tx.update(inventoryItemsTable).set({ currentStock: String(after) }).where(eq(inventoryItemsTable.id, item.id));
      await tx.insert(inventoryTransactionsTable).values({
        itemId: item.id,
        type: "out",
        quantity: String(qty),
        stockBefore: String(before),
        stockAfter: String(after),
        reason: `Staff demand #${demand.id}${demand.department ? ` (${demand.department})` : ""}`,
        reference: `DEMAND-${demand.id}`,
        performedBy: actor,
      });

      const [updated] = await tx.update(inventoryDemandRequestsTable)
        .set({
          status: "issued",
          reviewedBy: actor,
          reviewedAt: new Date(),
          issuedAt: new Date(),
        })
        .where(eq(inventoryDemandRequestsTable.id, id))
        .returning();

      return { demand: updated!, newStock: after };
    });

    res.json({ ...mapDemand(result.demand), newStock: result.newStock });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Issue failed";
    if (msg === "INSUFFICIENT_STOCK") {
      res.status(400).json({ error: "Insufficient stock to issue this demand" });
      return;
    }
    if (msg === "ITEM_NOT_FOUND") {
      res.status(404).json({ error: "Item not found" });
      return;
    }
    throw err;
  }
});

export default router;
