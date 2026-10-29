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
import { buildIdentityPayload } from "./lib/buildIdentity";
import { errorHandler } from "./middleware/errorHandler";
import { dicomUploadLimiter } from "./middleware/rateLimits";
import { dicomUploadsRouter } from "./routes/dicom-uploads";
import { whatsappWebhookRouter } from "./routes/whatsapp";
import { recordRequest } from "./lib/requestMetrics";
import { KEY_IMAGE_MOUNT, radiologyKeyImageHandlers } from "./lib/radiologyKeyImageStatic";

// Helmet is required in production. In dev it is optional so a missing
// install (or CSP that would break Vite HMR) never blocks local work —
// baseline headers below still apply when Helmet is skipped.
let helmet: typeof import("helmet").default | undefined;
try {
  helmet = (await import("helmet")).default;
} catch {
  helmet = undefined;
}

const artifactDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const app: Express = express();

const isProd = process.env.NODE_ENV === "production";

if (isProd && !helmet) {
  throw new Error(
    "helmet is required in production but failed to load. Install the helmet dependency before starting the API.",
  );
}

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
if (isProd && helmet) {
  app.use(
    helmet({
      contentSecurityPolicy: false, // Let the SPA handle its own CSP
      crossOriginEmbedderPolicy: false, // Required for Google Fonts / external assets
    }),
  );
} else {
  // Dev / Helmet-skipped fallback: always set the critical browser headers
  // Helmet would have provided (minus CSP, which breaks Vite HMR).
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-DNS-Prefetch-Control", "off");
    next();
  });
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
// /api/health      → release identity (build.commit) + process liveness
// /api/healthz     → readiness (DB reachable; see routes/health.ts)
// /api/health/schema → full schema readiness probe
//   Gates 1-4:
//   1. db_patch_ok=true (db-patch-v2 completed)
//   2. schema_verify_status=sql_pass|full_pass|pass_with_warnings (SQL verification passed)
//   3. Critical columns verified inline
//   4. Migration count sanity check (≥6 Drizzle + some feature migrations)
app.get("/health", (_req, res) => {
  // `commit` is what the build was TOLD — a compose ARG sourced from .env, which
  // only deploy-synology.sh refreshes. `imageBuiltAt`/`artifact` are what the
  // image knows about itself, written by the Dockerfile from its own build clock
  // and a hash of the bytes shipped. When those say "built last week" while the
  // commit says "six weeks ago", the stamp is stale and the code is not what it
  // claims — which is exactly how /health reported 2d51e8d7 (2026-09-16) while
  // dist/ contained code merged 2026-10-12.
  const identity = buildIdentityPayload();
  res.status(200).json({
    ok:      true,
    version: identity.version || process.env.ERP_VERSION  || "0.0.0",
    build:   identity.buildNumber || process.env.BUILD_NUMBER || "0",
    commit:  identity.commit,
    identitySource: identity.identitySource,
    gitBranch: identity.gitBranch,
    declaredCommit: identity.declaredGitCommit,
    staleStampDetected: identity.staleStampDetected,
    imageBuiltAt: identity.imageBuiltAt,
    artifact:     identity.artifactSha256,
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
      const identity = buildIdentityPayload();
      res.status(200).json({
        ok: true,
        version: process.env.ERP_VERSION  || state["erp_version"]  || "0.0.0",
        build:   process.env.BUILD_NUMBER || state["build_number"] || "0",
        release: process.env.RELEASE_NAME || state["release_name"] || "",
        // The image's resolved identity, not `process.env.GIT_COMMIT`. This endpoint and
        // `/health` are read from the same container during the same incident, and they
        // used to answer with two different commits: `/health` reported the identity the
        // Dockerfile resolved from the build context, and this line reported whatever the
        // `.env` of the moment declared. On the clinic box those differ — Container
        // Manager re-bakes from a `.env` whose `GIT_COMMIT` only `deploy-synology.sh`
        // refreshes — so the operator's second question about the deploy was answered with
        // a stale commit that had nothing to do with the bytes running.
        commit: identity.commit.slice(0, 8),
        commitSource: identity.identitySource,
        staleStampDetected: identity.staleStampDetected,
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

// Standard JSON body parser — 20 MB (expense bill attachments + OCR) for all API routes except uploads.
// The uploads route (/api/uploads) handles JSON base64 up to 25 MB
// via a separate router-level limit check.
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

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

// Radiology key images are clinical pictures: a viewport capture can carry the
// patient's name, UHID or accession burned into the raster by the modality, and
// no code in CARE inspects pixels — so the file itself is the PHI. This prefix
// used to sit on the public static mount below, protected only by a UUID
// filename. It now admits either a Bearer staff session that holds
// /radiology, or a short-lived grant minted for that one file by
// POST /api/radiology/report-generator/key-images/access-urls — never the
// `?staffToken=` session query token. See lib/radiologyKeyImageStatic.ts.
// Server-side readers (composer, print) are unaffected: they read from disk.
app.use(KEY_IMAGE_MOUNT, ...radiologyKeyImageHandlers());

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
<html lang="en" class="sa-boot">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1">
  <title>Super Admin Portal (Protected)</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    /* Pairing-page chrome ONLY. Unscoped button/body rules leaked into the
       USB portal after login (PR #674 full-page boot): every HelpCircle
       "why commission" control became a full-width amber button and body
       overflow:hidden clipped the referral report. Released by removing
       html.sa-boot when superadmin-ui.js is injected. */
    html.sa-boot, html.sa-boot body {
      background: #0b0f19;
      color: #f1f5f9;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
    }
    html.sa-boot body {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      overflow: hidden;
    }
    html.sa-boot .card {
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
    html.sa-boot .icon {
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
    html.sa-boot h1 { font-size: 1.35rem; font-weight: 700; margin: 0 0 0.75rem 0; color: #fbbf24; tracking: -0.025em; }
    html.sa-boot p { font-size: 0.875rem; color: #94a3b8; line-height: 1.6; margin: 0 0 1.75rem 0; }
    /* NEVER style all button/input elements — the USB login PIN field has an
       absolutely-positioned eye <button> that would become a solid amber
       overlay (width:100%) and block typing. Pairing chrome is ID-scoped. */
    html.sa-boot #pair-btn,
    html.sa-boot #auth-btn {
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
    html.sa-boot #pair-btn:hover,
    html.sa-boot #auth-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(251, 191, 36, 0.4);
    }
    html.sa-boot #pair-btn:active,
    html.sa-boot #auth-btn:active {
      transform: translateY(0);
    }
    html.sa-boot #err {
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
    html.sa-boot .loading-dots {
      display: inline-flex;
      gap: 4px;
    }
    html.sa-boot .loading-dots span {
      width: 6px;
      height: 6px;
      background-color: #fbbf24;
      border-radius: 50%;
      animation: dot-blink 1.4s infinite both;
    }
    html.sa-boot .loading-dots span:nth-child(2) { animation-delay: 0.2s; }
    html.sa-boot .loading-dots span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes dot-blink {
      0%, 80%, 100% { opacity: 0.2; }
      40% { opacity: 1; }
    }
    html:not(.sa-boot) body {
      margin: 0;
      min-height: 100%;
      overflow: auto;
      background: #0b0f19;
      color: #f1f5f9;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
    }
    #root { min-height: 100%; width: 100%; }
  </style>
</head>
<body>
  <div id="root" data-sa-bootstrap="1">
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
    // The drive key the portal already holds, kept in this script's own scope so the
    // security-key shim can start a challenge request. It is not published on window:
    // the bundle receives the same value, but the pairing page has no reason to put a
    // bearer secret where any later script can read it off the global.
    let pairedDriveKey = "";
    // A function, not a global holding the secret: the pairing code hands the value to
    // the shim that needs it, and nothing else on the page can read it back off window.
    function setPairedDriveKey(value) {
      pairedDriveKey = typeof value === "string" ? value.trim() : "";
    }
    async function ensureApiPluginLoaded(dir) {
      // Cloud / Synology: the API plugin is not on a server-local USB path, so
      // the browser must upload superadmin-api.js (same as ERP Ctrl+Shift+K).
      const keyText = await readUsbFile(dir, "superadmin.key");
      const apiCode = await readUsbFile(dir, "superadmin-api.js");
      if (!keyText) {
        showError("superadmin.key is missing on the USB drive.");
        return false;
      }
      setPairedDriveKey(keyText);
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
      installLoginTotpShim();
      installLoginKeyShim();

      // Drop pairing-page CSS before the USB UI mounts so login PIN (eye
      // toggle), HelpCircle, and WhatsApp controls are not amber overlays.
      document.documentElement.classList.remove("sa-boot");

      const script = document.createElement("script");
      script.type = "text/javascript";
      script.textContent = code;
      document.body.appendChild(script);

      setTimeout(() => {
        if (!window.SuperAdminPortal) {
          document.documentElement.classList.add("sa-boot");
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
        // Unlock whenever the PIN field is on screen and auto-login is not
        // mid-flight. The yellow overlay was CSS; disabled/readOnly is the
        // older USB lock after a failed auto-login or PIN-only skip.
        const attempting = Array.from(document.querySelectorAll("p, span, div")).some((el) => {
          const t = (el.textContent || "").trim();
          return t.startsWith("Auto-login via USB");
        });
        if (attempting) return;
        if (!autoLoginFailedVisible() && !document.getElementById("pin")) return;
        const inputs = document.querySelectorAll('#pin, input[type="password"], input[autocomplete="current-password"]');
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

    // SUPER_ADMIN_REQUIRE_2FA makes the host login answer 401 { requiresTotp }
    // until a valid authenticator code arrives. The sign-in form itself is
    // superadmin-ui.js read off the pen drive, so it has no code field and must
    // not have to be rebuilt for the clinic to use the second factor: this shim
    // notices the demand, adds the field to the page it is already on, and
    // attaches whatever is typed to the next attempt. The server decides when
    // the box appears, so an unconfigured deployment still shows exactly two
    // fields as before.
    function installLoginTotpShim() {
      if (window.__saTotpShimInstalled) return;
      window.__saTotpShimInstalled = true;

      // The login card is React-owned and re-renders on every keystroke and on
      // each auto-login state change, which destroys a node appended to it. So
      // the demand and the draft live outside the DOM: the field is re-appended
      // while the server still wants one, and a code typed before a re-render is
      // not silently lost between the click and the request.
      let demanded = false;
      let draft = "";

      function codeField() {
        return document.getElementById("sa-totp-code");
      }

      function addCodeField() {
        if (codeField()) return true;
        // React re-renders the login card, so anchor on a field the bundle owns.
        const anchor = document.getElementById("pin")
          || document.querySelector('input[type="password"]')
          || document.getElementById("name");
        if (!anchor) return false;
        const row = document.createElement("div");
        row.id = "sa-totp-row";
        // Inline styles only: a stylesheet here leaks into the portal the same
        // way the pairing CSS did (see the html.sa-boot scoping above).
        row.setAttribute("style", "margin-top:10px;text-align:left");
        const label = document.createElement("label");
        label.setAttribute("for", "sa-totp-code");
        label.setAttribute("style", "font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#94a3b8");
        label.textContent = "Authentication code";
        const input = document.createElement("input");
        input.id = "sa-totp-code";
        input.type = "text";
        input.setAttribute("inputmode", "numeric");
        input.setAttribute("autocomplete", "one-time-code");
        input.placeholder = "6-digit code, or a backup code";
        input.setAttribute("style", "margin-top:6px;width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid #475569;background:#0f172a;color:#e2e8f0;font-family:monospace;letter-spacing:.15em");
        input.value = draft;
        input.addEventListener("input", function () { draft = input.value; });
        const hint = document.createElement("p");
        hint.setAttribute("style", "font-size:11px;color:#94a3b8;margin:6px 0 0");
        hint.textContent = "From the authenticator app paired with this account. A backup code works once.";
        row.appendChild(label);
        row.appendChild(input);
        row.appendChild(hint);
        (anchor.closest("form") || anchor.parentElement).appendChild(row);
        input.focus();
        return true;
      }

      // Same 400 ms heartbeat the PIN fallback already uses on this page.
      setInterval(function () { if (demanded) addCodeField(); }, 400);

      function typedCode() {
        const el = codeField();
        if (el && typeof el.value === "string") {
          draft = el.value;
          return el.value.replace(/[\s-]/g, "");
        }
        return draft.replace(/[\s-]/g, "");
      }

      const origFetch = window.fetch.bind(window);
      window.fetch = async function (input, init) {
        let sentCode = "";
        let isLogin = false;
        try {
          const url = typeof input === "string" ? input : (input && input.url) || "";
          isLogin = url.indexOf("/super-admin/login") !== -1;
          if (isLogin && init && typeof init.body === "string") {
            const value = typedCode();
            if (value) {
              const body = JSON.parse(init.body);
              // The bundle's own handler knows nothing about this field, so it
              // resends the PIN on every attempt — never blank what it proved.
              if (!body.totpCode && !body.backupCode) {
                if (/^[0-9]{6}$/.test(value)) body.totpCode = value;
                else body.backupCode = value;
                init = Object.assign({}, init, { body: JSON.stringify(body) });
              }
              sentCode = value;
            }
          }
        } catch (_) { /* never block login */ }

        const res = await origFetch(input, init);
        if (!isLogin) return res;
        try {
          if (res && res.status === 200) {
            // Session issued: stop demanding, and forget the draft so a later
            // login on this page does not carry an old code.
            demanded = false;
            draft = "";
            return res;
          }
          if (res && (res.status === 401 || res.status === 403)) {
            res.clone().json().then(function (j) {
              if (!j || j.requiresTotp !== true) return;
              // requiresTotp is only ever set alongside a code demand, never for
              // the not-enrolled 403 (that carries requiresTotpEnrollment and the
              // bundle already prints the sentence naming Settings → Security).
              const alreadyHadField = Boolean(codeField());
              demanded = true;
              addCodeField();
              // The bundle resends whatever is in the box, so a rejected code has
              // to be cleared or the next click repeats the same failure.
              if (alreadyHadField && sentCode) {
                draft = "";
                const el = codeField();
                if (el) { el.value = ""; el.focus(); }
              }
            }).catch(function () {});
          }
        } catch (_) { /* response shape is best-effort */ }
        return res;
      };
    }

    // SUPER_ADMIN_REQUIRE_KEY makes /login answer 401 { requiresKey } until a signed
    // challenge arrives, and 403 { requiresKeyEnrollment } when the account holds no
    // key at all. The sign-in card belongs to the bundle on the pen drive, so the
    // ceremony lives here: ask the server for a challenge for the name already typed,
    // let the browser sign it on the stick, and attach that signature to the next
    // /login. No drive rebuild, and the PIN box simply stops being used.
    function installLoginKeyShim() {
      if (window.__saKeyShimInstalled) return;
      window.__saKeyShimInstalled = true;

      let demanded = false;
      let signed = null;
      let busy = false;

      function keyButton() { return document.getElementById("sa-key-btn"); }
      function keyHint() { return document.getElementById("sa-key-hint"); }

      function setHint(text) {
        const el = keyHint();
        if (el) el.textContent = text;
      }

      function addKeyButton() {
        if (keyButton()) return true;
        // Anchor on a field the bundle owns: React re-renders the whole card.
        const anchor = document.getElementById("pin")
          || document.querySelector('input[type="password"]')
          || document.getElementById("name");
        if (!anchor) return false;
        const row = document.createElement("div");
        row.id = "sa-key-row";
        // Inline styles only, for the same reason the pairing CSS is id-scoped above.
        row.setAttribute("style", "margin-top:10px;text-align:left");
        const btn = document.createElement("button");
        btn.id = "sa-key-btn";
        btn.type = "button";
        btn.setAttribute("style", "width:100%;box-sizing:border-box;padding:9px 10px;border-radius:8px;border:1px solid #475569;background:#0f172a;color:#e2e8f0;font-size:13px;cursor:pointer");
        btn.textContent = "Use a security key instead of a PIN";
        btn.addEventListener("click", runCeremony);
        const hint = document.createElement("p");
        hint.id = "sa-key-hint";
        hint.setAttribute("style", "font-size:11px;color:#94a3b8;margin:6px 0 0");
        hint.textContent = "Tap the key when the browser asks, then press Sign in.";
        row.appendChild(btn);
        row.appendChild(hint);
        (anchor.closest("form") || anchor.parentElement).appendChild(row);
        return true;
      }

      // The card is React-owned and re-renders, so a demanded key button is re-appended
      // on the same 400 ms heartbeat the other two shims use.
      setInterval(function () { if (demanded) addKeyButton(); }, 400);

      function b64uToBuf(s) {
        const raw = atob(String(s).replace(/-/g, "+").replace(/_/g, "/"));
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        return bytes.buffer;
      }

      function bufToB64u(value) {
        const bytes = value instanceof ArrayBuffer
          ? new Uint8Array(value)
          : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      }

      async function runCeremony() {
        if (busy) return;
        busy = true;
        const btn = keyButton();
        const resetLabel = "Use a security key instead of a PIN";
        try {
          // WebAuthn exists only in a secure context. Measured: served over plain http
          // on a LAN address, navigator.credentials is undefined here — so the key door
          // is an https path, and the page has to say that instead of looking like a
          // dead key.
          if (!navigator.credentials || !navigator.credentials.get) {
            if (btn) btn.textContent = resetLabel;
            setHint("This page must be opened over https to use a security key.");
            return;
          }
          const nameEl = document.getElementById("name")
            || document.querySelector('input[autocomplete="username"]');
          const name = nameEl && nameEl.value ? String(nameEl.value).trim() : "";
          if (btn) btn.textContent = "Waiting for the key…";
          const begun = await fetch("/api/super-admin/key-login/begin", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-sa-usb-key": pairedDriveKey },
            body: JSON.stringify({ name }),
          });
          const opts = await begun.json().catch(() => ({}));
          if (!begun.ok || !opts || !opts.challenge) {
            setHint((opts && opts.error) || "The server would not start a key sign-in for that name.");
            if (btn) btn.textContent = resetLabel;
            return;
          }
          const cred = await navigator.credentials.get({
            publicKey: {
              challenge: b64uToBuf(opts.challenge),
              rpId: opts.rpId,
              allowCredentials: (opts.allowCredentials || []).map(function (c) {
                return { id: b64uToBuf(c.id), type: c.type || "public-key", transports: c.transports };
              }),
              userVerification: opts.userVerification || "required",
              timeout: opts.timeout,
            },
          });
          if (!cred) throw new Error("cancelled");
          const r = cred.response;
          signed = {
            webauthnChallenge: opts.challenge,
            keyAssertion: {
              id: cred.id,
              rawId: cred.id,
              type: cred.type,
              clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
              response: {
                authenticatorData: bufToB64u(r.authenticatorData),
                clientDataJSON: bufToB64u(r.clientDataJSON),
                signature: bufToB64u(r.signature),
                userHandle: r.userHandle ? bufToB64u(r.userHandle) : undefined,
              },
            },
          };
          demanded = false;
          if (btn) btn.textContent = "Key accepted — now press Sign in";
          setHint("No PIN is needed. Press Sign in.");
        } catch (e) {
          signed = null;
          if (btn) btn.textContent = resetLabel;
          setHint(e && e.name === "NotAllowedError"
            ? "The key was not touched in time, or it refused to sign. Try again."
            : "That key sign-in did not complete.");
        } finally {
          busy = false;
        }
      }

      const origFetch = window.fetch.bind(window);
      window.fetch = async function (input, init) {
        let spent = false;
        try {
          const url = typeof input === "string" ? input : (input && input.url) || "";
          if (url.indexOf("/super-admin/login") !== -1 && signed && init && typeof init.body === "string") {
            const body = JSON.parse(init.body);
            if (!body.keyAssertion) {
              body.webauthnChallenge = signed.webauthnChallenge;
              body.keyAssertion = signed.keyAssertion;
              init = Object.assign({}, init, { body: JSON.stringify(body) });
              spent = true;
            }
          }
        } catch (_) { /* never block login */ }
        if (spent) {
          // One challenge, one attempt: the server consumes it whether or not the
          // signature verifies, so a second click must run a fresh ceremony.
          signed = null;
        }

        const res = await origFetch(input, init);
        try {
          const url = typeof input === "string" ? input : (input && input.url) || "";
          if (url.indexOf("/super-admin/login") === -1) return res;
          if (res && res.status === 200) {
            demanded = false;
            return res;
          }
          if (res && (res.status === 401 || res.status === 403)) {
            res.clone().json().then(function (j) {
              if (!j || (j.requiresKey !== true && j.requiresKeyEnrollment !== true)) return;
              demanded = true;
              addKeyButton();
              setHint(j.requiresKeyEnrollment === true
                ? "No key is enrolled for this account: sign in to the ERP with your PIN and register one under Settings → Security."
                : "Press the button above, tap the key, then Sign in again.");
            }).catch(function () {});
          }
        } catch (_) { /* response shape is best-effort */ }
        return res;
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
