import express, { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { whatsappSettingsTable, whatsappNumbersTable, whatsappConversationsTable, clinicSettingsTable, appointmentsTable, billsTable, waOutboxTable } from "@workspace/db/schema";
// NOTE: patientsTable is imported lower in this file (near the Form F image
// handler); it is module-scoped and reused by the reminder queries below.
import { eq, desc, sql, ilike, and, inArray, isNull } from "drizzle-orm";
import { requireStaffPermission } from "../middleware/requireStaffAuth";
import { encryptSecret, decryptSecretTolerant } from "../lib/cryptoUtils";
import { todayIST } from "../lib/istDate";
import { getWhatsAppService } from "../services/whatsapp/WhatsAppService";
import { WhatsAppBotEngine } from "../services/whatsapp/WhatsAppBotEngine";
import { MetaWhatsAppCloudProvider } from "../services/whatsapp/MetaWhatsAppCloudProvider";
import { applyReportDeliveryReceiptStatuses } from "../lib/reportDeliveryReceipts";
import {
  applyWaOutboxReceiptStatuses, sendWhatsAppNow, getWaOutboxHealth, retryWaOutboxMessage, WHATSAPP_FEATURE_FLAG,
  type MetaStatusLike, type WaMessagePurpose,
} from "../services/whatsapp/WhatsAppOutbox";
import { isFeatureEnabledServer } from "../lib/featureFlags";
import { logger } from "../lib/logger";

// Shared with routes/waChatbot.ts's webhook — see the note above
// handleAiReply below for why this webhook now delegates to the same
// engine instead of running its own separate, divergent logic.
const sharedWaService = getWhatsAppService();
const sharedBotEngine = new WhatsAppBotEngine(sharedWaService);

// Dedicated to webhook SIGNATURE VERIFICATION only — deliberately NOT the
// same object as sharedWaService's underlying provider. That provider is
// selected by WHATSAPP_PROVIDER at process start (WhatsAppProviderFactory),
// which production never sets, so it silently resolves to MockWhatsAppProvider
// — a permissive test double whose verifyWebhook() accepts almost anything.
// Meta is this app's only production provider (per the unified WhatsApp
// Settings design), so the security-critical verify step always goes
// through this instance directly, with the secret passed in explicitly from
// the freshly-read, decrypted DB settings on every request — never from
// env, never from a value cached at process start.
const metaWebhookVerifier = new MetaWhatsAppCloudProvider();

export const whatsappRouter: IRouter = Router();
export const whatsappWebhookRouter: IRouter = Router();

async function getOrCreateSettings() {
  const [row] = await db.select().from(whatsappSettingsTable).limit(1);
  if (row) return { ...row, accessToken: decryptSecretTolerant(row.accessToken), appSecret: decryptSecretTolerant(row.appSecret) };
  const [created] = await db.insert(whatsappSettingsTable).values({}).returning();
  return { ...created, accessToken: decryptSecretTolerant(created.accessToken), appSecret: decryptSecretTolerant(created.appSecret) };
}

/**
 * Never return a complete secret to the browser — masks accessToken/
 * appSecret to a fixed placeholder (present vs absent is still visible, the
 * value never is), and parses testAllowlist from its stored JSON string into
 * a real array for the client. This is the ONLY function that should ever
 * shape a whatsapp_settings row for an HTTP response.
 */
function sanitizeSettingsForClient(row: typeof whatsappSettingsTable.$inferSelect) {
  let testAllowlist: string[] = [];
  try { const arr = JSON.parse(row.testAllowlist || "[]"); if (Array.isArray(arr)) testAllowlist = arr.filter((x) => typeof x === "string"); } catch { /* ignore malformed */ }
  return {
    ...row,
    accessToken: row.accessToken ? "••••••••" : "",
    appSecret: row.appSecret ? "••••••••" : "",
    testAllowlist,
  };
}

// ── Number config helper ──
// graphApiVersion flows through this single shape so every Meta API call in
// this file (and the outbox dispatcher, which reads it straight off
// whatsapp_settings) uses the SAME configured version — previously this file
// hardcoded "v20.0" in five separate places while MetaWhatsAppCloudProvider.ts
// hardcoded "v21.0", and nothing kept them in sync.
interface NumberConfig {
  phoneNumberId: string;
  accessToken: string;
  graphApiVersion: string;
}

/** Resolve the number that should be used for a given role.
 *  If numbers table has entries, pick the first enabled number matching the role.
 *  Falls back to the legacy global settings if no numbers exist. */
export async function resolveNumber(role: string): Promise<NumberConfig | null> {
  const s = await getOrCreateSettings();
  const numbers = await db.select().from(whatsappNumbersTable).where(eq(whatsappNumbersTable.enabled, true));
  const match = numbers.find((n) => n.role === role) ?? numbers.find((n) => n.isDefault);
  if (match && match.phoneNumberId && match.accessToken) {
    return { phoneNumberId: match.phoneNumberId, accessToken: decryptSecretTolerant(match.accessToken), graphApiVersion: s.graphApiVersion };
  }
  // Legacy fallback
  if (s.phoneNumberId && s.accessToken) {
    return { phoneNumberId: s.phoneNumberId, accessToken: s.accessToken, graphApiVersion: s.graphApiVersion };
  }
  return null;
}

async function resolveDefaultNumber(): Promise<NumberConfig | null> {
  return resolveNumber("general");
}

// ─── Existing Settings & Send Routes ──────────────────────────────────────────

whatsappRouter.get("/settings", async (_req, res) => {
  const s = await getOrCreateSettings();
  res.json(sanitizeSettingsForClient(s));
});

whatsappRouter.put("/settings", requireStaffPermission("/settings"), async (req, res) => {
  const current = await getOrCreateSettings();
  const body = req.body ?? {};
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.enabled !== undefined) updates.enabled = !!body.enabled;
  if (typeof body.phoneNumberId === "string") updates.phoneNumberId = body.phoneNumberId.trim();
  if (typeof body.templateName === "string") updates.templateName = body.templateName.trim();
  if (typeof body.templateLang === "string") updates.templateLang = body.templateLang.trim() || "en";
  if (typeof body.defaultCountryCode === "string") updates.defaultCountryCode = body.defaultCountryCode.replace(/\D/g, "") || "91";
  if (typeof body.accessToken === "string" && body.accessToken && body.accessToken !== "••••••••") {
    updates.accessToken = encryptSecret(body.accessToken.trim());
  }
  if (body.autoSendOnVerify !== undefined) updates.autoSendOnVerify = !!body.autoSendOnVerify;
  if (body.includeViewerLink !== undefined) updates.includeViewerLink = !!body.includeViewerLink;
  if (typeof body.reportMessageTemplate === "string") updates.reportMessageTemplate = body.reportMessageTemplate;
  // New webhook + AI fields
  if (typeof body.wabaId === "string") updates.wabaId = body.wabaId.trim();
  if (typeof body.webhookVerifyToken === "string") updates.webhookVerifyToken = body.webhookVerifyToken.trim();
  if (body.aiAssistantEnabled !== undefined) updates.aiAssistantEnabled = !!body.aiAssistantEnabled;
  if (typeof body.aiAssistantName === "string") updates.aiAssistantName = body.aiAssistantName.trim();
  if (typeof body.aiSystemPrompt === "string") updates.aiSystemPrompt = body.aiSystemPrompt;
  if (typeof body.aiEscalationMessage === "string") updates.aiEscalationMessage = body.aiEscalationMessage.trim();
  // ── Automation triggers ──
  if (body.autoSendBillCreated !== undefined) updates.autoSendBillCreated = !!body.autoSendBillCreated;
  if (body.appointmentReminderEnabled !== undefined) updates.appointmentReminderEnabled = !!body.appointmentReminderEnabled;
  if (typeof body.appointmentReminderTime === "string") updates.appointmentReminderTime = body.appointmentReminderTime.trim() || "18:00";
  if (typeof body.appointmentReminderTemplate === "string") updates.appointmentReminderTemplate = body.appointmentReminderTemplate;
  if (body.duesReminderEnabled !== undefined) updates.duesReminderEnabled = !!body.duesReminderEnabled;
  if (typeof body.duesReminderTime === "string") updates.duesReminderTime = body.duesReminderTime.trim() || "11:00";
  if (body.duesReminderMinAmount !== undefined) updates.duesReminderMinAmount = Math.max(0, Math.floor(Number(body.duesReminderMinAmount) || 0));
  if (typeof body.duesReminderTemplate === "string") updates.duesReminderTemplate = body.duesReminderTemplate;

  // ── Provider (section A) ──
  if (typeof body.businessDisplayName === "string") updates.businessDisplayName = body.businessDisplayName.trim();
  if (typeof body.graphApiVersion === "string") {
    const v = body.graphApiVersion.trim();
    if (!/^v\d+\.\d+$/.test(v)) { res.status(400).json({ error: "graphApiVersion must look like 'v21.0'" }); return; }
    updates.graphApiVersion = v;
  }

  // ── Credentials (section B) ──
  if (typeof body.appSecret === "string" && body.appSecret && body.appSecret !== "••••••••") {
    updates.appSecret = encryptSecret(body.appSecret.trim());
  }

  // ── Automation controls (section E) — all enforced server-side by
  // enqueueWhatsAppMessage(); these columns are read there, never trusted
  // from a client request at send time.
  if (body.shadowMode !== undefined) updates.shadowMode = !!body.shadowMode;
  if (Array.isArray(body.testAllowlist)) {
    const normalized = body.testAllowlist.filter((x: unknown) => typeof x === "string").map((x: string) => x.replace(/\D/g, "")).filter(Boolean);
    updates.testAllowlist = JSON.stringify(normalized);
  }
  if (body.blockNonAllowlisted !== undefined) updates.blockNonAllowlisted = !!body.blockNonAllowlisted;
  if (body.outboundMessagingEnabled !== undefined) updates.outboundMessagingEnabled = !!body.outboundMessagingEnabled;
  if (body.inboundProcessingEnabled !== undefined) updates.inboundProcessingEnabled = !!body.inboundProcessingEnabled;
  if (body.reportReadyMessagesEnabled !== undefined) updates.reportReadyMessagesEnabled = !!body.reportReadyMessagesEnabled;
  if (body.paymentMessagesEnabled !== undefined) updates.paymentMessagesEnabled = !!body.paymentMessagesEnabled;
  if (typeof body.quietHoursStart === "string") updates.quietHoursStart = body.quietHoursStart.trim();
  if (typeof body.quietHoursEnd === "string") updates.quietHoursEnd = body.quietHoursEnd.trim();
  if (body.maxRetryAttempts !== undefined) updates.maxRetryAttempts = Math.max(1, Math.min(20, Math.floor(Number(body.maxRetryAttempts) || 5)));
  if (body.retryDelayBaseSeconds !== undefined) updates.retryDelayBaseSeconds = Math.max(5, Math.floor(Number(body.retryDelayBaseSeconds) || 30));
  if (body.dailyMessageLimit !== undefined) updates.dailyMessageLimit = Math.max(0, Math.floor(Number(body.dailyMessageLimit) || 0));
  if (body.monthlyMessageBudgetWarning !== undefined) updates.monthlyMessageBudgetWarning = Math.max(0, Math.floor(Number(body.monthlyMessageBudgetWarning) || 0));

  // ── Consent and safety (section G) — marketingMessagesAllowed is stored
  // but not read by any send path yet (marketing campaigns are out of
  // scope for this build). stopStartHandlingEnabled / phiProtectionEnabled
  // are intentionally NOT settable here even though they're listed below —
  // see the schema comment for why those two stay hardcoded true.
  if (body.transactionalMessagesAllowed !== undefined) updates.transactionalMessagesAllowed = !!body.transactionalMessagesAllowed;
  if (body.reminderMessagesAllowed !== undefined) updates.reminderMessagesAllowed = !!body.reminderMessagesAllowed;
  if (body.marketingMessagesAllowed !== undefined) updates.marketingMessagesAllowed = !!body.marketingMessagesAllowed;
  if (body.secureReportLinkRequired !== undefined) updates.secureReportLinkRequired = !!body.secureReportLinkRequired;

  const [row] = await db.update(whatsappSettingsTable).set(updates).where(eq(whatsappSettingsTable.id, current.id)).returning();
  res.json(sanitizeSettingsForClient(row));
});

