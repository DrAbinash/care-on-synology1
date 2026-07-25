import { Router, type Request, type Response, type NextFunction } from "express";
import crypto from "node:crypto";
import {
  runDailySummary,
  fireBankingAutoSync,
  runWhatsappAppointmentReminders,
  runWhatsappDuesReminders,
  fireScheduledBackups,
  runRestoreVerificationJob,
  runBackupDeadManCheck,
  runMonthlyReferralSummaryNow,
} from "../cron";
import { logger } from "../lib/logger";

const router = Router();

/** Constant-time string compare — same helper shape as plugin-loader.ts and
 *  requireSuperAdminUsb.ts, so secret comparison is uniform across the server. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function requireCronSecret(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env["CRON_SECRET"];
  if (!expected) {
    res.status(503).json({ error: "CRON_SECRET not configured on server" });
    return;
  }
  const header = req.header("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!safeEqual(provided, expected)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

router.use(requireCronSecret);

router.post("/daily-summary", async (_req, res) => {
  try {
    await runDailySummary();
    res.json({ ok: true, fired: "daily-summary", at: new Date().toISOString() });
  } catch (err) {
    logger.error({ err }, "internal-cron daily-summary failed");
    res.status(500).json({ error: "daily-summary failed" });
  }
});

router.post("/banking-auto-sync", async (_req, res) => {
  try {
    await fireBankingAutoSync();
    res.json({ ok: true, fired: "banking-auto-sync", at: new Date().toISOString() });
  } catch (err) {
    logger.error({ err }, "internal-cron banking-auto-sync failed");
    res.status(500).json({ error: "banking-auto-sync failed" });
  }
});

router.post("/whatsapp-appointment-reminders", async (_req, res) => {
  try {
    const result = await runWhatsappAppointmentReminders();
    res.json({ ok: true, fired: "whatsapp-appointment-reminders", result, at: new Date().toISOString() });
  } catch (err) {
    logger.error({ err }, "internal-cron whatsapp-appointment-reminders failed");
    res.status(500).json({ error: "whatsapp-appointment-reminders failed" });
  }
});

router.post("/whatsapp-dues-reminders", async (_req, res) => {
  try {
    const result = await runWhatsappDuesReminders();
    res.json({ ok: true, fired: "whatsapp-dues-reminders", result, at: new Date().toISOString() });
  } catch (err) {
    logger.error({ err }, "internal-cron whatsapp-dues-reminders failed");
    res.status(500).json({ error: "whatsapp-dues-reminders failed" });
  }
});

// ── Backup / DR jobs ─────────────────────────────────────────────────────────
// These three had NO reachable code path in production. Every scheduler lives
// behind the ENABLE_SCHEDULERS gate in index.ts, which production deliberately
// does not set (see the comment at index.ts:2797), and until now internal-cron
// exposed no endpoint for them. The net effect was that automated backups never
// fired from the API, backups were never proven restorable, and the dead-man
// alert designed to catch "no backup at all" could never run — so total backup
// failure was undetectable. Same CRON_SECRET bearer auth as the routes above.

router.post("/scheduled-backups", async (_req, res) => {
  try {
    await fireScheduledBackups();
    res.json({ ok: true, fired: "scheduled-backups", at: new Date().toISOString() });
  } catch (err) {
    logger.error({ err }, "internal-cron scheduled-backups failed");
    res.status(500).json({ error: "scheduled-backups failed" });
  }
});

router.post("/restore-verification", async (_req, res) => {
  try {
    const result = await runRestoreVerificationJob("internal-cron");
    // Report the verification verdict without failing the trigger itself: a
    // restore that could not be proven is a real result, not a 500.
    res.json({ ok: true, fired: "restore-verification", verified: result.ok, result, at: new Date().toISOString() });
  } catch (err) {
    logger.error({ err }, "internal-cron restore-verification failed");
    res.status(500).json({ error: "restore-verification failed" });
  }
});

router.post("/backup-dead-man", async (_req, res) => {
  try {
    const result = await runBackupDeadManCheck();
    res.json({ ok: true, fired: "backup-dead-man", result, at: new Date().toISOString() });
  } catch (err) {
    logger.error({ err }, "internal-cron backup-dead-man failed");
    res.status(500).json({ error: "backup-dead-man failed" });
  }
});

// Monthly referral-activity summary. Sends referral counts and billed amounts —
// no commission figure, rate or payout. Forced by default so an admin can verify
// delivery before turning the scheduled send on; a forced run does not consume
// the month's send slot.
router.post("/monthly-referral-summary", async (_req, res) => {
  try {
    const result = await runMonthlyReferralSummaryNow();
    res.json({ ok: true, fired: "monthly-referral-summary", result, at: new Date().toISOString() });
  } catch (err) {
    logger.error({ err }, "internal-cron monthly-referral-summary failed");
    res.status(500).json({ error: "monthly-referral-summary failed" });
  }
});

export default router;
