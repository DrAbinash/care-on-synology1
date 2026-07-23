import {
  pgTable, serial, integer, text, date, boolean, timestamp, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { staffTable } from "./staff";
import { usersTable } from "./users";

/**
 * Duty roster & shift scheduling (attendance Phase 2) — additive, non-financial.
 * Supports 12h/night/cross-midnight shifts, grace periods, weekly-offs and a
 * holiday calendar so attendance can later be judged late/early/absent/overnight.
 * Does NOT compute payroll. Gated by ff_hr_roster.
 */

export const shiftTemplatesTable = pgTable("shift_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  code: text("code"),
  startTime: text("start_time").notNull(), // "HH:MM" (local IST)
  endTime: text("end_time").notNull(),
  crossMidnight: boolean("cross_midnight").notNull().default(false),
  graceMinutes: integer("grace_minutes").notNull().default(10),
  breakMinutes: integer("break_minutes").notNull().default(0),
  color: text("color"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const dutyRostersTable = pgTable(
  "duty_rosters",
  {
    id: serial("id").primaryKey(),
    staffId: integer("staff_id").notNull().references(() => staffTable.id, { onDelete: "restrict" }),
    dutyDate: date("duty_date").notNull(),
    shiftTemplateId: integer("shift_template_id").references(() => shiftTemplatesTable.id, { onDelete: "set null" }),
    status: text("status").notNull().default("scheduled"), // scheduled | off | holiday | leave | swap_requested
    notes: text("notes"),
    createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    staffDateUq: uniqueIndex("duty_rosters_staff_date_uq").on(t.staffId, t.dutyDate),
    dateIdx: index("duty_rosters_date_idx").on(t.dutyDate),
  }),
);

export const holidayCalendarTable = pgTable("holiday_calendar", {
  id: serial("id").primaryKey(),
  holidayDate: date("holiday_date").notNull().unique(),
  name: text("name").notNull(),
  type: text("type").notNull().default("public"), // public | optional | restricted
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ShiftTemplate = typeof shiftTemplatesTable.$inferSelect;
export type DutyRoster = typeof dutyRostersTable.$inferSelect;
export type Holiday = typeof holidayCalendarTable.$inferSelect;
