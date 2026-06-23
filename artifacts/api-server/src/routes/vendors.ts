import { Router } from "express";
import { db } from "@workspace/db";
import {
  vendorsTable,
  inventoryItemsTable,
  inventoryTransactionsTable,
} from "@workspace/db/schema";
import { eq, sql, and, desc } from "drizzle-orm";

export const vendorsRouter = Router();

// Postgres unique-violation can surface as a wrapped Drizzle "Failed query: ..."
// error whose message no longer contains the words "unique" or "duplicate".
// Detect by walking the error chain and checking for code 23505 or text hints.
function isDuplicateError(err: unknown): boolean {
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur; i++) {
    const e = cur as { code?: string; message?: string; cause?: unknown };
    if (e.code === "23505") return true;
    const msg = typeof e.message === "string" ? e.message.toLowerCase() : "";
    if (msg.includes("unique") || msg.includes("duplicate") || msg.includes("23505")) return true;
    cur = e.cause;
  }
  return false;
}

const asString = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? null : String(v).trim());
const asTrim = (v: unknown) => {
  const s = asString(v);
  return s ? s : null;
};

// GET /api/vendors - list with summary aggregates
vendorsRouter.get("/", async (_req, res) => {
  // Per-vendor aggregates for items supplied + total purchases (sum of stock-in qty * unit_cost)
  const vendors = await db.select().from(vendorsTable).orderBy(vendorsTable.name);

  const itemCounts = await db
    .select({
      vendorId: inventoryItemsTable.preferredVendorId,
      itemCount: sql<number>`count(*)::int`,
    })
    .from(inventoryItemsTable)
    .where(sql`${inventoryItemsTable.preferredVendorId} is not null`)
    .groupBy(inventoryItemsTable.preferredVendorId);

  const purchases = await db
    .select({
      vendorId: inventoryTransactionsTable.vendorId,
      txnCount: sql<number>`count(*)::int`,
      totalQty: sql<string>`coalesce(sum(${inventoryTransactionsTable.quantity}), 0)::text`,
      totalCost: sql<string>`coalesce(sum(${inventoryTransactionsTable.quantity} * coalesce(${inventoryTransactionsTable.unitCost}, 0)), 0)::text`,
      lastPurchaseAt: sql<string | null>`max(${inventoryTransactionsTable.createdAt})`,
    })
    .from(inventoryTransactionsTable)
    .where(and(
      sql`${inventoryTransactionsTable.vendorId} is not null`,
      eq(inventoryTransactionsTable.type, "in"),
    ))
    .groupBy(inventoryTransactionsTable.vendorId);

  const itemMap = new Map(itemCounts.map(r => [r.vendorId, r.itemCount]));
  const purchaseMap = new Map(purchases.map(r => [r.vendorId, r]));

  const rows = vendors.map(v => {
    const p = purchaseMap.get(v.id);
    return {
      ...v,
      openingBalance: Number(v.openingBalance),
      itemCount: itemMap.get(v.id) ?? 0,
      purchaseCount: p?.txnCount ?? 0,
      totalPurchaseQty: p ? Number(p.totalQty) : 0,
      totalPurchaseCost: p ? Number(p.totalCost) : 0,
      lastPurchaseAt: p?.lastPurchaseAt ?? null,
    };
  });

  res.json(rows);
});

