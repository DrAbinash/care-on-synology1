import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const discountReasonsTable = pgTable("discount_reasons", {
  id: serial("id").primaryKey(),
  label: text("label").notNull().unique(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
