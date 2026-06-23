import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const whatsappSettingsTable = pgTable("whatsapp_settings", {
  id: serial("id").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  phoneNumberId: text("phone_number_id").notNull().default(""),
  accessToken: text("access_token").notNull().default(""),
  templateName: text("template_name").notNull().default(""),
  templateLang: text("template_lang").notNull().default("en"),
  defaultCountryCode: text("default_country_code").notNull().default("91"),
  autoSendOnVerify: boolean("auto_send_on_verify").notNull().default(false),
  reportMessageTemplate: text("report_message_template").notNull().default(""),
  includeViewerLink: boolean("include_viewer_link").notNull().default(true),
  // WhatsApp Business webhook (Meta Cloud API)
  wabaId: text("waba_id").notNull().default(""),
  webhookVerifyToken: text("webhook_verify_token").notNull().default(""),
  // Meta AI Business Assistant (Gemini-powered auto-reply)
  aiAssistantEnabled: boolean("ai_assistant_enabled").notNull().default(false),
  aiAssistantName: text("ai_assistant_name").notNull().default("Care Diagnostics Assistant"),
  aiSystemPrompt: text("ai_system_prompt").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WhatsappSettings = typeof whatsappSettingsTable.$inferSelect;