// GET /api/vendors/:id - vendor + supplied items + recent purchases
vendorsRouter.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [vendor] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, id));
  if (!vendor) {
    res.status(404).json({ error: "Vendor not found" });
    return;
  }

  const items = await db
    .select({
      id: inventoryItemsTable.id,
      name: inventoryItemsTable.name,
      unit: inventoryItemsTable.unit,
      category: inventoryItemsTable.category,
      currentStock: inventoryItemsTable.currentStock,
      minStock: inventoryItemsTable.minStock,
      costPrice: inventoryItemsTable.costPrice,
      isActive: inventoryItemsTable.isActive,
    })
    .from(inventoryItemsTable)
    .where(eq(inventoryItemsTable.preferredVendorId, id))
    .orderBy(inventoryItemsTable.name);

  const purchases = await db
    .select({
      id: inventoryTransactionsTable.id,
      itemId: inventoryTransactionsTable.itemId,
      itemName: inventoryItemsTable.name,
      itemUnit: inventoryItemsTable.unit,
      quantity: inventoryTransactionsTable.quantity,
      unitCost: inventoryTransactionsTable.unitCost,
      invoiceNumber: inventoryTransactionsTable.invoiceNumber,
      invoiceDate: inventoryTransactionsTable.invoiceDate,
      reference: inventoryTransactionsTable.reference,
      reason: inventoryTransactionsTable.reason,
      performedBy: inventoryTransactionsTable.performedBy,
      createdAt: inventoryTransactionsTable.createdAt,
    })
    .from(inventoryTransactionsTable)
    .leftJoin(inventoryItemsTable, eq(inventoryItemsTable.id, inventoryTransactionsTable.itemId))
    .where(and(
      eq(inventoryTransactionsTable.vendorId, id),
      eq(inventoryTransactionsTable.type, "in"),
    ))
    .orderBy(desc(inventoryTransactionsTable.createdAt))
    .limit(200);

  const totals = purchases.reduce((acc, p) => {
    const qty = Number(p.quantity);
    const cost = qty * Number(p.unitCost ?? 0);
    return { qty: acc.qty + qty, cost: acc.cost + cost, count: acc.count + 1 };
  }, { qty: 0, cost: 0, count: 0 });

  res.json({
    vendor: { ...vendor, openingBalance: Number(vendor.openingBalance) },
    items: items.map(i => ({ ...i, currentStock: Number(i.currentStock), minStock: Number(i.minStock), costPrice: Number(i.costPrice) })),
    purchases: purchases.map(p => ({ ...p, quantity: Number(p.quantity), unitCost: p.unitCost == null ? null : Number(p.unitCost) })),
    summary: {
      itemCount: items.length,
      purchaseCount: totals.count,
      totalPurchaseQty: totals.qty,
      totalPurchaseCost: totals.cost,
    },
  });
});

// POST /api/vendors
vendorsRouter.post("/", async (req, res) => {
  const code = asString(req.body?.code);
  const name = asString(req.body?.name);
  if (!code || !name) {
    res.status(400).json({ error: "code and name are required" });
    return;
  }

  const opening = Number(req.body?.openingBalance);
  try {
    const [row] = await db.insert(vendorsTable).values({
      code,
      name,
      contactPerson: asTrim(req.body?.contactPerson),
      phone: asTrim(req.body?.phone),
      email: asTrim(req.body?.email),
      address: asTrim(req.body?.address),
      city: asTrim(req.body?.city),
      state: asTrim(req.body?.state),
      pincode: asTrim(req.body?.pincode),
      gstin: asTrim(req.body?.gstin),
      paymentTerms: asTrim(req.body?.paymentTerms),
      category: asTrim(req.body?.category),
      openingBalance: String(Number.isFinite(opening) ? opening : 0),
      notes: asTrim(req.body?.notes),
      isActive: req.body?.isActive !== false,
    }).returning();
    res.status(201).json({ ...row, openingBalance: Number(row.openingBalance) });
  } catch (err) {
    if (isDuplicateError(err)) {
      res.status(409).json({ error: "A vendor with that code already exists" });
      return;
    }
    const msg = err instanceof Error ? err.message : "Failed";
    res.status(500).json({ error: msg });
  }
});

