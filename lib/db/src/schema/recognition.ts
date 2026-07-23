import {
  pgTable, serial, integer, text, date, boolean, jsonb, timestamp, index,
} from "drizzle-orm/pg-core";
import { staffTable } from "./staff";
import { usersTable } from "./users";

/**
 * Recognition, allowances & notifications (Phase 4) — configurable, advisory.
 *
 * Awards and allowance eligibility are performance-linked benefits that ALWAYS
 * require human approval (owner decision): nothing here grants money or changes
 * payroll. Allowance statuses are earned/temporary, never permanent salary.
 * Notifications are the previously-missing in-app inbox. Gated by
 * ff_hr_staff_awards / ff_hr_performance_allowances / ff_hr_employee_self_service.
 */

// In-app notification inbox (generic; the first such system in the ERP).
export const notificationsTable = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    // Recipient is a staff member and/or an ERP user (self-service).
    staffId: integer("staff_id").references(() => staffTable.id, { onDelete: "cascade" }),
    userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // performance_event | appeal_decision | award | allowance | review_due | ...
    title: text("title").notNull(),
    body: text("body"),
    refType: text("ref_type"),
    refId: text("ref_id"),
    isRead: boolean("is_read").notNull().default(false),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    staffIdx: index("notifications_staff_idx").on(t.staffId),
    userIdx: index("notifications_user_idx").on(t.userId),
    unreadIdx: index("notifications_unread_idx").on(t.isRead),
  }),
);

// Configurable award / badge catalogue (Employee of Week/Month/Year + custom
// badges: Patient Champion, Perfect Attendance, Emergency Hero, …).
export const awardTypesTable = pgTable("award_types", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  cadence: text("cadence").notNull().default("custom"), // weekly | monthly | yearly | custom
  description: text("description"),
  criteria: jsonb("criteria"), // configurable eligibility thresholds
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// A declared winner (management-approved). "No eligible winner" is allowed by
// simply not creating a row for a period.
export const awardWinnersTable = pgTable(
  "award_winners",
  {
    id: serial("id").primaryKey(),
    awardTypeId: integer("award_type_id").notNull().references(() => awardTypesTable.id, { onDelete: "restrict" }),
    staffId: integer("staff_id").notNull().references(() => staffTable.id, { onDelete: "restrict" }),
    periodLabel: text("period_label").notNull(), // e.g. "2026-W30" | "2026-07" | "2026"
    citation: text("citation"),
    approvedByUserId: integer("approved_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    approvedByName: text("approved_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    typePeriodIdx: index("award_winners_type_period_idx").on(t.awardTypeId, t.periodLabel),
    staffIdx: index("award_winners_staff_idx").on(t.staffId),
  }),
);

// Computed allowance eligibility per staff per period, plus its approval status.
export const allowanceEligibilityTable = pgTable(
  "allowance_eligibility",
  {
    id: serial("id").primaryKey(),
    staffId: integer("staff_id").notNull().references(() => staffTable.id, { onDelete: "restrict" }),
    allowanceKind: text("allowance_kind").notNull(), // travel | food
    periodLabel: text("period_label").notNull(),
    // eligible | provisionally_eligible | not_eligible | on_hold | disqualified |
    // approved | rejected | expired
    status: text("status").notNull(),
    reasons: jsonb("reasons"), // machine-readable explanation
    metricsSnapshot: jsonb("metrics_snapshot"),
    approvedByUserId: integer("approved_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    approvedByName: text("approved_by_name"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    staffKindPeriodIdx: index("allowance_eligibility_staff_kind_period_idx").on(t.staffId, t.allowanceKind, t.periodLabel),
  }),
);

export type Notification = typeof notificationsTable.$inferSelect;
export type AwardType = typeof awardTypesTable.$inferSelect;
export type AwardWinner = typeof awardWinnersTable.$inferSelect;
export type AllowanceEligibility = typeof allowanceEligibilityTable.$inferSelect;
