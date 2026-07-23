import {
  pgTable, serial, integer, text, date, boolean, numeric, timestamp, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { staffTable } from "./staff";
import { usersTable } from "./users";

/**
 * Leave management — additive, non-financial. Approved/medical leave must never
 * incur an attendance penalty (enforced when attendance summaries are computed).
 * Leave-without-pay is tracked but NOT wired to payroll. Gated by ff_hr_leave.
 */

export const leaveTypesTable = pgTable("leave_types", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  paid: boolean("paid").notNull().default(true),
  maxDaysPerYear: numeric("max_days_per_year", { precision: 6, scale: 2 }),
  requiresApproval: boolean("requires_approval").notNull().default(true),
  countsAsAttendance: boolean("counts_as_attendance").notNull().default(true), // no penalty
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const leaveBalancesTable = pgTable(
  "leave_balances",
  {
    id: serial("id").primaryKey(),
    staffId: integer("staff_id").notNull().references(() => staffTable.id, { onDelete: "restrict" }),
    leaveTypeId: integer("leave_type_id").notNull().references(() => leaveTypesTable.id, { onDelete: "restrict" }),
    year: integer("year").notNull(),
    entitled: numeric("entitled", { precision: 6, scale: 2 }).notNull().default("0"),
    used: numeric("used", { precision: 6, scale: 2 }).notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    uq: uniqueIndex("leave_balances_staff_type_year_uq").on(t.staffId, t.leaveTypeId, t.year),
  }),
);

export const leaveRequestsTable = pgTable(
  "leave_requests",
  {
    id: serial("id").primaryKey(),
    staffId: integer("staff_id").notNull().references(() => staffTable.id, { onDelete: "restrict" }),
    leaveTypeId: integer("leave_type_id").notNull().references(() => leaveTypesTable.id, { onDelete: "restrict" }),
    fromDate: date("from_date").notNull(),
    toDate: date("to_date").notNull(),
    days: numeric("days", { precision: 6, scale: 2 }).notNull(),
    halfDay: boolean("half_day").notNull().default(false),
    reason: text("reason"),
    status: text("status").notNull().default("submitted"), // submitted | approved | rejected | cancelled
    approverUserId: integer("approver_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    approverName: text("approver_name"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    staffIdx: index("leave_requests_staff_idx").on(t.staffId),
    statusIdx: index("leave_requests_status_idx").on(t.status),
  }),
);

export type LeaveType = typeof leaveTypesTable.$inferSelect;
export type LeaveBalance = typeof leaveBalancesTable.$inferSelect;
export type LeaveRequest = typeof leaveRequestsTable.$inferSelect;
