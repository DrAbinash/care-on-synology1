import { Router } from "express";
import { db } from "@workspace/db";
import {
  inventoryItemsTable,
  inventoryTransactionsTable,
  inventoryConsumptionRulesTable,
  testsTable,
  vendorsTable,
} from "@workspace/db/schema";
import { eq, desc, lt, and, inArray, sql } from "drizzle-orm";
import {
  ListInventoryItemsByVendorParams,
  CreateInventoryItemBody,
  CreateInventoryConsumptionRuleBody,
  UpdateInventoryItemParams,
  UpdateInventoryItemBody,
  InventoryStockInParams,
  InventoryStockInBody,
  InventoryStockOutParams,
  InventoryStockOutBody,
  InventoryAdjustParams,
  InventoryAdjustBody,
  GetInventoryHistoryParams,
  ReplaceInventoryConsumptionRulesByTestParams,
  ReplaceInventoryConsumptionRulesByTestBody,
  DeleteInventoryConsumptionRulesByTestParams,
  DeleteInventoryConsumptionRuleParams,
} from "@workspace/api-zod";

const router = Router();

// List all inventory items
router.get("/", async (_req, res) => {
  const items = await db
    .select()
    .from(inventoryItemsTable)
    .orderBy(inventoryItemsTable.name);
  res.json(items.map(toNum));
});

// Vendor master is now exposed under /api/vendors. We deliberately keep
// /api/inventory/items-by-vendor as a thin convenience for the inventory page.
router.get("/items-by-vendor/:vendorId", async (req, res) => {
  const paramsParsed = ListInventoryItemsByVendorParams.safeParse(req.params);
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid request", details: paramsParsed.error.issues });
    return;
  }
  const items = await db
    .select()
    .from(inventoryItemsTable)
    .where(eq(inventoryItemsTable.preferredVendorId, paramsParsed.data.vendorId))
    .orderBy(inventoryItemsTable.name);
  res.json(items.map(toNum));
});

// Low stock items
router.get("/low-stock", async (_req, res) => {
  const rows = await db
    .select()
    .from(inventoryItemsTable)
    .where(
      and(
        eq(inventoryItemsTable.isActive, true),
        lt(inventoryItemsTable.currentStock, inventoryItemsTable.minStock)
      )
    );
  res.json(rows.map(toNum));
});

// Create item
router.post("/", async (req, res) => {
  const bodyParsed = CreateInventoryItemBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: "Invalid request", details: bodyParsed.error.issues });
    return;
  }
  const { name, unit, category, currentStock, minStock, costPrice, preferredVendorId } = bodyParsed.data;
  const vid = preferredVendorId == null || preferredVendorId === "" ? null : Number(preferredVendorId);
  const [item] = await db
    .insert(inventoryItemsTable)
    .values({
      name,
      unit,
      category: category || "consumable",
      currentStock: currentStock != null ? String(currentStock) : "0",
      minStock: minStock != null ? String(minStock) : "0",
      costPrice: costPrice != null ? String(costPrice) : "0",
      preferredVendorId: Number.isFinite(vid as number) ? (vid as number) : null,
    })
    .returning();
  res.status(201).json(toNum(item));
});

// Update item
router.patch("/:id", async (req, res) => {
  const paramsParsed = UpdateInventoryItemParams.safeParse(req.params);
  const bodyParsed = UpdateInventoryItemBody.safeParse(req.body);
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
  const body = bodyParsed.data;
  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.unit !== undefined) updates.unit = body.unit;
  if (body.category !== undefined) updates.category = body.category;
  if (body.minStock !== undefined) updates.minStock = String(body.minStock);
  if (body.costPrice !== undefined) updates.costPrice = String(body.costPrice);
  if (body.isActive !== undefined) updates.isActive = body.isActive;
  if (body.preferredVendorId !== undefined) {
    const v = body.preferredVendorId;
    if (v == null || v === "") {
      updates.preferredVendorId = null;
    } else {
      const n = Number(v);
      updates.preferredVendorId = Number.isFinite(n) ? n : null;
    }
  }
  const [item] = await db.update(inventoryItemsTable).set(updates).where(eq(inventoryItemsTable.id, id)).returning();
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  res.json(toNum(item));
});

