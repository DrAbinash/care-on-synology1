import { pgTable, serial, integer, text, numeric, timestamp } from "drizzle-orm/pg-core";

// Immutable audit trail for every drawer-close lifecycle event.
// action values: close_started | closed | mismatch_detected | mismatch_approved |
//                drawer_reopened | post_close_override
export const drawerAuditLogTable = pgTable("drawer_audit_log", {
  id: serial("id").primaryKey(),

  // The user_day_closures row this log belongs to (null for pre-close events).
  userClosureId: integer("user_closure_id"),

  action: text("action").notNull(),

  userId: integer("user_id"),
  userName: text("user_name").notNull(),
  userRole: text("user_role").notNull().default("staff"),

  expectedTotal: numeric("expected_total", { precision: 12, scale: 2 }),
  actualTotal:   numeric("actual_total",   { precision: 12, scale: 2 }),
  variance:      numeric("variance",       { precision: 12, scale: 2 }),

  // Free-text reason / note relevant to the action.
  reason: text("reason").notNull().default(""),

  // For post_close_override: bill or payment id that was modified.
  targetType: text("target_type"),
  targetId: integer("target_id"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