// PATCH /api/vendors/:id
vendorsRouter.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Vendor not found" });
    return;
  }

  const updates: Record<string, unknown> = {};
  for (const k of ["code", "name", "contactPerson", "phone", "email", "address", "city", "state", "pincode", "gstin", "paymentTerms", "category", "notes"]) {
    if (k in req.body) {
      const v = req.body[k];
      updates[k] = typeof v === "string" ? (v.trim() || null) : v;
    }
  }
  if ("openingBalance" in req.body) {
    const n = Number(req.body.openingBalance);
    updates.openingBalance = String(Number.isFinite(n) ? n : 0);
  }
  if ("isActive" in req.body) updates.isActive = !!req.body.isActive;

  try {
    const [row] = await db.update(vendorsTable).set(updates).where(eq(vendorsTable.id, id)).returning();
    res.json({ ...row, openingBalance: Number(row.openingBalance) });
  } catch (err) {
    if (isDuplicateError(err)) {
      res.status(409).json({ error: "A vendor with that code already exists" });
      return;
    }
    const msg = err instanceof Error ? err.message : "Failed";
    res.status(500).json({ error: msg });
  }
});

// ── Bulk CSV import ───────────────────────────────────────────────────────
// Upsert by `code` (the vendor code is the only true unique key). All
// optional fields are nullable; isActive defaults to true.
vendorsRouter.post("/import", async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? (req.body.rows as Record<string, unknown>[]) : null;
  if (!rows) {
    res.status(400).json({ error: "Request body must include `rows: []`." });
    return;
  }
  if (rows.length > 5000) {
    res.status(413).json({ error: "Too many rows in one import (max 5000)." });
    return;
  }

  let inserted = 0, updated = 0, skipped = 0;
  const errors: { row: number; reason: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const code = asString(r.code) || "";
    const name = asString(r.name) || "";
    if (!code || !name) {
      skipped++;
      errors.push({ row: i + 2, reason: "Missing required field (code or name)." });
      continue;
    }
    const opening = Number(r.openingBalance);
    const isActiveStr = typeof r.isActive === "string" ? r.isActive.trim() : "";
    const values = {
      code, name,
      contactPerson: asTrim(r.contactPerson),
      phone: asTrim(r.phone),
      email: asTrim(r.email),
      address: asTrim(r.address),
      city: asTrim(r.city),
      state: asTrim(r.state),
      pincode: asTrim(r.pincode),
      gstin: asTrim(r.gstin),
      paymentTerms: asTrim(r.paymentTerms),
      category: asTrim(r.category),
      notes: asTrim(r.notes),
      openingBalance: String(Number.isFinite(opening) ? opening : 0),
      isActive: isActiveStr ? !/^(false|0|no|inactive)$/i.test(isActiveStr) : true,
    };

    try {
      const [existing] = await db.select({ id: vendorsTable.id }).from(vendorsTable).where(eq(vendorsTable.code, code));
      if (existing) {
        await db.update(vendorsTable).set(values).where(eq(vendorsTable.id, existing.id));
        updated++;
      } else {
        await db.insert(vendorsTable).values(values);
        inserted++;
      }
    } catch (e) {
      skipped++;
      errors.push({ row: i + 2, reason: isDuplicateError(e) ? `Duplicate vendor code "${code}".` : (e as Error).message || "Database error" });
    }
  }

  res.json({ inserted, updated, skipped, errors: errors.slice(0, 50) });
});

// DELETE /api/vendors/:id - soft refusal if vendor has linked items or purchases
vendorsRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Vendor not found" });
    return;
  }

  const [{ c: itemRefs }] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(inventoryItemsTable)
    .where(eq(inventoryItemsTable.preferredVendorId, id));
  const [{ c: txnRefs }] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(inventoryTransactionsTable)
    .where(eq(inventoryTransactionsTable.vendorId, id));

  if (itemRefs > 0 || txnRefs > 0) {
    res.status(409).json({
      error: `Cannot delete: vendor is linked to ${itemRefs} item(s) and ${txnRefs} purchase(s). Deactivate instead.`,
    });
    return;
  }

  await db.delete(vendorsTable).where(eq(vendorsTable.id, id));
  res.json({ ok: true });
});