/** Emergency pause / resume — a single, obvious action for "stop sending
 *  right now" that doesn't require an admin to find and disable every
 *  individual toggle. Checked by enqueueWhatsAppMessage() before every send. */
whatsappRouter.post("/emergency-pause", requireStaffPermission("/settings"), async (req, res): Promise<void> => {
  const { reason } = req.body as { reason?: string };
  const current = await getOrCreateSettings();
  const [row] = await db.update(whatsappSettingsTable).set({
    emergencyPaused: true, emergencyPausedReason: (reason ?? "").trim() || "Paused by staff", emergencyPausedAt: new Date(), updatedAt: new Date(),
  }).where(eq(whatsappSettingsTable.id, current.id)).returning();
  res.json(sanitizeSettingsForClient(row));
});

whatsappRouter.post("/emergency-resume", requireStaffPermission("/settings"), async (_req, res): Promise<void> => {
  const current = await getOrCreateSettings();
  const [row] = await db.update(whatsappSettingsTable).set({
    emergencyPaused: false, emergencyPausedReason: "", emergencyPausedAt: null, updatedAt: new Date(),
  }).where(eq(whatsappSettingsTable.id, current.id)).returning();
  res.json(sanitizeSettingsForClient(row));
});

/** Connection test — a real, cheap Graph API call (GET on the phone number
 *  ID) that proves the configured credentials actually work, distinct from
 *  the "/test" route below which sends a real message. Never exposes the
 *  raw access token; only ok/error and the timestamp are persisted. */
