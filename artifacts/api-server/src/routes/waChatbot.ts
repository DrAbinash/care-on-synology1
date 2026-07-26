// =============================================================================
// WhatsApp Chatbot Routes
//
// Provider-agnostic webhook receiver and chatbot API. Integrates with the
// WhatsAppService + WhatsAppBotEngine for automated patient engagement.
// =============================================================================

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  waContactsTable, waConversationsTable, waMessagesTable,
  waBotSessionsTable, waAuditLogsTable,
} from "@workspace/db/schema";
import { eq, desc, and, gte, sql } from "drizzle-orm";
import { requireStaffPermission } from "../middleware/requireStaffAuth";
import { getWhatsAppService } from "../services/whatsapp/WhatsAppService";
import { WhatsAppBotEngine } from "../services/whatsapp/WhatsAppBotEngine";
import type { ParsedIncomingMessage } from "../services/whatsapp/WhatsAppProvider";

export const waChatbotRouter: IRouter = Router();
// DEPRECATED / NOT MOUNTED — see routes/index.ts for why. Kept exported
// (rather than deleted) only so nothing importing this module fails to
// compile; no route in routes/index.ts or app.ts mounts it, so none of
// the handlers below are reachable over HTTP. The single production
// WhatsApp webhook is "/api/whatsapp/webhook" (routes/whatsapp.ts).
export const waChatbotWebhookRouter: IRouter = Router();

const service = getWhatsAppService();
const botEngine = new WhatsAppBotEngine(service);

// ── DEPRECATED — unreachable, see note above. Left in place for reference
// only. (POST /api/wa-chatbot/webhook/:provider) ────────────────────
waChatbotWebhookRouter.post("/:provider", async (req: Request, res: Response): Promise<void> => {
  // Always respond 200 immediately to prevent provider retries
  res.status(200).json({ status: "ok" });

  const provider = String(req.params.provider || "mock").toLowerCase();
  const rawBody = JSON.stringify(req.body);
  const signature = req.headers["x-hub-signature-256"] as string || req.headers["x-signature"] as string || "";

  try {
    // Verify webhook signature
    const verifyResult = await service.verifyWebhook(rawBody, signature);
    if (!verifyResult.valid) {
      await service.logAudit({ action: "webhook_rejected", provider, status: "rejected", details: "Invalid signature" });
      return;
    }

    // Parse incoming messages
    const messages = await service.parseIncomingMessages(rawBody);
    if (messages.length === 0) return;

    for (const msg of messages) {
      if (!msg.from) continue;

      // Get or create contact
      const contact = await service.getOrCreateContact(msg.from, "");

      // Get or create conversation
      const conversation = await service.getOrCreateConversation(contact.id, contact.phone);

      // Log incoming message
      await service.logIncomingMessage(conversation.id, provider, msg);

      // Skip bot processing if human handover
      if (conversation.status === "human") {
        await service.logAudit({ action: "message_human_queue", provider, phone: contact.phone, conversationId: conversation.id, status: "human_queued" });
        continue;
      }

      // Process with bot engine
      const reply = await botEngine.processMessage(contact, msg);

      // Send reply if any
      if (reply.text) {
        let sendResult: { ok: boolean; providerMessageId?: string; error?: string };
        if (reply.buttons && reply.buttons.length > 0) {
          sendResult = await service.sendInteractive(contact.phone, reply.text, reply.buttons);
        } else {
          sendResult = await service.sendText(contact.phone, reply.text);
        }

        if (sendResult.ok) {
          await service.logOutgoingMessage(conversation.id, provider, reply.text, sendResult.providerMessageId);
        }
      }

      // Handle handover action
      if (reply.action === "handover_human") {
        await service.updateConversationStatus(conversation.id, "human");
      }

      // Audit log
      await service.logAudit({
        action: "bot_reply",
        provider,
        phone: contact.phone,
        conversationId: conversation.id,
        status: reply.text ? "replied" : "no_reply",
        details: reply.text?.slice(0, 200),
      });
    }
  } catch (err) {
    await service.logAudit({
      action: "webhook_error",
      provider,
      status: "error",
      details: (err as Error).message,
    });
  }
});

// ─── GET webhook verification (Meta Cloud API subscription verification) ────────
waChatbotWebhookRouter.get("/:provider", async (req: Request, res: Response): Promise<void> => {
  const provider = String(req.params.provider || "mock").toLowerCase();
  const mode = req.query["hub.mode"] as string;
  const token = req.query["hub.verify_token"] as string;
  const challenge = req.query["hub.challenge"] as string;

  // For Meta Cloud API, verify token matches env var
  if (mode === "subscribe" && token) {
    const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN || "";
    if (expectedToken && token === expectedToken) {
      res.status(200).send(String(challenge ?? ""));
      return;
    }
  }

  // Generic verification
  res.status(403).json({ error: "Webhook verification failed" });
});

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
