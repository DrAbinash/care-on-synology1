import {
  pgTable, serial, integer, text, date, numeric, jsonb, timestamp, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { staffTable } from "./staff";
import { usersTable } from "./users";

/**
 * Appraisal, increment recommendations & PIP (Phase 5) — advisory.
 *
 * Increment "recommendations" are advisory outputs only — the system NEVER
 * alters payroll or salary (owner decision). Final decisions are management's.
 * PIPs are confidential (no public shaming). Gated by ff_hr_annual_appraisals.
 */

export const appraisalCyclesTable = pgTable("appraisal_cycles", {
  id: serial("id").primaryKey(),
  label: text("label").notNull().unique(), // e.g. "2026"
  yearStart: date("year_start").notNull(),
  yearEnd: date("year_end").notNull(),
  status: text("status").notNull().default("open"), // draft | open | finalized
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const employeeAppraisalsTable = pgTable(
  "employee_appraisals",
  {
    id: serial("id").primaryKey(),
    cycleId: integer("cycle_id").notNull().references(() => appraisalCyclesTable.id, { onDelete: "restrict" }),
    staffId: integer("staff_id").notNull().references(() => staffTable.id, { onDelete: "restrict" }),
    annualScoreAvg: numeric("annual_score_avg", { precision: 6, scale: 2 }),
    recommendationBand: text("recommendation_band"),
    recommendation: text("recommendation"),
    strengths: text("strengths"),
    improvementAreas: text("improvement_areas"),
    managerComments: text("manager_comments"),
    employeeComments: text("employee_comments"),
    // pending | approved | deferred | rejected — advisory, never touches payroll
    managementDecision: text("management_decision").notNull().default("pending"),
    decidedByUserId: integer("decided_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    cycleStaffUq: uniqueIndex("employee_appraisals_cycle_staff_uq").on(t.cycleId, t.staffId),
    staffIdx: index("employee_appraisals_staff_idx").on(t.staffId),
  }),
);

export const performanceImprovementPlansTable = pgTable(
  "performance_improvement_plans",
  {
    id: serial("id").primaryKey(),
    staffId: integer("staff_id").notNull().references(() => staffTable.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    targetCategories: jsonb("target_categories"),
    requiredActions: text("required_actions"),
    trainingAssigned: text("training_assigned"),
    supervisorStaffId: integer("supervisor_staff_id").references(() => staffTable.id, { onDelete: "set null" }),
    startDate: date("start_date"),
    reviewDates: jsonb("review_dates"),
    completionDate: date("completion_date"),
    outcome: text("outcome"),
    employeeComments: text("employee_comments"),
    managementDecision: text("management_decision"),
    // draft | active | review_due | improved | extended | failed | closed
    status: text("status").notNull().default("draft"),
    createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    staffIdx: index("performance_improvement_plans_staff_idx").on(t.staffId),
    statusIdx: index("performance_improvement_plans_status_idx").on(t.status),
  }),
);

export type AppraisalCycle = typeof appraisalCyclesTable.$inferSelect;
export type EmployeeAppraisal = typeof employeeAppraisalsTable.$inferSelect;
export type PerformanceImprovementPlan = typeof performanceImprovementPlansTable.$inferSelect;
