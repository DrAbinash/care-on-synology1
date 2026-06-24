import type { Express, Request, Response } from "express";
import { Router } from "express";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import url from "node:url";
import crypto from "node:crypto";
import { logger } from "./lib/logger";

export let activePluginRouter: Router | null = null;
let pluginSource: "local" | "uploaded" | null = null;
let loadedPluginPath: string | null = null;
let lastHeartbeatTime = 0;

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
async function checkUsbStatus() {
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

export function initializePluginLoader(app: Express) {
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

    try {
      const tempPath = path.resolve(import.meta.dirname, "dist/temp-superadmin-api.mjs");
      await fsPromises.mkdir(path.dirname(tempPath), { recursive: true });
      await fsPromises.writeFile(tempPath, code, "utf8");

      const fileUrl = url.pathToFileURL(tempPath).href + "?t=" + Date.now();
      const pluginModule = await import(fileUrl);
      activePluginRouter = pluginModule.default || pluginModule.router;
      pluginSource = "uploaded";
      lastHeartbeatTime = Date.now();

      // On Unix, delete the file immediately to leave no trace. On Windows, ignore the failure since Windows locks opened files.
      try {
        await fsPromises.unlink(tempPath);
      } catch {
        // Failed to delete (likely Windows lock) - delete on exit as backup
        process.on("exit", () => {
          try { fs.unlinkSync(tempPath); } catch {}
        });
      }

      logger.info("Super Admin plugin uploaded and loaded securely in memory.");
      res.json({ ok: true });
    } catch (err: any) {
      logger.error({ err }, "Failed to load uploaded plugin");
      res.status(500).json({ error: err.message || "Failed to load plugin" });
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
