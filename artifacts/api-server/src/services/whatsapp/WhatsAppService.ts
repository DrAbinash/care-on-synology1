// =============================================================================
// WhatsAppService
//
// Central service orchestrating provider adapter, bot engine, database storage,
// and ERP integration. All incoming and outgoing WhatsApp messages flow through
// this service.
// =============================================================================

import { db } from "@workspace/db";
import {
  waContactsTable, waConversationsTable, waMessagesTable,
  waBotSessionsTable, waAuditLogsTable,
  patientsTable, doctorsTable, staffTable,
  billsTable, ordersTable, patientReportsTable, appointmentsTable,
} from "@workspace/db/schema";
import { eq, desc, and, gte, sql } from "drizzle-orm";
import type { WhatsAppProvider } from "./WhatsAppProvider";
import { getWhatsAppProvider } from "./WhatsAppProviderFactory";
import type { ParsedIncomingMessage } from "./WhatsAppProvider";

// Session expiry in minutes
const SESSION_EXPIRY_MINUTES = 30;

export class WhatsAppService {
  private provider: WhatsAppProvider;

  constructor() {
    this.provider = getWhatsAppProvider();
  }

  // ── Provider passthrough ──────────────────────────────────────────────────────

  async sendText(to: string, body: string): Promise<{ ok: boolean; providerMessageId?: string; error?: string }> {
    const result = await this.provider.sendTextMessage({ to, body });
    return { ok: result.success, providerMessageId: result.providerMessageId, error: result.error };
  }

  async sendInteractive(to: string, body: string, buttons: { id: string; title: string }[]): Promise<{ ok: boolean; error?: string }> {
    const result = await this.provider.sendInteractiveButtons({ to, body, buttons });
    return { ok: result.success, error: result.error };
  }

  async sendTemplate(to: string, templateName: string, languageCode = "en", components?: unknown[]): Promise<{ ok: boolean; error?: string }> {
    const result = await this.provider.sendTemplateMessage({ to, templateName, languageCode, components });
    return { ok: result.success, error: result.error };
  }

  async verifyWebhook(rawBody: string, signature: string): Promise<{ valid: boolean }> {
    const result = await this.provider.verifyWebhook(rawBody, signature);
    return { valid: result.valid };
  }

  async parseIncomingMessages(rawBody: string): Promise<ParsedIncomingMessage[]> {
    return this.provider.parseIncomingMessages(rawBody);
  }

  // ── Contact management ───────────────────────────────────────────────────────────

  async getOrCreateContact(phone: string, name?: string): Promise<typeof waContactsTable.$inferSelect> {
    const normalized = this.normalizePhone(phone);
    const [existing] = await db.select().from(waContactsTable).where(eq(waContactsTable.phone, normalized)).limit(1);
    if (existing) {
      await db.update(waContactsTable).set({ lastInteractionAt: new Date(), name: name && name !== existing.name ? name : existing.name }).where(eq(waContactsTable.id, existing.id));
      return { ...existing, name: name && name !== existing.name ? name : existing.name, lastInteractionAt: new Date() };
    }
    // Try to link with patient, doctor, or staff by phone
    let patientId: number | undefined;
    let doctorId: number | undefined;
    let staffUserId: number | undefined;

    const [patient] = await db.select({ id: patientsTable.id }).from(patientsTable)
      .where(eq(patientsTable.phone, normalized)).limit(1);
    if (patient) patientId = patient.id;

    const [doctor] = await db.select({ id: doctorsTable.id }).from(doctorsTable)
      .where(eq(doctorsTable.phone, normalized)).limit(1);
    if (doctor) doctorId = doctor.id;

    const [staff] = await db.select({ id: staffTable.id }).from(staffTable)
      .where(eq(staffTable.phone, normalized)).limit(1);
    if (staff) staffUserId = staff.id;

    let contactType = "unknown";
    if (staff) contactType = "staff";
    else if (doctor) contactType = "doctor";
    else if (patient) contactType = "patient";

    const [created] = await db.insert(waContactsTable).values({
      phone: normalized,
      name: name || "",
      patientId,
      doctorId,
      staffUserId,
      contactType,
      consentStatus: "pending",
      lastInteractionAt: new Date(),
    }).returning();
    return created;
  }

  // ── Conversation management ───────────────────────────────────────────────────

  async getOrCreateConversation(contactId: number, phone: string): Promise<typeof waConversationsTable.$inferSelect> {
    const [existing] = await db.select().from(waConversationsTable).where(eq(waConversationsTable.contactId, contactId)).limit(1);
    if (existing) {
      await db.update(waConversationsTable).set({ lastMessageAt: new Date() }).where(eq(waConversationsTable.id, existing.id));
      return { ...existing, lastMessageAt: new Date() };
    }
    const [created] = await db.insert(waConversationsTable).values({ contactId, phone, status: "bot", lastMessageAt: new Date() }).returning();
    return created;
  }

  async updateConversationStatus(convId: number, status: string, assignedUserId?: number): Promise<void> {
    const updates: Record<string, unknown> = { status };
    if (assignedUserId !== undefined) updates.assignedUserId = assignedUserId;
    await db.update(waConversationsTable).set(updates).where(eq(waConversationsTable.id, convId));
  }

