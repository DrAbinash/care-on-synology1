import { pgTable, text, serial, timestamp, boolean, numeric } from "drizzle-orm/pg-core";

export const discountRulesTable = pgTable("discount_rules", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull().default("percentage"), // percentage | fixed
  value: numeric("value", { precision: 10, scale: 2 }).notNull().default("0"),
  scope: text("scope").notNull().default("all"), // all | category | test
  categories: text("categories").notNull().default("[]"), // JSON string[]
  testIds: text("test_ids").notNull().default("[]"), // JSON number[]
  expiresAt: text("expires_at"), // YYYY-MM-DD
  reason: text("reason"), // default reason description
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Auto-apply conditions: JSON array of { type, value } objects.
  // Supported types: "age_gte" | "age_lte" | "referral_doctor_id"
  // All conditions must match for the rule to auto-apply (AND logic).
  conditions: text("conditions").notNull().default("[]"),
});

export type DiscountRule = typeof discountRulesTable.$inferSelect;
