import { pgTable, text, serial, timestamp, numeric, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Tally-compatible account groups
export const TALLY_GROUPS = [
  // Assets
  "Current Assets",
  "Fixed Assets",
  "Investments",
  "Loans & Advances (Asset)",
  "Misc. Expenses (Asset)",
  // Liabilities
  "Current Liabilities",
  "Loans (Liability)",
  "Unsecured Loans",
  "Capital Account",
  "Reserves & Surplus",
  // Income
  "Direct Income",
  "Indirect Income",
  // Expenses
  "Direct Expenses",
  "Indirect Expenses",
  // Special
  "Cash-in-Hand",
  "Bank Accounts",
  "Bank OD Accounts",
  "Duties & Taxes",
  "Sundry Creditors",
  "Sundry Debtors",
] as const;

export const accountsTable = pgTable("accounts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(), // 'cash' | 'bank' | 'income' | 'expense' | 'liability' | 'asset'
  code: text("code").unique(),
  bankName: text("bank_name"),
  accountNumber: text("account_number"),
  ifscCode: text("ifsc_code"),
  isActive: boolean("is_active").notNull().default(true),
  // Tally-compatible fields
  tallyGroup: text("tally_group"),       // One of TALLY_GROUPS
  openingBalance: numeric("opening_balance", { precision: 14, scale: 2 }).default("0"),
  openingBalanceType: text("opening_balance_type").default("Dr"), // 'Dr' | 'Cr'
  gstApplicable: boolean("gst_applicable").default(false),
  gstNumber: text("gst_number"),
  pan: text("pan"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const vouchersTable = pgTable("vouchers", {
  id: serial("id").primaryKey(),
  voucherNumber: text("voucher_number").notNull().unique(),
  type: text("type").notNull(), // 'payment' | 'receipt' | 'contra' | 'journal' | 'sales' | 'purchase'
  date: text("date").notNull(),
  creditAccountId: text("credit_account_id").notNull(),
  debitAccountId: text("debit_account_id").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  particular: text("particular").notNull(),
  remark: text("remark"),
  performedBy: text("performed_by"),
  reference: text("reference"),
  narration: text("narration"),
  // Optional link to a bill for filtering
  billId: integer("bill_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Audit trail for voucher edits
export const voucherAuditsTable = pgTable("voucher_audits", {
  id: serial("id").primaryKey(),
  voucherId: integer("voucher_id").notNull(),
  voucherNumber: text("voucher_number").notNull(),
  editedBy: text("edited_by").notNull(),
  reason: text("reason").notNull(),
  changeType: text("change_type").notNull(), // 'amount' | 'particular' | 'date' | 'reference' | 'narration' | 'accounts' | 'general'
  oldValue: text("old_value"),
  newValue: text("new_value"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAccountSchema = createInsertSchema(accountsTable).omit({ id: true, createdAt: true });
export const insertVoucherSchema = createInsertSchema(vouchersTable).omit({ id: true, voucherNumber: true, createdAt: true });
export const insertVoucherAuditSchema = createInsertSchema(voucherAuditsTable).omit({ id: true, createdAt: true });

export type Account = typeof accountsTable.$inferSelect;
export type Voucher = typeof vouchersTable.$inferSelect;
export type VoucherAudit = typeof voucherAuditsTable.$inferSelect;
export type InsertAccount = z.infer<typeof insertAccountSchema>;
export type InsertVoucher = z.infer<typeof insertVoucherSchema>;
export type InsertVoucherAudit = z.infer<typeof insertVoucherAuditSchema>;
