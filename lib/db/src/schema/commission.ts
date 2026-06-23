import { pgTable, text, serial, timestamp, integer, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { doctorsTable } from "./doctors";

export const commissionRulesTable = pgTable("commission_rules", {
  id: serial("id").primaryKey(),
  doctorId: integer("doctor_id").notNull().references(() => doctorsTable.id),
  name: text("name").notNull(),
  type: text("type").notNull().default("percentage"), // 'percentage' | 'fixed'
  value: numeric("value", { precision: 10, scale: 2 }).notNull(),
  scope: text("scope").notNull().default("all"), // 'all' | 'category' | 'test'
  categories: text("categories"), // JSON array of category strings
  testIds: text("test_ids"), // JSON array of test IDs
  isExclusive: boolean("is_exclusive").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCommissionRuleSchema = createInsertSchema(commissionRulesTable).omit({ id: true, createdAt: true });
export type CommissionRule = typeof commissionRulesTable.$inferSelect;
export type InsertCommissionRule = z.infer<typeof insertCommissionRuleSchema>;
