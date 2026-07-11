import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { patientsTable } from "./patients";
import { ordersTable } from "./orders";

export const billsTable = pgTable("bills", {
  id: serial("id").primaryKey(),
  billNumber: text("bill_number").notNull().unique(),
  orderId: integer("order_id").notNull().references(() => ordersTable.id),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id),
  subtotal: numeric("subtotal", { precision: 10, scale: 2 }).notNull().default("0"),
  discount: numeric("discount", { precision: 10, scale: 2 }).notNull().default("0"),
  discountReason: text("discount_reason"),
  discountReasonNote: text("discount_reason_note"),
  taxAmount: numeric("tax_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  totalAmount: numeric("total_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  paidAmount: numeric("paid_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  balanceAmount: numeric("balance_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("pending"),
  ledgerId: integer("ledger_id"),
  dueDate: text("due_date"),
  createdByName: text("created_by_name"),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelledByName: text("cancelled_by_name"),
  cancellationReason: text("cancellation_reason"),
  refundAmount: numeric("refund_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  originalTotal: numeric("original_total", { precision: 10, scale: 2 }).notNull().default("0"),

  // Idempotency key for POST /api/bills retries (see migrations/add_bill_order_idempotency.sql).
  // Was previously missing from this schema, so Drizzle's insert builder —
  // which only writes columns it knows about — silently dropped every
  // clientRef passed via the `as any` value spread in bills.ts, leaving
  // this column permanently NULL. That made the idempotency check
  // ("WHERE client_ref = ...") always a no-op: a genuine network-retried
  // bill creation was never recognized as a retry.
  clientRef: text("client_ref"),

  // ── V3: Analytics counters (future dashboard) ──
  qrScanCount: integer("qr_scan_count").notNull().default(0),
  receiptVerificationCount: integer("receipt_verification_count").notNull().default(0),
  pdfDownloadCount: integer("pdf_download_count").notNull().default(0),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const paymentsTable = pgTable("payments", {
  id: serial("id").primaryKey(),
  billId: integer("bill_id").notNull().references(() => billsTable.id),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  method: text("method").notNull(),
  referenceNumber: text("reference_number"),
  notes: text("notes"),
  recordedByName: text("recorded_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBillSchema = createInsertSchema(billsTable).omit({ id: true, billNumber: true, createdAt: true, updatedAt: true });
export type InsertBill = z.infer<typeof insertBillSchema>;
export type Bill = typeof billsTable.$inferSelect;

export const insertPaymentSchema = createInsertSchema(paymentsTable).omit({ id: true, createdAt: true });
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof paymentsTable.$inferSelect;
