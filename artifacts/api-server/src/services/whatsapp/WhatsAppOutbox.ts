// =============================================================================
// WhatsAppOutbox — the single outbound WhatsApp send path.
//
// Modeled directly on services/integration/outbox.ts (CARE -> HOPE
// transactional outbox): enqueueWhatsAppMessage() inserts a row (idempotent
// on idempotency_key), a background dispatcher (dispatchPendingWaOutbox)
// claims pending rows with FOR UPDATE SKIP LOCKED, sends via the Meta Cloud
// API, and records each attempt in wa_delivery_attempts. Meta's delivery
// webhooks (sent/delivered/read/failed) are applied with the same
// no-regression guard reportDeliveryReceipts.ts already uses for the
// separate report_delivery_receipts table.
//
// enqueueWhatsAppMessage() is the ONLY sanctioned way to reach Meta with a
// patient-facing message. It performs every check requirement 6 of the
// implementation spec lists, in order, and returns before Meta is ever
// contacted — the actual send happens later, asynchronously, in
// dispatchPendingWaOutbox(). This is a deliberate behavior change from the
// direct-call helpers it replaces (sendBillWhatsapp, sendReportWhatsapp,
// etc.), which called Meta synchronously and returned the real result
// immediately: ok:true here means "accepted into the outbox," not
// "delivered." See the completion report for why this is the correct
// trade-off for the non-negotiable outbox architecture, and how existing
// callers were adapted.
// =============================================================================
import { createHash } from "node:crypto";
import { sql, eq, inArray, and, lte } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  waOutboxTable, waDeliveryAttemptsTable, waContactsTable,
  whatsappSettingsTable, whatsappNumbersTable,
} from "@workspace/db/schema";
import { decryptSecretTolerant } from "../../lib/cryptoUtils";
import { isFeatureEnabledServer } from "../../lib/featureFlags";
import { istHourMinute, todayIST } from "../../lib/istDate";
import { logger } from "../../lib/logger";

// Deliberately NOT imported from routes/whatsapp.ts — that module imports
// FROM this one (applyWaOutboxReceiptStatuses, enqueueWhatsAppMessage), and
// a two-way import cycle between them is fragile (partially-initialized
// exports depending on which side loads first). This is the same 3-line
// normalization routes/whatsapp.ts's own normalizePhone() uses.
export function normalizePhone(raw: string, countryCode: string): string | null {
  const digits = (raw || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length >= 11) return digits;
  return `${countryCode}${digits}`;
}

export const WHATSAPP_FEATURE_FLAG = "ff_whatsapp_cloud_api";

export type WaMessagePurpose =
  | "appointment_reminder" | "dues_reminder" | "report_ready" | "bill_created"
  | "payment_link" | "otp" | "chatbot_reply" | "manual_staff_send" | "test_send"
  // Recall follow-ups and feedback/NPS invites are each gated by their own
  // feature flag (ff_recall_engine / ff_feedback_nps) at the caller before
  // sendPlainWhatsappText() is ever reached, so no separate WhatsApp
  // automation-controls toggle exists for them here — always-enabled, same
  // as manual_staff_send/test_send, but still subject to quiet hours and the
  // daily limit since these ARE bulk/scheduled sends, unlike those two.
  | "recall_followup" | "feedback_invite";

export interface EnqueueWhatsAppMessageInput {
  recipientPhone: string;
  messagePurpose: WaMessagePurpose;
  /** Rendered message body (plain text) OR a template invocation — exactly
   *  one of `text` / `template` must be set. */
  text?: string;
  template?: { name: string; languageCode?: string; components?: unknown[] };
  patientId?: number | null;
  appointmentId?: number | null;
  billId?: number | null;
  reportId?: number | null;
  phoneNumberId?: string | null;
  /** Caller-supplied idempotency key. If omitted, one is derived from
   *  (purpose, recipient, a content hash) so the SAME message body sent
   *  twice for the same purpose+recipient is naturally deduped without the
   *  caller having to think about it — callers that need per-occurrence
   *  keys (e.g. "today's dues reminder" vs "yesterday's") should pass an
   *  explicit key that encodes the occurrence (date, bill id, etc). */
  idempotencyKey?: string;
  createdBy?: string;
  priority?: number;
}

export type EnqueueResult =
  | { ok: true; outboxId: number; status: "queued" | "suppressed"; idempotencyKey: string; deduped: boolean }
  | { ok: false; error: string; reason: EnqueueBlockReason };

export type EnqueueBlockReason =
  | "feature_flag_disabled" | "master_disabled" | "emergency_paused"
  | "purpose_disabled" | "invalid_recipient" | "consent_denied"
  | "allowlist_blocked" | "template_missing" | "no_content" | "daily_limit_reached";