whatsappRouter.post("/test-connection", requireStaffPermission("/settings"), async (_req, res): Promise<void> => {
  const current = await getOrCreateSettings();
  const cfg = await resolveDefaultNumber();
  if (!cfg) {
    const [row] = await db.update(whatsappSettingsTable).set({ lastCheckError: "No default number configured", lastCheckErrorAt: new Date() }).where(eq(whatsappSettingsTable.id, current.id)).returning();
    res.json({ ok: false, error: "No default number configured", settings: sanitizeSettingsForClient(row) });
    return;
  }
  try {
    const url = `https://graph.facebook.com/${cfg.graphApiVersion}/${encodeURIComponent(cfg.phoneNumberId)}?fields=display_phone_number,verified_name`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${cfg.accessToken}` } });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const errMsg = (data as { error?: { message?: string } }).error?.message ?? `HTTP ${resp.status}`;
      const [row] = await db.update(whatsappSettingsTable).set({ lastCheckError: errMsg, lastCheckErrorAt: new Date() }).where(eq(whatsappSettingsTable.id, current.id)).returning();
      res.json({ ok: false, error: errMsg, settings: sanitizeSettingsForClient(row) });
      return;
    }
    const [row] = await db.update(whatsappSettingsTable).set({ lastSuccessfulCheckAt: new Date(), lastCheckError: "" }).where(eq(whatsappSettingsTable.id, current.id)).returning();
    res.json({ ok: true, data, settings: sanitizeSettingsForClient(row) });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Connection test failed";
    const [row] = await db.update(whatsappSettingsTable).set({ lastCheckError: errMsg, lastCheckErrorAt: new Date() }).where(eq(whatsappSettingsTable.id, current.id)).returning();
    res.json({ ok: false, error: errMsg, settings: sanitizeSettingsForClient(row) });
  }
});

whatsappRouter.post("/test", requireStaffPermission("/settings"), async (req, res): Promise<void> => {
  const { phone, numberId } = req.body as { phone?: string; numberId?: number };
  if (!phone) {
    res.status(400).json({ error: "phone required" });
    return;
  }
  const result = await sendBillWhatsapp({ phone, patientName: "Test User", billNumber: "TEST-0001", totalAmount: 0, tokenNo: 1, numberId });
  res.json(result);
});

/**
 * Health + diagnostics for the unified settings page's Health section
 * (section H) — outbox queue depth, webhook signature stats, feature-flag
 * and emergency-pause state. Never returns secrets/tokens/raw PHI, only
 * counts and timestamps.
 */
whatsappRouter.get("/health", requireStaffPermission("/settings"), async (_req, res): Promise<void> => {
  const s = await getOrCreateSettings();
  const outbox = await getWaOutboxHealth();
  const flagOn = await isFeatureEnabledServer(WHATSAPP_FEATURE_FLAG);
  res.json({
    featureEnabled: flagOn,
    masterEnabled: s.enabled,
    outboundMessagingEnabled: s.outboundMessagingEnabled,
    emergencyPaused: s.emergencyPaused,
    emergencyPausedReason: s.emergencyPausedReason || null,
    shadowMode: s.shadowMode,
    outbox,
    webhook: {
      lastWebhookReceivedAt: s.lastWebhookReceivedAt,
      lastValidSignatureAt: s.lastValidSignatureAt,
      lastRejectedSignatureAt: s.lastRejectedSignatureAt,
      rejectedSignatureCount: s.rejectedSignatureCount,
    },
  });
});

/** Recent outbox rows for the Health tab's queue/dead-letter view — never
 *  returns payload_json verbatim (may contain patient message text), just
 *  enough to identify and act on a row. */
whatsappRouter.get("/outbox", requireStaffPermission("/settings"), async (req, res): Promise<void> => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const baseQuery = status
    ? db.select({
        id: waOutboxTable.id, recipientPhone: waOutboxTable.recipientPhone, messagePurpose: waOutboxTable.messagePurpose,
        status: waOutboxTable.status, attemptCount: waOutboxTable.attemptCount, maxAttempts: waOutboxTable.maxAttempts,
        lastErrorMessage: waOutboxTable.lastErrorMessage, nextAttemptAt: waOutboxTable.nextAttemptAt,
        createdAt: waOutboxTable.createdAt, sentAt: waOutboxTable.sentAt, deliveredAt: waOutboxTable.deliveredAt, readAt: waOutboxTable.readAt,
      }).from(waOutboxTable).where(eq(waOutboxTable.status, status))
    : db.select({
        id: waOutboxTable.id, recipientPhone: waOutboxTable.recipientPhone, messagePurpose: waOutboxTable.messagePurpose,
        status: waOutboxTable.status, attemptCount: waOutboxTable.attemptCount, maxAttempts: waOutboxTable.maxAttempts,
        lastErrorMessage: waOutboxTable.lastErrorMessage, nextAttemptAt: waOutboxTable.nextAttemptAt,
        createdAt: waOutboxTable.createdAt, sentAt: waOutboxTable.sentAt, deliveredAt: waOutboxTable.deliveredAt, readAt: waOutboxTable.readAt,
      }).from(waOutboxTable);
  const rows = await baseQuery.orderBy(desc(waOutboxTable.createdAt)).limit(limit);
  res.json(rows);
});

/** Manual retry of a dead-lettered/failed outbox row (Health tab action). */
whatsappRouter.post("/outbox/:id/retry", requireStaffPermission("/settings"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const result = await retryWaOutboxMessage(id);
  if (!result.ok) { res.status(404).json(result); return; }
  res.json(result);
});

// ── WhatsApp Numbers CRUD ──

whatsappRouter.get("/numbers", requireStaffPermission("/settings"), async (_req, res): Promise<void> => {
  const rows = await db.select().from(whatsappNumbersTable).orderBy(desc(whatsappNumbersTable.isDefault), desc(whatsappNumbersTable.createdAt));
  res.json(rows.map((r) => ({ ...r, accessToken: r.accessToken ? "••••••••" : "" })));
});

whatsappRouter.post("/numbers", requireStaffPermission("/settings"), async (req, res): Promise<void> => {
  const body = req.body ?? {};
  if (!body.name?.trim() || !body.phoneNumberId?.trim()) {
    res.status(400).json({ error: "name and phoneNumberId required" });
    return;
  }
  const role = (body.role === "form_f" || body.role === "reports") ? body.role : "general";
  const rawToken = String(body.accessToken ?? "").trim();
  const values = {
    name: String(body.name).trim(),
    phoneNumberId: String(body.phoneNumberId).trim(),
    displayNumber: String(body.displayNumber ?? "").trim(),
    accessToken: rawToken ? encryptSecret(rawToken) : "",
    role,
    enabled: !!body.enabled,
    isDefault: !!body.isDefault,
  };
  // If marking as default, clear other defaults
  if (values.isDefault) {
    await db.update(whatsappNumbersTable).set({ isDefault: false }).where(eq(whatsappNumbersTable.isDefault, true));
  }
  const [row] = await db.insert(whatsappNumbersTable).values(values).returning();
  res.json({ ...row, accessToken: "" });
});

whatsappRouter.put("/numbers/:id", requireStaffPermission("/settings"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const body = req.body ?? {};
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.name === "string") updates.name = body.name.trim();
  if (typeof body.phoneNumberId === "string") updates.phoneNumberId = body.phoneNumberId.trim();
  if (typeof body.displayNumber === "string") updates.displayNumber = body.displayNumber.trim();
  if (typeof body.accessToken === "string" && body.accessToken && body.accessToken !== "••••••••") {
    updates.accessToken = encryptSecret(body.accessToken.trim());
  }
  if (body.role === "general" || body.role === "form_f" || body.role === "reports") updates.role = body.role;
  if (body.enabled !== undefined) updates.enabled = !!body.enabled;
  if (body.isDefault !== undefined) updates.isDefault = !!body.isDefault;

  if (updates.isDefault) {
    await db.update(whatsappNumbersTable).set({ isDefault: false }).where(eq(whatsappNumbersTable.isDefault, true));
  }

  const [row] = await db.update(whatsappNumbersTable).set(updates).where(eq(whatsappNumbersTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...row, accessToken: "" });
});

whatsappRouter.delete("/numbers/:id", requireStaffPermission("/settings"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(whatsappNumbersTable).where(eq(whatsappNumbersTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.isDefault) {
    res.status(400).json({ error: "Cannot delete the default number. Set another as default first." });
    return;
  }
  await db.delete(whatsappNumbersTable).where(eq(whatsappNumbersTable.id, id));
  res.json({ ok: true });
});

whatsappRouter.post("/numbers/:id/test", requireStaffPermission("/settings"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { phone } = req.body as { phone?: string };
  if (!phone) { res.status(400).json({ error: "phone required" }); return; }

  const [num] = await db.select().from(whatsappNumbersTable).where(eq(whatsappNumbersTable.id, id)).limit(1);
  if (!num) { res.status(404).json({ error: "Number not found" }); return; }
  if (!num.phoneNumberId || !num.accessToken) { res.status(400).json({ error: "Number missing credentials" }); return; }
  const s = await getOrCreateSettings();

  const to = normalizePhone(phone, s.defaultCountryCode);
  if (!to) { res.status(400).json({ error: "Invalid phone" }); return; }

  const result = await sendWhatsAppNow({
    recipientPhone: to,
    messagePurpose: "test_send",
    phoneNumberId: num.phoneNumberId,
    text: `Test message from Care Diagnostics via number: ${num.name || num.displayNumber || num.phoneNumberId}`,
  });
  res.json(result);
});

// ─── Conversation Inbox Routes ─────────────────────────────────────────────────

whatsappRouter.get("/conversations", requireStaffPermission("/settings"), async (req, res): Promise<void> => {
  const page = Math.max(1, Number(req.query.page ?? 1));
  const limit = 50;
  const offset = (page - 1) * limit;

  const rows = await db
    .select()
    .from(whatsappConversationsTable)
    .orderBy(desc(whatsappConversationsTable.createdAt))
    .limit(limit)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(whatsappConversationsTable);

  res.json({ conversations: rows, total: Number(count), page, limit });
});

whatsappRouter.get("/conversations/:phone", requireStaffPermission("/settings"), async (req, res): Promise<void> => {
  const phone = String(req.params.phone ?? "");
  const rows = await db
    .select()
    .from(whatsappConversationsTable)
    .where(eq(whatsappConversationsTable.phone, phone))
    .orderBy(desc(whatsappConversationsTable.createdAt))
    .limit(100);
  res.json(rows);
});

whatsappRouter.post("/conversations/:phone/reply", requireStaffPermission("/settings"), async (req, res): Promise<void> => {
  const phone = String(req.params.phone ?? "");
  const { message, numberId } = req.body as { message?: string; numberId?: number };
  if (!message?.trim()) {
    res.status(400).json({ error: "message required" });
    return;
  }

  const s = await getOrCreateSettings();
  const result = await sendTextMessage(phone, message.trim(), s, numberId);
  if (!result.ok) {
    res.status(502).json({ error: result.error ?? "Send failed" });
    return;
  }

  // Log the outgoing reply
  await db.insert(whatsappConversationsTable).values({
    phone,
    customerName: "",
    direction: "outgoing",
    messageBody: message.trim(),
    waMessageId: result.messageId ?? "",
    aiHandled: false,
    status: "sent",
  });

  res.json({ ok: true, messageId: result.messageId });
});

// ─── Public Webhook Routes (Meta verification + incoming messages) ──────────────

whatsappWebhookRouter.get("/", (req: Request, res: Response): void => {
  const mode      = req.query["hub.mode"];
  const token     = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  getOrCreateSettings().then((s) => {
    if (mode === "subscribe" && token && token === s.webhookVerifyToken) {
      res.status(200).send(String(challenge ?? ""));
    } else {
      res.status(403).json({ error: "Webhook verification failed" });
    }
  }).catch(() => res.status(500).json({ error: "Internal error" }));
});

/**
 * POST /api/whatsapp/webhook — mounted with express.raw() (see app.ts, BEFORE
 * the global express.json() parser) specifically so req.body arrives here as
 * the untouched raw Buffer Meta signed, not a re-parsed/re-serialized object.
 * A JSON.stringify(parsedBody) round-trip does not reliably reproduce the
 * exact bytes Meta hashed (key order, whitespace, unicode escaping can all
 * differ), which is why signature verification must happen against these
 * exact bytes and BEFORE any JSON.parse.
 *
 * Fails closed: no database write, no message processing, and no delegation
 * to the bot engine happens unless the signature verifies. A rejected
 * signature is recorded (count + timestamp, no raw body) so the unified
 * settings page's webhook diagnostics panel can show it.
 */
whatsappWebhookRouter.post("/", express.raw({ type: () => true, limit: "5mb" }), async (req: Request, res: Response): Promise<void> => {
  // Always respond 200 immediately to prevent Meta from retrying — this is
  // just the HTTP ack, not a signal that anything below was accepted.
  res.status(200).json({ status: "ok" });

  const rawBodyBuffer = req.body;
  const rawBody = Buffer.isBuffer(rawBodyBuffer) ? rawBodyBuffer.toString("utf8") : "";
  const signatureHeader = req.header("x-hub-signature-256") ?? "";

  try {
    const s = await getOrCreateSettings();

    await db.update(whatsappSettingsTable).set({ lastWebhookReceivedAt: new Date() }).where(eq(whatsappSettingsTable.id, s.id)).catch(() => {});

    const verifyResult = await metaWebhookVerifier.verifyWebhook(rawBody, signatureHeader, s.appSecret);
    if (!verifyResult.valid) {
      logger.warn({ hasSignatureHeader: !!signatureHeader, hasSecret: !!s.appSecret }, "[whatsapp webhook] rejected: invalid or missing signature");
      await db.update(whatsappSettingsTable).set({
        lastRejectedSignatureAt: new Date(),
        rejectedSignatureCount: sql`${whatsappSettingsTable.rejectedSignatureCount} + 1`,
      }).where(eq(whatsappSettingsTable.id, s.id)).catch(() => {});
      // Sanitized audit event — action + status only, no raw body (may
      // contain patient phone numbers / message text), no signature value.
      void db.insert(whatsappConversationsTable).values({
        phone: "", customerName: "", direction: "incoming",
        messageBody: "[webhook rejected: invalid signature]",
        waMessageId: "", aiHandled: false, status: "rejected",
      }).catch(() => {});
      return;
    }
    await db.update(whatsappSettingsTable).set({ lastValidSignatureAt: new Date() }).where(eq(whatsappSettingsTable.id, s.id)).catch(() => {});

    let body: WhatsappWebhookBody;
    try {
      body = JSON.parse(rawBody) as WhatsappWebhookBody;
    } catch {
      return; // valid signature over an unparseable body — nothing to process
    }
    if (body.object !== "whatsapp_business_account") return;

    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== "messages") continue;
        const value = change.value;

        // Delivery/read receipts (sent|delivered|read|failed) for staff-tracked
        // report sends — Meta posts these under value.statuses[], which the
        // message-handling below never reads. Additive, fire-and-forget; a
        // no-op unless a tracked receipt matches the provider message id.
        const statuses = (value as { statuses?: unknown }).statuses;
        if (Array.isArray(statuses)) {
          void applyReportDeliveryReceiptStatuses(statuses as Parameters<typeof applyReportDeliveryReceiptStatuses>[0]).catch(() => {});
          void applyWaOutboxReceiptStatuses(statuses as MetaStatusLike[]).catch(() => {});
        }

        // Meta includes the receiving phone number ID in metadata
        const receivingPhoneNumberId = (value.metadata as { phone_number_id?: string } | undefined)?.phone_number_id ?? "";
        if (receivingPhoneNumberId && Array.isArray(statuses) && statuses.length > 0) {
          void db.update(whatsappNumbersTable).set({ lastReceiptAt: new Date() }).where(eq(whatsappNumbersTable.phoneNumberId, receivingPhoneNumberId)).catch(() => {});
        }

        // Resolve the number config for routing
        let numCfg: NumberConfig | null = null;
        let numRole = "general";
        if (receivingPhoneNumberId) {
          const numbers = await db.select().from(whatsappNumbersTable).where(eq(whatsappNumbersTable.enabled, true));
          const matched = numbers.find((n) => n.phoneNumberId === receivingPhoneNumberId);
          if (matched) {
            numCfg = { phoneNumberId: matched.phoneNumberId, accessToken: decryptSecretTolerant(matched.accessToken), graphApiVersion: s.graphApiVersion };
            numRole = matched.role;
            void db.update(whatsappNumbersTable).set({ lastInboundAt: new Date(), connectionStatus: "ok" }).where(eq(whatsappNumbersTable.id, matched.id)).catch(() => {});
          }
        }
        // Fallback to legacy settings
        if (!numCfg && s.phoneNumberId && s.accessToken) {
          numCfg = { phoneNumberId: s.phoneNumberId, accessToken: s.accessToken, graphApiVersion: s.graphApiVersion };
        }

        for (const msg of value.messages ?? []) {
          const phone = msg.from;
          const waId  = msg.id;
          const name  = value.contacts?.find((c) => c.wa_id === phone)?.profile?.name ?? "";

          // Meta's webhook delivery is at-least-once — a slow ack or network
          // blip makes Meta retry the SAME message. Without this check a
          // retry would re-run the bot engine (STOP/START handling, session
          // state, Form F field extraction) a second time even though the
          // resulting outbound reply itself would separately be deduped by
          // wa_outbox's idempotency key. Checked before any processing, per
          // requirement 10 ("dedupe by provider message ID, store before
          // processing").
          if (waId) {
            const [dup] = await db.select({ id: whatsappConversationsTable.id }).from(whatsappConversationsTable)
              .where(and(eq(whatsappConversationsTable.waMessageId, waId), eq(whatsappConversationsTable.direction, "incoming")))
              .limit(1);
            if (dup) continue;
          }

          // ─── Incoming IMAGE ─── attempt ID card OCR + Form F auto-fill ───
          if (msg.type === "image" && msg.image?.id) {
            void handleIncomingImage({
              phone, waId, name,
              mediaId: msg.image.id,
              caption: msg.image.caption ?? "",
              mimeType: msg.image.mime_type ?? "image/jpeg",
              numCfg,
              numRole,
            }).catch(() => {});
            continue;
          }

          if (msg.type !== "text" || !msg.text?.body) continue;

          const text = msg.text.body;

          // Save incoming message (this webhook's own conversation log —
          // see the note above sharedBotEngine for why this table is kept
          // separate from waConversationsTable rather than merged today)
          await db.insert(whatsappConversationsTable).values({
            phone,
            customerName: name,
            direction: "incoming",
            messageBody: text,
            waMessageId: waId,
            aiHandled: false,
            status: "received",
          });

          // Delegate to the SAME bot engine the /api/wa-chatbot/webhook
          // path uses, rather than this webhook's own separate logic.
          // This is the actual fix for "two never-connected WhatsApp AI
          // systems" — a message arriving here now gets the identical
          // menu-bot-with-Knowledge-Base-grounded-fallback experience as
          // one arriving at the other webhook URL, instead of two
          // different bots with two different behaviors depending on
          // which webhook happened to receive it.
          //
          // Deliberately NOT unified: the underlying contact/conversation
          // tables (waContactsTable vs whatsappConversationsTable) — those
          // are two separate, real data stores with their own staff-facing
          // UIs built on top of them elsewhere in this codebase, and
          // merging them is a genuine data-migration task, not a "connect
          // the logic" task. This delegation calls
          // service.getOrCreateContact() to resolve the waContactsTable
          // side fresh on every message, so both systems' records stay
          // populated and queryable independently, without either webhook
          // losing its own audit trail.
          if (numRole !== "reports" && s.aiAssistantEnabled && numCfg) {
            void (async () => {
              try {
                const contact = await sharedWaService.getOrCreateContact(phone, name);
                const reply = await sharedBotEngine.processMessage(contact, {
                  provider: "meta",
                  from: phone,
                  timestamp: String(Date.now()),
                  messageId: waId,
                  type: "text",
                  body: text,
                  rawPayload: msg,
                });
                if (reply.text) {
                  await sendWhatsAppNow({
                    recipientPhone: phone,
                    messagePurpose: "chatbot_reply",
                    phoneNumberId: numCfg.phoneNumberId,
                    text: reply.text,
                  });
                  await db.insert(whatsappConversationsTable).values({
                    phone,
                    customerName: name,
                    direction: "outgoing",
                    messageBody: reply.text,
                    waMessageId: "",
                    aiHandled: reply.action !== "handover_human",
                    status: "sent",
                  });
                }
              } catch {
                // Swallowed deliberately, matching this webhook's existing
                // error-tolerance policy — Meta already received its 200
                // response before this async work began, so a failure
                // here must never surface as a webhook-level error.
              }
            })();
          }
        }
      }
    }
  } catch (_err) {
    // Errors are swallowed — 200 already sent to Meta
  }
});

// ─── Incoming image handler (ID card OCR → Form F) ──────────────────────────────────────
import { geminiOcrIdCard } from "@workspace/integrations-gemini-ai";
import { formFRecordsTable, patientsTable } from "@workspace/db/schema";

// Meta's own documented WhatsApp Cloud API image limit is 5 MB; anything
// claiming to be larger, or arriving without a recognized image MIME type,
// is rejected before it is ever buffered into memory or handed to OCR.
const INBOUND_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const INBOUND_IMAGE_ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

async function handleIncomingImage(params: {
  phone: string;
  waId: string;
  name: string;
  mediaId: string;
  caption: string;
  mimeType: string;
  numCfg: NumberConfig | null;
  numRole: string;
}): Promise<void> {
  const { phone, waId, name, mediaId, caption, mimeType, numCfg, numRole } = params;

  if (!numCfg) return; // Can't download without credentials
  if (!INBOUND_IMAGE_ALLOWED_MIME.has(mimeType)) {
    logger.warn({ mimeType }, "[whatsapp] Incoming image rejected: unsupported MIME type");
    return;
  }

  // 1. Download image via Meta media API
  let imageBuf: Buffer | null = null;
  try {
    const metaUrl = `https://graph.facebook.com/${numCfg.graphApiVersion}/${encodeURIComponent(mediaId)}?access_token=${encodeURIComponent(numCfg.accessToken)}`;
    const metaResp = await fetch(metaUrl);
    if (!metaResp.ok) throw new Error(`Meta media info failed: ${metaResp.status}`);
    const metaData = await metaResp.json() as { url?: string; file_size?: number };
    if (!metaData.url) throw new Error("No media URL from Meta");
    if (typeof metaData.file_size === "number" && metaData.file_size > INBOUND_IMAGE_MAX_BYTES) {
      throw new Error(`Media file_size ${metaData.file_size} exceeds ${INBOUND_IMAGE_MAX_BYTES} byte limit`);
    }
    const imgResp = await fetch(metaData.url, { headers: { Authorization: `Bearer ${numCfg.accessToken}` } });
    if (!imgResp.ok) throw new Error(`Image download failed: ${imgResp.status}`);
    const declaredLength = Number(imgResp.headers.get("content-length") ?? "0");
    if (declaredLength > INBOUND_IMAGE_MAX_BYTES) throw new Error(`Content-Length ${declaredLength} exceeds ${INBOUND_IMAGE_MAX_BYTES} byte limit`);
    const buf = Buffer.from(await imgResp.arrayBuffer());
    if (buf.length > INBOUND_IMAGE_MAX_BYTES) throw new Error(`Downloaded ${buf.length} bytes exceeds ${INBOUND_IMAGE_MAX_BYTES} byte limit`);
    imageBuf = buf;
  } catch (err) {
    console.warn("[whatsapp] Incoming image download failed:", err);
    return;
  }

  if (!imageBuf || imageBuf.length === 0) return;

  // 2. Run Gemini OCR on ID card
  let ocrResult: { guardianName: string; address: string; documentType: string; confidence: string } | null = null;
  try {
    const base64 = imageBuf.toString("base64");
    ocrResult = await geminiOcrIdCard(base64, mimeType);
  } catch (err) {
    console.warn("[whatsapp] ID card OCR failed:", err);
  }

  // 3. Find patient by phone
  const phoneDigits = (phone || "").replace(/\D/g, "");
  const patientRows = await db
    .select()
    .from(patientsTable)
    .where(ilike(patientsTable.phone, `%${phoneDigits}%`))
    .limit(5);
  const patient = patientRows[0] ?? null;

  // 4. Save incoming image message to conversation log
  await db.insert(whatsappConversationsTable).values({
    phone,
    customerName: name,
    direction: "incoming",
    messageBody: caption || `[Image: ${ocrResult?.documentType ?? "ID Card"}]`,
    waMessageId: waId,
    aiHandled: !!ocrResult,
    status: "received",
  });

  // Only process ID card / Form F logic if this number is a Form F number
  if (numRole !== "form_f") {
    // Non-Form-F numbers: just log the image, no Form F processing
    if (numCfg) {
      void sendTextMessageRaw(phone, "Thank you for your message. For ID card uploads related to Form F, please use our dedicated Form F number.", numCfg).catch(() => {});
    }
    return;
  }

  // 5. If patient found and data extracted, upsert Form F record
  if (patient && ocrResult && (ocrResult.guardianName || ocrResult.address)) {
    // Look for an existing Form F record for this patient (most recent)
    const existing = await db
      .select()
      .from(formFRecordsTable)
      .where(eq(formFRecordsTable.patientId, patient.id))
      .orderBy(desc(formFRecordsTable.createdAt))
      .limit(1);

    if (existing[0]) {
      // Update existing record with extracted data (not verified yet)
      const updates: Record<string, unknown> = {};
      if (ocrResult.guardianName) updates.idCardExtractedName = ocrResult.guardianName;
      if (ocrResult.address) updates.idCardExtractedAddress = ocrResult.address;
      updates.idCardVerified = false;
      await db.update(formFRecordsTable).set(updates).where(eq(formFRecordsTable.id, existing[0].id));
    } else {
      // Create a new draft Form F record
      await db.insert(formFRecordsTable).values({
        patientId: patient.id,
        billNumber: null,
        patientName: `${patient.firstName} ${patient.lastName}`.trim(),
        address: ocrResult.address || patient.address || "",
        mobile: patient.phone ?? "",
        husbandFatherName: ocrResult.guardianName ?? "",
        idCardExtractedName: ocrResult.guardianName || null,
        idCardExtractedAddress: ocrResult.address || null,
        idCardVerified: false,
      });
    }

    // 6. Send confirmation reply
    const replyBody = ocrResult.guardianName || ocrResult.address
      ? `Thank you! We received your ID card image and extracted the following details for your Form F record:\n• Guardian/Husband/Father: ${ocrResult.guardianName || "(not found)"}\n• Address: ${ocrResult.address || "(not found)"}\n\nOur staff will verify and confirm these details shortly.`
      : "Thank you for sharing your ID card image. We couldn't clearly read the details. Our staff will assist you at the center.";
    void sendTextMessageRaw(phone, replyBody, numCfg).catch(() => {});
  } else {
    // Reply even when no patient found or no data extracted
    const replyBody = patient
      ? "Thank you for your ID card image. We couldn't extract the required details automatically. Our staff will assist you at the center."
      : "Thank you for your ID card image. We couldn't find a matching patient record. Please visit the center so our staff can verify and update your records.";
    void sendTextMessageRaw(phone, replyBody, numCfg).catch(() => {});
  }
}

// ─── Low-level send helpers ────────────────────────────────────────────────────

export async function sendTextMessageRaw(
  to: string,
  body: string,
  cfg: NumberConfig,
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  if (!cfg.accessToken || !cfg.phoneNumberId) return { ok: false, error: "WhatsApp not configured" };
  const url = `https://graph.facebook.com/${cfg.graphApiVersion || "v21.0"}/${encodeURIComponent(cfg.phoneNumberId)}/messages`;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
    });
    const data = (await resp.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
    if (!resp.ok) return { ok: false, error: data.error?.message ?? `HTTP ${resp.status}` };
    return { ok: true, messageId: data.messages?.[0]?.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Send failed" };
  }
}

