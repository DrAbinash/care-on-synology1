import { pgTable, text, serial, timestamp, numeric, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { doctorsTable } from "./doctors";

export const doctorPayoutsTable = pgTable(
  "doctor_payouts",
  {
    id: serial("id").primaryKey(),
    doctorId: integer("doctor_id").notNull().references(() => doctorsTable.id),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    paymentDate: text("payment_date").notNull(),
    paymentMethod: text("payment_method").notNull().default("cash"),
    reference: text("reference"),
    periodFrom: text("period_from"),
    periodTo: text("period_to"),
    notes: text("notes"),
    voucherId: integer("voucher_id"),
    performedBy: text("performed_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    doctorIdx: index("doctor_payouts_doctor_idx").on(t.doctorId),
    dateIdx: index("doctor_payouts_date_idx").on(t.paymentDate),
    doctorDateIdx: index("doctor_payouts_doctor_date_idx").on(t.doctorId, t.paymentDate),
  }),
);

export const insertDoctorPayoutSchema = createInsertSchema(doctorPayoutsTable).omit({
  id: true,
  createdAt: true,
});
export type DoctorPayout = typeof doctorPayoutsTable.$inferSelect;
export type InsertDoctorPayout = z.infer<typeof insertDoctorPayoutSchema>;