  // ── Message storage ───────────────────────────────────────────────────────────

  async logIncomingMessage(conversationId: number, provider: string, msg: ParsedIncomingMessage): Promise<void> {
    await db.insert(waMessagesTable).values({
      conversationId,
      provider,
      direction: "incoming",
      messageType: msg.type,
      messageText: msg.body || "",
      providerMessageId: msg.messageId,
      rawPayloadJson: JSON.stringify(msg.rawPayload),
    });
  }

  async logOutgoingMessage(conversationId: number, provider: string, text: string, providerMessageId?: string, templateName?: string): Promise<void> {
    await db.insert(waMessagesTable).values({
      conversationId,
      provider,
      direction: "outgoing",
      messageType: templateName ? "template" : "text",
      messageText: text,
      providerMessageId,
      templateName,
    });
  }

  // ── Bot session management ────────────────────────────────────────────────────

  async getOrCreateSession(contactId: number): Promise<{ id: number; currentStep: string; context: Record<string, unknown> }> {
    const [existing] = await db.select().from(waBotSessionsTable)
      .where(eq(waBotSessionsTable.contactId, contactId))
      .limit(1);

    const now = new Date();
    const expires = new Date(now.getTime() + SESSION_EXPIRY_MINUTES * 60_000);

    if (existing) {
      if (existing.expiresAt < now) {
        await db.update(waBotSessionsTable).set({ currentStep: "main_menu", contextJson: "{}", expiresAt: expires }).where(eq(waBotSessionsTable.id, existing.id));
        return { id: existing.id, currentStep: "main_menu", context: {} };
      }
      const context = JSON.parse(existing.contextJson || "{}") as Record<string, unknown>;
      return { id: existing.id, currentStep: existing.currentStep, context };
    }

    const [created] = await db.insert(waBotSessionsTable).values({
      contactId,
      currentStep: "main_menu",
      contextJson: "{}",
      expiresAt: expires,
    }).returning();
    return { id: created.id, currentStep: "main_menu", context: {} };
  }

  async updateSession(contactId: number, step: string, context: Record<string, unknown>): Promise<void> {
    const [existing] = await db.select().from(waBotSessionsTable)
      .where(eq(waBotSessionsTable.contactId, contactId))
      .limit(1);
    const expires = new Date(Date.now() + SESSION_EXPIRY_MINUTES * 60_000);
    const ctxJson = JSON.stringify(context);
    if (existing) {
      await db.update(waBotSessionsTable).set({ currentStep: step, contextJson: ctxJson, expiresAt: expires }).where(eq(waBotSessionsTable.id, existing.id));
    } else {
      await db.insert(waBotSessionsTable).values({ contactId, currentStep: step, contextJson: ctxJson, expiresAt: expires });
    }
  }

  async resetSession(contactId: number): Promise<void> {
    await this.updateSession(contactId, "main_menu", {});
  }

  // ── ERP lookups ────────────────────────────────────────────────────────────────

  async findPatientByPhone(phone: string): Promise<typeof patientsTable.$inferSelect | null> {
    const [row] = await db.select().from(patientsTable).where(eq(patientsTable.phone, this.normalizePhone(phone))).limit(1);
    return row || null;
  }

  async findBillsByPatientId(patientId: number): Promise<typeof billsTable.$inferSelect[]> {
    return db.select().from(billsTable).where(eq(billsTable.patientId, patientId)).orderBy(desc(billsTable.createdAt)).limit(5);
  }

  async findPendingReportsByPatientId(patientId: number): Promise<{ id: number; title: string; status: string }[]> {
    const rows = await db.select({ id: patientReportsTable.id, title: patientReportsTable.title, status: patientReportsTable.status })
      .from(patientReportsTable)
      .where(and(eq(patientReportsTable.patientId, patientId), sql`${patientReportsTable.status} != 'verified'`))
      .orderBy(desc(patientReportsTable.createdAt))
      .limit(10);
    return rows;
  }

  async findAppointmentsByPatientId(patientId: number): Promise<typeof appointmentsTable.$inferSelect[]> {
    return db.select().from(appointmentsTable).where(eq(appointmentsTable.patientId, patientId)).orderBy(desc(appointmentsTable.appointmentDate)).limit(5);
  }

  // ── Audit logging ────────────────────────────────────────────────────────────────

  async logAudit(params: { action: string; provider: string; phone?: string; conversationId?: number; amount?: number; status: string; details?: string; performedBy?: string }): Promise<void> {
    await db.insert(waAuditLogsTable).values({
      action: params.action,
      provider: params.provider,
      phone: params.phone,
      conversationId: params.conversationId,
      amount: params.amount,
      status: params.status,
      details: params.details,
      performedBy: params.performedBy || "system",
    });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────────

  normalizePhone(raw: string): string {
    const digits = (raw || "").replace(/\D/g, "");
    if (!digits) return "";
    if (digits.length >= 11) return digits;
    const cc = process.env.WHATSAPP_DEFAULT_COUNTRY_CODE || "91";
    return `${cc}${digits}`;
  }
}

// Singleton for easy import
let _service: WhatsAppService | null = null;
export function getWhatsAppService(): WhatsAppService {
  if (!_service) _service = new WhatsAppService();
  return _service;
}