async function sendTextMessage(
  to: string,
  body: string,
  s: typeof whatsappSettingsTable.$inferSelect,
  numberId?: number,
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  if (numberId) {
    const [num] = await db.select().from(whatsappNumbersTable).where(eq(whatsappNumbersTable.id, numberId)).limit(1);
    if (num && num.phoneNumberId && num.accessToken) {
      return sendTextMessageRaw(to, body, { phoneNumberId: num.phoneNumberId, accessToken: decryptSecretTolerant(num.accessToken), graphApiVersion: s.graphApiVersion });
    }
  }
  if (s.accessToken && s.phoneNumberId) {
    return sendTextMessageRaw(to, body, { phoneNumberId: s.phoneNumberId, accessToken: decryptSecretTolerant(s.accessToken), graphApiVersion: s.graphApiVersion });
  }
  // Try default number
  const def = await resolveDefaultNumber();
  if (def) return sendTextMessageRaw(to, body, def);
  return { ok: false, error: "WhatsApp not configured" };
}

export function normalizePhone(raw: string, countryCode: string): string | null {
  const digits = (raw || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length >= 11) return digits;
  return `${countryCode}${digits}`;
}

/**
 * Send an arbitrary free-text WhatsApp message to a phone number, through
 * the single wa_outbox enqueue chokepoint (sendWhatsAppNow — see
 * WhatsAppOutbox.ts). Used for patient login OTP codes (a session text, so
 * it needs no pre-approved template), recall follow-ups, feedback/NPS
 * invites and bill payment links; `purpose` decides which automation-control
 * toggle and quiet-hours/daily-limit treatment applies. Returns ok:false
 * (never throws) when WhatsApp is disabled/unconfigured or the send fails.
 */
