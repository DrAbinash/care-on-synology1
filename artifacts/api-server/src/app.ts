import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
// Bind before routes module graph finishes constructing request handlers.
import "./bootstrapLocalAi";
import router from "./routes";
import { logger } from "./lib/logger";
import { errorHandler } from "./middleware/errorHandler";
import { dicomUploadLimiter } from "./middleware/rateLimits";
import { dicomUploadsRouter } from "./routes/dicom-uploads";
import { whatsappWebhookRouter } from "./routes/whatsapp";
import { recordRequest } from "./lib/requestMetrics";

// Helmet is loaded lazily so a missing optional dependency never crashes the
// server. Production deployments should include it; dev environments can
// skip it (CSP would otherwise break Vite HMR).
let helmet: typeof import("helmet").default | undefined;
try {
  helmet = (await import("helmet")).default;
} catch {
  // Helmet not installed — security headers fall back to manual sets below.
}

const artifactDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const app: Express = express();

const isProd = process.env.NODE_ENV === "production";

// Replit's hosting proxy (and most cloud hosts) terminates TLS upstream and
// forwards the real client IP via X-Forwarded-For. Without this setting,
// express-rate-limit refuses to derive client IPs from that header and
// throws ERR_ERL_UNEXPECTED_X_FORWARDED_FOR on every limited route, which
// floods the logs and makes rate limiting unreliable. "1" trusts exactly
// one hop (the platform proxy in front of us) — never use `true`/unbounded
// trust because that lets clients spoof their IP via the same header.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// Production security headers via Helmet (disabled in dev so Vite HMR works).
// If Helmet is unavailable, we still set a few critical headers manually below.
if (isProd && helmet) {
  app.use(
    helmet({
      contentSecurityPolicy: false, // Let the SPA handle its own CSP
      crossOriginEmbedderPolicy: false, // Required for Google Fonts / external assets
    }),
  );
}

// Gzip / brotli compression for API JSON responses and static assets.
// Applied before CORS so compressed preflight responses are still valid.
try {
  const compression = (await import("compression")).default;
  app.use(compression());
} catch {
  // compression optional — no crash if package is missing
}

