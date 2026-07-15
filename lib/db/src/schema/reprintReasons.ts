import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";

// Mirrors discountReasons.ts exactly — same admin-configurable preset-list
// pattern, applied to bill reprints instead of discounts.
export const reprintReasonsTable = pgTable("reprint_reasons", {
  id: serial("id").primaryKey(),
  label: text("label").notNull().unique(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