export async function sendPlainWhatsappText(
  phone: string,
  body: string,
  purpose: WaMessagePurpose = "manual_staff_send",
): Promise<{ ok: boolean; skipped?: boolean; error?: string; messageId?: string }> {
  const result = await sendWhatsAppNow({ recipientPhone: phone, messagePurpose: purpose, text: body });
  return { ok: result.ok, skipped: result.skipped, error: result.error, messageId: result.messageId };
}

async function resolvePhoneNumberIdFor(numberId?: number): Promise<string | undefined> {
  if (!numberId) return undefined;
  const [num] = await db.select({ phoneNumberId: whatsappNumbersTable.phoneNumberId }).from(whatsappNumbersTable).where(eq(whatsappNumbersTable.id, numberId)).limit(1);
  return num?.phoneNumberId;
}

export async function sendBillWhatsapp(params: {
  phone: string;
  patientName: string;
  billNumber: string;
  totalAmount: number;
  tokenNo: number;
  numberId?: number;
}): Promise<{ ok: boolean; skipped?: boolean; error?: string; messageId?: string }> {
  const s = await getOrCreateSettings();
  const phoneNumberId = await resolvePhoneNumberIdFor(params.numberId);
  const result = await sendWhatsAppNow({
    recipientPhone: params.phone,
    messagePurpose: "bill_created",
    phoneNumberId,
    template: {
      name: s.templateName,
      languageCode: s.templateLang || "en",
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: params.patientName },
            { type: "text", text: params.billNumber },
            { type: "text", text: `₹${params.totalAmount.toFixed(2)}` },
            { type: "text", text: String(params.tokenNo) },
          ],
        },
      ],
    },
  });
  return { ok: result.ok, skipped: result.skipped, error: result.error, messageId: result.messageId };
}

