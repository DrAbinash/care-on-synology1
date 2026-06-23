import { pgTable, text, serial, timestamp, boolean } from "drizzle-orm/pg-core";

export const emailSettingsTable = pgTable("email_settings", {
  id: serial("id").primaryKey(),
  smtpHost: text("smtp_host").notNull().default(""),
  smtpPort: text("smtp_port").notNull().default("587"),
  smtpUser: text("smtp_user").notNull().default(""),
  smtpPassword: text("smtp_password").notNull().default(""),
  smtpSecure: boolean("smtp_secure").notNull().default(false),
  fromAddress: text("from_address").notNull().default(""),
  fromName: text("from_name").notNull().default("Care Diagnostics ERP"),
  adminEmail: text("admin_email").notNull().default(""),
  extraRecipients: text("extra_recipients").notNull().default("[]"),
  billEditEnabled: boolean("bill_edit_enabled").notNull().default(true),
  dailySummaryEnabled: boolean("daily_summary_enabled").notNull().default(true),
  dailySummaryTime: text("daily_summary_time").notNull().default("17:00"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type EmailSettings = typeof emailSettingsTable.$inferSelect;
