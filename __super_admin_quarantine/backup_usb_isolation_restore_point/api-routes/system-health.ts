import { Router } from "express";
import { db } from "@workspace/db";
import { logger } from "../lib/logger";
import { requireSuperAdmin } from "../middleware/requireSuperAdmin";
import { requireSuperAdminUsb } from "../middleware/requireSuperAdminUsb";

const router = Router();

// System health dashboard — super admin only
router.get(
  "/",
  requireSuperAdminUsb,
  requireSuperAdmin,
  async (_req, res) => {
    const memory = process.memoryUsage();
    const uptimeSeconds = Math.floor(process.uptime());

    // Database status
    let dbStatus = "connected";
    try {
      await db.execute("SELECT 1");
    } catch {
      dbStatus = "error";
    }

    // Redis / BullMQ status (safe if Redis is not configured)
    let redisStatus: "connected" | "missing" | "error" = "missing";
    let queueStatus: "running" | "disabled" = "disabled";
    try {
      if (process.env.REDIS_URL) {
        const { Redis } = await import("ioredis");
        const client = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 2000 });
        await client.ping();
        await client.quit();
        redisStatus = "connected";
        queueStatus = "running";
      }
    } catch {
      redisStatus = process.env.REDIS_URL ? "error" : "missing";
    }

    res.json({
      database: dbStatus,
      redis: redisStatus,
      queue: queueStatus,
      uptimeSeconds,
      memory: {
        rss: memory.rss,
        heapTotal: memory.heapTotal,
        heapUsed: memory.heapUsed,
        external: memory.external,
      },
      version: process.env.npm_package_version ?? "0.0.0",
      nodeVersion: process.version,
      platform: process.platform,
      startedAt: new Date(SERVER_STARTED_AT).toISOString(),
    });
  },
);

const SERVER_STARTED_AT = Date.now();

export default router;
