import { pgTable, serial, integer, varchar, timestamp, text } from "drizzle-orm/pg-core";
import { patientsTable } from "./patients";

export const pregnancyEpisodesTable = pgTable("pregnancy_episodes", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id),
  startDate: timestamp("start_date", { withTimezone: true }).notNull().defaultNow(),
  edd: varchar("edd", { length: 20 }),
  status: varchar("status", { length: 20 }).notNull().default("active"), // active, completed
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PregnancyEpisode = typeof pregnancyEpisodesTable.$inferSelect;
export type InsertPregnancyEpisode = typeof pregnancyEpisodesTable.$inferInsert;
