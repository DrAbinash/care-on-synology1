// =============================================================================
// n8n -> CARE internal automation API for WhatsApp.
//
// Non-negotiable architecture (see the WhatsApp Cloud API build spec):
//   n8n (separate Docker) -> authenticated CARE internal API -> CARE
//   validates business rules/consent/idempotency -> CARE WhatsApp outbox ->
//   Meta Cloud API -> Meta webhook -> CARE delivery/read/failure records.
//
// n8n calls the routes below on its own schedule. It never touches CARE's
// Postgres directly, never stores WhatsApp credentials, never renders the
// final patient message, and never decides consent/eligibility — every
// route here triggers EXISTING, already-idempotent CARE business logic
// (runAppointmentReminders, runDuesReminders, runReportDeliveryReminders,
// dispatchPendingWaOutbox), each of which itself goes through the single
// enqueueWhatsAppMessage() chokepoint (WhatsAppOutbox.ts) for every safety
// check. n8n cannot pass arbitrary patient message text — every endpoint
// here is a fixed trigger, not a generic "send this" API.
//
// Auth is a DEDICATED service credential (WHATSAPP_AUTOMATION_SECRET),
// deliberately separate from CRON_SECRET (internal-cron.ts) so a leaked
// WhatsApp automation token cannot also trigger backups/restore-verification,
// and vice versa. Same weak-secret-fails-closed + constant-time-compare
// pattern as internal-cron.ts (see lib/secretStrength.ts) — a router this
// exposed to the public internet must never be guarded by a default value.
// =============================================================================
import { Router, type Request, type Response, type NextFunction } from "express";
import crypto from "node:crypto";
import { checkSecretStrength, weakSecretMessage } from "../lib/secretStrength";
import { isFeatureEnabledServer } from "../lib/featureFlags";
import { dispatchPendingWaOutbox, getWaOutboxHealth, WHATSAPP_FEATURE_FLAG } from "../services/whatsapp/WhatsAppOutbox";
import { getWhatsAppService } from "../services/whatsapp/WhatsAppService";
import { logger } from "../lib/logger";

const router = Router();

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

let weakSecretLogged = false;

/** Same fail-closed shape as internal-cron.ts's requireCronSecret, against a
 *  DIFFERENT env var — see the module comment for why the two are separate. */
function requireAutomationSecret(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env["WHATSAPP_AUTOMATION_SECRET"];
  const weakness = checkSecretStrength(expected);
  if (weakness) {
    if (!weakSecretLogged) {
      weakSecretLogged = true;
      console.error(weakSecretMessage("WHATSAPP_AUTOMATION_SECRET", weakness));
    }
    res.status(503).json({ error: weakSecretMessage("WHATSAPP_AUTOMATION_SECRET", weakness) });
    return;
  }
  const secret = expected as string;
  const header = req.header("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!safeEqual(provided, secret)) {
    void getWhatsAppService().logAudit({
      action: "n8n_automation_auth_failed", provider: "n8n", status: "rejected",
      details: `${req.method} ${req.path}`,
    }).catch(() => {});
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

router.use(requireAutomationSecret);

async function auditTrigger(action: string, result: unknown): Promise<void> {
  try {
    await getWhatsAppService().logAudit({
      action, provider: "n8n", status: "triggered",
      details: JSON.stringify(result).slice(0, 500),
    });
  } catch { /* audit logging must never fail the trigger itself */ }
}

/**
 * Health probe — safe for n8n to poll frequently to decide whether to keep
 * calling the dispatch endpoints. Never returns secrets, tokens, or
 * unredacted PHI; outbox counts and timestamps only.
 */
router.get("/health", async (_req, res) => {
  try {
    const flagOn = await isFeatureEnabledServer(WHATSAPP_FEATURE_FLAG);
    const outbox = await getWaOutboxHealth();
    res.json({ ok: true, featureEnabled: flagOn, outbox, at: new Date().toISOString() });
  } catch (err) {
    logger.error({ err }, "internal-automations-whatsapp health check failed");
    res.status(500).json({ ok: false, error: "health check failed" });
  }
});

/**
 * Drains queued/retry-scheduled wa_outbox rows toward Meta. This is the
 * ONLY thing that makes retries and quiet-hours-deferred messages actually
 * go out eventually — sendWhatsAppNow's inline attempt only covers the
 * FIRST try. n8n is expected to call this on a short interval (e.g. every
 * 1-5 minutes); safe to call concurrently or overlapping thanks to the
 * dispatcher's FOR UPDATE SKIP LOCKED claim.
 */
router.post("/dispatch-outbox", async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.body?.limit) || 20));
    const result = await dispatchPendingWaOutbox({ limit, workerId: "n8n-dispatch" });
    await auditTrigger("n8n_dispatch_outbox", result);
    res.json({ ok: true, result, at: new Date().toISOString() });
  } catch (err) {
    logger.error({ err }, "internal-automations-whatsapp dispatch-outbox failed");
    res.status(500).json({ ok: false, error: "dispatch-outbox failed" });
  }
});

router.post("/dispatch-due-appointment-reminders", async (_req, res) => {
  try {
    const { runAppointmentReminders } = await import("./whatsapp");
    const result = await runAppointmentReminders();
    await auditTrigger("n8n_dispatch_appointment_reminders", result);
    res.json({ ok: true, result, at: new Date().toISOString() });
  } catch (err) {
    logger.error({ err }, "internal-automations-whatsapp dispatch-due-appointment-reminders failed");
    res.status(500).json({ ok: false, error: "dispatch-due-appointment-reminders failed" });
  }
});

router.post("/dispatch-report-ready-notifications", async (_req, res) => {
  try {
    const { runReportDeliveryReminders } = await import("./reportDeliveryTracking");
    const result = await runReportDeliveryReminders();
    await auditTrigger("n8n_dispatch_report_ready", result);
    res.json({ ok: true, result, at: new Date().toISOString() });
  } catch (err) {
    logger.error({ err }, "internal-automations-whatsapp dispatch-report-ready-notifications failed");
    res.status(500).json({ ok: false, error: "dispatch-report-ready-notifications failed" });
  }
});

/**
 * "Payment reminders" in this codebase's existing business logic is the
 * outstanding-dues reminder job (runDuesReminders) — there is no separate
 * payment-specific batch job today. Named to match the n8n contract; maps
 * onto the existing, already-idempotent dues reminder run.
 */
router.post("/dispatch-payment-reminders", async (_req, res) => {
  try {
    const { runDuesReminders } = await import("./whatsapp");
    const result = await runDuesReminders();
    await auditTrigger("n8n_dispatch_payment_reminders", result);
    res.json({ ok: true, result, at: new Date().toISOString() });
  } catch (err) {
    logger.error({ err }, "internal-automations-whatsapp dispatch-payment-reminders failed");
    res.status(500).json({ ok: false, error: "dispatch-payment-reminders failed" });
  }
});

export default router;
