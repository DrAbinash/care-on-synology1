import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { whatsappSettingsTable, whatsappNumbersTable, whatsappConversationsTable, clinicSettingsTable, appointmentsTable, billsTable } from "@workspace/db/schema";
// NOTE: patientsTable is imported lower in this file (near the Form F image
// handler); it is module-scoped and reused by the reminder queries below.
import { eq, desc, sql, ilike, and, inArray, isNull } from "drizzle-orm";
import { requireStaffPermission } from "../middleware/requireStaffAuth";
import { encryptSecret, decryptSecretTolerant } from "../lib/cryptoUtils";
import { todayIST } from "../lib/istDate";
import { getWhatsAppService } from "../services/whatsapp/WhatsAppService";
import { WhatsAppBotEngine } from "../services/whatsapp/WhatsAppBotEngine";

// Shared with routes/waChatbot.ts's webhook — see the note above
// handleAiReply below for why this webhook now delegates to the same
// engine instead of running its own separate, divergent logic.
const sharedWaService = getWhatsAppService();
const sharedBotEngine = new WhatsAppBotEngine(sharedWaService);

export const whatsappRouter: IRouter = Router();
export const whatsappWebhookRouter: IRouter = Router();

async function getOrCreateSettings() {
  const [row] = await db.select().from(whatsappSettingsTable).limit(1);
  if (row) return { ...row, accessToken: decryptSecretTolerant(row.accessToken) };
  const [created] = await db.insert(whatsappSettingsTable).values({}).returning();
  return { ...created, accessToken: decryptSecretTolerant(created.accessToken) };
}

// ── Number config helper ──
interface NumberConfig {
  phoneNumberId: string;
  accessToken: string;
}

/** Resolve the number that should be used for a given role.
 *  If numbers table has entries, pick the first enabled number matching the role.
 *  Falls back to the legacy global settings if no numbers exist. */
export async function resolveNumber(role: string): Promise<NumberConfig | null> {
  const numbers = await db.select().from(whatsappNumbersTable).where(eq(whatsappNumbersTable.enabled, true));
  const match = numbers.find((n) => n.role === role) ?? numbers.find((n) => n.isDefault);
  if (match && match.phoneNumberId && match.accessToken) {
    return { phoneNumberId: match.phoneNumberId, accessToken: decryptSecretTolerant(match.accessToken) };
  }
  // Legacy fallback
  const s = await getOrCreateSettings();
  if (s.phoneNumberId && s.accessToken) {
    return { phoneNumberId: s.phoneNumberId, accessToken: s.accessToken };
  }
  return null;
}

async function resolveDefaultNumber(): Promise<NumberConfig | null> {
  return resolveNumber("general");
}

// ─── Existing Settings & Send Routes ──────────────────────────────────────────

