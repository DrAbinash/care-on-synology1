import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const testCategoriesTable = pgTable("test_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TestCategory = typeof testCategoriesTable.$inferSelect;
