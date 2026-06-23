import { Router, type Request, type Response } from "express";
import { spawn } from "node:child_process";
import { logger } from "../lib/logger";

const router = Router();

function requireInternalApiKey(req: Request, res: Response, next: () => void): void {
  const expected = process.env["INTERNAL_API_KEY"];
  if (!expected) {
    if (process.env["NODE_ENV"] === "production") {
      logger.error("INTERNAL_API_KEY is not set — internal backup endpoint disabled");
      res.status(503).json({ error: "INTERNAL_API_KEY not configured" });
      return;
    }
    logger.warn("INTERNAL_API_KEY not set — internal backup endpoint unprotected (non-production)");
    next();
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

router.use(requireInternalApiKey);

// ─── GET /api/internal/backup/download ───────────────────────────────────────
// Runs pg_dump on the live PostgreSQL database and streams the SQL as a
// gzip-compressed download.  Intended for nightly replication to a Synology
// NAS or other local backup target.
//
// Query params:
//   ?format=sql|gzip   (default: gzip)
//   ?tables=table1,table2   (default: all tables)
//
// Headers:
//   Authorization: Bearer <INTERNAL_API_KEY>
//
router.get("/download", async (req, res) => {
  const format = (req.query["format"] as string) ?? "gzip";
  const tablesParam = (req.query["tables"] as string) ?? "";
  const dbUrl = process.env["DATABASE_URL"];

  if (!dbUrl) {
    res.status(500).json({ error: "DATABASE_URL not configured" });
    return;
  }

  // Parse DATABASE_URL
  let url: URL;
  try {
    url = new URL(dbUrl);
  } catch {
    res.status(500).json({ error: "DATABASE_URL is malformed" });
    return;
  }
  const host = url.hostname;
  const port = url.port || "5432";
  const database = url.pathname.replace(/^\//, "");
  const username = url.username;
  const password = url.password;

  const args = [
    "--host", host,
    "--port", port,
    "--username", username,
    "--dbname", database,
    "--no-owner",
    "--no-privileges",
    "--clean",
    "--if-exists",
  ];

  if (tablesParam) {
    const tables = tablesParam.split(",").map((t) => t.trim()).filter(Boolean);
    for (const t of tables) {
      args.push("--table", t);
    }
  }

  const env = { ...process.env, PGPASSWORD: password };
  const isGzip = format === "gzip";

  const filename = `caredeoghar_backup_${new Date().toISOString().replace(/[:.]/g, "-")}.${isGzip ? "sql.gz" : "sql"}`;

  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Type", isGzip ? "application/gzip" : "application/sql");

  try {
    const pgDump = spawn("pg_dump", args, { env, stdio: ["ignore", "pipe", "pipe"] });

    let errorOutput = "";
    pgDump.stderr.on("data", (chunk) => {
      errorOutput += chunk;
    });

    pgDump.on("error", (err) => {
      logger.error({ err }, "pg_dump spawn failed");
      if (!res.headersSent) {
        res.status(500).json({ error: "pg_dump failed to start", details: err.message });
      }
    });

    pgDump.on("close", (code) => {
      if (code !== 0) {
        logger.error({ code, errorOutput }, "pg_dump exited with error");
      }
      if (!res.writableEnded) {
        res.end();
      }
    });

    if (isGzip) {
      const gzip = spawn("gzip", ["-c"], { stdio: ["pipe", "pipe", "pipe"] });
      pgDump.stdout.pipe(gzip.stdin);
      gzip.stdout.pipe(res);
      gzip.stderr.on("data", (chunk) => {
        logger.error({ chunk: String(chunk) }, "gzip error");
      });
      gzip.on("error", (err) => {
        logger.error({ err }, "gzip spawn failed");
      });
    } else {
      pgDump.stdout.pipe(res);
    }
  } catch (err) {
    logger.error({ err }, "Backup download failed");
    res.status(500).json({ error: "Backup download failed", details: String(err) });
  }
});

export default router;
