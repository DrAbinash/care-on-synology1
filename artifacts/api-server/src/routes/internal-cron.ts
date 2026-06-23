import { Router, type Request, type Response, type NextFunction } from "express";
import { runDailySummary, runMonthEndCommission, fireBankingAutoSync } from "../cron";
import { logger } from "../lib/logger";

const router = Router();

function requireCronSecret(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env["CRON_SECRET"];
  if (!expected) {
    res.status(503).json({ error: "CRON_SECRET not configured on server" });
    return;
  }
  const header = req.header("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (provided !== expected) {
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

router.post("/month-end-commission", async (_req, res) => {
  try {
    await runMonthEndCommission(new Date());
    res.json({ ok: true, fired: "month-end-commission", at: new Date().toISOString() });
  } catch (err) {
    logger.error({ err }, "internal-cron month-end-commission failed");
    res.status(500).json({ error: "month-end-commission failed" });
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

export default router;
