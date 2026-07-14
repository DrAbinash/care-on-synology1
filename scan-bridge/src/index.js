// Care Diagnostics Document Scan Bridge
// -------------------------------------------------------------
// Runs on each workstation that has a document scanner (flatbed or ADF).
// Browser pages call http://127.0.0.1:8766/* for scan/health.
// The bridge talks to:
//   • a vendor adapter (WIA / SANE / Folder-watch / Mock)
//   • returns base64 images to the ERP frontend
//
// Configuration via environment variables:
//   BRIDGE_SCAN_PORT        (default 8766)
//   BRIDGE_SCAN_VENDOR      mock | wia | sane | folder-watch
//   SCAN_WATCH_FOLDER       (folder-watch only) watched folder path
//   WIA_DEVICE_INDEX        1-based index for multiple WIA devices (default 1)
//   WIA_DPI                 Resolution for WIA scans (default 300)
//   SANE_DPI                Resolution for SANE scans (default 300)
//   ERP_BRIDGE_SECRET       shared secret; if set and BRIDGE_REQUIRE_AUTH=true,
//                           required on every request (except /health) via the
//                           X-Bridge-Secret header.
//   BRIDGE_REQUIRE_AUTH     "true" to enforce ERP_BRIDGE_SECRET (default false,
//                           so existing workstations upgrading the bridge are
//                           not locked out until every PC has the secret set —
//                           flip to true once rollout is complete).
//
// Endpoints:
//   GET  /health    → { ok: true, deviceConnected: true, vendor: "wia", ... }
//   GET  /devices   → { ok: true, devices: [{ index, name }] }
//   POST /scan      → { ok: true, imageBase64: "...", mimeType: "image/jpeg" }
//   POST /latest-scan → { ok: true, imageBase64: "...", filename: "..." }
//
// Security:
//   The bridge binds to 127.0.0.1 only. CORS allows the ERP origin derived
//   from ERP_BASE_URL or explicitly via BRIDGE_ALLOW_ORIGINS. Since the ERP is
//   typically served over HTTPS while this bridge is plain HTTP on loopback,
//   modern browsers additionally require a Private Network Access preflight
//   response (see the Access-Control-Allow-Private-Network header below) —
//   without it, an HTTPS-origin page's fetch to 127.0.0.1 is blocked even
//   though CORS itself would otherwise allow it.

import express from "express";
import cors from "cors";
import { loadAdapter } from "./adapters/index.js";
import { promises as fs, constants } from "node:fs";
import { join, basename, extname } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";

const PORT = Number(process.env.BRIDGE_SCAN_PORT ?? 8766);
const VENDOR = process.env.BRIDGE_SCAN_VENDOR ?? "mock";
const ERP_BASE = (process.env.ERP_BASE_URL ?? "").replace(/\/$/, "");

// BRIDGE_ALLOW_ORIGINS must be explicitly configured. Defaults to the ERP
// origin when ERP_BASE_URL is set, or denies all cross-origin requests.
const _rawAllow = process.env.BRIDGE_ALLOW_ORIGINS ?? "";
if (_rawAllow.trim() === "*") {
  console.error("[scan-bridge] FATAL: BRIDGE_ALLOW_ORIGINS=\"*\" is not permitted. Set it to the specific ERP origin, e.g. https://erp.yourdomain.com");
  process.exit(1);
}

let ALLOW;
if (_rawAllow.trim()) {
  ALLOW = _rawAllow.split(",").map((s) => s.trim()).filter(Boolean);
} else if (ERP_BASE) {
  try {
    ALLOW = [new URL(ERP_BASE).origin];
  } catch {
    ALLOW = [];
  }
} else {
  ALLOW = [];
}

const REQUIRE_AUTH = (process.env.BRIDGE_REQUIRE_AUTH ?? "false").trim().toLowerCase() === "true";
const ERP_SECRET = process.env.ERP_BRIDGE_SECRET ?? "";
if (REQUIRE_AUTH && !ERP_SECRET) {
  console.error("[scan-bridge] FATAL: BRIDGE_REQUIRE_AUTH=true but ERP_BRIDGE_SECRET is not set. Set ERP_BRIDGE_SECRET or disable BRIDGE_REQUIRE_AUTH.");
  process.exit(1);
}

let adapter;

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(cors({ origin: ALLOW.length > 0 ? ALLOW : false, credentials: false }));

