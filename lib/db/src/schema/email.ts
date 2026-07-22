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
  // JSON array of up to 3 "HH:MM" strings (IST), e.g. '["09:00","14:00","20:00"]".
  // Replaces the old single dailySummaryTime column so admins can schedule
  // multiple sends per day.
  dailySummaryTimes: text("daily_summary_times").notNull().default('["17:00"]'),
  // JSON object mapping each configured "HH:MM" slot to the IST date
  // (YYYY-MM-DD) it was last SENT on — never set by the manual "Send Summary
  // Now" button. This is what makes the scheduler crash/restart-safe: the
  // previous implementation only tracked "already fired today" in an
  // in-memory Set that reset on every process restart, so a redeploy or
  // container bounce during the exact configured minute silently skipped
  // that day's email forever with no retry. Persisting per-slot dates lets
  // the scheduler catch up on its next tick after a restart instead of only
  // firing in one one-minute-wide window per day, and lets each of the (up
  // to 3) daily slots be tracked independently. See cron.ts's scheduleDaily().
  dailySummaryLastSentSlots: text("daily_summary_last_sent_slots").notNull().default("{}"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type EmailSettings = typeof emailSettingsTable.$inferSelect;
