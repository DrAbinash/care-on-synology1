import { Router, type Request, type Response } from "express";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { logger } from "../lib/logger";
import { checkSecretStrength, weakSecretMessage } from "../lib/secretStrength";

const router = Router();

/** Constant-time string compare — same helper shape as plugin-loader.ts and
 *  requireSuperAdminUsb.ts, so secret comparison is uniform across the server. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Logged once per process so a hammering caller cannot flood the log. */
let weakKeyLogged = false;

function requireInternalApiKey(req: Request, res: Response, next: () => void): void {
  const expected = process.env["INTERNAL_API_KEY"];
  // Fail CLOSED in every environment. This endpoint streams full-database
  // backups, so an unset key must never mean "no auth required": previously a
  // box that was not explicitly NODE_ENV=production served backups to any
  // caller that could reach the port. Matches internal-cron.ts, which has
  // always returned 503 unconditionally when its secret is unset.
  //
  // A WEAK key is treated identically to a missing one. This router is mounted
  // under the public /api/ prefix (routes/index.ts) with no IP allowlist, so
  // the bearer token is the only thing in front of a full patient-database
  // export. Production shipped with INTERNAL_API_KEY=1234, which the
  // constant-time compare below accepted perfectly happily — the auth logic was
  // never the problem, the value was, and nothing could tell the difference.
  const weakness = checkSecretStrength(expected);
  if (weakness) {
    if (!weakKeyLogged) {
      weakKeyLogged = true;
      logger.error(weakSecretMessage("INTERNAL_API_KEY", weakness));
    }
    res.status(503).json({ error: weakSecretMessage("INTERNAL_API_KEY", weakness) });
    return;
  }
  // checkSecretStrength returning null already guarantees a non-empty string,
  // but it does not narrow the type the way the old `if (!expected)` did.
  const key = expected as string;
  const header = req.header("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!safeEqual(provided, key)) {
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

    // BEND-1 — TRUTHFUL stream termination. Previously the pipe auto-ended
    // the response even when pg_dump failed mid-stream, so the puller saw a
    // clean HTTP 200 and archived a TRUNCATED dump. The response now ends
    // cleanly ONLY when pg_dump exited 0 (and gzip finished); any failure
    // destroys the socket so the client sees a transfer error (curl exits
    // non-zero and the Synology script keeps its previous good backup).
    let pgExitCode: number | null = null;
    let compressorDone = !isGzip; // no gzip stage → nothing extra to wait for
    const finalize = () => {
      if (pgExitCode === null || !compressorDone) return; // not settled yet
      if (res.writableEnded || res.destroyed) return;
      if (pgExitCode === 0) {
        res.end();
      } else {
        logger.error({ code: pgExitCode, errorOutput }, "pg_dump exited with error — destroying response stream");
        res.destroy(new Error(`pg_dump exited with code ${pgExitCode}`));
      }
    };

    pgDump.on("close", (code) => {
      pgExitCode = code ?? 1;
      if (pgExitCode !== 0) {
        logger.error({ code, errorOutput }, "pg_dump exited with error");
      }
      finalize();
    });

    if (isGzip) {
      const gzip = spawn("gzip", ["-c"], { stdio: ["pipe", "pipe", "pipe"] });
      pgDump.stdout.pipe(gzip.stdin);
      gzip.stdout.pipe(res, { end: false });
      gzip.stderr.on("data", (chunk) => {
        logger.error({ chunk: String(chunk) }, "gzip error");
      });
      gzip.on("error", (err) => {
        logger.error({ err }, "gzip spawn failed");
      });
      gzip.on("close", () => {
        compressorDone = true;
        finalize();
      });
    } else {
      pgDump.stdout.pipe(res, { end: false });
      pgDump.stdout.on("end", finalize);
    }
  } catch (err) {
    logger.error({ err }, "Backup download failed");
    res.status(500).json({ error: "Backup download failed", details: String(err) });
  }
});

export default router;