// Private Network Access preflight: without this header, a browser page
// served over HTTPS (or any non-private origin) that fetches a loopback/
// private-network address like 127.0.0.1 gets its preflight silently
// rejected in Chromium-based browsers, independent of the CORS allow-list
// above. This is the fix for "Local Workstation Scanner: Offline" reports
// where the bridge is actually running and CORS-allowed but PNA still blocks
// the request.
app.use((req, res, next) => {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Private-Network", "true");
  }
  next();
});

// Shared-secret auth (opt-in via BRIDGE_REQUIRE_AUTH). /health stays
// unauthenticated always, so the "is the bridge even running" poller in the
// ERP frontend keeps working before a secret has been provisioned on a new
// install.
app.use((req, res, next) => {
  if (!REQUIRE_AUTH || req.path === "/health") {
    next();
    return;
  }
  const provided = req.get("X-Bridge-Secret") ?? "";
  if (provided !== ERP_SECRET) {
    res.status(401).json({ ok: false, error: "Missing or invalid X-Bridge-Secret header" });
    return;
  }
  next();
});

// ── Health / device status ───────────────────────────────────────────────────────
app.get("/health", async (_req, res) => {
  try {
    const status = await adapter.status();
    res.json({
      ok: true,
      vendor: VENDOR,
      adapter: adapter.name,
      version: "1.0.0",
      authRequired: REQUIRE_AUTH,
      corsConfigured: ALLOW.length > 0,
      allowedOrigins: ALLOW,
      ...status,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message, vendor: VENDOR, adapter: adapter.name });
  }
});

