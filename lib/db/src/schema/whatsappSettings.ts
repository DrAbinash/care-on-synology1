import { pgTable, serial, text, boolean, timestamp, integer } from "drizzle-orm/pg-core";

export const whatsappSettingsTable = pgTable("whatsapp_settings", {
  id: serial("id").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  phoneNumberId: text("phone_number_id").notNull().default(""),
  accessToken: text("access_token").notNull().default(""),
  templateName: text("template_name").notNull().default(""),
  templateLang: text("template_lang").notNull().default("en"),
  defaultCountryCode: text("default_country_code").notNull().default("91"),
  autoSendOnVerify: boolean("auto_send_on_verify").notNull().default(false),
  // Report delivery mode: 'manual' (staff selects reports bill/test-wise from
  // the delivery-tracking screen) or 'auto' (report auto-sends on verify). Kept
  // in sync with autoSendOnVerify by the report-delivery-tracking settings
  // endpoint so the existing on-verify auto-send path needs no change. Defaults
  // to 'manual' — the clinic sends selected reports, not every report.
  reportDeliveryMode: text("report_delivery_mode").notNull().default("manual"),
  reportMessageTemplate: text("report_message_template").notNull().default(""),
  includeViewerLink: boolean("include_viewer_link").notNull().default(true),
  // ── Automation triggers ────────────────────────────────────────────────
  // Discrete toggle for the on-bill-creation template send (still requires the
  // master `enabled` flag). Defaults on to preserve existing behaviour where
  // any enabled WhatsApp config auto-sent a bill message.
  autoSendBillCreated: boolean("auto_send_bill_created").notNull().default(true),
  // Appointment reminder — a daily cron sends tomorrow's scheduled patients a
  // reminder at appointmentReminderTime (server-local HH:MM). Off by default.
  appointmentReminderEnabled: boolean("appointment_reminder_enabled").notNull().default(false),
  appointmentReminderTime: text("appointment_reminder_time").notNull().default("18:00"),
  appointmentReminderTemplate: text("appointment_reminder_template").notNull().default(""),
  // Dues reminder — a daily cron messages patients with an outstanding balance
  // at/above duesReminderMinAmount, at duesReminderTime. Off by default.
  duesReminderEnabled: boolean("dues_reminder_enabled").notNull().default(false),
  duesReminderTime: text("dues_reminder_time").notNull().default("11:00"),
  duesReminderMinAmount: integer("dues_reminder_min_amount").notNull().default(0),
  duesReminderTemplate: text("dues_reminder_template").notNull().default(""),
  // WhatsApp Business webhook (Meta Cloud API)
  wabaId: text("waba_id").notNull().default(""),
  webhookVerifyToken: text("webhook_verify_token").notNull().default(""),
  // Meta AI Business Assistant (Gemini-powered auto-reply)
  aiAssistantEnabled: boolean("ai_assistant_enabled").notNull().default(false),
  aiAssistantName: text("ai_assistant_name").notNull().default("Care Diagnostics Assistant"),
  aiSystemPrompt: text("ai_system_prompt").notNull().default(""),
  // Escalation message — what a patient sees when the AI hands off to
  // staff (Knowledge Base no-match, or the explicit "Talk to Staff" menu
  // option). Added rather than building a full configurable Escalation
  // Rules engine (per 04_AI_RECEPTIONIST_OPERATIONAL_DESIGN.md Section
  // 2.2) because, as of this column's addition, there is exactly ONE
  // real escalation trigger implemented anywhere in this codebase
  // (Knowledge Base no-match) plus the menu's explicit human-handoff
  // option — no VIP/Emergency/max-turns triggers exist yet to route, so
  // a rules engine would have nothing real to configure beyond this one
  // message. Extend this to a proper rules table if/when a second real
  // trigger is built (e.g. clinical_escalation_triggers actually being
  // checked against incoming messages, which today is a Knowledge Base
  // category with no code reading it — see WHATSAPP_SYSTEM_AUDIT.md).
  aiEscalationMessage: text("ai_escalation_message").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WhatsappSettings = typeof whatsappSettingsTable.$inferSelect;