// CORS — restrict to known origins. In production set ALLOWED_ORIGINS in .env
// as a comma-separated list (e.g. "https://caredeoghar.com,http://localhost:5173").
// On the Synology all traffic goes through nginx on the same origin, so the
// default empty list means same-origin only, which is correct.
const _rawOrigins = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
app.use(
  cors({
    origin: _rawOrigins.length > 0
      ? (origin, cb) => {
          // Allow requests with no origin (e.g. curl, mobile native, server-to-server)
          if (!origin) return cb(null, true);
          if (_rawOrigins.includes(origin)) return cb(null, true);
          cb(new Error(`CORS: origin '${origin}' not allowed`));
        }
      : false,                    // false = same-origin only (nginx handles it)
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// DICOM / imaging upload route — mounted BEFORE any JSON body parser.
// Multer handles multipart/form-data streaming directly to disk.
// This prevents large DICOM files from being buffered into RAM by express.json().
// ─────────────────────────────────────────────────────────────────────────────
// ── Health endpoints (no auth, no rate-limit — used by Docker + monitoring) ─
// /health          → liveness probe (is the process alive?)
// /api/health/schema → full schema readiness probe
//   Gates 1-4:
//   1. db_patch_ok=true (db-patch-v2 completed)
//   2. schema_verify_status=sql_pass|full_pass|pass_with_warnings (SQL verification passed)
//   3. Critical columns verified inline
//   4. Migration count sanity check (≥6 Drizzle + some feature migrations)
app.get("/health", (_req, res) => {
  res.status(200).json({
    ok:      true,
    version: process.env.ERP_VERSION  || "0.0.0",
    build:   process.env.BUILD_NUMBER || "0",
    commit:  (process.env.GIT_COMMIT  || "unknown").slice(0, 8),
    ts:      new Date().toISOString(),
  });
});

import { pool } from "@workspace/db";

app.get("/api/health/schema", async (_req, res) => {
  try {
    const client = await pool.connect();
    try {
      // ── Gate 1: Read full deploy state ──────────────────────────────────────
      const stateRes = await client.query<{ key: string; value: string }>(
        `SELECT key, value FROM public.schema_deploy_state ORDER BY key LIMIT 30`
      );
      const state: Record<string, string> = {};
      for (const row of stateRes.rows) { state[row.key] = row.value; }

      if (state["db_patch_ok"] !== "true") {
        res.status(503).json({
          ok: false,
          error: "db-patch-v2 did not complete — run: docker compose up -d --build",
          state,
        });
        return;
      }

      // ── Gate 2: SQL schema verification status ───────────────────────────────
      // pass_with_warnings means all required schema objects exist and
      // startup is safe — only non-blocking drift (missing indexes, type/
      // nullability mismatches, extra tables) remains. It must gate the same
      // as full_pass here, or a healthy-but-warned deploy would start
      // returning 503 from this readiness probe.
      const svStatus = state["schema_verify_status"];
      if (svStatus !== "sql_pass" && svStatus !== "full_pass" && svStatus !== "pass_with_warnings") {
        res.status(503).json({
          ok: false,
          error: `Schema verification not passed (status: ${svStatus ?? "missing"})`,
          hint: "Run: docker compose up -d --build",
          state,
        });
        return;
      }

      // ── Gate 3: Critical column check (belt-and-suspenders) ─────────────────
      const missRes = await client.query<{ tbl: string; col: string }>(`
        SELECT t.tbl, t.col FROM (VALUES
          ('radiology_worklist', 'ai_feedback'),
          ('radiology_worklist', 'source_pacs'),
          ('radiology_worklist', 'ai_draft_status'),
          ('radiology_worklist', 'patient_match_status'),
          ('clinic_settings',    'ollama_enabled'),
          ('clinic_settings',    'active_payment_gateway'),
          ('clinic_settings',    'icici_enabled'),
          ('clinic_settings',    'kiosk_enabled'),
          ('clinic_settings',    'sidebar_theme'),
          ('clinic_settings',    'lan_only_login'),
          ('clinic_settings',    'session_idle_timeout_minutes'),
          ('clinic_settings',    'form_f_billing_prompt'),
          ('bills',              'client_ref'),
          ('bills',              'cancelled_at'),
          ('bills',              'refund_amount'),
          ('orders',             'client_ref'),
          ('orders',             'collected_at'),
          ('order_tests',        'status'),
          ('diagnostic_tests',   'department'),
          ('diagnostic_tests',   'test_type'),
          ('patients',           'age_value'),
          ('users',              'sidebar_theme')
        ) AS t(tbl, col)
        WHERE NOT EXISTS (
          SELECT 1 FROM information_schema.columns c
          WHERE c.table_schema = 'public' AND c.table_name = t.tbl AND c.column_name = t.col
        )
      `);

      if (missRes.rows.length > 0) {
        const missing = missRes.rows.map((r: any) => `${r.tbl}.${r.col}`);
        res.status(503).json({
          ok: false,
          error: "Missing critical schema columns",
          missing,
          hint: "Run: docker compose up -d --build  OR  docker compose run --rm care-migrate",
          state,
        });
        return;
      }

      // ── Gate 4: Migration count sanity ───────────────────────────────────────
      let migrationCounts = { drizzle: 0, feature: 0 };
      try {
        const dc = await client.query<{ cnt: string }>(`SELECT COUNT(*)::text AS cnt FROM drizzle.__drizzle_migrations`);
        const fc = await client.query<{ cnt: string }>(`SELECT COUNT(*)::text AS cnt FROM public.schema_migrations_log WHERE kind = 'feature'`);
        migrationCounts = { drizzle: parseInt(dc.rows[0].cnt), feature: parseInt(fc.rows[0].cnt) };
      } catch { /* ignore — tables may not exist in very old schema */ }

      if (migrationCounts.drizzle < 6) {
        res.status(503).json({
          ok: false,
          error: `Only ${migrationCounts.drizzle} Drizzle migrations applied (expected ≥6)`,
          migrationCounts,
          hint: "Run: docker compose run --rm care-migrate",
          state,
        });
        return;
      }

      // ── All gates passed ─────────────────────────────────────────────────────
      res.status(200).json({
        ok: true,
        version: process.env.ERP_VERSION  || state["erp_version"]  || "0.0.0",
        build:   process.env.BUILD_NUMBER || state["build_number"] || "0",
        release: process.env.RELEASE_NAME || state["release_name"] || "",
        commit:  (process.env.GIT_COMMIT  || state["git_commit"]   || "unknown").slice(0, 8),
        state,
        migrationCounts,
        ts: new Date().toISOString(),
      });
    } finally {
      client.release();
    }
  } catch (err: any) {
    res.status(503).json({ ok: false, error: err?.message ?? "Schema check failed" });
  }
});

app.use("/api/dicom-uploads", dicomUploadLimiter, dicomUploadsRouter);

// Meta WhatsApp Cloud API webhook — mounted here, BEFORE the global
// express.json() below, same reason as dicom-uploads above: its POST route
// verifies Meta's x-hub-signature-256 HMAC against the EXACT raw bytes Meta
// signed, which is only possible if nothing has parsed (and thereby
// re-serializable-different) the body first. See routes/whatsapp.ts's POST
// handler doc comment for the full rationale. This single mount replaces
// the old one under routes/index.ts's "/whatsapp/webhook" (removed — it ran
// after express.json(), so req.body there was already-parsed JSON with no
// raw bytes left to verify against).
app.use("/api/whatsapp/webhook", whatsappWebhookRouter);

// Standard JSON body parser — 5 MB for all API routes except uploads.
// The uploads route (/api/uploads) handles JSON base64 up to 25 MB
// via a separate router-level limit check.
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

// ── Diagnostics: lightweight request-timing capture ────────────────────────
// Records method, path, status code, duration (ms), and caller role for
// every /api/* request into an in-memory ring buffer (see requestMetrics.ts)
// used by the admin-only Diagnostics page (/diagnostics, GET /api/diagnostics/*).
// Deliberately records NOTHING else — no headers, no request/response body,
// no query string, no tokens. req.staffSession is populated further down the
// middleware chain by requireStaffAuth (where applicable); reading it inside
// the "finish" handler (which fires after the whole request completed) means
// it is already set by then for any authenticated route.
app.use("/api", (req: Request, res: Response, next: NextFunction) => {
  const startedAt = process.hrtime.bigint();
  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const role = (req as unknown as { staffSession?: { role?: string } }).staffSession?.role;
    recordRequest({
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs,
      role: role || "anonymous",
    });
  });
  next();
});

// Global rate limiting is applied once inside routes/index.ts (generalLimiter).
// Do not stack a second copy here — duplicate limiters double-count every /api
// request and can 429 login even when the dedicated staff/patient login
// limiters would still allow the attempt.
app.use("/api", router);

// Serve user-uploaded site assets (favicon, photos, hero images, etc.)
// from data/uploads. Path matches what /api/website/photos returns.
//
// X-Content-Type-Options: nosniff prevents browsers from MIME-sniffing a
// response away from the declared Content-Type. Combined with the upload
// handler enforcing a safe extension derived from the validated MIME type
// (never from the client-supplied filename), this ensures uploaded files
// cannot be served as HTML or JavaScript even if an attacker tried to
// smuggle active content through the photo upload endpoint.
app.use("/uploads", (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
}, express.static(path.resolve(artifactDir, "data/uploads")));

// Serve the Super Admin Portal bootstrap HTML page (Zero Trace USB Isolation).
// Reads the UI bundle directly from the paired USB key in the browser.
app.get(/^\/super-admin-portal(\/.*)?$/, (_req: Request, res: Response) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1">
  <title>Super Admin Portal (Protected)</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    body {
      background: #0b0f19;
      color: #f1f5f9;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      overflow: hidden;
    }
    .card {
      background: rgba(17, 24, 39, 0.7);
      border: 1px solid rgba(251, 191, 36, 0.2);
      padding: 2.5rem;
      border-radius: 16px;
      max-width: 420px;
      width: 90%;
      text-align: center;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 0 40px rgba(251, 191, 36, 0.05);
      backdrop-filter: blur(12px);
    }
    .icon {
      font-size: 3rem;
      margin-bottom: 1rem;
      color: #fbbf24;
      display: inline-block;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.05); opacity: 0.8; }
    }
    h1 { font-size: 1.35rem; font-weight: 700; margin: 0 0 0.75rem 0; color: #fbbf24; tracking: -0.025em; }
    p { font-size: 0.875rem; color: #94a3b8; line-height: 1.6; margin: 0 0 1.75rem 0; }
    button {
      background: linear-gradient(135deg, #fbbf24, #f59e0b);
      color: #0b0f19;
      border: none;
      padding: 0.75rem 1.5rem;
      border-radius: 8px;
      font-size: 0.875rem;
      font-weight: 700;
      cursor: pointer;
      width: 100%;
      transition: all 0.2s;
      box-shadow: 0 4px 14px rgba(251, 191, 36, 0.3);
    }
    button:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(251, 191, 36, 0.4);
    }
    button:active {
      transform: translateY(0);
    }
    #err {
      color: #f87171;
      font-size: 0.8rem;
      margin-top: 1.25rem;
      margin-bottom: 0;
      background: rgba(248, 113, 113, 0.1);
      padding: 0.5rem;
      border-radius: 6px;
      border: 1px solid rgba(248, 113, 113, 0.2);
      display: none;
    }
    .loading-dots {
      display: inline-flex;
      gap: 4px;
    }
    .loading-dots span {
      width: 6px;
      height: 6px;
      background-color: #fbbf24;
      border-radius: 50%;
      animation: dot-blink 1.4s infinite both;
    }
    .loading-dots span:nth-child(2) { animation-delay: 0.2s; }
    .loading-dots span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes dot-blink {
      0%, 80%, 100% { opacity: 0.2; }
      40% { opacity: 1; }
    }
  </style>
</head>
<body>
  <div id="root">
    <div class="card">
      <div class="icon">🔑</div>
      <h1 id="title">Super Admin Portal</h1>
      <p id="desc">Please connect your Super Admin USB drive to authorize this session.</p>
      <button id="pair-btn" style="display: none; margin-bottom: 0.75rem;">Select USB Drive Folder</button>
      <button id="auth-btn" style="display: none;">Authorize USB Drive</button>
      <p id="hint" style="display: none; font-size: 0.75rem; color: #64748b; margin: 1rem 0 0 0;">Tip: Ctrl+Shift+K also opens the folder picker.</p>
      <p id="err"></p>
    </div>
  </div>

  <script>
    const IDB_NAME = "sa_usb_v1";
    const IDB_STORE = "handles";
    const IDB_HANDLE_KEY = "pen_drive_root";

    // In-memory cache so permission prompts can start on the same user-gesture
    // tick (IndexedDB await would drop Chromium's transient activation).
    let cachedDir = null;

    function openIdb() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }

    async function idbGet(key) {
      try {
        const db = await openIdb();
        return new Promise((resolve, reject) => {
          const tx = db.transaction(IDB_STORE, "readonly");
          const req = tx.objectStore(IDB_STORE).get(key);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      } catch (err) {
        console.error("IndexedDB error:", err);
        return null;
      }
    }

    async function idbPut(key, value) {
      const db = await openIdb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }

    function showStatus(text) {
      document.getElementById("desc").innerHTML = text;
    }

    function showError(msg) {
      const el = document.getElementById("err");
      el.textContent = msg || "";
      el.style.display = msg ? "block" : "none";
    }

    function setPairVisible(show) {
      document.getElementById("pair-btn").style.display = show ? "inline-block" : "none";
      document.getElementById("hint").style.display = show ? "block" : "none";
    }

    function setAuthVisible(show) {
      document.getElementById("auth-btn").style.display = show ? "inline-block" : "none";
    }

    function fsAccessSupported() {
      return typeof window.showDirectoryPicker === "function" && typeof indexedDB !== "undefined";
    }

    /**
     * Start the folder picker on the current user gesture (no await before
     * showDirectoryPicker). Persists the handle when superadmin.key is present.
     */
    function beginPairPenDrive() {
      if (!fsAccessSupported()) {
        return Promise.reject(new Error("This browser cannot browse folders. Use Chrome/Edge, or pair from the ERP (Ctrl+Shift+K)."));
      }
      const picker = window.showDirectoryPicker({ mode: "read" });
      return (async () => {
        const handle = await picker;
        await handle.getFileHandle("superadmin.key");
        // Also required for Zero-Trace portal boot.
        await handle.getFileHandle("superadmin-ui.js");
        await idbPut(IDB_HANDLE_KEY, handle);
        cachedDir = handle;
        return handle;
      })();
    }

    async function readUsbFile(dir, name) {
      try {
        const fh = await dir.getFileHandle(name);
        const file = await fh.getFile();
        const text = await file.text();
        return text && text.length > 0 ? text : null;
      } catch {
        return null;
      }
    }

    let heartbeatTimer = null;
    async function ensureApiPluginLoaded(dir) {
      // Cloud / Synology: the API plugin is not on a server-local USB path, so
      // the browser must upload superadmin-api.js (same as ERP Ctrl+Shift+K).
      const keyText = await readUsbFile(dir, "superadmin.key");
      const apiCode = await readUsbFile(dir, "superadmin-api.js");
      if (!keyText) {
        showError("superadmin.key is missing on the USB drive.");
        return false;
      }
      if (!apiCode) {
        showError("superadmin-api.js is missing on the USB drive. Rebuild/copy the pen-drive plugin files.");
        return false;
      }
      showStatus("Loading Super Admin API plugin…");
      const res = await fetch("/api/super-admin-setup/upload-plugin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-sa-usb-key": keyText.trim(),
        },
        body: JSON.stringify({ code: apiCode }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        showError(body.error || "Failed to load Super Admin API plugin from USB.");
        return false;
      }
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => {
        fetch("/api/super-admin-setup/heartbeat", {
          method: "POST",
          headers: { "x-sa-usb-key": keyText.trim() },
        }).catch(() => {});
      }, 10000);
      return true;
    }

    async function loadPortalFromDir(dir) {
      document.getElementById("pair-btn").style.display = "none";
      setAuthVisible(false);
      document.getElementById("hint").style.display = "none";
      showError("");

      const pluginOk = await ensureApiPluginLoaded(dir);
      if (!pluginOk) {
        setPairVisible(true);
        return;
      }

      showStatus("Loading Super Admin Interface <div class='loading-dots'><span></span><span></span><span></span></div>");

      const code = await readUsbFile(dir, "superadmin-ui.js");
      if (!code) {
        showError("The superadmin-ui.js file is empty or missing on the USB key.");
        setPairVisible(true);
        return;
      }

      // Older USB UI locks the PIN field after a failed auto-login and never
      // sends the typed PIN — only the mismatched usbPin. Install a host shim
      // so operators can type their DB PIN without rebuilding the pen drive.
      installLoginPinFallbackShim();

      const script = document.createElement("script");
      script.type = "text/javascript";
      script.textContent = code;
      document.body.appendChild(script);

      setTimeout(() => {
        if (!window.SuperAdminPortal) {
          showError("UI script executed but SuperAdminPortal component was not found.");
          setPairVisible(true);
        }
      }, 1000);
    }

    function installLoginPinFallbackShim() {
      if (window.__saPinFallbackInstalled) return;
      window.__saPinFallbackInstalled = true;

      function autoLoginFailedVisible() {
        const nodes = document.querySelectorAll("div, p, span");
        for (const el of nodes) {
          const t = (el.textContent || "").trim();
          if (t.startsWith("Auto-login failed")) return true;
        }
        return false;
      }

      function unlockPinInputs() {
        if (!autoLoginFailedVisible()) return;
        const inputs = document.querySelectorAll('input[type="password"], input[autocomplete="current-password"]');
        for (const inp of inputs) {
          if (inp.disabled) inp.disabled = false;
          if (inp.readOnly) inp.readOnly = false;
          if ((inp.placeholder || "").toLowerCase().includes("auto-filled")) {
            inp.placeholder = "Enter Super Admin PIN";
          }
        }
      }

      // Keep unlocking while React re-renders the failed state.
      setInterval(unlockPinInputs, 400);

      const origFetch = window.fetch.bind(window);
      window.fetch = async function (input, init) {
        try {
          const url = typeof input === "string" ? input : (input && input.url) || "";
          if (url.includes("/super-admin/login") && init && typeof init.body === "string") {
            const body = JSON.parse(init.body);
            const pinInput = document.querySelector('input[type="password"], input[autocomplete="current-password"]');
            const nameInput = document.querySelector('#name, input[autocomplete="username"]');
            const typed = pinInput && typeof pinInput.value === "string" ? pinInput.value.trim() : "";
            if (!body.name && nameInput && nameInput.value) body.name = String(nameInput.value).trim();
            // Old USB plugins often require pin. Host auth accepts usbPin for
            // pen-drive auto-login. Send both when we have a secret so either path works.
            const secret = typed || body.usbPin || body.pin || "";
            if (secret) {
              body.pin = String(secret);
              body.usbPin = String(secret);
              init = Object.assign({}, init, { body: JSON.stringify(body) });
            }
          }
        } catch (_) { /* never block login */ }
        return origFetch(input, init);
      };
    }

    async function tryLoadPortal() {
      try {
        const dir = cachedDir || await idbGet(IDB_HANDLE_KEY);
        cachedDir = dir || null;
        if (!dir) {
          showStatus("Plug in the Super Admin USB drive, then select its root folder (the one with <code style='color:#fbbf24'>superadmin.key</code>).");
          setPairVisible(true);
          setAuthVisible(false);
          showError("");
          return;
        }

        // Prefer requestPermission path via Authorize button when needed.
        let perm = "prompt";
        try {
          perm = await dir.queryPermission({ mode: "read" });
        } catch (_) { /* older handles */ }

        if (perm !== "granted") {
          setPairVisible(true);
          setAuthVisible(true);
          showStatus("Click Authorize to allow read access, or Select USB Drive Folder to re-pair.");
          return;
        }

        await loadPortalFromDir(dir);
      } catch (err) {
        showError(err.message || "Failed to load portal from USB.");
        setPairVisible(true);
      }
    }

    async function runPairFlow(pairPromise) {
      showError("");
      showStatus("Waiting for folder selection…");
      document.getElementById("pair-btn").disabled = true;
      try {
        const handle = await pairPromise;
        await loadPortalFromDir(handle);
      } catch (err) {
        if (err && err.name === "AbortError") {
          showStatus("Folder selection cancelled. Plug in the drive and try again.");
        } else {
          const msg = (err && err.message) || "Could not read USB drive.";
          if (String(msg).includes("superadmin.key") || String(msg).includes("superadmin-ui.js")) {
            showError("Chosen folder must contain superadmin.key and superadmin-ui.js.");
          } else {
            showError(msg);
          }
          showStatus("Plug in the Super Admin USB drive, then select its root folder.");
        }
        setPairVisible(true);
      } finally {
        document.getElementById("pair-btn").disabled = false;
      }
    }

    document.getElementById("pair-btn").addEventListener("click", () => {
      // Start picker synchronously from the click gesture.
      const pairPromise = beginPairPenDrive();
      void runPairFlow(pairPromise);
    });

    document.getElementById("auth-btn").addEventListener("click", () => {
      const dir = cachedDir;
      if (!dir) {
        showError("No paired USB key found. Use Select USB Drive Folder first.");
        setPairVisible(true);
        return;
      }
      if (typeof dir.requestPermission !== "function") {
        showError("Permission API unavailable. Use Select USB Drive Folder to re-pair.");
        return;
      }
      // Start permission request on this click (no IndexedDB await first).
      const permPromise = dir.requestPermission({ mode: "read" });
      void (async () => {
        try {
          const next = await permPromise;
          if (next === "granted") {
            await loadPortalFromDir(dir);
          } else {
            showError("Permission denied. Access to the USB drive is required.");
          }
        } catch (err) {
          showError((err && err.message) || "Permission request failed.");
        }
      })();
    });

    // Same hidden combo as the ERP — works on this bootstrap page too.
    window.addEventListener("keydown", (e) => {
      if (!(e.ctrlKey && e.shiftKey && e.code === "KeyK")) return;
      e.preventDefault();
      if (!fsAccessSupported()) {
        showError("Folder picker not supported in this browser. Use Chrome or Edge.");
        return;
      }
      const pairPromise = beginPairPenDrive();
      void runPairFlow(pairPromise);
    }, true);

    // Auto-load on mount
    tryLoadPortal();
  </script>
</body>
</html>`);
});


// =============================================================================
// Production single-port static serving (Windows .exe / portable build /
// Replit Autoscale Cloud Run deployment)
//
// When SERVE_STATIC_DIR points at a folder that contains:
//   <dir>/site/                 — clinic-site Vite build    (BASE_PATH=/)        ← root
//   <dir>/erp/                  — diagnostic-erp Vite build (BASE_PATH=/erp/)    ← staff
//   <dir>/super-admin-portal/   — super-admin-portal build  (BASE_PATH=/super-admin-portal/)
//
// the API server will also serve those static frontends with SPA fallback.
// This avoids needing nginx in the Windows desktop build — one Node process
// serves the API and all three web UIs. The same mechanism powers Replit
// Autoscale (Cloud Run = single container, single port) where the deploy
// build script (scripts/build-deploy.mjs) stages these folders into
// artifacts/api-server/dist/web. Has zero effect when SERVE_STATIC_DIR is
// unset (Replit dev workflows, where each artifact runs its own Vite server).
// =============================================================================
const rawStaticDir = process.env["SERVE_STATIC_DIR"];
// res.sendFile requires absolute paths; resolve relative values against cwd.
const staticDir = rawStaticDir ? path.resolve(rawStaticDir) : undefined;
if (staticDir) {
  const erpDir = path.join(staticDir, "erp");
  const siteDir = path.join(staticDir, "site");
  const resolvedErpDir = existsSync(erpDir) ? erpDir : null;
  const resolvedSiteDir = existsSync(siteDir) ? siteDir : null;

  if (!resolvedErpDir) {
    logger.warn(
      { staticDir, erpDir, siteDir },
      "SERVE_STATIC_DIR is set but expected sub-folders are missing; static serving disabled",
    );
  } else {
    const hasSite = Boolean(resolvedSiteDir);
    logger.info({ erpDir: resolvedErpDir, siteDir: resolvedSiteDir, hasSite }, "Serving frontends from disk");

    // Cache-Control helper: hashed Vite assets (e.g. index-Dgaf8k.js) can be
    // cached forever because their content-addressable names change on every
    // build.  index.html and any non-hashed file must NOT be cached because
    // it is the SPA entry point whose content changes every deploy.
    function staticWithCache(dir: string) {
      return express.static(dir, {
        index: false,
        fallthrough: true,
        setHeaders(res: Response, filePath: string) {
          const base = path.basename(filePath);
          // Vite hashes look like "name-AbC123.js" or "name.AbC123.css"
          const isHashed = /[.-][a-f0-9]{8,}\.(js|css|woff2?|png|jpg|jpeg|webp|svg|ico)$/.test(base);
          if (isHashed) {
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          }
        },
      });
    }

    // Diagnostic ERP — staff app, mounted under /erp (built with BASE_PATH=/erp/).
    // The patient/staff portal lives at /erp/portal as a route inside this SPA.
    app.use("/erp", staticWithCache(resolvedErpDir));
    app.get(/^\/erp(\/.*)?$/, (_req: Request, res: Response, next: NextFunction) => {
      res.sendFile(path.join(resolvedErpDir, "index.html"), (err) => {
        if (err) next(err);
      });
    });

    // Public Clinic Website (built with BASE_PATH=/) — catch-all SPA last.
    // Excludes /api/, /erp (bare), /erp/ (prefix), /uploads, and /super-admin-portal
    // so those routes are handled by their own handlers above (and not swallowed
    // by the website-builder SPA).
    //
    // The bare /erp exclusion (erp$) is critical: without it, a request for
    // the path /erp (no trailing slash) is not matched by the /erp/ prefix
    // handler and falls through to this catch-all, which serves clinic-site's
    // index.html. The clinic-site SPA then parses "erp" as a page slug, finds
    // no website-builder page with that slug, and shows
    // "Page not found: /erp doesn't exist or isn't published."
    if (hasSite) {
      app.use(staticWithCache(resolvedSiteDir!));
      app.get(
        /^\/(?!api\/|erp\/|erp$|uploads\/|super-admin-portal\/).*/,
        (_req: Request, res: Response, next: NextFunction) => {
          res.sendFile(path.join(resolvedSiteDir!, "index.html"), (err) => {
            if (err) next(err);
          });
        },
      );
    }

  }
}

// Global error handler — must be registered AFTER all routes.
// Catches any unhandled errors from route handlers and prevents stack-trace
// leakage in production.
app.use(errorHandler);

export default app;