/**
 * Report-ready notification. Uses the configured template if one is set,
 * else falls back to a plain-text message. Unlike the pre-outbox version,
 * this no longer retries a failed template send with a plain-text send
 * within the same call — the choice is made once at enqueue time, and any
 * failure is retried by the outbox dispatcher's own backoff instead. A
 * template that is permanently broken (e.g. not yet approved by Meta) will
 * dead-letter after maxRetryAttempts rather than silently falling back
 * forever; see the completion report for why this trade-off was made.
 */
export async function sendReportWhatsapp(params: {
  phone: string;
  patientName: string;
  reportNumber: string;
  testName: string;
  reportUrl: string;
  numberId?: number;
}): Promise<{ ok: boolean; skipped?: boolean; error?: string; messageId?: string }> {
  const s = await getOrCreateSettings();
  const phoneNumberId = await resolvePhoneNumberIdFor(params.numberId);
  const result = s.templateName
    ? await sendWhatsAppNow({
        recipientPhone: params.phone,
        messagePurpose: "report_ready",
        phoneNumberId,
        template: {
          name: s.templateName,
          languageCode: s.templateLang || "en",
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: params.patientName },
                { type: "text", text: params.reportNumber },
                { type: "text", text: params.testName },
                { type: "text", text: "READY" },
              ],
            },
          ],
        },
      })
    : await sendWhatsAppNow({
        recipientPhone: params.phone,
        messagePurpose: "report_ready",
        phoneNumberId,
        text: `Hello ${params.patientName}, your ${params.testName} report (${params.reportNumber}) is ready. View: ${params.reportUrl}`,
      });
  return { ok: result.ok, skipped: result.skipped, error: result.error, messageId: result.messageId };
}

