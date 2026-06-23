// =============================================================================
// WhatsApp Chatbot Schema
//
// Provider-agnostic WhatsApp module for patient engagement, staff communication,
// and admin alerts. Uses "wa_" prefix to avoid conflict with existing
// whatsapp_conversations table (legacy message log).
// =============================================================================

import { pgTable, serial, text, timestamp, boolean, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ── Contacts ───────────────────────────────────────────────────────────────────
export const waContactsTable = pgTable("wa_contacts", {
  id: serial("id").primaryKey(),
  phone: text("phone").notNull().unique(),
  name: text("name").notNull().default(""),
  patientId: integer("patient_id"),
  doctorId: integer("doctor_id"),
  staffUserId: integer("staff_user_id"),
  contactType: text("contact_type").notNull().default("unknown"), // patient / doctor / staff / admin / unknown
  consentStatus: text("consent_status").notNull().default("pending"), // pending / granted / denied
  language: text("language").notNull().default("en"),
  lastInteractionAt: timestamp("last_interaction_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("wa_contact_phone_idx").on(t.phone),
  index("wa_contact_patient_idx").on(t.patientId),
  index("wa_contact_type_idx").on(t.contactType),
]);

// ── Conversations (thread-level, not per-message) ───────────────────────────────────────
export const waConversationsTable = pgTable("wa_conversations", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id").notNull(),
  phone: text("phone").notNull(),
  status: text("status").notNull().default("bot"), // open / bot / human / closed
  currentFlow: text("current_flow").notNull().default(""),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  assignedUserId: integer("assigned_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("wa_conv_phone_idx").on(t.phone),
  index("wa_conv_status_idx").on(t.status),
  index("wa_conv_contact_idx").on(t.contactId),
]);

// ── Messages ─────────────────────────────────────────────────────────────────
export const waMessagesTable = pgTable("wa_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull(),
  provider: text("provider").notNull().default("mock"),
  direction: text("direction").notNull(), // incoming / outgoing
  messageType: text("message_type").notNull().default("text"), // text / template / document / image / interactive / button
  messageText: text("message_text"),
  templateName: text("template_name"),
  mediaUrl: text("media_url"),
  providerMessageId: text("provider_message_id"),
  status: text("status").notNull().default("delivered"), // sent / delivered / read / failed
  rawPayloadJson: text("raw_payload_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("wa_msg_conv_idx").on(t.conversationId),
  index("wa_msg_direction_idx").on(t.direction),
  index("wa_msg_created_idx").on(t.createdAt),
]);

// ── Bot Sessions ─────────────────────────────────────────────────────────────
export const waBotSessionsTable = pgTable("wa_bot_sessions", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id").notNull(),
  currentStep: text("current_step").notNull().default("main_menu"),
  contextJson: text("context_json").notNull().default("{}"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("wa_bot_contact_idx").on(t.contactId),
  index("wa_bot_expires_idx").on(t.expiresAt),
]);

// ── Templates ────────────────────────────────────────────────────────────────
export const waTemplatesTable = pgTable("wa_templates", {
  id: serial("id").primaryKey(),
  templateName: text("template_name").notNull(),
  category: text("category").notNull().default("UTILITY"),
  language: text("language").notNull().default("en"),
  body: text("body").notNull().default(""),
  status: text("status").notNull().default("pending"), // pending / approved / rejected
  useCase: text("use_case").notNull().default(""), // appointment_reminder / report_ready / bill_created / etc
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("wa_tmpl_name_idx").on(t.templateName),
  index("wa_tmpl_usecase_idx").on(t.useCase),
]);

// ── Audit Logs ───────────────────────────────────────────────────────────────
export const waAuditLogsTable = pgTable("wa_audit_logs", {
  id: serial("id").primaryKey(),
  action: text("action").notNull(),
  provider: text("provider").notNull(),
  phone: text("phone"),
  conversationId: integer("conversation_id"),
  amount: integer("amount"),
  status: text("status").notNull(),
  details: text("details"),
  performedBy: text("performed_by").notNull().default("system"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Zod schemas ────────────────────────────────────────────────────────────────
export const insertWaContactSchema = createInsertSchema(waContactsTable);
export const insertWaConversationSchema = createInsertSchema(waConversationsTable);
export const insertWaMessageSchema = createInsertSchema(waMessagesTable);
export const insertWaBotSessionSchema = createInsertSchema(waBotSessionsTable);
export const insertWaTemplateSchema = createInsertSchema(waTemplatesTable);
export const insertWaAuditLogSchema = createInsertSchema(waAuditLogsTable);

export type InsertWaContact = z.infer<typeof insertWaContactSchema>;
export type InsertWaConversation = z.infer<typeof insertWaConversationSchema>;
export type InsertWaMessage = z.infer<typeof insertWaMessageSchema>;
export type InsertWaBotSession = z.infer<typeof insertWaBotSessionSchema>;
export type InsertWaTemplate = z.infer<typeof insertWaTemplateSchema>;
export type InsertWaAuditLog = z.infer<typeof insertWaAuditLogSchema>;
