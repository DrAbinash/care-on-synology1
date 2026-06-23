import { pgTable, serial, text, timestamp, boolean, integer } from "drizzle-orm/pg-core";

export const sitePopupsTable = pgTable("site_popups", {
  id: serial("id").primaryKey(),
  title: text("title").notNull().default(""),
  body: text("body").notNull().default(""),
  ctaLabel: text("cta_label").notNull().default(""),
  ctaUrl: text("cta_url").notNull().default(""),
  imageUrl: text("image_url").notNull().default(""),
  triggerType: text("trigger_type").notNull().default("time_delay"), // time_delay | exit_intent | scroll | manual
  triggerValue: integer("trigger_value").notNull().default(5), // seconds for time_delay, scroll % for scroll
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const siteFaqsTable = pgTable("site_faqs", {
  id: serial("id").primaryKey(),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  orderIndex: integer("order_index").notNull().default(0),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sitePhotosTable = pgTable("site_photos", {
  id: serial("id").primaryKey(),
  url: text("url").notNull(), // local filesystem path under /uploads/site
  alt: text("alt").notNull().default(""),
  category: text("category").notNull().default("general"), // general | hero | services | gallery | team
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
});
