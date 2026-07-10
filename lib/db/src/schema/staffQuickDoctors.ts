import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// staff_quick_doctors — each authenticated staff member's OWN Billing Desk
// Quick Doctor slot layout (8 fixed slots, same shape/contract as the legacy
// clinic_settings.quick_doctor_ids field: a JSON-stringified array of exactly
// 8 entries, each a positive integer doctor id or null).
//
// This table is personal, not clinic-wide: one row per staff member
// (uniqueIndex on staffId), so one billing clerk saving their own layout can
// never overwrite another staff member's. `staffId` is always the
// server-derived authenticated session's own subjectId — routes/
// staffQuickDoctors.ts never accepts a client-supplied staffId.
export const staffQuickDoctorsTable = pgTable(
  "staff_quick_doctors",
  {
    id: serial("id").primaryKey(),
    staffId: integer("staff_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    quickDoctorIds: text("quick_doctor_ids").notNull().default("[null,null,null,null,null,null,null,null]"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    staffUq: uniqueIndex("staff_quick_doctors_staff_uq").on(t.staffId),
  }),
);

export type StaffQuickDoctors = typeof staffQuickDoctorsTable.$inferSelect;
export type InsertStaffQuickDoctors = typeof staffQuickDoctorsTable.$inferInsert;
