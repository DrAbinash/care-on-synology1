import { pgTable, text, serial, timestamp, integer, numeric, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Canonical money-out rows for Expense Entry V2.
 * An expense bill (expenses row) can have zero or more payments.
 * Unpaid / due bill ⇒ zero active rows. Each later settlement ⇒ a new row.
 *
 * Cash / day-close MUST use these rows (payment_mode + created_at posting clock),
 * never expenses.bill_amount / expenses.amount. payment_date is the business /
 * reference date only — reconciliation windows by created_at (same as the rest of CARE).
 */
export const expensePaymentsTable = pgTable(
  "expense_payments",
  {
    id: serial("id").primaryKey(),
    expenseId: integer("expense_id").notNull(),
    /** Stable public id e.g. EXPAY-2609-0001 — used as voucher.reference. */
    paymentPublicId: text("payment_public_id").notNull().unique(),
    paymentDate: text("payment_date").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    paymentMode: text("payment_mode").notNull().default("cash"),
    /** Chart-of-accounts id money left from (Cash in Hand / Bank). */
    paidFromAccountId: integer("paid_from_account_id"),
    referenceNumber: text("reference_number"),
    notes: text("notes"),
    createdBy: text("created_by"),
    /** Durable link to the Payment Voucher that records this outflow. */
    voucherId: integer("voucher_id"),
    /** POSTED | PENDING | FAILED | REVERSED */
    accountingStatus: text("accounting_status").notNull().default("PENDING"),
    accountingError: text("accounting_error"),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedBy: text("reversed_by"),
    reversalReason: text("reversal_reason"),
    /** "true" when created by the V2 backfill of a legacy fully-paid expense. */
    isLegacyBackfill: text("is_legacy_backfill").notNull().default("false"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("expense_payments_expense_id_idx").on(t.expenseId),
    index("expense_payments_payment_date_idx").on(t.paymentDate),
    index("expense_payments_voucher_id_idx").on(t.voucherId),
  ],
);

export const expensePaymentCounterTable = pgTable("expense_payment_counter", {
  id: serial("id").primaryKey(),
  counter: integer("counter").notNull().default(0),
});

export const insertExpensePaymentSchema = createInsertSchema(expensePaymentsTable).omit({
  id: true,
  paymentPublicId: true,
  createdAt: true,
  updatedAt: true,
});
export type ExpensePayment = typeof expensePaymentsTable.$inferSelect;
export type InsertExpensePayment = z.infer<typeof insertExpensePaymentSchema>;
