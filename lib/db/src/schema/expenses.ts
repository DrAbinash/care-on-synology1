import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const expensesTable = pgTable("expenses", {
  id: serial("id").primaryKey(),
  expenseId: text("expense_id").notNull().unique(),
  category: text("category").notNull(),
  description: text("description").notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  expenseDate: text("expense_date").notNull(),
  paymentMode: text("payment_mode").notNull().default("cash"),
  paidTo: text("paid_to"),
  voucherId: integer("voucher_id"),
  approvedBy: text("approved_by"),
  // Session-derived at creation time (never client-editable — same convention as
  // the audit actors in bills.ts). Lets the approval-separation check in
  // routes/expenses.ts compare "who created" against "who approved" even though
  // approvedBy itself stays free text.
  createdBy: text("created_by"),
  notes: text("notes"),
  // The scanned bill/receipt image (data URL) kept for audit parity — the source
  // document behind the OCR'd fields. Deliberately NEVER selected by the list
  // endpoint (only fetched on the single-expense detail view) so it can't bloat
  // list responses.
  receiptImageUrl: text("receipt_image_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

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
