import { pgTable, serial, text, boolean, timestamp, integer } from "drizzle-orm/pg-core";

export const whatsappNumberRoleEnum = ["general", "form_f", "reports"] as const;

export const whatsappNumbersTable = pgTable("whatsapp_numbers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().default(""),
  // Meta Cloud API phone number ID (the technical identifier used in API calls)
  phoneNumberId: text("phone_number_id").notNull().default(""),
  // Human-readable display number (e.g. +91-98765-43210)
  displayNumber: text("display_number").notNull().default(""),
  // Per-number access token (optional — falls back to global settings if empty)
  accessToken: text("access_token").notNull().default(""),
  // Role determines routing behaviour in the webhook
  role: text("role").notNull().default("general"),
  enabled: boolean("enabled").notNull().default(true),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WhatsappNumber = typeof whatsappNumbersTable.$inferSelect;
export type NewWhatsappNumber = typeof whatsappNumbersTable.$inferInsert;
