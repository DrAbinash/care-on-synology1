import { pgTable, text, serial, timestamp, integer, numeric, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Expense bill header (Expense Entry V2).
 *
 * Semantics after V2:
 *   - `amount` remains for backward compatibility (= billAmount for new rows;
 *     historically it meant "money paid", which equalled the bill).
 *   - `billAmount` is the supplier bill / invoice total.
 *   - Actual money movements live in `expense_payments`.
 *   - paymentStatus is derived from payments but stored for fast filtering.
 *
 * BILL VALUE ≠ MONEY PAID. Day-close must use expense_payments, not billAmount.
 */
export const expensesTable = pgTable(
  "expenses",
  {
    id: serial("id").primaryKey(),
    expenseId: text("expense_id").notNull().unique(),
    category: text("category").notNull(),
    description: text("description").notNull(),
    /** @deprecated Prefer billAmount. Kept = bill total for V2 rows. */
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    expenseDate: text("expense_date").notNull(),
    paymentMode: text("payment_mode").notNull().default("cash"),
    paidTo: text("paid_to"),
    voucherId: integer("voucher_id"),
    approvedBy: text("approved_by"),
    createdBy: text("created_by"),
    notes: text("notes"),
    receiptImageUrl: text("receipt_image_url"),

    // ── Expense Entry V2 columns ───────────────────────────────────────────
    /** Supplier bill total (inclusive of tax unless tax is tracked separately). */
    billAmount: numeric("bill_amount", { precision: 12, scale: 2 }),
    taxAmount: numeric("tax_amount", { precision: 12, scale: 2 }),
    /** PAID | PART_PAID | DUE | VOID */
    paymentStatus: text("payment_status").notNull().default("PAID"),
    vendorId: integer("vendor_id"),
    vendorNameSnapshot: text("vendor_name_snapshot"),
    invoiceNumber: text("invoice_number"),
    invoiceDate: text("invoice_date"),
    departmentId: integer("department_id"),
    categoryId: integer("category_id"),
    subcategoryId: integer("subcategory_id"),
    /** POSTED | PENDING | FAILED | REVERSED | PARTIAL */
    accountingStatus: text("accounting_status").notNull().default("PENDING"),
    accountingError: text("accounting_error"),
    /** Accrual / purchase voucher for the bill (Dr Expense / Cr Payable). */
    accrualVoucherId: integer("accrual_voucher_id"),
    voidReason: text("void_reason"),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedBy: text("voided_by"),
    /** SHA-256 hex of the receipt image bytes (duplicate detection). */
    receiptImageHash: text("receipt_image_hash"),
    /** JSON blob of last OCR extraction (confidence, raw fields). */
    ocrMetaJson: text("ocr_meta_json"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("expenses_payment_status_idx").on(t.paymentStatus),
    index("expenses_vendor_id_idx").on(t.vendorId),
    index("expenses_invoice_number_idx").on(t.invoiceNumber),
    index("expenses_department_id_idx").on(t.departmentId),
    index("expenses_receipt_hash_idx").on(t.receiptImageHash),
    index("expenses_expense_date_idx").on(t.expenseDate),
  ],
);

export const expenseCounterTable = pgTable("expense_counter", {
  id: serial("id").primaryKey(),
  counter: integer("counter").notNull().default(0),
});

export const insertExpenseSchema = createInsertSchema(expensesTable).omit({
  id: true,
  expenseId: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertExpense = z.infer<typeof insertExpenseSchema>;
export type Expense = typeof expensesTable.$inferSelect;

export const EXPENSE_PAYMENT_STATUSES = ["PAID", "PART_PAID", "DUE", "VOID"] as const;
export type ExpensePaymentStatus = (typeof EXPENSE_PAYMENT_STATUSES)[number];

export const EXPENSE_ACCOUNTING_STATUSES = [
  "POSTED",
  "PENDING",
  "FAILED",
  "REVERSED",
  "PARTIAL",
] as const;
export type ExpenseAccountingStatus = (typeof EXPENSE_ACCOUNTING_STATUSES)[number];
