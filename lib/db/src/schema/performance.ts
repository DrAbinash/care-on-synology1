import {
  pgTable,
  serial,
  integer,
  text,
  date,
  boolean,
  numeric,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { staffTable } from "./staff";
import { usersTable } from "./users";

/**
 * Performance module (Phase 3) — configurable, advisory, shadow-mode.
 *
 * The OFFICIAL score is computed server-side by the pure engine
 * (artifacts/api-server/src/lib/performance/scoreEngine.ts) from these tables.
 * Owner decisions honoured: policy is DATA (categories + rules), never
 * hard-coded; performance is ADVISORY — no payroll/deduction/increment is
 * changed by software; finalized cycles snapshot their rule-set so history is
 * immutable. Gated by ff_hr_performance_scoring. Non-financial.
 */

export const performanceCyclesTable = pgTable("performance_cycles", {
  id: serial("id").primaryKey(),
  label: text("label").notNull().unique(), // e.g. "2026-07"
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  status: text("status").notNull().default("open"), // draft | open | finalized | locked
  ruleSnapshot: jsonb("rule_snapshot"), // categories+rules captured at finalize
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  finalizedByUserId: integer("finalized_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// Configurable category policy (the 100-point framework, editable by management).
export const performanceCategoriesTable = pgTable("performance_categories", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  label: text("label").notNull(),
  maxMarks: integer("max_marks").notNull(),
  strategy: text("strategy").notNull().default("deduction"), // deduction | earned
  baseline: integer("baseline"),
  sortOrder: integer("sort_order"),
  isActive: boolean("is_active").notNull().default(true),
  effectiveFrom: date("effective_from"),
  effectiveUntil: date("effective_until"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// Configurable rules that resolve to signed point events.
export const performanceRulesTable = pgTable("performance_rules", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  categoryKey: text("category_key").notNull(),
  points: integer("points").notNull(), // signed
  minPoint: integer("min_point"),
  maxPoint: integer("max_point"),
  frequencyCap: integer("frequency_cap"),
  evidenceRequired: boolean("evidence_required").notNull().default(false),
  responseRequired: boolean("response_required").notNull().default(false),
  approvalLevel: text("approval_level"), // supervisor | manager | director
  autoApplied: boolean("auto_applied").notNull().default(false),
  disqualifying: boolean("disqualifying").notNull().default(false),
  majorMisconduct: boolean("major_misconduct").notNull().default(false),
  awardDisqualification: boolean("award_disqualification").notNull().default(false),
  allowanceDisqualification: boolean("allowance_disqualification").notNull().default(false),
  departmentApplicability: text("department_applicability"),
  designationApplicability: text("designation_applicability"),
  effectiveFrom: date("effective_from"),
  effectiveUntil: date("effective_until"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// A verified positive/negative event applied to one staff member in one cycle.
export const performanceEventsTable = pgTable(
  "performance_events",
  {
    id: serial("id").primaryKey(),
    cycleId: integer("cycle_id").notNull().references(() => performanceCyclesTable.id, { onDelete: "restrict" }),
    staffId: integer("staff_id").notNull().references(() => staffTable.id, { onDelete: "restrict" }),
    ruleId: integer("rule_id").references(() => performanceRulesTable.id, { onDelete: "set null" }),
    categoryKey: text("category_key").notNull(),
    points: integer("points").notNull(), // signed
    disqualifying: boolean("disqualifying").notNull().default(false),
    eventDate: date("event_date").notNull(),
    description: text("description"),
    notes: text("notes"),
    evidenceStorageKey: text("evidence_storage_key"),
    // draft | submitted | employee_notified | employee_responded | manager_review
    // | approved | rejected | returned | score_applied
    status: text("status").notNull().default("submitted"),
    submittedByUserId: integer("submitted_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    submittedByName: text("submitted_by_name"),
    verifiedByUserId: integer("verified_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    employeeResponse: text("employee_response"),
    appealStatus: text("appeal_status"),
    finalDecision: text("final_decision"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    cycleStaffIdx: index("performance_events_cycle_staff_idx").on(t.cycleId, t.staffId),
    staffIdx: index("performance_events_staff_idx").on(t.staffId),
    statusIdx: index("performance_events_status_idx").on(t.status),
  }),
);

// Finalized score per staff per cycle (immutable snapshot).
export const performanceScoresTable = pgTable(
  "performance_scores",
  {
    id: serial("id").primaryKey(),
    cycleId: integer("cycle_id").notNull().references(() => performanceCyclesTable.id, { onDelete: "restrict" }),
    staffId: integer("staff_id").notNull().references(() => staffTable.id, { onDelete: "restrict" }),
    total: numeric("total", { precision: 6, scale: 2 }).notNull(),
    maxTotal: numeric("max_total", { precision: 6, scale: 2 }).notNull(),
    breakdown: jsonb("breakdown").notNull(),
    disqualified: boolean("disqualified").notNull().default(false),
    ruleSnapshot: jsonb("rule_snapshot"),
    finalizedByUserId: integer("finalized_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    cycleStaffUq: uniqueIndex("performance_scores_cycle_staff_uq").on(t.cycleId, t.staffId),
    staffIdx: index("performance_scores_staff_idx").on(t.staffId),
  }),
);

// Employee appeal against an event (or a finalized score).
export const performanceAppealsTable = pgTable(
  "performance_appeals",
  {
    id: serial("id").primaryKey(),
    eventId: integer("event_id").references(() => performanceEventsTable.id, { onDelete: "restrict" }),
    cycleId: integer("cycle_id").references(() => performanceCyclesTable.id, { onDelete: "restrict" }),
    staffId: integer("staff_id").notNull().references(() => staffTable.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("submitted"), // submitted | under_review | upheld | rejected | withdrawn
    decidedByUserId: integer("decided_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    decision: text("decision"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    staffIdx: index("performance_appeals_staff_idx").on(t.staffId),
    statusIdx: index("performance_appeals_status_idx").on(t.status),
  }),
);

export type PerformanceCycle = typeof performanceCyclesTable.$inferSelect;
export type PerformanceCategory = typeof performanceCategoriesTable.$inferSelect;
export type PerformanceRule = typeof performanceRulesTable.$inferSelect;
export type PerformanceEvent = typeof performanceEventsTable.$inferSelect;
export type PerformanceScore = typeof performanceScoresTable.$inferSelect;
export type PerformanceAppeal = typeof performanceAppealsTable.$inferSelect;
