import { pgTable, serial, text, timestamp, integer, numeric, date, jsonb } from "drizzle-orm/pg-core";

// Per-user / per-shift day close.
// Each staff member closes their own session independently.
// Their financial window runs from MAX(last overall close, last user close) → now.
// After close, new bills they create fall into the next window (tomorrow's accounting).
export const userDayClosuresTable = pgTable("user_day_closures", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  userName: text("user_name").notNull(),

  // IST date label of the close.
  closureDate: date("closure_date").notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true }).notNull().defaultNow(),

  // Window this close covers (same semantics as overall day_closures).
  coveredFromTs: timestamp("covered_from_ts", { withTimezone: true }),
  coveredToTs: timestamp("covered_to_ts", { withTimezone: true }).notNull().defaultNow(),

  // Expected = payments recorded by this user inside the window.
  expectedCash:   numeric("expected_cash",   { precision: 12, scale: 2 }).notNull().default("0"),
  expectedUpi:    numeric("expected_upi",    { precision: 12, scale: 2 }).notNull().default("0"),
  expectedCard:   numeric("expected_card",   { precision: 12, scale: 2 }).notNull().default("0"),
  expectedCheque: numeric("expected_cheque", { precision: 12, scale: 2 }).notNull().default("0"),
  expectedOther:  numeric("expected_other",  { precision: 12, scale: 2 }).notNull().default("0"),
  totalExpected:  numeric("total_expected",  { precision: 12, scale: 2 }).notNull().default("0"),

  // Bills created by this user in the window.
  totalBilled: numeric("total_billed", { precision: 12, scale: 2 }).notNull().default("0"),
  totalDue:    numeric("total_due",    { precision: 12, scale: 2 }).notNull().default("0"),
  billsCount:    integer("bills_count").notNull().default(0),
  paymentsCount: integer("payments_count").notNull().default(0),

  // Actual = physically counted by the user at close time.
  actualCash:   numeric("actual_cash",   { precision: 12, scale: 2 }).notNull().default("0"),
  actualUpi:    numeric("actual_upi",    { precision: 12, scale: 2 }).notNull().default("0"),
  actualCard:   numeric("actual_card",   { precision: 12, scale: 2 }).notNull().default("0"),
  actualCheque: numeric("actual_cheque", { precision: 12, scale: 2 }).notNull().default("0"),
  actualOther:  numeric("actual_other",  { precision: 12, scale: 2 }).notNull().default("0"),
  totalActual:  numeric("total_actual",  { precision: 12, scale: 2 }).notNull().default("0"),

  // (totalActual - totalExpected). Negative = short, positive = surplus.
  variance:     numeric("variance",      { precision: 12, scale: 2 }).notNull().default("0"),
  varianceNote: text("variance_note").notNull().default(""),

  // Optional handover note for the next shift.
  notes: text("notes").notNull().default(""),

  // ── Denomination counting (added May 2026) ───────────────────────────────
  // JSONB: { d500, d200, d100, d50, d20, d10, coins } — count of each note.
  // null means denomination section was not used.
  denominations: jsonb("denominations").$type<{
    d500: number; d200: number; d100: number;
    d50: number; d20: number; d10: number; coins: number;
  } | null>().default(null),
  // Sum of denominations × face value. null if denominations not entered.
  denominationTotal: numeric("denomination_total", { precision: 12, scale: 2 }),

  // ── Drawer status (added May 2026) ───────────────────────────────────────
  // open | closed | mismatch | balanced | approved
  // "open" is never stored (it's the default/absence state).
  // "mismatch" = variance != 0 and not yet approved.
  // "approved" = mismatch acknowledged by admin.
  // "balanced" = variance == 0 on close.
  drawerStatus: text("drawer_status").notNull().default("closed"),

  // Admin who approved a mismatch + timestamp.
  approvedByName: text("approved_by_name"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvalNote: text("approval_note"),

  // Admin who reopened this individual drawer + reason.
  reopenedByName: text("reopened_by_name"),
  reopenedAt: timestamp("reopened_at", { withTimezone: true }),
  reopenReason: text("reopen_reason"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
