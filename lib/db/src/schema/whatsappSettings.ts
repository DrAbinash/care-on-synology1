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

  // ── Provider (unified WhatsApp Settings — section A) ──────────────────
  businessDisplayName: text("business_display_name").notNull().default(""),
  graphApiVersion: text("graph_api_version").notNull().default("v21.0"),
  lastSuccessfulCheckAt: timestamp("last_successful_check_at", { withTimezone: true }),
  lastCheckError: text("last_check_error").notNull().default(""),
  lastCheckErrorAt: timestamp("last_check_error_at", { withTimezone: true }),

  // ── Credentials (section B) ────────────────────────────────────────────
  // Encrypted the same way as accessToken (encryptSecret/decryptSecretTolerant).
  appSecret: text("app_secret").notNull().default(""),

  // ── Webhook diagnostics (section D) ────────────────────────────────────
  lastWebhookVerifiedAt: timestamp("last_webhook_verified_at", { withTimezone: true }),
  lastWebhookReceivedAt: timestamp("last_webhook_received_at", { withTimezone: true }),
  lastValidSignatureAt: timestamp("last_valid_signature_at", { withTimezone: true }),
  lastRejectedSignatureAt: timestamp("last_rejected_signature_at", { withTimezone: true }),
  rejectedSignatureCount: integer("rejected_signature_count").notNull().default(0),

  // ── Automation controls (section E) — all enforced server-side in
  // whatsappEnqueue.ts, never trust the frontend to have disabled anything.
  shadowMode: boolean("shadow_mode").notNull().default(true),
  testAllowlist: text("test_allowlist").notNull().default("[]"), // JSON array of E.164 numbers
  blockNonAllowlisted: boolean("block_non_allowlisted").notNull().default(true),
  outboundMessagingEnabled: boolean("outbound_messaging_enabled").notNull().default(true),
  inboundProcessingEnabled: boolean("inbound_processing_enabled").notNull().default(true),
  reportReadyMessagesEnabled: boolean("report_ready_messages_enabled").notNull().default(true),
  paymentMessagesEnabled: boolean("payment_messages_enabled").notNull().default(true),
  quietHoursStart: text("quiet_hours_start").notNull().default(""), // "HH:MM" or "" = no quiet hours
  quietHoursEnd: text("quiet_hours_end").notNull().default(""),
  maxRetryAttempts: integer("max_retry_attempts").notNull().default(5),
  retryDelayBaseSeconds: integer("retry_delay_base_seconds").notNull().default(30),
  dailyMessageLimit: integer("daily_message_limit").notNull().default(0), // 0 = unlimited
  monthlyMessageBudgetWarning: integer("monthly_message_budget_warning").notNull().default(0), // 0 = disabled
  emergencyPaused: boolean("emergency_paused").notNull().default(false),
  emergencyPausedReason: text("emergency_paused_reason").notNull().default(""),
  emergencyPausedAt: timestamp("emergency_paused_at", { withTimezone: true }),

  // ── Consent and safety (section G) — stopStartHandlingEnabled and
  // phiProtectionEnabled are DISPLAY-ONLY: WhatsAppBotEngine's STOP/START
  // opt-out and DOB gate are always-on regardless of these columns, so a
  // misconfigured settings page can never disable a legal opt-out or a PHI
  // safeguard. See the migration comment for the full rationale.
  transactionalMessagesAllowed: boolean("transactional_messages_allowed").notNull().default(true),
  reminderMessagesAllowed: boolean("reminder_messages_allowed").notNull().default(true),
  marketingMessagesAllowed: boolean("marketing_messages_allowed").notNull().default(false),
  stopStartHandlingEnabled: boolean("stop_start_handling_enabled").notNull().default(true),
  phiProtectionEnabled: boolean("phi_protection_enabled").notNull().default(true),
  secureReportLinkRequired: boolean("secure_report_link_required").notNull().default(true),

  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WhatsappSettings = typeof whatsappSettingsTable.$inferSelect;
