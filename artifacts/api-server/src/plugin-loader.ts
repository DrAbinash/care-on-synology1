import type { Express, Request, Response } from "express";
import { Router } from "express";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import crypto from "node:crypto";
import { logger } from "./lib/logger";

export let activePluginRouter: Router | null = null;
export let pluginSource: "local" | "uploaded" | null = null;
export let loadedPluginPath: string | null = null;
export let lastHeartbeatTime = 0;

function constantTimeEqualString(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// Scans for a local USB drive containing superadmin.key and superadmin-api.js
async function scanLocalUsb(): Promise<{ keyPath: string; pluginPath: string } | null> {
  const customPath = process.env["SUPER_ADMIN_USB_PATH"];
  if (customPath && fs.existsSync(customPath)) {
    const keyPath = path.join(customPath, "superadmin.key");
    const pluginPath = path.join(customPath, "superadmin-api.js");
    if (fs.existsSync(keyPath) && fs.existsSync(pluginPath)) {
      return { keyPath, pluginPath };
    }
  }

  // Windows drive letters D: to Z:
  if (process.platform === "win32") {
    for (let charCode = 68; charCode <= 90; charCode++) {
      const drive = String.fromCharCode(charCode) + ":\\";
      try {
        const keyPath = path.join(drive, "superadmin.key");
        const pluginPath = path.join(drive, "superadmin-api.js");
        if (fs.existsSync(keyPath) && fs.existsSync(pluginPath)) {
          return { keyPath, pluginPath };
        }
      } catch {
        // Drive not ready or permission denied
      }
    }
  } else {
    // Linux mount points under /media or /mnt
    const mountDirs = ["/media", "/mnt"];
    for (const base of mountDirs) {
      try {
        if (!fs.existsSync(base)) continue;
        const subdirs = fs.readdirSync(base);
        for (const sub of subdirs) {
          const drive = path.join(base, sub);
          const keyPath = path.join(drive, "superadmin.key");
          const pluginPath = path.join(drive, "superadmin-api.js");
          if (fs.existsSync(keyPath) && fs.existsSync(pluginPath)) {
            return { keyPath, pluginPath };
          }
        }
      } catch {
        // Directory read error
      }
    }
  }

  return null;
}

// Loader check loop (runs every 5 seconds)
export async function checkUsbStatus() {
  if (pluginSource === "uploaded") {
    // Heartbeat check for uploaded plugin
    if (Date.now() - lastHeartbeatTime > 30000) {
      logger.warn("Super Admin plugin heartbeat lost. Unmounting routes.");
      unloadPlugin();
    }
    return;
  }

  const usb = await scanLocalUsb();
  if (usb) {
    try {
      const keyContent = fs.readFileSync(usb.keyPath, "utf8").trim();
      const expectedKey = process.env["SUPER_ADMIN_USB_KEY"] || "";
      if (expectedKey && constantTimeEqualString(keyContent, expectedKey)) {
        if (!activePluginRouter || loadedPluginPath !== usb.pluginPath) {
          logger.info(`Valid Super Admin USB detected at ${usb.pluginPath}. Loading plugin...`);
          const fileUrl = url.pathToFileURL(usb.pluginPath).href + "?t=" + Date.now();
          const pluginModule = await import(fileUrl);
          activePluginRouter = pluginModule.default || pluginModule.router;
          pluginSource = "local";
          loadedPluginPath = usb.pluginPath;
          logger.info("Super Admin plugin loaded successfully from USB.");
        }
      } else {
        if (activePluginRouter) {
          logger.warn("Super Admin USB key mismatch. Unmounting.");
          unloadPlugin();
        }
      }
    } catch (err) {
      logger.error({ err }, "Error reading/loading plugin from USB");
      unloadPlugin();
    }
  } else {
    if (activePluginRouter && pluginSource === "local") {
      logger.warn("Super Admin USB disconnected. Unmounting.");
      unloadPlugin();
    }
  }
}

export function unloadPlugin() {
  activePluginRouter = null;
  pluginSource = null;
  loadedPluginPath = null;
}

export function setPluginState(router: any, source: "local" | "uploaded" | null, path: string | null, heartbeat: number) {
  activePluginRouter = router;
  pluginSource = source;
  loadedPluginPath = path;
  lastHeartbeatTime = heartbeat;
}

const PLUGIN_TEMP_PREFIX = "care-superadmin-plugin-";
const pluginTempFiles = new Set<string>();
let exitCleanupInstalled = false;

// The uploaded bundle touches disk only so Node can import() it, then it is
// removed. Each upload writes its own filename: with a shared path, a second
// operator uploading while the first is still importing either loads the other
// operator's code or hits a file the other upload already unlinked
// (ERR_MODULE_NOT_FOUND).
function newPluginTempPath(): string {
  return path.join(os.tmpdir(), PLUGIN_TEMP_PREFIX + crypto.randomBytes(8).toString("hex") + ".mjs");
}

async function removePluginTempFile(tempPath: string): Promise<void> {
  try {
    await fsPromises.unlink(tempPath);
    return;
  } catch {
    // Windows keeps an imported file locked until the process exits.
  }
  pluginTempFiles.add(tempPath);
  if (!exitCleanupInstalled) {
    exitCleanupInstalled = true;
    process.on("exit", () => {
      for (const f of pluginTempFiles) {
        try { fs.unlinkSync(f); } catch { /* already gone */ }
      }
    });
  }
}

// A crash between the write and the unlink leaves a readable copy of the bundle
// behind, which defeats the no-trace design. Only files older than a minute can
// be orphans - an in-flight import is milliseconds old.
export async function sweepPluginTempFiles(now: number = Date.now()): Promise<number> {
  const dir = os.tmpdir();
  let removed = 0;
  let names: string[];
  try {
    names = await fsPromises.readdir(dir);
  } catch {
    return 0;
  }
  for (const name of names.filter((n) => n.startsWith(PLUGIN_TEMP_PREFIX))) {
    const full = path.join(dir, name);
    try {
      const stat = await fsPromises.stat(full);
      if (now - stat.mtimeMs < 60_000) continue;
      await fsPromises.unlink(full);
      pluginTempFiles.delete(full);
      removed++;
    } catch { /* another process won the race */ }
  }
  return removed;
}

export function initializePluginLoader(app: Express) {
  // Sweep any bundle copy a previous crash left in the temp directory.
  void sweepPluginTempFiles();

  // Check USB status every 5 seconds
  setInterval(checkUsbStatus, 5000);

  // Endpoint to upload the plugin (for cloud instances where USB is not local)
  app.post("/api/super-admin-setup/upload-plugin", async (req, res): Promise<void> => {
    const expected = process.env["SUPER_ADMIN_USB_KEY"];
    if (!expected) {
      res.status(403).json({ error: "USB gate is disabled on server." });
      return;
    }

    const key = req.header("x-sa-usb-key") || "";
    if (!key || !constantTimeEqualString(key, expected)) {
      res.status(401).json({ error: "Invalid USB key." });
      return;
    }

    const { code } = req.body;
    if (!code) {
      res.status(400).json({ error: "Plugin code is required." });
      return;
    }

    const tempPath = newPluginTempPath();
    try {
      await fsPromises.writeFile(tempPath, code, { encoding: "utf8", mode: 0o600 });

      const fileUrl = url.pathToFileURL(tempPath).href + "?t=" + Date.now();
      const pluginModule = await import(fileUrl);
      activePluginRouter = pluginModule.default || pluginModule.router;
      pluginSource = "uploaded";
      lastHeartbeatTime = Date.now();

      logger.info("Super Admin plugin uploaded and loaded securely in memory.");
      res.json({ ok: true });
    } catch (err: any) {
      logger.error({ err }, "Failed to load uploaded plugin");
      res.status(500).json({ error: err.message || "Failed to load plugin" });
    } finally {
      // Leave no trace either way, including the failure path the old code left
      // the bundle sitting on disk.
      await removePluginTempFile(tempPath);
    }
  });

  // Heartbeat endpoint to maintain the uploaded plugin
  app.post("/api/super-admin-setup/heartbeat", (req, res): void => {
    const expected = process.env["SUPER_ADMIN_USB_KEY"];
    if (!expected) {
      res.status(403).json({ error: "USB gate is disabled." });
      return;
    }

    const key = req.header("x-sa-usb-key") || "";
    if (!key || !constantTimeEqualString(key, expected)) {
      res.status(401).json({ error: "Invalid USB key." });
      return;
    }

    if (pluginSource === "uploaded") {
      lastHeartbeatTime = Date.now();
    }
    res.json({ ok: true, active: activePluginRouter !== null });
  });
}