whatsappRouter.get("/settings", async (_req, res) => {
  const s = await getOrCreateSettings();
  res.json({ ...s, accessToken: s.accessToken ? "••••••••" : "" });
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
  const [row] = await db.update(whatsappSettingsTable).set(updates).where(eq(whatsappSettingsTable.id, current.id)).returning();
  res.json({ ...row, accessToken: row.accessToken ? "••••••••" : "" });
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
  const cfg: NumberConfig = { phoneNumberId: num.phoneNumberId, accessToken: decryptSecretTolerant(num.accessToken) };
  if (!cfg.phoneNumberId || !cfg.accessToken) { res.status(400).json({ error: "Number missing credentials" }); return; }

  const s = await getOrCreateSettings();
  const to = normalizePhone(phone, s.defaultCountryCode);
  if (!to) { res.status(400).json({ error: "Invalid phone" }); return; }

  const result = await sendTextMessageRaw(to, `Test message from Care Diagnostics via number: ${num.name || num.displayNumber || num.phoneNumberId}`, cfg);
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

whatsappWebhookRouter.post("/", async (req: Request, res: Response): Promise<void> => {
  // Always respond 200 immediately to prevent Meta from retrying
  res.status(200).json({ status: "ok" });

  try {
    const body = req.body as WhatsappWebhookBody;
    if (body.object !== "whatsapp_business_account") return;

    const s = await getOrCreateSettings();

    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== "messages") continue;
        const value = change.value;
        // Meta includes the receiving phone number ID in metadata
        const receivingPhoneNumberId = (value.metadata as { phone_number_id?: string } | undefined)?.phone_number_id ?? "";

        // Resolve the number config for routing
        let numCfg: NumberConfig | null = null;
        let numRole = "general";
        if (receivingPhoneNumberId) {
          const numbers = await db.select().from(whatsappNumbersTable).where(eq(whatsappNumbersTable.enabled, true));
          const matched = numbers.find((n) => n.phoneNumberId === receivingPhoneNumberId);
          if (matched) {
            numCfg = { phoneNumberId: matched.phoneNumberId, accessToken: decryptSecretTolerant(matched.accessToken) };
            numRole = matched.role;
          }
        }
        // Fallback to legacy settings
        if (!numCfg && s.phoneNumberId && s.accessToken) {
          numCfg = { phoneNumberId: s.phoneNumberId, accessToken: s.accessToken };
        }

        for (const msg of value.messages ?? []) {
          const phone = msg.from;
          const waId  = msg.id;
          const name  = value.contacts?.find((c) => c.wa_id === phone)?.profile?.name ?? "";

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
                  await sendTextMessageRaw(phone, reply.text, numCfg);
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

  // 1. Download image via Meta media API
  let imageBuf: Buffer | null = null;
  try {
    const metaUrl = `https://graph.facebook.com/v20.0/${encodeURIComponent(mediaId)}?access_token=${encodeURIComponent(numCfg.accessToken)}`;
    const metaResp = await fetch(metaUrl);
    if (!metaResp.ok) throw new Error(`Meta media info failed: ${metaResp.status}`);
    const metaData = await metaResp.json() as { url?: string };
    if (!metaData.url) throw new Error("No media URL from Meta");
    const imgResp = await fetch(metaData.url, { headers: { Authorization: `Bearer ${numCfg.accessToken}` } });
    if (!imgResp.ok) throw new Error(`Image download failed: ${imgResp.status}`);
    imageBuf = Buffer.from(await imgResp.arrayBuffer());
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
  const url = `https://graph.facebook.com/v20.0/${encodeURIComponent(cfg.phoneNumberId)}/messages`;
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
      return sendTextMessageRaw(to, body, { phoneNumberId: num.phoneNumberId, accessToken: decryptSecretTolerant(num.accessToken) });
    }
  }
  if (s.accessToken && s.phoneNumberId) {
    return sendTextMessageRaw(to, body, { phoneNumberId: s.phoneNumberId, accessToken: decryptSecretTolerant(s.accessToken) });
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
 * Send an arbitrary free-text WhatsApp message to a phone number using the
 * clinic's configured default number (DB-backed settings, same stack as
 * report delivery). Used for patient login OTP codes — a session text, so it
 * needs no pre-approved template. Returns ok:false (never throws) when
 * WhatsApp is disabled/unconfigured or the send fails.
 */
export async function sendPlainWhatsappText(
  phone: string,
  body: string,
): Promise<{ ok: boolean; skipped?: boolean; error?: string; messageId?: string }> {
  const s = await getOrCreateSettings();
  if (!s.enabled) return { ok: false, skipped: true, error: "WhatsApp disabled" };
  const cfg = await resolveDefaultNumber();
  if (!cfg) return { ok: false, error: "WhatsApp settings incomplete" };
  const to = normalizePhone(phone, s.defaultCountryCode);
  if (!to) return { ok: false, error: "Invalid phone" };

  const url = `https://graph.facebook.com/v20.0/${encodeURIComponent(cfg.phoneNumberId)}/messages`;
  const payload = { messaging_product: "whatsapp", to, type: "text", text: { body } };
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await resp.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
    if (!resp.ok) return { ok: false, error: data.error?.message || `HTTP ${resp.status}` };
    return { ok: true, messageId: data.messages?.[0]?.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Send failed" };
  }
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
  // Master WhatsApp switch AND the discrete "on bill created" automation toggle
  // must both be on. autoSendBillCreated defaults true so existing behaviour is
  // preserved; admins can now silence bill messages without disabling WhatsApp.
  if (!s.enabled || s.autoSendBillCreated === false) return { ok: false, skipped: true };

  let cfg: NumberConfig | null = null;
  if (params.numberId) {
    const [num] = await db.select().from(whatsappNumbersTable).where(eq(whatsappNumbersTable.id, params.numberId)).limit(1);
    if (num && num.phoneNumberId && num.accessToken) cfg = { phoneNumberId: num.phoneNumberId, accessToken: decryptSecretTolerant(num.accessToken) };
  }
  if (!cfg) cfg = await resolveDefaultNumber();
  if (!cfg) {
    return { ok: false, error: "WhatsApp settings incomplete" };
  }
  const to = normalizePhone(params.phone, s.defaultCountryCode);
  if (!to) return { ok: false, error: "Invalid phone" };

  const url = `https://graph.facebook.com/v20.0/${encodeURIComponent(cfg.phoneNumberId)}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: s.templateName,
      language: { code: s.templateLang || "en" },
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
  };

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${cfg.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = (await resp.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
    if (!resp.ok) {
      return { ok: false, error: data.error?.message || `HTTP ${resp.status}` };
    }
    return { ok: true, messageId: data.messages?.[0]?.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Send failed" };
  }
}

export async function sendReportWhatsapp(params: {
  phone: string;
  patientName: string;
  reportNumber: string;
  testName: string;
  reportUrl: string;
  numberId?: number;
}): Promise<{ ok: boolean; skipped?: boolean; error?: string; messageId?: string }> {
  const s = await getOrCreateSettings();
  if (!s.enabled) return { ok: false, skipped: true };

  let cfg: NumberConfig | null = null;
  if (params.numberId) {
    const [num] = await db.select().from(whatsappNumbersTable).where(eq(whatsappNumbersTable.id, params.numberId)).limit(1);
    if (num && num.phoneNumberId && num.accessToken) cfg = { phoneNumberId: num.phoneNumberId, accessToken: decryptSecretTolerant(num.accessToken) };
  }
  if (!cfg) cfg = await resolveDefaultNumber();
  if (!cfg) {
    return { ok: false, error: "WhatsApp settings incomplete" };
  }
  const to = normalizePhone(params.phone, s.defaultCountryCode);
  if (!to) return { ok: false, error: "Invalid phone" };

  const url = `https://graph.facebook.com/v20.0/${encodeURIComponent(cfg.phoneNumberId)}/messages`;

  if (s.templateName) {
    const tplPayload = {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: s.templateName,
        language: { code: s.templateLang || "en" },
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
    };
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(tplPayload),
      });
      const data = (await resp.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
      if (resp.ok) return { ok: true, messageId: data.messages?.[0]?.id };
    } catch { /* fall through to text fallback */ }
  }

  const textPayload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: `Hello ${params.patientName}, your ${params.testName} report (${params.reportNumber}) is ready. View: ${params.reportUrl}` },
  };
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(textPayload),
    });
    const data = (await resp.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
    if (!resp.ok) return { ok: false, error: data.error?.message || `HTTP ${resp.status}` };
    return { ok: true, messageId: data.messages?.[0]?.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Send failed" };
  }
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
  if (!s.enabled) return { ok: false, skipped: true };

  let cfg: NumberConfig | null = null;
  if (params.numberId) {
    const [num] = await db.select().from(whatsappNumbersTable).where(eq(whatsappNumbersTable.id, params.numberId)).limit(1);
    if (num && num.phoneNumberId && num.accessToken) cfg = { phoneNumberId: num.phoneNumberId, accessToken: decryptSecretTolerant(num.accessToken) };
  }
  if (!cfg) cfg = await resolveDefaultNumber();
  if (!cfg) return { ok: false, error: "WhatsApp settings incomplete" };

  const to = normalizePhone(params.phone, s.defaultCountryCode);
  if (!to) return { ok: false, error: "Invalid phone" };

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

  const result = await sendTextMessageRaw(to, body, cfg);
  return result;
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
    const to = normalizePhone(r.phone, s.defaultCountryCode);
    if (!to) { failed++; continue; }
    const tpl = (s.appointmentReminderTemplate || "").trim();
    const body = tpl
      ? tpl.replace(/\{\{name\}\}/g, name).replace(/\{\{date\}\}/g, tomorrow).replace(/\{\{time\}\}/g, r.timeSlot ?? "")
      : `Hello ${name}, this is a reminder of your appointment at Care Diagnostics on ${tomorrow}${r.timeSlot ? ` at ${r.timeSlot}` : ""}. Please arrive 10 minutes early. Reply here if you need to reschedule.`;
    const res = await sendTextMessageRaw(to, body, cfg);
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
  for (const p of byPatient.values()) {
    if (p.total < minAmount) continue;
    total++;
    const to = normalizePhone(p.phone, s.defaultCountryCode);
    if (!to) { failed++; continue; }
    const amt = `₹${p.total.toFixed(2)}`;
    const tpl = (s.duesReminderTemplate || "").trim();
    const body = tpl
      ? tpl.replace(/\{\{name\}\}/g, p.name).replace(/\{\{amount\}\}/g, amt)
      : `Hello ${p.name}, our records show an outstanding balance of ${amt} at Care Diagnostics. Kindly clear your dues at your earliest convenience. Please ignore this message if already paid. — Care Diagnostics`;
    const res = await sendTextMessageRaw(to, body, cfg);
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