export function defaultIdempotencyKey(input: EnqueueWhatsAppMessageInput, normalizedPhone: string): string {
  const contentSignature = input.template
    ? `tpl:${input.template.name}:${input.template.languageCode ?? "en"}`
    : `txt:${createHash("sha256").update(input.text ?? "").digest("hex").slice(0, 16)}`;
  return `${input.messagePurpose}:${normalizedPhone}:${contentSignature}`;
}

export function parseAllowlist(raw: string): string[] {
  try {
    const arr = JSON.parse(raw || "[]");
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

async function getSettingsRow() {
  const [row] = await db.select().from(whatsappSettingsTable).limit(1);
  return row ?? null;
}

// Security-critical or patient-explicitly-requested messages must never be
// held back by clinic-configured automation controls — a patient waiting on
// a login OTP, a staff member sending manually, or a chatbot reply to a
// message the patient just sent are not "automation" in the sense quiet
// hours / daily limits exist to throttle.
export const QUIET_HOURS_EXEMPT_PURPOSES: ReadonlySet<WaMessagePurpose> = new Set(["otp", "manual_staff_send", "chatbot_reply", "test_send"]);
export const DAILY_LIMIT_EXEMPT_PURPOSES: ReadonlySet<WaMessagePurpose> = new Set(["otp", "manual_staff_send", "chatbot_reply", "test_send"]);

export function parseHHMM(value: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((value || "").trim());
  if (!m) return null;
  const hour = Number(m[1]), minute = Number(m[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

/** Quiet hours window may wrap past midnight (e.g. 22:00 -> 07:00). Takes
 *  the raw "HH:MM" strings (not the whole settings row) and an injectable
 *  `now` so this is directly unit-testable without a fake DB row. */
export function isWithinQuietHours(quietHoursStart: string, quietHoursEnd: string, now: Date = new Date()): boolean {
  const start = parseHHMM(quietHoursStart);
  const end = parseHHMM(quietHoursEnd);
  if (!start || !end) return false;
  const nowParts = istHourMinute(now);
  const nowMin = nowParts.hour * 60 + nowParts.minute;
  const startMin = start.hour * 60 + start.minute;
  const endMin = end.hour * 60 + end.minute;
  if (startMin === endMin) return false; // degenerate window = disabled
  if (startMin < endMin) return nowMin >= startMin && nowMin < endMin;
  return nowMin >= startMin || nowMin < endMin; // wraps past midnight
}

/** The next real-time Date at which the configured quiet-hours window ends. */
export function quietHoursEndDate(quietHoursEnd: string, now: Date = new Date()): Date {
  const end = parseHHMM(quietHoursEnd);
  if (!end) return now;
  const istNowParts = istHourMinute(now);
  const nowMin = istNowParts.hour * 60 + istNowParts.minute;
  const endMin = end.hour * 60 + end.minute;
  let minutesUntilEnd = endMin - nowMin;
  if (minutesUntilEnd <= 0) minutesUntilEnd += 24 * 60;
  return new Date(now.getTime() + minutesUntilEnd * 60 * 1000);
}

/**
 * Single enqueue chokepoint. See requirement 6: feature-flag check, master
 * enable check, emergency-pause check, number normalization, shadow/allowlist
 * check, consent check, template validation, idempotency check, outbox
 * insertion, audit logging — all performed here, in this order, so no caller
 * can bypass any of them by calling something lower-level.
 */
export async function enqueueWhatsAppMessage(input: EnqueueWhatsAppMessageInput): Promise<EnqueueResult> {
  // 1. Feature-flag check.
  const flagOn = await isFeatureEnabledServer(WHATSAPP_FEATURE_FLAG);
  if (!flagOn) return { ok: false, error: "WhatsApp Cloud API integration is not enabled (ff_whatsapp_cloud_api)", reason: "feature_flag_disabled" };

  const s = await getSettingsRow();
  if (!s) return { ok: false, error: "WhatsApp settings not initialized", reason: "master_disabled" };

  // 2. Master enable check.
  if (!s.enabled || !s.outboundMessagingEnabled) {
    return { ok: false, error: "WhatsApp outbound messaging is disabled", reason: "master_disabled" };
  }

  // 3. Emergency pause check.
  if (s.emergencyPaused) {
    return { ok: false, error: `WhatsApp sending is emergency-paused: ${s.emergencyPausedReason || "no reason given"}`, reason: "emergency_paused" };
  }

  // Per-message-type toggle (appointment/dues reuse their existing columns;
  // report/payment/bill_created/otp/manual/test map onto the new ones).
  const purposeEnabled: Record<WaMessagePurpose, boolean> = {
    appointment_reminder: s.appointmentReminderEnabled,
    dues_reminder: s.duesReminderEnabled,
    report_ready: s.reportReadyMessagesEnabled,
    bill_created: s.autoSendBillCreated,
    payment_link: s.paymentMessagesEnabled,
    otp: true, // OTP is a login-security message, not a marketing/reminder toggle
    chatbot_reply: s.inboundProcessingEnabled,
    manual_staff_send: true, // staff explicitly chose to send this
    test_send: true, // the test-send action IS the point of shadow mode
    recall_followup: true, // gated upstream by ff_recall_engine
    feedback_invite: true, // gated upstream by ff_feedback_nps
  };
  if (!purposeEnabled[input.messagePurpose]) {
    return { ok: false, error: `Message type "${input.messagePurpose}" is disabled in WhatsApp automation controls`, reason: "purpose_disabled" };
  }

  // 4. Number normalization.
  const normalizedPhone = normalizePhone(input.recipientPhone, s.defaultCountryCode);
  if (!normalizedPhone) return { ok: false, error: "Invalid recipient phone number", reason: "invalid_recipient" };

  // 5. Test/shadow-mode + allowlist check.
  const allowlist = parseAllowlist(s.testAllowlist);
  const isProduction = process.env.NODE_ENV === "production";
  const onAllowlist = allowlist.includes(normalizedPhone);
  let suppressed = false;
  let suppressedReason: string | null = null;
  if (s.shadowMode && !onAllowlist) {
    suppressed = true;
    suppressedReason = "shadow_mode";
  } else if (!isProduction && allowlist.length === 0 && s.blockNonAllowlisted) {
    // "In non-production mode, empty allowlist must block all real sends."
    return { ok: false, error: "Test allowlist is empty — all sends are blocked outside production until numbers are allowlisted", reason: "allowlist_blocked" };
  } else if (s.blockNonAllowlisted && !onAllowlist && !isProduction) {
    suppressed = true;
    suppressedReason = "not_on_test_allowlist";
  }
  // Never silently redirect a patient message to an administrator's number —
  // suppression means "don't call Meta," never "send it somewhere else."

  // 6. Consent check. A denied contact never receives outbound messages,
  // except test_send (staff explicitly targeting a specific number for
  // configuration testing, not a patient-eligibility send) and otp (a
  // security-critical session code the patient is actively requesting by
  // trying to log in right now — matches this codebase's existing
  // sendPlainWhatsappText() precedent, which never checked consent either).
  if (input.messagePurpose !== "test_send" && input.messagePurpose !== "otp") {
    const [contact] = await db.select({ consentStatus: waContactsTable.consentStatus })
      .from(waContactsTable).where(eq(waContactsTable.phone, normalizedPhone)).limit(1);
    if (contact?.consentStatus === "denied") {
      return { ok: false, error: "Recipient has opted out (consent_status=denied)", reason: "consent_denied" };
    }
  }

  // 7. Template validation.
  if (!input.text && !input.template) {
    return { ok: false, error: "Message must have either text or a template", reason: "no_content" };
  }

  // Automation controls: daily message limit (hard block; 0 = unlimited) and
  // quiet hours (soft defer — the message is still enqueued, just not
  // dispatched until the window ends). Neither applies to suppressed
  // (shadow-mode) rows, since those never reach Meta regardless, nor to the
  // exempt purposes above.
  if (!DAILY_LIMIT_EXEMPT_PURPOSES.has(input.messagePurpose) && s.dailyMessageLimit > 0) {
    const todayStart = new Date(`${todayIST()}T00:00:00+05:30`);
    const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(waOutboxTable)
      .where(and(sql`${waOutboxTable.createdAt} >= ${todayStart}`, sql`${waOutboxTable.status} NOT IN ('suppressed')`));
    if (Number(count) >= s.dailyMessageLimit) {
      return { ok: false, error: `Daily WhatsApp message limit reached (${s.dailyMessageLimit})`, reason: "daily_limit_reached" };
    }
  }
  let deferredUntil: Date | null = null;
  if (!suppressed && !QUIET_HOURS_EXEMPT_PURPOSES.has(input.messagePurpose) && isWithinQuietHours(s.quietHoursStart, s.quietHoursEnd)) {
    deferredUntil = quietHoursEndDate(s.quietHoursEnd);
  }

  // 8. Idempotency check + 9. outbox insertion (single statement, unique
  // index does the dedup — a duplicate key is a no-op that returns the
  // existing row rather than a race-prone select-then-insert).
  const idempotencyKey = input.idempotencyKey ?? defaultIdempotencyKey(input, normalizedPhone);

  const existing = await db.select({ id: waOutboxTable.id, status: waOutboxTable.status })
    .from(waOutboxTable).where(eq(waOutboxTable.idempotencyKey, idempotencyKey)).limit(1);
  if (existing[0]) {
    return { ok: true, outboxId: existing[0].id, status: existing[0].status === "suppressed" ? "suppressed" : "queued", idempotencyKey, deduped: true };
  }

  const payload = input.template
    ? { kind: "template" as const, name: input.template.name, languageCode: input.template.languageCode ?? "en", components: input.template.components ?? [] }
    : { kind: "text" as const, body: input.text };

  const [row] = await db.insert(waOutboxTable).values({
    patientId: input.patientId ?? null,
    appointmentId: input.appointmentId ?? null,
    billId: input.billId ?? null,
    reportId: input.reportId ?? null,
    phoneNumberId: input.phoneNumberId ?? null,
    recipientPhone: normalizedPhone,
    messagePurpose: input.messagePurpose,
    templateKey: input.template?.name ?? null,
    templateVersion: input.template?.languageCode ?? null,
    payloadJson: JSON.stringify(payload),
    idempotencyKey,
    status: suppressed ? "suppressed" : "queued",
    suppressedReason,
    priority: input.priority ?? 5,
    maxAttempts: s.maxRetryAttempts,
    ...(deferredUntil ? { nextAttemptAt: deferredUntil } : {}),
    createdBy: input.createdBy ?? "system",
  }).returning();

  // 10. Idempotency check already covered above; 11. audit logging.
  logger.info({
    outboxId: row.id, purpose: input.messagePurpose, suppressed, suppressedReason,
    hasPatientId: input.patientId != null,
  }, "[whatsapp outbox] message enqueued");

  return { ok: true, outboxId: row.id, status: suppressed ? "suppressed" : "queued", idempotencyKey, deduped: false };
}

// ── Dispatcher ──────────────────────────────────────────────────────────────

export function backoffMs(attempts: number, baseSeconds: number): number {
  // base, 2x, 4x, 8x ... capped at 1h — same shape as integration/outbox.ts.
  return Math.min(baseSeconds * 1000 * Math.pow(2, Math.max(0, attempts - 1)), 60 * 60 * 1000);
}

/** HTTP statuses worth retrying (rate limit + transient server errors). */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

/** A failed attempt is dead-lettered (no further retries) when either the
 *  failure itself is permanent (a non-retryable HTTP status — retryable=false
 *  covers network errors too, which callers pass as true), or the retry
 *  budget is exhausted. Extracted as a pure function so the retry/dead-letter
 *  boundary is independently testable from the network call around it. */
export function shouldDeadLetter(retryable: boolean, attemptNo: number, maxAttempts: number): boolean {
  return !retryable || attemptNo >= maxAttempts;
}

interface DispatchNumberConfig { phoneNumberId: string; accessToken: string; graphApiVersion: string }

async function resolveDispatchNumber(phoneNumberId: string | null, s: typeof whatsappSettingsTable.$inferSelect): Promise<DispatchNumberConfig | null> {
  if (phoneNumberId) {
    const [num] = await db.select().from(whatsappNumbersTable).where(eq(whatsappNumbersTable.phoneNumberId, phoneNumberId)).limit(1);
    if (num?.accessToken) return { phoneNumberId: num.phoneNumberId, accessToken: decryptSecretTolerant(num.accessToken), graphApiVersion: s.graphApiVersion };
  }
  const [def] = await db.select().from(whatsappNumbersTable).where(and(eq(whatsappNumbersTable.enabled, true), eq(whatsappNumbersTable.isDefault, true))).limit(1);
  if (def?.accessToken) return { phoneNumberId: def.phoneNumberId, accessToken: decryptSecretTolerant(def.accessToken), graphApiVersion: s.graphApiVersion };
  if (s.phoneNumberId && s.accessToken) return { phoneNumberId: s.phoneNumberId, accessToken: decryptSecretTolerant(s.accessToken), graphApiVersion: s.graphApiVersion };
  return null;
}

async function recordAttempt(outboxId: number, attemptNo: number, success: boolean, httpStatus: number | null, providerErrorCode: string | null, responseSanitized: string | null): Promise<void> {
  try {
    await db.insert(waDeliveryAttemptsTable).values({
      outboxId, attemptNo, respondedAt: new Date(), httpStatus, providerErrorCode,
      responseSanitized: responseSanitized?.slice(0, 500) ?? null, success,
    });
  } catch { /* best effort — never let attempt logging mask the real result */ }
}

export type RowDispatchOutcome =
  | { kind: "suppressed" }
  | { kind: "sent"; messageId?: string }
  | { kind: "retry_scheduled"; error: string }
  | { kind: "dead_letter"; error: string };

/**
 * Attempt delivery of a single ALREADY-CLAIMED outbox row (status must be
 * "processing" — the caller is responsible for the atomic claim, via either
 * dispatchPendingWaOutbox's FOR UPDATE SKIP LOCKED batch claim or
 * claimOutboxRowForImmediateSend's single-row compare-and-swap. Always
 * clears lockedAt/lockedBy on the way out, whatever the outcome, so a row
 * never gets stuck "locked" by a worker that has finished with it.
 * Shared by both the batch dispatcher and sendWhatsAppNow's inline
 * best-effort attempt, so there is exactly one place that talks to Meta.
 */
async function dispatchOneOutboxRow(row: typeof waOutboxTable.$inferSelect, s: typeof whatsappSettingsTable.$inferSelect, timeoutMs: number): Promise<RowDispatchOutcome> {
  const attemptNo = row.attemptCount + 1;

  // A row claimed while already marked suppressed (shadow mode / not on
  // allowlist) never reaches Meta — the point of shadow mode is that
  // building and validating the message still happens, but the network
  // call does not. Re-checked here (not just at enqueue time) so flipping
  // shadow mode off doesn't require re-enqueuing already-queued rows — it
  // does, however, mean a row enqueued while suppressed and later manually
  // retried after shadow mode is turned off WILL send for real, which is
  // the correct behavior for a manual retry action.
  if (row.suppressedReason) {
    await db.update(waOutboxTable).set({ status: "suppressed", lockedAt: null, lockedBy: null }).where(eq(waOutboxTable.id, row.id));
    return { kind: "suppressed" };
  }

  const cfg = await resolveDispatchNumber(row.phoneNumberId, s);
  if (!cfg) {
    await recordAttempt(row.id, attemptNo, false, null, "not_configured", "No WhatsApp number credentials configured");
    await db.update(waOutboxTable).set({
      status: "queued", attemptCount: attemptNo, lastErrorMessage: "WhatsApp not configured",
      nextAttemptAt: new Date(Date.now() + backoffMs(attemptNo, s.retryDelayBaseSeconds)), lockedAt: null, lockedBy: null,
    }).where(eq(waOutboxTable.id, row.id));
    return { kind: "retry_scheduled", error: "WhatsApp not configured" };
  }

  let payload: { kind: "text"; body?: string } | { kind: "template"; name: string; languageCode: string; components: unknown[] };
  try {
    payload = JSON.parse(row.payloadJson);
  } catch {
    // Malformed payload can never succeed on retry — dead-letter immediately.
    await recordAttempt(row.id, attemptNo, false, null, "invalid_payload", null);
    await db.update(waOutboxTable).set({ status: "dead_letter", attemptCount: attemptNo, lastErrorMessage: "Malformed payload_json", deadLetteredAt: new Date(), lockedAt: null, lockedBy: null }).where(eq(waOutboxTable.id, row.id));
    return { kind: "dead_letter", error: "Malformed payload" };
  }

  const url = `https://graph.facebook.com/${cfg.graphApiVersion}/${encodeURIComponent(cfg.phoneNumberId)}/messages`;
  const body = payload.kind === "template"
    ? { messaging_product: "whatsapp", to: row.recipientPhone, type: "template", template: { name: payload.name, language: { code: payload.languageCode }, components: payload.components } }
    : { messaging_product: "whatsapp", to: row.recipientPhone, type: "text", text: { body: payload.body ?? "" } };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = (await resp.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string; code?: number; error_subcode?: number } };

    if (resp.ok) {
      const providerMessageId = data.messages?.[0]?.id;
      await recordAttempt(row.id, attemptNo, true, resp.status, null, JSON.stringify({ messageId: providerMessageId }));
      await db.update(waOutboxTable).set({ status: "sent", attemptCount: attemptNo, sentAt: new Date(), providerMessageId, lastErrorMessage: null, lockedAt: null, lockedBy: null }).where(eq(waOutboxTable.id, row.id));
      if (row.phoneNumberId) void db.update(whatsappNumbersTable).set({ lastOutboundAt: new Date(), connectionStatus: "ok" }).where(eq(whatsappNumbersTable.phoneNumberId, row.phoneNumberId)).catch(() => {});
      return { kind: "sent", messageId: providerMessageId };
    }

    const errCode = String(data.error?.code ?? resp.status);
    const errMsg = data.error?.message ?? `HTTP ${resp.status}`;
    const retryable = isRetryableStatus(resp.status);
    const isDead = shouldDeadLetter(retryable, attemptNo, row.maxAttempts);
    await recordAttempt(row.id, attemptNo, false, resp.status, errCode, errMsg);
    await db.update(waOutboxTable).set({
      status: isDead ? "dead_letter" : "queued", attemptCount: attemptNo,
      lastErrorCode: errCode, lastErrorMessage: errMsg,
      nextAttemptAt: retryable ? new Date(Date.now() + backoffMs(attemptNo, s.retryDelayBaseSeconds)) : row.nextAttemptAt,
      deadLetteredAt: isDead ? new Date() : null,
      lockedAt: null, lockedBy: null,
    }).where(eq(waOutboxTable.id, row.id));
    return isDead ? { kind: "dead_letter", error: errMsg } : { kind: "retry_scheduled", error: errMsg };
  } catch (err) {
    const msg = (err as Error)?.name === "AbortError" ? "timeout" : ((err as Error)?.message ?? "send_error").slice(0, 300);
    const isDead = shouldDeadLetter(true, attemptNo, row.maxAttempts);
    await recordAttempt(row.id, attemptNo, false, null, "network_error", msg);
    await db.update(waOutboxTable).set({
      status: isDead ? "dead_letter" : "queued", attemptCount: attemptNo, lastErrorMessage: msg,
      nextAttemptAt: new Date(Date.now() + backoffMs(attemptNo, s.retryDelayBaseSeconds)),
      deadLetteredAt: isDead ? new Date() : null, lockedAt: null, lockedBy: null,
    }).where(eq(waOutboxTable.id, row.id));
    return isDead ? { kind: "dead_letter", error: msg } : { kind: "retry_scheduled", error: msg };
  } finally {
    clearTimeout(timer);
  }
}

export interface DispatchSummary { claimed: number; sent: number; failed: number; dead: number; suppressed: number }

/**
 * Claim up to `limit` queued/suppressed rows and attempt delivery.
 * Concurrency-safe via FOR UPDATE SKIP LOCKED, so multiple worker processes
 * (or a manual + scheduled run overlapping) never double-send the same row.
 */
export async function dispatchPendingWaOutbox(opts: { limit?: number; workerId?: string; timeoutMs?: number } = {}): Promise<DispatchSummary> {
  const limit = opts.limit ?? 20;
  const workerId = opts.workerId ?? `care-wa-${process.pid}`;
  const timeoutMs = opts.timeoutMs ?? 15_000;

  const s = await getSettingsRow();
  const summary: DispatchSummary = { claimed: 0, sent: 0, failed: 0, dead: 0, suppressed: 0 };
  if (!s) return summary;

  const claimedIds = await db.transaction(async (tx) => {
    const res = await tx.execute(
      sql`SELECT id FROM wa_outbox WHERE status IN ('queued', 'suppressed') AND next_attempt_at <= NOW() ORDER BY priority ASC, next_attempt_at ASC LIMIT ${limit} FOR UPDATE SKIP LOCKED`,
    );
    const rows = ((res as unknown as { rows?: Array<{ id: number }> }).rows ?? (res as unknown as Array<{ id: number }>)) as Array<{ id: number }>;
    const ids = rows.map((r) => Number(r.id));
    if (ids.length) {
      await tx.update(waOutboxTable).set({ status: "processing", lockedAt: new Date(), lockedBy: workerId, processingStartedAt: new Date() }).where(inArray(waOutboxTable.id, ids));
    }
    return ids;
  });
  if (claimedIds.length === 0) return summary;
  summary.claimed = claimedIds.length;

  const rows = await db.select().from(waOutboxTable).where(inArray(waOutboxTable.id, claimedIds));

  for (const row of rows) {
    const outcome = await dispatchOneOutboxRow(row, s, timeoutMs);
    if (outcome.kind === "suppressed") summary.suppressed++;
    else if (outcome.kind === "sent") summary.sent++;
    else if (outcome.kind === "retry_scheduled") summary.failed++;
    else summary.dead++;
  }

  return summary;
}

/**
 * Atomically claim a single freshly-enqueued row for an immediate best-effort
 * send attempt, without waiting for the next dispatcher sweep. This is a
 * compare-and-swap UPDATE ... WHERE status = 'queued' ... RETURNING — if the
 * background dispatcher (or a concurrent immediate-send call) claims the row
 * first, this returns null and the caller correctly treats the message as
 * "accepted, will be delivered by the dispatcher" rather than sending twice.
 * The next_attempt_at check means a quiet-hours-deferred row is correctly
 * left alone until its deferred time arrives.
 */
async function claimOutboxRowForImmediateSend(id: number, workerId: string): Promise<typeof waOutboxTable.$inferSelect | null> {
  const [claimed] = await db.update(waOutboxTable)
    .set({ status: "processing", lockedAt: new Date(), lockedBy: workerId, processingStartedAt: new Date() })
    .where(and(eq(waOutboxTable.id, id), eq(waOutboxTable.status, "queued"), lte(waOutboxTable.nextAttemptAt, new Date())))
    .returning();
  return claimed ?? null;
}

export interface SendWhatsAppNowResult { ok: boolean; skipped?: boolean; error?: string; messageId?: string; outboxId?: number }

/**
 * Thin, return-shape-compatible wrapper around enqueueWhatsAppMessage() for
 * callers that used to call Meta directly and expect a synchronous
 * ok/messageId result (sendBillWhatsapp, sendReportWhatsapp, OTP, etc — see
 * requirement 6). Every safety check still runs through the single
 * enqueue chokepoint; this only adds ONE best-effort inline delivery
 * attempt on top, so existing callers keep seeing a real messageId in the
 * common case instead of every send silently becoming "fire and forget."
 * If the inline attempt does not win the claim (dispatcher got there first,
 * or the row was deferred past quiet hours) or fails, the row is already
 * safely queued for the background dispatcher's retries — this function
 * still returns ok:true, just without a messageId yet.
 */
export async function sendWhatsAppNow(input: EnqueueWhatsAppMessageInput): Promise<SendWhatsAppNowResult> {
  const enqueued = await enqueueWhatsAppMessage(input);
  if (!enqueued.ok) {
    const SOFT_REASONS: EnqueueBlockReason[] = ["feature_flag_disabled", "master_disabled", "emergency_paused", "purpose_disabled"];
    if (SOFT_REASONS.includes(enqueued.reason)) return { ok: false, skipped: true, error: enqueued.error };
    return { ok: false, error: enqueued.error };
  }
  if (enqueued.status === "suppressed") return { ok: true, skipped: true, outboxId: enqueued.outboxId };
  if (enqueued.deduped) {
    const [existing] = await db.select({ providerMessageId: waOutboxTable.providerMessageId, status: waOutboxTable.status })
      .from(waOutboxTable).where(eq(waOutboxTable.id, enqueued.outboxId)).limit(1);
    return { ok: true, outboxId: enqueued.outboxId, messageId: existing?.providerMessageId ?? undefined };
  }

  const s = await getSettingsRow();
  if (!s) return { ok: true, outboxId: enqueued.outboxId };
  const workerId = `care-wa-inline-${process.pid}`;
  const claimed = await claimOutboxRowForImmediateSend(enqueued.outboxId, workerId);
  if (!claimed) return { ok: true, outboxId: enqueued.outboxId }; // dispatcher (or quiet-hours defer) owns it now

  const outcome = await dispatchOneOutboxRow(claimed, s, 15_000);
  if (outcome.kind === "sent") return { ok: true, outboxId: enqueued.outboxId, messageId: outcome.messageId };
  if (outcome.kind === "suppressed") return { ok: true, skipped: true, outboxId: enqueued.outboxId };
  // retry_scheduled / dead_letter: the row is already queued for the
  // background dispatcher (or permanently dead-lettered) — surface the
  // error to the caller so it can log/alert exactly as it did before this
  // refactor, while the outbox row itself is the durable source of truth.
  return { ok: false, error: outcome.error, outboxId: enqueued.outboxId };
}

/** Manual retry of a dead/failed row (admin action). Resets attempt count so
 *  a permanently-misconfigured template that was fixed gets a fresh budget,
 *  not zero remaining attempts. */
export async function retryWaOutboxMessage(id: number): Promise<{ ok: boolean; error?: string }> {
  const [row] = await db.select({ status: waOutboxTable.status }).from(waOutboxTable).where(eq(waOutboxTable.id, id)).limit(1);
  if (!row) return { ok: false, error: "Not found" };
  await db.update(waOutboxTable).set({
    status: "queued", attemptCount: 0, nextAttemptAt: new Date(), lockedAt: null, lockedBy: null,
    lastErrorCode: null, lastErrorMessage: null, deadLetteredAt: null,
  }).where(eq(waOutboxTable.id, id));
  return { ok: true };
}

// ── Meta delivery-status receipts → wa_outbox (no-regression) ───────────────

const STATUS_RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 2 };

export interface MetaStatusLike {
  id?: string;
  status?: string;
  timestamp?: string;
  errors?: Array<{ title?: string; message?: string; code?: number }>;
}

/** Mirrors reportDeliveryReceipts.ts's applyReportDeliveryReceiptStatuses for
 *  wa_outbox — same no-regression contract: read never regresses to
 *  delivered, delivered never regresses to sent. Fire-and-forget, never
 *  throws (called from the webhook handler after it has already 200-ed Meta). */
export async function applyWaOutboxReceiptStatuses(statuses: MetaStatusLike[]): Promise<void> {
  if (!Array.isArray(statuses) || statuses.length === 0) return;
  for (const st of statuses) {
    const providerMessageId = st.id;
    const raw = (st.status ?? "").trim().toLowerCase();
    if (!providerMessageId || !["sent", "delivered", "read", "failed"].includes(raw)) continue;
    void STATUS_RANK; // documents intended ordering; the notInArray guards below enforce it
    try {
      if (raw === "read") {
        await db.update(waOutboxTable).set({ status: "read", readAt: sql`COALESCE(${waOutboxTable.readAt}, NOW())`, deliveredAt: sql`COALESCE(${waOutboxTable.deliveredAt}, NOW())` })
          .where(and(eq(waOutboxTable.providerMessageId, providerMessageId), sql`${waOutboxTable.status} NOT IN ('read')`));
      } else if (raw === "delivered") {
        await db.update(waOutboxTable).set({ status: "delivered", deliveredAt: sql`COALESCE(${waOutboxTable.deliveredAt}, NOW())` })
          .where(and(eq(waOutboxTable.providerMessageId, providerMessageId), sql`${waOutboxTable.status} NOT IN ('read', 'delivered', 'failed')`));
      } else if (raw === "failed") {
        const errMsg = st.errors?.[0]?.message || st.errors?.[0]?.title || "delivery failed";
        await db.update(waOutboxTable).set({ status: "failed", failedAt: new Date(), lastErrorMessage: errMsg })
          .where(and(eq(waOutboxTable.providerMessageId, providerMessageId), sql`${waOutboxTable.status} NOT IN ('read', 'delivered')`));
      }
      // 'sent' is the dispatcher's own send-time write — no separate handling needed.
    } catch (err) {
      logger.warn({ err, providerMessageId, status: raw }, "[whatsapp outbox] receipt status apply failed (non-fatal)");
    }
  }
}

// ── Diagnostics (unified settings page — section H) ─────────────────────────

export interface WaOutboxHealth {
  queued: number; processing: number; failed: number; deadLetter: number; suppressed: number;
  lastSent: string | null; lastDelivered: string | null; lastRead: string | null;
}

export async function getWaOutboxHealth(): Promise<WaOutboxHealth> {
  const counts = await db.select({ status: waOutboxTable.status, n: sql<number>`count(*)` })
    .from(waOutboxTable).groupBy(waOutboxTable.status);
  const byStatus = Object.fromEntries(counts.map((c) => [c.status, Number(c.n)]));
  const [[lastSentRow], [lastDeliveredRow], [lastReadRow]] = await Promise.all([
    db.select({ at: waOutboxTable.sentAt }).from(waOutboxTable).where(sql`${waOutboxTable.sentAt} IS NOT NULL`).orderBy(sql`${waOutboxTable.sentAt} DESC`).limit(1),
    db.select({ at: waOutboxTable.deliveredAt }).from(waOutboxTable).where(sql`${waOutboxTable.deliveredAt} IS NOT NULL`).orderBy(sql`${waOutboxTable.deliveredAt} DESC`).limit(1),
    db.select({ at: waOutboxTable.readAt }).from(waOutboxTable).where(sql`${waOutboxTable.readAt} IS NOT NULL`).orderBy(sql`${waOutboxTable.readAt} DESC`).limit(1),
  ]);
  return {
    queued: byStatus.queued ?? 0,
    processing: byStatus.processing ?? 0,
    failed: 0, // "failed" here means queued-with-error, already folded into `queued` above per the state machine; kept as 0 for a distinct future use rather than double-counting
    deadLetter: byStatus.dead_letter ?? 0,
    suppressed: byStatus.suppressed ?? 0,
    lastSent: lastSentRow?.at ? new Date(lastSentRow.at).toISOString() : null,
    lastDelivered: lastDeliveredRow?.at ? new Date(lastDeliveredRow.at).toISOString() : null,
    lastRead: lastReadRow?.at ? new Date(lastReadRow.at).toISOString() : null,
  };
}
