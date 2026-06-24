// =============================================================================
// /api/system/* — runtime info + in-place app updates from a zip file.
//
// The Windows launcher / Electron main process sets two env vars when it boots
// the API server:
//
//   UPDATE_STAGING_DIR    = <install-root>/staging-update
//   UPDATE_MARKER_FILE    = <install-root>/data/.pending-update
//   APP_INSTALL_ROOT      = <install-root>
//   APP_MANIFEST_PATH     = <install-root>/MANIFEST.json   (optional)
//
// When the user uploads a new "DiagnosticERP-Update.zip" we:
//   1. Extract it under UPDATE_STAGING_DIR (it must contain an `app/` folder).
//   2. Write UPDATE_MARKER_FILE pointing at that staging dir.
//   3. Schedule `process.exit(0)` so the launcher takes over.
//
// On the next boot the launcher swaps `app/` ↔ `staging-update/app/` BEFORE
// starting Postgres / the API server, so we never try to overwrite files
// while Node has them mapped.
//
// Outside of a Windows portable build (e.g. on Replit) UPDATE_STAGING_DIR is
// unset and these endpoints return 501 Not Implemented.
// =============================================================================

import { Router, type Request, type Response } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "../lib/logger.js";

const execFileP = promisify(execFile);

export const systemRouter: Router = Router();

const STAGING_DIR  = process.env["UPDATE_STAGING_DIR"]  || "";
const MARKER_FILE  = process.env["UPDATE_MARKER_FILE"]  || "";
const INSTALL_ROOT = process.env["APP_INSTALL_ROOT"]    || "";
const MANIFEST_PATH = process.env["APP_MANIFEST_PATH"]
  || (INSTALL_ROOT ? path.join(INSTALL_ROOT, "MANIFEST.json") : "");

function updatesEnabled(): boolean {
  return Boolean(STAGING_DIR && MARKER_FILE && INSTALL_ROOT);
}

// Read the build manifest dropped at payload root by build-payload.mjs.
function readManifest(): Record<string, unknown> | null {
  if (!MANIFEST_PATH || !fs.existsSync(MANIFEST_PATH)) return null;
  try { return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")); }
  catch { return null; }
}

// -------- GET /api/system/info ---------------------------------------------
systemRouter.get("/info", (_req: Request, res: Response) => {
  const manifest = readManifest();
  res.json({
    name: (manifest?.["name"] as string) || "Care Diagnostics Billing ERP",
    builtAt: manifest?.["builtAt"] || null,
    nodeVersion: manifest?.["nodeVersion"] || null,
    postgresVersion: manifest?.["postgresVersion"] || null,
    updatesEnabled: updatesEnabled(),
    installRoot: INSTALL_ROOT || null,
    runtimeNode: process.version,
    platform: process.platform,
    pid: process.pid,
    uptimeSeconds: Math.round(process.uptime()),
  });
});

// -------- POST /api/system/update -------------------------------------------
// Multipart upload, single field "file" (.zip).  Maximum 1 GiB.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 1024 },
});

async function dirHasPath(dir: string, sub: string): Promise<boolean> {
  try { await fsp.stat(path.join(dir, sub)); return true; } catch { return false; }
}

async function extractZip(zipPath: string, destDir: string): Promise<void> {
  // Try common extractors. On Windows `tar -xf` is available since Win10 1803.
  // On Linux/macOS `unzip` is universal. We try both so dev runs work too.
  const tries: Array<[string, string[]]> = process.platform === "win32"
    ? [["tar", ["-xf", zipPath, "-C", destDir]],
       ["powershell", ["-NoProfile", "-Command",
         `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`]]]
    : [["unzip", ["-q", "-o", zipPath, "-d", destDir]],
       ["tar",   ["-xf", zipPath, "-C", destDir]]];

  let lastErr: unknown = null;
  for (const [cmd, args] of tries) {
    try { await execFileP(cmd, args, { maxBuffer: 64 * 1024 * 1024 }); return; }
    catch (e) { lastErr = e; }
  }
  throw new Error(`Could not extract zip — tried tar/unzip/powershell. Last error: ${String(lastErr)}`);
}

systemRouter.post("/update", upload.single("file"), async (req: Request, res: Response) => {
  if (!updatesEnabled()) {
    res.status(501).json({
      error: "In-place updates are only available in the Windows desktop build.",
    });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "Upload a .zip file in the 'file' field." });
    return;
  }

  try {
    // Persist the upload to a temp file so external extractors can read it.
    const tmpZip = path.join(STAGING_DIR, "..", `update-${Date.now()}.zip`);
    await fsp.mkdir(path.dirname(tmpZip), { recursive: true });
    await fsp.writeFile(tmpZip, req.file.buffer);

    // Recreate a clean staging dir.
    await fsp.rm(STAGING_DIR, { recursive: true, force: true });
    await fsp.mkdir(STAGING_DIR, { recursive: true });

    req.log?.info({ size: req.file.size }, "Extracting update zip");
    await extractZip(tmpZip, STAGING_DIR);
    await fsp.unlink(tmpZip).catch(() => {});

    // Some zips wrap everything in a top-level folder (e.g. DiagnosticERP-Update/app/…).
    // Detect and unwrap.
    let payloadDir = STAGING_DIR;
    if (!await dirHasPath(payloadDir, "app")) {
      const entries = await fsp.readdir(payloadDir, { withFileTypes: true });
      const dirs = entries.filter((e) => e.isDirectory());
      if (dirs.length === 1 && await dirHasPath(path.join(payloadDir, dirs[0]!.name), "app")) {
        payloadDir = path.join(payloadDir, dirs[0]!.name);
      }
    }

    // Sanity-check: must have app/server/dist/index.mjs and app/web/erp/index.html.
    const required = [
      "app/server/dist/index.mjs",
      "app/server/package.json",
      "app/web/erp/index.html",
      "app/db-migrate/run.mjs",
    ];
    for (const r of required) {
      if (!await dirHasPath(payloadDir, r)) {
        await fsp.rm(STAGING_DIR, { recursive: true, force: true });
        res.status(400).json({ error: `Update zip is missing ${r}` });
        return;
      }
    }

    // Write the marker the launcher reads on next boot.
    await fsp.mkdir(path.dirname(MARKER_FILE), { recursive: true });
    await fsp.writeFile(MARKER_FILE, JSON.stringify({
      stagingDir: payloadDir,
      stagedAt: new Date().toISOString(),
      sourceSize: req.file.size,
    }, null, 2));

    req.log?.info({ payloadDir }, "Update staged. Restarting…");
    res.json({
      ok: true,
      message: "Update staged successfully. The application will restart now.",
      stagedAt: new Date().toISOString(),
    });

    // Give the response time to flush, then exit so the launcher swaps + restarts.
    setTimeout(() => {
      logger.info("Exiting for in-place update swap");
      process.exit(0);
    }, 800);
  } catch (err) {
    req.log?.error({ err }, "Update failed");
    try { await fsp.rm(STAGING_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
    res.status(500).json({ error: (err as Error).message || "Update failed" });
  }
});

// -------- POST /api/system/restart ------------------------------------------
// Manual restart (handy when the user has already swapped files manually, or
// just wants to bounce the server). Only enabled when running under a launcher
// that can respawn us; otherwise this would just kill the process for good.
systemRouter.post("/restart", (_req: Request, res: Response) => {
  if (!updatesEnabled()) {
    res.status(501).json({ error: "Restart endpoint only works in the Windows desktop build." });
    return;
  }
  res.json({ ok: true, message: "Restarting…" });
  setTimeout(() => process.exit(0), 500);
});