// ── List all detected scanners ─────────────────────────────────────────────────
app.get("/devices", async (_req, res) => {
  try {
    if (typeof adapter.devices === "function") {
      const result = await adapter.devices();
      res.json({ ok: true, devices: result.devices || [] });
    } else {
      res.json({ ok: true, devices: [] });
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Scan a document and return base64 image ────────────────────────────────────
app.post("/scan", async (_req, res) => {
  try {
    const result = await adapter.scan();
    res.json({ ok: true, imageBase64: result.imageBase64, mimeType: result.mimeType ?? "image/jpeg", filename: result.filename || null });
  } catch (e) {
    const isWiaUnsupported = e.code === "WIA_UNSUPPORTED_DRIVER" || e.code === "WIA_NO_DEVICE";
    res.status(500).json({ ok: false, error: e.message, code: e.code || null, fallback: isWiaUnsupported ? "folder-watch" : null });
  }
});

// ── Latest-scan pickup: grab the newest image from a watched folder ───────────
// Must match adapters/folder-watch.js's default exactly — otherwise POST /scan
// (via the folder-watch adapter) and POST /latest-scan (this handler) silently
// look in two different folders, and "Import Latest Scan" never finds what a
// prior "Scan" call just picked up. Neither handler special-cases win32; if
// you configure a Windows-specific path, set SCAN_WATCH_FOLDER explicitly.
const SCAN_WATCH_FOLDER = process.env.SCAN_WATCH_FOLDER ?? join(tmpdir(), "care-scans");
const SCAN_PROCESSED_FOLDER = process.env.SCAN_PROCESSED_FOLDER ?? join(SCAN_WATCH_FOLDER, "processed");

const SCAN_EXTS = new Set(["jpg", "jpeg", "png", "pdf", "tiff", "tif", "bmp"]);
const MIME_MAP = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  pdf: "application/pdf", tiff: "image/tiff", tif: "image/tiff", bmp: "image/bmp",
};

function extMatches(filename) {
  const ext = basename(filename).split(".").pop()?.toLowerCase() ?? "";
  return SCAN_EXTS.has(ext);
}
function mimeFromExt(filename) {
  const ext = basename(filename).split(".").pop()?.toLowerCase() ?? "";
  return MIME_MAP[ext] || "application/octet-stream";
}

app.post("/latest-scan", async (_req, res) => {
  try {
    let entries;
    try {
      entries = await fs.readdir(SCAN_WATCH_FOLDER, { withFileTypes: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: `Cannot read watch folder "${SCAN_WATCH_FOLDER}": ${e.message}` });
      return;
    }

    const files = entries
      .filter((e) => e.isFile() && extMatches(e.name))
      .map((e) => ({ name: e.name, path: join(SCAN_WATCH_FOLDER, e.name) }));

    if (files.length === 0) {
      res.status(404).json({ ok: false, error: `No scan files found in "${SCAN_WATCH_FOLDER}". Please scan a document first.`, fallback: "folder-watch" });
      return;
    }

    // Find newest by mtime
    const withStats = await Promise.all(
      files.map(async (f) => {
        const stat = await fs.stat(f.path);
        return { ...f, mtime: stat.mtimeMs };
      })
    );
    withStats.sort((a, b) => b.mtime - a.mtime);
    const newest = withStats[0];

    const buffer = await fs.readFile(newest.path);
    const result = {
      ok: true,
      imageBase64: buffer.toString("base64"),
      mimeType: mimeFromExt(newest.name),
      filename: newest.name,
      pickedFrom: SCAN_WATCH_FOLDER,
    };

    // Move to processed folder after successful read
    try {
      await fs.mkdir(SCAN_PROCESSED_FOLDER, { recursive: true });
      const dest = join(SCAN_PROCESSED_FOLDER, newest.name);
      await fs.rename(newest.path, dest);
    } catch {
      // Non-fatal: keep the file in place if move fails
    }

    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Open scanner application on the workstation ───────────────────────────────
app.post("/open-scanner-app", async (_req, res) => {
  try {
    if (process.platform !== "win32") {
      res.status(400).json({ ok: false, error: "Opening scanner app is only supported on Windows" });
      return;
    }

    // Try Windows Fax and Scan first (built-in)
    try {
      await new Promise((resolve, reject) => {
        execFile("powershell", [
          "-Command",
          `Start-Process "wiaacmgr" -ErrorAction Stop`,
        ], { timeout: 5000, windowsHide: true }, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      res.json({ ok: true, message: "Windows Fax and Scan opened. After scanning completes, click Import Latest Scan.", app: "wiaacmgr" });
      return;
    } catch {
      // Fallback: try to open any installed scanner utility
    }

    // Try any vendor scanner utility found in well-known locations
    const commonPaths = [
      "C:\\Program Files (x86)\\Canon\\IJ Scan Utility\\CNMNUTIL.exe",
      "C:\\Program Files\\Canon\\IJ Scan Utility\\CNMNUTIL.exe",
      "C:\\Program Files (x86)\\HP\\HP Scan\\Scan.exe",
      "C:\\Program Files\\HP\\HP Scan\\Scan.exe",
      "C:\\Program Files (x86)\\Epson\\Epson Scan 2\\Scan.exe",
      "C:\\Program Files\\Epson\\Epson Scan 2\\Scan.exe",
      "C:\\Program Files (x86)\\Brother\\BrScan.exe",
      "C:\\Program Files\\Brother\\BrScan.exe",
    ];
    for (const p of commonPaths) {
      try {
        await fs.access(p, constants.F_OK);
        await new Promise((resolve, reject) => {
          execFile("powershell", [
            "-Command",
            `Start-Process "${p}" -ErrorAction Stop`,
          ], { timeout: 5000, windowsHide: true }, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        res.json({ ok: true, message: "Scanner software opened. After scanning completes, click Import Latest Scan.", app: "vendor-scan" });
        return;
      } catch {
        // Try next path
      }
    }

    res.status(404).json({
      ok: false,
      error: "No scanner application found on this workstation. If you're using a TVS PDS 8M or another USB document camera, use the \"Scan with TVS PDS 8M\" or \"Webcam\" option instead — those devices are camera-class hardware and don't have a Windows scanner app to open. Otherwise, scan using your scanner software and save to the watch folder, then click Import Latest Scan.",
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

(async () => {
  try {
    adapter = await loadAdapter(VENDOR);
    console.log(`[scan-bridge] Loaded adapter: ${VENDOR} (${adapter.name})`);
    if (ALLOW.length === 0) {
      console.warn("[scan-bridge] WARNING: No BRIDGE_ALLOW_ORIGINS configured and ERP_BASE_URL is not set. Cross-origin browser requests will be blocked.");
    }

    app.listen(PORT, "127.0.0.1", () => {
      console.log(`[scan-bridge] Listening on http://127.0.0.1:${PORT}`);
      console.log(`[scan-bridge] ERP: ${ERP_BASE || "(not configured)"}`);
      console.log(`[scan-bridge] Allowed origins: ${ALLOW.join(", ") || "(none — CORS blocked)"}`);
    });
  } catch (e) {
    console.error("[scan-bridge] FATAL: Failed to load adapter:", e);
    process.exit(1);
  }
})();
