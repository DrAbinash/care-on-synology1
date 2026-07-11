import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getStartupState } from "../lib/startupState";

const router: IRouter = Router();

// Capture the process start time once — this becomes the "version token".
// Every deployment restarts the process, so the token changes and connected
// clients can detect that a new version is available.
const SERVER_STARTED_AT = Date.now();

router.get("/healthz", async (_req, res) => {
  // BEND-1 — STARTING is distinguished from HEALTHY: the socket binds before
  // in-process startup migrations settle; until then readiness is 503
  // "starting", never a false "ok".
  const startup = getStartupState();
  if (startup.phase === "starting") {
    res.status(503).json({ status: "starting", since: startup.startedAt });
    return;
  }
  // FIX: probe the DB so Docker / Cloudflare healthchecks can detect a
  // degraded container when the database is unreachable, not just the process.
  try {
    await db.execute(sql`SELECT 1`);
    const data = HealthCheckResponse.parse({ status: "ok" });
    res.json({
      ...data,
      // Truthful startup-migration outcome (failure = degraded detail, the
      // process still serves; db-patch-v2 stays the authoritative runner).
      ...(startup.startupMigrationsOk === false
        ? { startupMigrations: "failed", startupMigrationError: startup.startupMigrationError }
        : {}),
    });
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