// Stock in
router.post("/:id/stock-in", async (req, res) => {
  const paramsParsed = InventoryStockInParams.safeParse(req.params);
  const bodyParsed = InventoryStockInBody.safeParse(req.body);
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
  const { quantity, reason, reference, performedBy, vendorId, invoiceNumber, invoiceDate, unitCost } = bodyParsed.data;
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    res.status(400).json({ error: "quantity must be > 0" });
    return;
  }
  const [existing] = await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Item not found" });
    return;
  }

  const vid = vendorId == null || vendorId === "" ? null : Number(vendorId);
  const uc = unitCost == null || unitCost === "" ? null : Number(unitCost);
  const idate = typeof invoiceDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(invoiceDate) ? invoiceDate : null;

  const before = Number(existing.currentStock);
  const after = before + qty;
  // Wrap stock update + transaction insert in one tx so we never log a purchase
  // that didn't actually adjust stock (or vice versa) under errors.
  const txn = await db.transaction(async (tx) => {
    await tx.update(inventoryItemsTable).set({ currentStock: after.toString() }).where(eq(inventoryItemsTable.id, id));
    const [inserted] = await tx.insert(inventoryTransactionsTable).values({
      itemId: id, type: "in", quantity: qty.toString(), stockBefore: before.toString(), stockAfter: after.toString(),
      reason: reason ?? null, reference: reference ?? null, performedBy: performedBy ?? null,
      vendorId: Number.isFinite(vid as number) ? (vid as number) : null,
      invoiceNumber: typeof invoiceNumber === "string" && invoiceNumber.trim() ? invoiceNumber.trim() : null,
      invoiceDate: idate,
      unitCost: Number.isFinite(uc as number) ? (uc as number).toString() : null,
    }).returning();
    return inserted;
  });
  res.status(201).json({ transaction: txn, newStock: after });
});

// Stock out
router.post("/:id/stock-out", async (req, res) => {
  const paramsParsed = InventoryStockOutParams.safeParse(req.params);
  const bodyParsed = InventoryStockOutBody.safeParse(req.body);
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
  const { quantity, reason, reference, performedBy } = bodyParsed.data;
  const qty = Number(quantity);
  const [existing] = await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  const before = Number(existing.currentStock);
  if (before < qty) {
    res.status(400).json({ error: "Insufficient stock" });
    return;
  }
  const after = before - qty;
  await db.update(inventoryItemsTable).set({ currentStock: after.toString() }).where(eq(inventoryItemsTable.id, id));
  const [txn] = await db.insert(inventoryTransactionsTable).values({
    itemId: id, type: "out", quantity: qty.toString(), stockBefore: before.toString(), stockAfter: after.toString(),
    reason: reason ?? null, reference: reference ?? null, performedBy: performedBy ?? null,
  }).returning();
  res.status(201).json({ transaction: txn, newStock: after });
});

// Stock adjustment
router.post("/:id/adjust", async (req, res) => {
  const paramsParsed = InventoryAdjustParams.safeParse(req.params);
  const bodyParsed = InventoryAdjustBody.safeParse(req.body);
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
  const { newQuantity, reason, performedBy } = bodyParsed.data;
  const target = Number(newQuantity);
  const [existing] = await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  const before = Number(existing.currentStock);
  await db.update(inventoryItemsTable).set({ currentStock: target.toString() }).where(eq(inventoryItemsTable.id, id));
  await db.insert(inventoryTransactionsTable).values({
    itemId: id, type: "adjustment", quantity: (target - before).toString(),
    stockBefore: before.toString(), stockAfter: target.toString(),
    reason: reason ?? null, performedBy: performedBy ?? null,
  });
  res.json({ newStock: target });
});

// Transaction history for an item (joins vendor name when available)
router.get("/:id/history", async (req, res) => {
  const paramsParsed = GetInventoryHistoryParams.safeParse(req.params);
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid request", details: paramsParsed.error.issues });
    return;
  }
  const id = paramsParsed.data.id;
  const rows = await db
    .select({
      id: inventoryTransactionsTable.id,
      itemId: inventoryTransactionsTable.itemId,
      type: inventoryTransactionsTable.type,
      quantity: inventoryTransactionsTable.quantity,
      stockBefore: inventoryTransactionsTable.stockBefore,
      stockAfter: inventoryTransactionsTable.stockAfter,
      reason: inventoryTransactionsTable.reason,
      reference: inventoryTransactionsTable.reference,
      performedBy: inventoryTransactionsTable.performedBy,
      vendorId: inventoryTransactionsTable.vendorId,
      vendorName: vendorsTable.name,
      invoiceNumber: inventoryTransactionsTable.invoiceNumber,
      invoiceDate: inventoryTransactionsTable.invoiceDate,
      unitCost: inventoryTransactionsTable.unitCost,
      createdAt: inventoryTransactionsTable.createdAt,
    })
    .from(inventoryTransactionsTable)
    .leftJoin(vendorsTable, eq(vendorsTable.id, inventoryTransactionsTable.vendorId))
    .where(eq(inventoryTransactionsTable.itemId, id))
    .orderBy(desc(inventoryTransactionsTable.createdAt));
  res.json(rows);
});

