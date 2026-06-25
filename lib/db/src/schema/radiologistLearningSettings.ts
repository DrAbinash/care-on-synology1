import { pgTable, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { staffTable } from "./staff";

export const radiologistLearningSettingsTable = pgTable("radiologist_learning_settings", {
  id: serial("id").primaryKey(),
  staffId: integer("staff_id").notNull().references(() => staffTable.id),
  learningEnabled: boolean("learning_enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RadiologistLearningSetting = typeof radiologistLearningSettingsTable.$inferSelect;
export type InsertRadiologistLearningSetting = typeof radiologistLearningSettingsTable.$inferInsert;
