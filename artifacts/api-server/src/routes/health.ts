import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

// Capture the process start time once — this becomes the "version token".
// Every deployment restarts the process, so the token changes and connected
// clients can detect that a new version is available.
const SERVER_STARTED_AT = Date.now();

router.get("/healthz", async (_req, res) => {
  // FIX: probe the DB so Docker / Cloudflare healthchecks can detect a
  // degraded container when the database is unreachable, not just the process.
  try {
    await db.execute(sql`SELECT 1`);
    const data = HealthCheckResponse.parse({ status: "ok" });
    res.json(data);
  } catch {
    res.status(503).json({ status: "degraded", db: "unreachable" });
  }
});

// Lightweight version endpoint — clients poll this to detect new deployments.
// Returns the server's startup timestamp (no auth required; no sensitive data).
router.get("/version", (_req, res) => {
  res.json({ startedAt: SERVER_STARTED_AT });
});

export default router;
