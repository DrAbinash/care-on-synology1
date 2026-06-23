import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { patientsTable } from "./patients";
import { doctorsTable } from "./doctors";

export const appointmentsTable = pgTable("appointments", {
  id: serial("id").primaryKey(),
  appointmentId: text("appointment_id").notNull().unique(),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id),
  doctorId: integer("doctor_id").references(() => doctorsTable.id),
  packageId: integer("package_id"),
  appointmentDate: text("appointment_date").notNull(),
  timeSlot: text("time_slot").notNull(),
  status: text("status").notNull().default("scheduled"),
  type: text("type").notNull().default("walk-in"),
  notes: text("notes"),
  ledgerId: integer("ledger_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const appointmentCounterTable = pgTable("appointment_counter", {
  id: serial("id").primaryKey(),
  counter: integer("counter").notNull().default(0),
});

export const insertAppointmentSchema = createInsertSchema(appointmentsTable).omit({
  id: true,
  appointmentId: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAppointment = z.infer<typeof insertAppointmentSchema>;
export type Appointment = typeof appointmentsTable.$inferSelect;