export async function sendReportDelivery(params: {
  phone: string;
  patientName: string;
  reportNumber: string;
  testName: string;
  reportUrl: string;
  viewerUrl?: string | null;
  numberId?: number;
}): Promise<{ ok: boolean; skipped?: boolean; error?: string; messageId?: string }> {
  const s = await getOrCreateSettings();
  const phoneNumberId = await resolvePhoneNumberIdFor(params.numberId);

  const tpl = (s.reportMessageTemplate || "").trim();
  const viewerLine = params.viewerUrl && s.includeViewerLink !== false
    ? `\nView images: ${params.viewerUrl}`
    : "";
  const defaultBody = `Hello ${params.patientName}, your ${params.testName} report (${params.reportNumber}) is ready.\nDownload: ${params.reportUrl}${viewerLine}\n— Care Diagnostics`;
  const body = tpl
    ? tpl
        .replace(/\{\{name\}\}/g, params.patientName)
        .replace(/\{\{reportNumber\}\}/g, params.reportNumber)
        .replace(/\{\{testName\}\}/g, params.testName)
        .replace(/\{\{reportUrl\}\}/g, params.reportUrl)
        .replace(/\{\{viewerUrl\}\}/g, params.viewerUrl ?? "")
    : defaultBody;

  const result = await sendWhatsAppNow({ recipientPhone: params.phone, messagePurpose: "report_ready", phoneNumberId, text: body });
  return { ok: result.ok, skipped: result.skipped, error: result.error, messageId: result.messageId };
}

