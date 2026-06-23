import { pgTable, serial, text, timestamp, integer, numeric, jsonb, date } from "drizzle-orm/pg-core";

// Day-Close / Cash-Drawer-Close.
//
// One row per close event. Admins (and super-admins) sign off on the
// day's collections; super-admins can re-open a closed day.
//
// "Coverage window" semantics:
//   coveredFromTs  = exclusive lower bound (typically the previous closure's
//                     closedAt, or NULL for the very first close)
//   coveredToTs    = inclusive upper bound = closedAt
// Bills/payments created AFTER closedAt automatically belong to the next
// open day — there is no hard block; the new day simply starts running
// totals from this closure forward.
export const dayClosuresTable = pgTable("day_closures", {
  id: serial("id").primaryKey(),
  // Business date label for the close (defaults to closedAt's IST date).
  closureDate: date("closure_date").notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true }).notNull().defaultNow(),
  closedByUserId: integer("closed_by_user_id"),
  closedByName: text("closed_by_name").notNull().default(""),

  // Coverage window — see header comment.
  coveredFromTs: timestamp("covered_from_ts", { withTimezone: true }),
  coveredToTs: timestamp("covered_to_ts", { withTimezone: true }).notNull().defaultNow(),

  // Expected = sum of payments in the coverage window grouped by method.
  expectedCash: numeric("expected_cash", { precision: 12, scale: 2 }).notNull().default("0"),
  expectedUpi: numeric("expected_upi", { precision: 12, scale: 2 }).notNull().default("0"),
  expectedCard: numeric("expected_card", { precision: 12, scale: 2 }).notNull().default("0"),
  expectedCheque: numeric("expected_cheque", { precision: 12, scale: 2 }).notNull().default("0"),
  expectedOther: numeric("expected_other", { precision: 12, scale: 2 }).notNull().default("0"),

  // Actual = entered by the closing user (physically counted).
  actualCash: numeric("actual_cash", { precision: 12, scale: 2 }).notNull().default("0"),
  actualUpi: numeric("actual_upi", { precision: 12, scale: 2 }).notNull().default("0"),
  actualCard: numeric("actual_card", { precision: 12, scale: 2 }).notNull().default("0"),
  actualCheque: numeric("actual_cheque", { precision: 12, scale: 2 }).notNull().default("0"),
  actualOther: numeric("actual_other", { precision: 12, scale: 2 }).notNull().default("0"),

  // (sum actual) - (sum expected). Negative = short, positive = surplus.
  variance: numeric("variance", { precision: 12, scale: 2 }).notNull().default("0"),
  varianceNote: text("variance_note").notNull().default(""),

  billsCount: integer("bills_count").notNull().default(0),
  paymentsCount: integer("payments_count").notNull().default(0),
  totalExpected: numeric("total_expected", { precision: 12, scale: 2 }).notNull().default("0"),
  totalActual: numeric("total_actual", { precision: 12, scale: 2 }).notNull().default("0"),

  // [{userId, userName, total, byMethod:{cash,upi,card,cheque,other}, count}]
  staffBreakdown: jsonb("staff_breakdown").notNull().default([]),

  // Report enrichments
  totalBilled: numeric("total_billed", { precision: 12, scale: 2 }).notNull().default("0"),
  totalRefunds: numeric("total_refunds", { precision: 12, scale: 2 }).notNull().default("0"),
  totalExpenses: numeric("total_expenses", { precision: 12, scale: 2 }).notNull().default("0"),
  totalDue: numeric("total_due", { precision: 12, scale: 2 }).notNull().default("0"),
  // [{testId, testName, category, count, total}]
  testSummary: jsonb("test_summary").notNull().default([]),
  // [{id, amount, category, description}]
  expenseDetails: jsonb("expense_details").notNull().default([]),
  // [{id, billNumber, patientName, totalAmount, refundAmount}]
  refundDetails: jsonb("refund_details").notNull().default([]),

  // Re-open audit (super-admin only).
  status: text("status").notNull().default("closed"), // "closed" | "reopened"
  reopenedAt: timestamp("reopened_at", { withTimezone: true }),
  reopenedByUserId: integer("reopened_by_user_id"),
  reopenedByName: text("reopened_by_name").notNull().default(""),
  reopenReason: text("reopen_reason").notNull().default(""),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
