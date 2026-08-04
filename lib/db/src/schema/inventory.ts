import { pgTable, text, serial, timestamp, integer, numeric, boolean, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { testsTable } from "./tests";
import { vendorsTable } from "./vendors";

export const inventoryItemsTable = pgTable("inventory_items", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  unit: text("unit").notNull(),
  category: text("category").notNull().default("consumable"),
  currentStock: numeric("current_stock", { precision: 10, scale: 2 }).notNull().default("0"),
  minStock: numeric("min_stock", { precision: 10, scale: 2 }).notNull().default("0"),
  costPrice: numeric("cost_price", { precision: 10, scale: 2 }).notNull().default("0"),
  preferredVendorId: integer("preferred_vendor_id").references(() => vendorsTable.id, { onDelete: "set null" }),
  isActive: boolean("is_active").notNull().default(true),
  // Reagent / consumable batch + reorder controls (added additively).
  trackExpiry: boolean("track_expiry").notNull().default(false),
  reorderPoint: numeric("reorder_point", { precision: 10, scale: 2 }),
  reorderQuantity: numeric("reorder_quantity", { precision: 10, scale: 2 }),
  autoReorderEnabled: boolean("auto_reorder_enabled").notNull().default(false),
  storageTemp: text("storage_temp"),
  openStabilityDays: integer("open_stability_days"),
  barcode: text("barcode"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// One row per received lot of a reagent/consumable. Drives expiry alerts and
// FEFO (first-expiry-first-out) consumption. current_stock on the item stays the
// authoritative total; qty_remaining across active batches should reconcile to it.
export const inventoryBatchesTable = pgTable("inventory_batches", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id").notNull().references(() => inventoryItemsTable.id),
  lotNumber: text("lot_number").notNull().default(""),
  expiryDate: date("expiry_date"),
  qtyReceived: numeric("qty_received", { precision: 10, scale: 2 }).notNull().default("0"),
  qtyRemaining: numeric("qty_remaining", { precision: 10, scale: 2 }).notNull().default("0"),
  unitCost: numeric("unit_cost", { precision: 12, scale: 2 }),
  vendorId: integer("vendor_id").references(() => vendorsTable.id, { onDelete: "set null" }),
  invoiceNumber: text("invoice_number"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  openedAt: timestamp("opened_at", { withTimezone: true }),
  status: text("status").notNull().default("active"), // active | depleted | expired | quarantined
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// Auto-generated reorder suggestions (or manual draft POs). A partial unique
// index (in the migration) keeps at most one open request per item.
export const inventoryReorderRequestsTable = pgTable("inventory_reorder_requests", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id").notNull().references(() => inventoryItemsTable.id),
  currentStock: numeric("current_stock", { precision: 10, scale: 2 }).notNull().default("0"),
  reorderPoint: numeric("reorder_point", { precision: 10, scale: 2 }),
  suggestedQty: numeric("suggested_qty", { precision: 10, scale: 2 }).notNull().default("0"),
  preferredVendorId: integer("preferred_vendor_id").references(() => vendorsTable.id, { onDelete: "set null" }),
  status: text("status").notNull().default("suggested"), // suggested | ordered | received | cancelled
  source: text("source").notNull().default("auto"),      // auto | manual
  notes: text("notes"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  orderedAt: timestamp("ordered_at", { withTimezone: true }),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

/** Staff demand — request supplies from store (approve → issue stock-out). */
export const inventoryDemandRequestsTable = pgTable("inventory_demand_requests", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id").references(() => inventoryItemsTable.id, { onDelete: "set null" }),
  itemName: text("item_name").notNull(),
  quantity: numeric("quantity", { precision: 10, scale: 2 }).notNull(),
  unit: text("unit").notNull().default("pcs"),
  department: text("department"),
  urgency: text("urgency").notNull().default("normal"), // normal | urgent
  notes: text("notes"),
  status: text("status").notNull().default("pending"), // pending | approved | issued | rejected | cancelled
  requestedBy: text("requested_by").notNull(),
  requestedById: integer("requested_by_id"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const inventoryTransactionsTable = pgTable("inventory_transactions", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id").notNull().references(() => inventoryItemsTable.id),
  type: text("type").notNull(), // 'in' | 'out' | 'adjustment'
  quantity: numeric("quantity", { precision: 10, scale: 2 }).notNull(),
  stockBefore: numeric("stock_before", { precision: 10, scale: 2 }).notNull(),
  stockAfter: numeric("stock_after", { precision: 10, scale: 2 }).notNull(),
  reason: text("reason"),
  reference: text("reference"), // e.g. ORD-2024-0001
  performedBy: text("performed_by"),
  // Vendor / invoice details for stock-in (purchase) transactions
  vendorId: integer("vendor_id").references(() => vendorsTable.id, { onDelete: "set null" }),
  invoiceNumber: text("invoice_number"),
  invoiceDate: date("invoice_date"),
  unitCost: numeric("unit_cost", { precision: 12, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const inventoryConsumptionRulesTable = pgTable("inventory_consumption_rules", {
  id: serial("id").primaryKey(),
  testId: integer("test_id").notNull().references(() => testsTable.id),
  itemId: integer("item_id").notNull().references(() => inventoryItemsTable.id),
  quantity: numeric("quantity", { precision: 10, scale: 2 }).notNull().default("1"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertInventoryItemSchema = createInsertSchema(inventoryItemsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertInventoryTransactionSchema = createInsertSchema(inventoryTransactionsTable).omit({ id: true, createdAt: true });
export const insertConsumptionRuleSchema = createInsertSchema(inventoryConsumptionRulesTable).omit({ id: true, createdAt: true });
export const insertInventoryBatchSchema = createInsertSchema(inventoryBatchesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertInventoryReorderRequestSchema = createInsertSchema(inventoryReorderRequestsTable).omit({ id: true, createdAt: true, updatedAt: true });

export type InventoryItem = typeof inventoryItemsTable.$inferSelect;
export type InventoryTransaction = typeof inventoryTransactionsTable.$inferSelect;
export type InventoryConsumptionRule = typeof inventoryConsumptionRulesTable.$inferSelect;
export type InventoryBatch = typeof inventoryBatchesTable.$inferSelect;
export type InventoryReorderRequest = typeof inventoryReorderRequestsTable.$inferSelect;
export type InventoryDemandRequest = typeof inventoryDemandRequestsTable.$inferSelect;
export type InsertInventoryItem = z.infer<typeof insertInventoryItemSchema>;
export type InsertInventoryTransaction = z.infer<typeof insertInventoryTransactionSchema>;
export type InsertConsumptionRule = z.infer<typeof insertConsumptionRuleSchema>;
export type InsertInventoryBatch = z.infer<typeof insertInventoryBatchSchema>;
export type InsertInventoryReorderRequest = z.infer<typeof insertInventoryReorderRequestSchema>;