export interface ReminderRunResult {
  skipped?: boolean;
  reason?: string;
  sent: number;
  failed: number;
  total: number;
}

/**
 * Send WhatsApp reminders for every appointment scheduled for TOMORROW (IST).
 * Driven by a daily cron (cron.ts) at whatsapp_settings.appointmentReminderTime.
 * No-ops unless both the master WhatsApp switch and the appointment-reminder
 * toggle are on. Safe to call ad-hoc via the internal-cron endpoint.
 */
export async function runAppointmentReminders(): Promise<ReminderRunResult> {
  const s = await getOrCreateSettings();
  if (!s.enabled) return { skipped: true, reason: "WhatsApp disabled", sent: 0, failed: 0, total: 0 };
  if (!s.appointmentReminderEnabled) return { skipped: true, reason: "Appointment reminders disabled", sent: 0, failed: 0, total: 0 };
  const cfg = await resolveDefaultNumber();
  if (!cfg) return { skipped: true, reason: "WhatsApp settings incomplete", sent: 0, failed: 0, total: 0 };

  const tomorrow = todayIST(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const rows = await db
    .select({
      appointmentId: appointmentsTable.id,
      patientId: appointmentsTable.patientId,
      timeSlot: appointmentsTable.timeSlot,
      firstName: patientsTable.firstName,
      lastName: patientsTable.lastName,
      phone: patientsTable.phone,
    })
    .from(appointmentsTable)
    .innerJoin(patientsTable, eq(appointmentsTable.patientId, patientsTable.id))
    .where(and(
      eq(appointmentsTable.appointmentDate, tomorrow),
      inArray(appointmentsTable.status, ["scheduled", "confirmed"]),
    ));

  let sent = 0, failed = 0;
  for (const r of rows) {
    const name = `${r.firstName} ${r.lastName}`.trim();
    const tpl = (s.appointmentReminderTemplate || "").trim();
    const body = tpl
      ? tpl.replace(/\{\{name\}\}/g, name).replace(/\{\{date\}\}/g, tomorrow).replace(/\{\{time\}\}/g, r.timeSlot ?? "")
      : `Hello ${name}, this is a reminder of your appointment at Care Diagnostics on ${tomorrow}${r.timeSlot ? ` at ${r.timeSlot}` : ""}. Please arrive 10 minutes early. Reply here if you need to reschedule.`;
    const res = await sendWhatsAppNow({
      recipientPhone: r.phone,
      messagePurpose: "appointment_reminder",
      text: body,
      patientId: r.patientId,
      appointmentId: r.appointmentId,
      idempotencyKey: `appointment_reminder:${r.appointmentId}:${tomorrow}`,
    });
    if (res.ok) sent++; else failed++;
  }
  return { sent, failed, total: rows.length };
}

/**
 * Send WhatsApp dues reminders to patients whose total outstanding balance
 * (across all active, non-cancelled bills) is at/above
 * whatsapp_settings.duesReminderMinAmount. Driven by a daily cron at
 * whatsapp_settings.duesReminderTime. One consolidated message per patient.
 */
export async function runDuesReminders(): Promise<ReminderRunResult> {
  const s = await getOrCreateSettings();
  if (!s.enabled) return { skipped: true, reason: "WhatsApp disabled", sent: 0, failed: 0, total: 0 };
  if (!s.duesReminderEnabled) return { skipped: true, reason: "Dues reminders disabled", sent: 0, failed: 0, total: 0 };
  const cfg = await resolveDefaultNumber();
  if (!cfg) return { skipped: true, reason: "WhatsApp settings incomplete", sent: 0, failed: 0, total: 0 };

  const minAmount = Math.max(0, s.duesReminderMinAmount ?? 0);

  const rows = await db
    .select({
      patientId: billsTable.patientId,
      firstName: patientsTable.firstName,
      lastName: patientsTable.lastName,
      phone: patientsTable.phone,
      balance: billsTable.balanceAmount,
      refund: billsTable.refundAmount,
    })
    .from(billsTable)
    .innerJoin(patientsTable, eq(billsTable.patientId, patientsTable.id))
    .where(and(
      inArray(billsTable.status, ["pending", "partial"]),
      isNull(billsTable.cancelledAt),
    ));

  // Aggregate outstanding per patient. trueOutstanding mirrors the My Daily
  // Summary convention: MAX(0, balance − refund) so refunded amounts don't
  // inflate what we chase.
  const byPatient = new Map<number, { name: string; phone: string; total: number }>();
  for (const r of rows) {
    const bal = Math.max(0, Number(r.balance ?? 0) - Math.max(0, Number(r.refund ?? 0)));
    if (bal <= 0) continue;
    const existing = byPatient.get(r.patientId);
    if (existing) {
      existing.total += bal;
    } else {
      byPatient.set(r.patientId, { name: `${r.firstName} ${r.lastName}`.trim(), phone: r.phone, total: bal });
    }
  }

  let sent = 0, failed = 0, total = 0;
  for (const [patientId, p] of byPatient.entries()) {
    if (p.total < minAmount) continue;
    total++;
    const amt = `₹${p.total.toFixed(2)}`;
    const tpl = (s.duesReminderTemplate || "").trim();
    const body = tpl
      ? tpl.replace(/\{\{name\}\}/g, p.name).replace(/\{\{amount\}\}/g, amt)
      : `Hello ${p.name}, our records show an outstanding balance of ${amt} at Care Diagnostics. Kindly clear your dues at your earliest convenience. Please ignore this message if already paid. — Care Diagnostics`;
    const res = await sendWhatsAppNow({
      recipientPhone: p.phone,
      messagePurpose: "dues_reminder",
      text: body,
      patientId,
      idempotencyKey: `dues_reminder:${patientId}:${todayIST()}`,
    });
    if (res.ok) sent++; else failed++;
  }
  return { sent, failed, total };
}

// ─── Webhook body types ────────────────────────────────────────────────────────

interface WhatsappWebhookBody {
  object?: string;
  entry?: {
    id: string;
    changes?: {
      field: string;
      value: {
        metadata?: { phone_number_id?: string };
        contacts?: { wa_id: string; profile?: { name?: string } }[];
        messages?: {
          id: string;
          from: string;
          type: string;
          text?: { body?: string };
          image?: { id: string; mime_type?: string; caption?: string };
          timestamp: string;
        }[];
      };
    }[];
  }[];
}

export default whatsappRouter;
