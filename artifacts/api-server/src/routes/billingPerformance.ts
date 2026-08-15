/**
 * GET /api/admin/billing-performance
 * Admin-only Clinic Peak / Billing Lane snapshot (observability, PHI-free).
 */
import { Router } from "express";
import {
  buildBillingPerformanceSnapshot,
  formatBillingPerformanceSnapshotText,
} from "../lib/billingPerformanceSnapshot";
import { logger } from "../lib/logger";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const snapshot = await buildBillingPerformanceSnapshot();
    res.json({
      ok: true,
      snapshot,
      text: formatBillingPerformanceSnapshotText(snapshot),
    });
  } catch (err) {
    logger.error({ err }, "billing-performance snapshot failed");
    res.status(500).json({ error: "billing performance snapshot failed" });
  }
});

export default router;
