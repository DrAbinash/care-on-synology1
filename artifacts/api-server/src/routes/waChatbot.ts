// =============================================================================
// WhatsApp Chatbot Routes — staff API only
//
// Conversation inbox, contacts, templates, audit logs and manual-send API
// (mounted at /api/wa-chatbot, staff-auth gated) for the wa_conversations/
// wa_contacts data store. There is no webhook receiver in this file — the
// one production webhook is "/api/whatsapp/webhook" (routes/whatsapp.ts),
// which already delegates to the same WhatsAppBotEngine for AI auto-replies.
// =============================================================================

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  waContactsTable, waConversationsTable, waMessagesTable,
  waBotSessionsTable, waAuditLogsTable,
} from "@workspace/db/schema";
import { eq, desc, and, gte, sql } from "drizzle-orm";
import { requireStaffPermission } from "../middleware/requireStaffAuth";
import { getWhatsAppService } from "../services/whatsapp/WhatsAppService";

export const waChatbotRouter: IRouter = Router();

const service = getWhatsAppService();

// ─── Staff API: Conversations ─────────────────────────────────────────────────
waChatbotRouter.get("/conversations", requireStaffPermission("/settings"), async (req, res): Promise<void> => {
  const page = Math.max(1, Number(req.query.page ?? 1));
  const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50)));
  const offset = (page - 1) * limit;
  const status = req.query.status as string | undefined;

  const baseQuery = status
    ? db.select().from(waConversationsTable).where(eq(waConversationsTable.status, status))
    : db.select().from(waConversationsTable);

  const rows = await baseQuery.orderBy(desc(waConversationsTable.lastMessageAt)).limit(limit).offset(offset);
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(waConversationsTable);

  // Enrich with contact names
  const enriched = await Promise.all(rows.map(async (row) => {
    const [contact] = await db.select({ name: waContactsTable.name, contactType: waContactsTable.contactType })
      .from(waContactsTable).where(eq(waContactsTable.id, row.contactId)).limit(1);
    return { ...row, contactName: contact?.name || row.phone, contactType: contact?.contactType || "unknown" };
  }));

  res.json({ conversations: enriched, total: Number(count), page, limit });
});

waChatbotRouter.get("/conversations/:id/messages", requireStaffPermission("/settings"), async (req, res): Promise<void> => {
  const convId = Number(req.params.id);
  if (!Number.isFinite(convId)) { res.status(400).json({ error: "Invalid conversation ID" }); return; }

  const rows = await db.select().from(waMessagesTable)
    .where(eq(waMessagesTable.conversationId, convId))
    .orderBy(desc(waMessagesTable.createdAt))
    .limit(200);
  res.json(rows);
});

waChatbotRouter.post("/conversations/:id/reply", requireStaffPermission("/settings"), async (req, res): Promise<void> => {
  const convId = Number(req.params.id);
  const { message } = req.body as { message?: string };
  if (!message?.trim()) { res.status(400).json({ error: "message required" }); return; }

  const [conv] = await db.select().from(waConversationsTable).where(eq(waConversationsTable.id, convId)).limit(1);
  if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }

  const result = await service.sendText(conv.phone, message.trim());
  if (!result.ok) { res.status(502).json({ error: result.error || "Send failed" }); return; }

  await service.logOutgoingMessage(convId, "erp", message.trim(), result.providerMessageId);
  await service.updateConversationStatus(convId, "human");

  res.json({ ok: true, messageId: result.providerMessageId });
});

waChatbotRouter.patch("/conversations/:id/status", requireStaffPermission("/settings"), async (req, res): Promise<void> => {
  const convId = Number(req.params.id);
  const { status, assignedUserId } = req.body as { status?: string; assignedUserId?: number };
  if (!status) { res.status(400).json({ error: "status required" }); return; }

  await service.updateConversationStatus(convId, status, assignedUserId);
  res.json({ ok: true });
});

