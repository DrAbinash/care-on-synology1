import { pgTable, text, serial, timestamp, numeric, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const doctorsTable = pgTable("doctors", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  specialization: text("specialization").notNull(),
  // Medical degree / qualification (MBBS, MD, DNB…) — reporting workspace
  // reads this from doctors master for REF. BY / chip labels. Not stuffed into name.
  degree: text("degree"),
  phone: text("phone"),
  email: text("email"),
  hospitalAffiliation: text("hospital_affiliation"),
  address: text("address"),
  area: text("area"),
  // Module B: doctor registration / council number — required on PCPNDT Form F prints
  // and on referral receipts to satisfy state medical council audits.
  registrationNumber: text("registration_number"),
  defaultCommissionType: text("default_commission_type").notNull().default("percentage"),
  defaultCommission: numeric("default_commission", { precision: 10, scale: 2 }).notNull().default("0"),
  ledgerId: integer("ledger_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDoctorSchema = createInsertSchema(doctorsTable).omit({ id: true, createdAt: true });
export type InsertDoctor = z.infer<typeof insertDoctorSchema>;
export type Doctor = typeof doctorsTable.$inferSelect;
