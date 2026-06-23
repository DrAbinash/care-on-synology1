import { pgTable, serial, text, timestamp, boolean, integer } from "drizzle-orm/pg-core";

export const sitePagesTable = pgTable("site_pages", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull(), // unique application-side; "home" reserved for /
  title: text("title").notNull(),
  status: text("status").notNull().default("draft"), // draft | published
  orderIndex: integer("order_index").notNull().default(0),
  showInNav: boolean("show_in_nav").notNull().default(true),
  // Sections array, see Website Builder schema. JSON of section objects:
  // [{ id, type, enabled, order, config }]
  // type ∈ header | hero | services | appointment | reviews | contact |
  //        connect | subscribe | faq | gallery | custom_html | footer
  sections: text("sections").notNull().default("[]"),
  // Per-page SEO overrides
  seoMetaTitle: text("seo_meta_title").notNull().default(""),
  seoMetaDescription: text("seo_meta_description").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