// ─── Staff API: Contacts ──────────────────────────────────────────────────────
waChatbotRouter.get("/contacts", requireStaffPermission("/settings"), async (req, res): Promise<void> => {
  const page = Math.max(1, Number(req.query.page ?? 1));
  const limit = 50;
  const offset = (page - 1) * limit;
  const type = req.query.type as string | undefined;

  const baseQuery = type
    ? db.select().from(waContactsTable).where(eq(waContactsTable.contactType, type))
    : db.select().from(waContactsTable);

  const rows = await baseQuery.orderBy(desc(waContactsTable.lastInteractionAt)).limit(limit).offset(offset);
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(waContactsTable);
  res.json({ contacts: rows, total: Number(count), page, limit });
});

waChatbotRouter.get("/contacts/:phone", requireStaffPermission("/settings"), async (req, res): Promise<void> => {
  const phone = String(req.params.phone ?? "");
  const [contact] = await db.select().from(waContactsTable).where(eq(waContactsTable.phone, phone)).limit(1);
  if (!contact) { res.status(404).json({ error: "Contact not found" }); return; }

  const [conv] = await db.select().from(waConversationsTable).where(eq(waConversationsTable.contactId, contact.id)).limit(1);
  const messages = conv ? await db.select().from(waMessagesTable)
    .where(eq(waMessagesTable.conversationId, conv.id))
    .orderBy(desc(waMessagesTable.createdAt))
    .limit(50) : [];

  res.json({ contact, conversation: conv, messages });
});

// ─── Staff API: Templates ───────────────────────────────────────────────────────
waChatbotRouter.get("/templates", requireStaffPermission("/settings"), async (_req, res): Promise<void> => {
  const { waTemplatesTable } = await import("@workspace/db/schema");
  const rows = await db.select().from(waTemplatesTable).orderBy(desc(waTemplatesTable.createdAt));
  res.json(rows);
});

// ─── Staff API: Audit Logs ────────────────────────────────────────────────────
waChatbotRouter.get("/audit-logs", requireStaffPermission("/settings"), async (req, res): Promise<void> => {
  const page = Math.max(1, Number(req.query.page ?? 1));
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
  const offset = (page - 1) * limit;

  const rows = await db.select().from(waAuditLogsTable)
    .orderBy(desc(waAuditLogsTable.createdAt))
    .limit(limit)
    .offset(offset);
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(waAuditLogsTable);
  res.json({ logs: rows, total: Number(count), page, limit });
});

// ─── Staff API: Send message from ERP ─────────────────────────────────────────
waChatbotRouter.post("/send", requireStaffPermission("/settings"), async (req, res): Promise<void> => {
  const { phone, message, type = "text" } = req.body as { phone: string; message: string; type?: string };
  if (!phone || !message) { res.status(400).json({ error: "phone and message required" }); return; }

  let result: { ok: boolean; providerMessageId?: string; error?: string };
  if (type === "interactive" && req.body.buttons) {
    const r = await service.sendInteractive(phone, message, req.body.buttons);
    result = { ...r, providerMessageId: undefined };
  } else {
    result = await service.sendText(phone, message);
  }

  if (!result.ok) { res.status(502).json({ error: result.error || "Send failed" }); return; }

  await service.logAudit({
    action: "manual_send",
    provider: "erp",
    phone,
    status: "sent",
    details: message.slice(0, 200),
    performedBy: "staff",
  });

  res.json({ ok: true, messageId: result.providerMessageId || null });
});

// ─── Staff API: Dashboard stats ────────────────────────────────────────────────
waChatbotRouter.get("/dashboard", requireStaffPermission("/settings"), async (_req, res): Promise<void> => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [{ totalConversations }] = await db.select({ totalConversations: sql<number>`count(*)` }).from(waConversationsTable);
  const [{ humanConversations }] = await db.select({ humanConversations: sql<number>`count(*)` }).from(waConversationsTable).where(eq(waConversationsTable.status, "human"));
  const [{ totalMessages }] = await db.select({ totalMessages: sql<number>`count(*)` }).from(waMessagesTable);
  const [{ incomingToday }] = await db.select({ incomingToday: sql<number>`count(*)` }).from(waMessagesTable)
    .where(and(eq(waMessagesTable.direction, "incoming"), gte(waMessagesTable.createdAt, today)));
  const [{ totalContacts }] = await db.select({ totalContacts: sql<number>`count(*)` }).from(waContactsTable);

  res.json({
    totalConversations,
    humanConversations,
    totalMessages,
    incomingToday,
    totalContacts,
  });
});

export default waChatbotRouter;
