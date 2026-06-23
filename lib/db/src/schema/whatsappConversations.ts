import { pgTable, serial, text, boolean, timestamp, index } from "drizzle-orm/pg-core";

export const whatsappConversationsTable = pgTable("whatsapp_conversations", {
  id: serial("id").primaryKey(),
  phone: text("phone").notNull(),
  customerName: text("customer_name").notNull().default(""),
  direction: text("direction").notNull().default("incoming"),  // "incoming" | "outgoing"
  messageBody: text("message_body").notNull().default(""),
  waMessageId: text("wa_message_id").notNull().default(""),
  aiHandled: boolean("ai_handled").notNull().default(false),
  status: text("status").notNull().default("received"),  // "received" | "replied" | "ignored"
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("whatsapp_conv_phone_idx").on(t.phone),
  index("whatsapp_conv_created_idx").on(t.createdAt),
]);

export type WhatsappConversation = typeof whatsappConversationsTable.$inferSelect;
