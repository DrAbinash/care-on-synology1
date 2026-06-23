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

export type InventoryItem = typeof inventoryItemsTable.$inferSelect;
export type InventoryTransaction = typeof inventoryTransactionsTable.$inferSelect;
export type InventoryConsumptionRule = typeof inventoryConsumptionRulesTable.$inferSelect;
export type InsertInventoryItem = z.infer<typeof insertInventoryItemSchema>;
export type InsertInventoryTransaction = z.infer<typeof insertInventoryTransactionSchema>;
export type InsertConsumptionRule = z.infer<typeof insertConsumptionRuleSchema>;