// Consumption rules
router.get("/consumption-rules", async (_req, res) => {
  const rows = await db
    .select({
      id: inventoryConsumptionRulesTable.id,
      testId: inventoryConsumptionRulesTable.testId,
      itemId: inventoryConsumptionRulesTable.itemId,
      quantity: inventoryConsumptionRulesTable.quantity,
      testName: testsTable.name,
      itemName: inventoryItemsTable.name,
      itemUnit: inventoryItemsTable.unit,
    })
    .from(inventoryConsumptionRulesTable)
    .leftJoin(testsTable, eq(inventoryConsumptionRulesTable.testId, testsTable.id))
    .leftJoin(inventoryItemsTable, eq(inventoryConsumptionRulesTable.itemId, inventoryItemsTable.id));
  res.json(rows);
});

router.post("/consumption-rules", async (req, res) => {
  const bodyParsed = CreateInventoryConsumptionRuleBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: "Invalid request", details: bodyParsed.error.issues });
    return;
  }
  const { testId, itemId, quantity } = bodyParsed.data;
  const [rule] = await db
    .insert(inventoryConsumptionRulesTable)
    .values({
      testId: Number(testId),
      itemId: Number(itemId),
      quantity: quantity != null ? String(quantity) : "1",
    })
    .returning();
  res.status(201).json(rule);
});

// Replace ALL consumption rules for a single test in one atomic operation.
// Body shape:  { items: [ { itemId: number, quantity: number|string }, ... ] }
// An empty `items` array effectively clears the test's rules.
//
// We deliberately delete-then-insert inside a transaction (instead of trying
// to diff/upsert) because:
//   1. The dialog always sends the FULL desired list (it is a multi-item
//      editor, not a partial-patch endpoint), so a wholesale replace is
//      both simpler and matches the user's mental model.
//   2. The composite (testId,itemId) is not enforced as unique at the DB
//      level, so there is no `ON CONFLICT` shortcut available.
router.put("/consumption-rules/by-test/:testId", async (req, res) => {
  const paramsParsed = ReplaceInventoryConsumptionRulesByTestParams.safeParse(req.params);
  const bodyParsed = ReplaceInventoryConsumptionRulesByTestBody.safeParse(req.body);
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
  const testId = paramsParsed.data.testId;
  const rawItems = bodyParsed.data.items;

  // Validate / normalise input BEFORE touching the DB so a bad payload
  // can never leave a test with zero rules by mistake.
  const normalised: { itemId: number; quantity: string }[] = [];
  const seen = new Set<number>();
  for (const it of rawItems) {
    const itemId = Number(it?.itemId);
    const qty = Number(it?.quantity);
    if (!Number.isFinite(itemId) || itemId <= 0) {
      res.status(400).json({ error: `Invalid itemId: ${it?.itemId}` });
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      res.status(400).json({ error: `Quantity for item ${itemId} must be > 0` });
      return;
    }
    // Dedupe — if the user added the same item twice in the dialog, sum the
    // quantities rather than inserting two conflicting rows for the same test.
    if (seen.has(itemId)) {
      const existing = normalised.find((n) => n.itemId === itemId)!;
      existing.quantity = (Number(existing.quantity) + qty).toString();
    } else {
      seen.add(itemId);
      normalised.push({ itemId, quantity: qty.toString() });
    }
  }

  // Pre-check that the test and every item actually exist. This turns what
  // would otherwise be an opaque 500 (raw FK violation) into a clean 400
  // with a useful message — and avoids wasting a transaction round-trip.
  const [testExists] = await db
    .select({ id: testsTable.id })
    .from(testsTable)
    .where(eq(testsTable.id, testId))
    .limit(1);
  if (!testExists) {
    res.status(404).json({ error: `Test ${testId} not found` });
    return;
  }

  if (normalised.length > 0) {
    const itemIds = normalised.map((n) => n.itemId);
    const found = await db
      .select({ id: inventoryItemsTable.id })
      .from(inventoryItemsTable)
      .where(inArray(inventoryItemsTable.id, itemIds));
    const foundSet = new Set(found.map((r) => r.id));
    const missing = itemIds.filter((id) => !foundSet.has(id));
    if (missing.length > 0) {
      res.status(400).json({ error: `Inventory item(s) not found: ${missing.join(", ")}` });
      return;
    }
  }

  const inserted = await db.transaction(async (tx) => {
    await tx
      .delete(inventoryConsumptionRulesTable)
      .where(eq(inventoryConsumptionRulesTable.testId, testId));
    if (normalised.length === 0) return [];
    return tx
      .insert(inventoryConsumptionRulesTable)
      .values(normalised.map((n) => ({ testId, itemId: n.itemId, quantity: n.quantity })))
      .returning();
  });

  res.json({ success: true, count: inserted.length, rules: inserted });
});

