/**
 * routes/admin-operations.ts — the canonical Operational Health / Deployment
 * Smoke Test endpoint (admin-gated; mounted behind requireStaffAuth +
 * requireAdminRole in routes/index.ts).
 *
 *   GET  /api/admin/operations/health      → live report (no persistence)
 *   POST /api/admin/operations/smoke-run   → run + persist to history
 *   GET  /api/admin/operations/history     → recent persisted runs
 *
 * All checks run in-process against the real DB/pool and self-probe the API
 * over loopback (queue routes, admin-guard). Never returns secrets or PHI —
 * every message/metadata is redacted by the shared runner.
 */
import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";
import { buildOpsContext, makeHttpProbe } from "../lib/operationsContext";
import { buildOperationsReport } from "../lib/operationsChecks";
import { recordOpsRun, recentOpsRuns } from "../lib/operationsHistory";
import type { OpsRunTrigger } from "../lib/operationsHealth";

const router: IRouter = Router();

function loopbackBase(): string {
  const port = process.env.PORT || "8080";
  return `http://127.0.0.1:${port}`;
}

async function dbQuery(text: string, params?: unknown[]): Promise<Array<Record<string, unknown>>> {
  const r = await pool.query(text, params as unknown[] | undefined);
  return r.rows as Array<Record<string, unknown>>;
}

function poolStats() {
  // pg.Pool exposes these counters at runtime.
  const p = pool as unknown as { totalCount?: number; idleCount?: number; waitingCount?: number };
  return { total: p.totalCount ?? 0, idle: p.idleCount ?? 0, waiting: p.waitingCount ?? 0 };
}

function clampTimeout(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 5000;
  return Math.min(Math.max(n, 500), 20000);
}

async function runReport(opts: { includeOptional: boolean; timeoutMs: number; trigger: OpsRunTrigger }) {
  const ctx = await buildOpsContext({
    now: new Date(),
    mode: "server",
    baseUrl: loopbackBase(),
    query: dbQuery,
    probe: makeHttpProbe(opts.timeoutMs),
    poolStats,
    uptimeSeconds: process.uptime(),
  });
  return buildOperationsReport(ctx, { includeOptional: opts.includeOptional, timeoutMs: opts.timeoutMs, trigger: opts.trigger });
}

// Live report for the dashboard's Refresh — never persists.
router.get("/health", async (req, res) => {
  const includeOptional = req.query.includeOptional !== "0";
  const timeoutMs = clampTimeout(req.query.timeout);
  try {
    const report = await runReport({ includeOptional, timeoutMs, trigger: "admin" });
    res.json(report);
  } catch (err) {
    logger.error({ err }, "operations health check failed");
    res.status(500).json({ error: "operations health check failed" });
  }
});

// Full smoke run — persists to history (dashboard "Run full smoke test").
router.post("/smoke-run", async (req: StaffAuthRequest, res) => {
  const includeOptional = req.body?.includeOptional !== false;
  const timeoutMs = clampTimeout(req.body?.timeout);
  try {
    const report = await runReport({ includeOptional, timeoutMs, trigger: "admin" });
    const runId = randomUUID();
    try {
      await recordOpsRun({ report, runId, initiatedBy: req.staffSession?.subjectName ?? null });
    } catch (persistErr) {
      logger.warn({ err: persistErr }, "operations run persistence failed (report still returned)");
    }
    res.json({ runId, report });
  } catch (err) {
    logger.error({ err }, "operations smoke-run failed");
    res.status(500).json({ error: "smoke run failed" });
  }
});

// Recent persisted runs (Phase 6 history).
router.get("/history", async (req, res) => {
  const limit = Number(req.query.limit) || 20;
  try {
    const runs = await recentOpsRuns(limit);
    res.json({ runs });
  } catch (err) {
    logger.error({ err }, "operations history read failed");
    res.status(500).json({ error: "operations history unavailable" });
  }
});

export default router;
