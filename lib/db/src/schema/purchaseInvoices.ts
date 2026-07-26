import { pgTable, text, serial, timestamp, integer, numeric, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { vendorsTable } from "./vendors";
import { inventoryItemsTable } from "./inventory";

/**
 * Header for a scanned or manually-entered supplier invoice. Groups multiple
 * line items under one vendor/invoice#/total — previously stock-in only
 * existed as flat vendorId/invoiceNumber columns duplicated per line on
 * inventoryBatchesTable/inventoryTransactionsTable, with nothing tying a
 * multi-item invoice together as one record.
 *
 * Confirming a "draft" invoice (see routes/purchaseInvoices.ts) fans its
 * matched line items out into inventoryBatchesTable + inventoryTransactionsTable
 * rows via the same receiveBatchTx() helper the manual single-item "Stock In"
 * flow uses, then flips status to "posted". Posted invoices are immutable —
 * corrections go through the existing stock-adjustment path, not by editing
 * a posted invoice's line items.
 */
export const purchaseInvoicesTable = pgTable("purchase_invoices", {
  id: serial("id").primaryKey(),
  invoiceNumber: text("invoice_number").notNull(),
  invoiceDate: date("invoice_date"),
  vendorId: integer("vendor_id").references(() => vendorsTable.id, { onDelete: "set null" }),
  // OCR-extracted vendor name, kept even when it couldn't be matched to a
  // vendorsTable row (or was overridden) — an audit trail of what the
  // invoice actually said versus which vendor record it got reconciled to.
  vendorNameRaw: text("vendor_name_raw"),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull().default("0"),
  gstAmount: numeric("gst_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("draft"), // draft | posted | cancelled
  sourceImageUrl: text("source_image_url"),
  ocrConfidence: text("ocr_confidence"), // high | medium | low | null (manual entry, no OCR run)
  ocrConfidencePercent: integer("ocr_confidence_percent"),
  notes: text("notes"),
  createdBy: text("created_by"),
  postedAt: timestamp("posted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

/**
 * One row per product/medicine line on the invoice. `itemId` is null until
 * matched (by the fuzzy-match pass, or a manual pick) to the inventory
 * catalog; a line with no itemId is skipped when the invoice is posted
 * (see routes/purchaseInvoices.ts) rather than blocking the whole invoice.
 */
export const purchaseInvoiceLineItemsTable = pgTable("purchase_invoice_line_items", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => purchaseInvoicesTable.id, { onDelete: "cascade" }),
  itemId: integer("item_id").references(() => inventoryItemsTable.id, { onDelete: "set null" }),
  descriptionRaw: text("description_raw").notNull(),
  // 0-100 fuzzy-match score between descriptionRaw and the matched item's
  // name, null if unmatched or manually picked (no score to show).
  matchConfidence: numeric("match_confidence", { precision: 5, scale: 2 }),
  quantity: numeric("quantity", { precision: 10, scale: 2 }).notNull().default("0"),
  unitCost: numeric("unit_cost", { precision: 12, scale: 2 }).notNull().default("0"),
  lineTotal: numeric("line_total", { precision: 12, scale: 2 }).notNull().default("0"),
  lotNumber: text("lot_number"),
  expiryDate: date("expiry_date"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPurchaseInvoiceSchema = createInsertSchema(purchaseInvoicesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertPurchaseInvoiceLineItemSchema = createInsertSchema(purchaseInvoiceLineItemsTable).omit({ id: true, createdAt: true });

export type PurchaseInvoice = typeof purchaseInvoicesTable.$inferSelect;
export type PurchaseInvoiceLineItem = typeof purchaseInvoiceLineItemsTable.$inferSelect;
export type InsertPurchaseInvoice = z.infer<typeof insertPurchaseInvoiceSchema>;
export type InsertPurchaseInvoiceLineItem = z.infer<typeof insertPurchaseInvoiceLineItemSchema>;