// Delete every consumption rule for a given test.
router.delete("/consumption-rules/by-test/:testId", async (req, res) => {
  const paramsParsed = DeleteInventoryConsumptionRulesByTestParams.safeParse(req.params);
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid request", details: paramsParsed.error.issues });
    return;
  }
  await db
    .delete(inventoryConsumptionRulesTable)
    .where(eq(inventoryConsumptionRulesTable.testId, paramsParsed.data.testId));
  res.json({ success: true });
});

router.delete("/consumption-rules/:id", async (req, res) => {
  const paramsParsed = DeleteInventoryConsumptionRuleParams.safeParse(req.params);
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid request", details: paramsParsed.error.issues });
    return;
  }
  await db.delete(inventoryConsumptionRulesTable).where(eq(inventoryConsumptionRulesTable.id, paramsParsed.data.id));
  res.json({ success: true });
});

// ── Bulk CSV import ───────────────────────────────────────────────────────
// Upserts inventory items by `name` (case-insensitive). Stock movements
// are intentionally NOT imported — they have to flow through the audited
// stock-in/out endpoints. `vendorCode` (optional) is resolved against the
// vendors table to set preferredVendorId.
router.post("/import", async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? (req.body.rows as Record<string, unknown>[]) : null;
  if (!rows) {
    res.status(400).json({ error: "Request body must include `rows: []`." });
    return;
  }
  if (rows.length > 5000) {
    res.status(413).json({ error: "Too many rows in one import (max 5000)." });
    return;
  }

  // Pre-load the vendor code → id map once so we don't fire one SELECT per row.
  const vendors = await db.select({ id: vendorsTable.id, code: vendorsTable.code }).from(vendorsTable);
  const vendorByCode = new Map(vendors.map(v => [v.code.toLowerCase(), v.id]));

  let inserted = 0, updated = 0, skipped = 0;
  const errors: { row: number; reason: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const name = String(r.name ?? "").trim();
    const unit = String(r.unit ?? "").trim();
    if (!name || !unit) {
      skipped++;
      errors.push({ row: i + 2, reason: "Missing required field (name or unit)." });
      continue;
    }

    const category = (typeof r.category === "string" && r.category.trim()) || "consumable";
    const currentStock = Number(r.currentStock ?? 0);
    const minStock = Number(r.minStock ?? 0);
    const costPrice = Number(r.costPrice ?? 0);
    if (![currentStock, minStock, costPrice].every(n => Number.isFinite(n) && n >= 0)) {
      skipped++;
      errors.push({ row: i + 2, reason: "currentStock, minStock, and costPrice must be non-negative numbers." });
      continue;
    }

    let preferredVendorId: number | null = null;
    const vendorCode = typeof r.vendorCode === "string" ? r.vendorCode.trim() : "";
    if (vendorCode) {
      const vid = vendorByCode.get(vendorCode.toLowerCase());
      if (vid !== undefined) preferredVendorId = vid;
      // Unknown vendor code → leave preferredVendorId null (don't fail the row).
    }

    const isActiveStr = typeof r.isActive === "string" ? r.isActive.trim() : "";
    const isActive = isActiveStr ? !/^(false|0|no|inactive)$/i.test(isActiveStr) : true;

    // On UPDATE we deliberately do NOT touch `currentStock`: stock movements
    // must flow through the audited stock-in/out endpoints to preserve the
    // inventory_transactions ledger. `currentStock` is only seeded on INSERT.
    const updateValues = {
      name, unit, category,
      minStock: minStock.toFixed(2),
      costPrice: costPrice.toFixed(2),
      preferredVendorId, isActive,
    };

    try {
      // Match by name + unit (both case-insensitive). Inventory items have
      // no unique code, but two rows that share BOTH name and unit are
      // overwhelmingly the same physical item — `(Surgical Gloves, box)`
      // and `(Surgical Gloves, pair)` will not collide.
      const [existing] = await db
        .select({ id: inventoryItemsTable.id })
        .from(inventoryItemsTable)
        .where(sql`lower(${inventoryItemsTable.name}) = lower(${name}) AND lower(${inventoryItemsTable.unit}) = lower(${unit})`);
      if (existing) {
        await db.update(inventoryItemsTable).set(updateValues).where(eq(inventoryItemsTable.id, existing.id));
        updated++;
      } else {
        await db.insert(inventoryItemsTable).values({ ...updateValues, currentStock: currentStock.toFixed(2) });
        inserted++;
      }
    } catch (e) {
      skipped++;
      errors.push({ row: i + 2, reason: (e as Error).message || "Database error" });
    }
  }

  res.json({ inserted, updated, skipped, errors: errors.slice(0, 50) });
});

function toNum(item: Record<string, unknown>) {
  return {
    ...item,
    currentStock: Number(item.currentStock),
    minStock: Number(item.minStock),
    costPrice: Number(item.costPrice),
  };
}

export default router;
