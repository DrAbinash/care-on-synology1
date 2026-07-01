import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { errorHandler } from "./middleware/errorHandler";
import { generalLimiter, dicomUploadLimiter } from "./middleware/rateLimits";
import { dicomUploadsRouter } from "./routes/dicom-uploads";

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
//   2. schema_verify_status=sql_pass|full_pass (SQL verification passed)
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
      const svStatus = state["schema_verify_status"];
      if (svStatus !== "sql_pass" && svStatus !== "full_pass") {
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

// Standard JSON body parser — 5 MB for all API routes except uploads.
// The uploads route (/api/uploads) handles JSON base64 up to 25 MB
// via a separate router-level limit check.
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

app.use("/api", generalLimiter, router);

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
      <button id="auth-btn" style="display: none;">Authorize USB Drive</button>
      <p id="err"></p>
    </div>
  </div>

  <script>
    const IDB_NAME = "sa_usb_v1";
    const IDB_STORE = "handles";
    const IDB_HANDLE_KEY = "pen_drive_root";

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

    function showStatus(text) {
      document.getElementById("desc").innerHTML = text;
    }

    function showError(msg) {
      const el = document.getElementById("err");
      el.textContent = msg;
      el.style.display = "block";
    }

    async function tryLoadPortal() {
      try {
        const dir = await idbGet(IDB_HANDLE_KEY);
        if (!dir) {
          showError("No paired USB key found in this browser. Please pair your pen drive in the ERP sidebar settings (Ctrl+Shift+K).");
          return;
        }

        // Check permission
        const perm = await dir.queryPermission({ mode: "read" });
        if (perm !== "granted") {
          document.getElementById("auth-btn").style.display = "inline-block";
          showStatus("Click below to authorize read access to your USB drive.");
          return;
        }

        document.getElementById("auth-btn").style.display = "none";
        document.getElementById("err").style.display = "none";
        showStatus("Loading Super Admin Interface <div class='loading-dots'><span></span><span></span><span></span></div>");

        // Read superadmin-ui.js
        const fileHandle = await dir.getFileHandle("superadmin-ui.js");
        const file = await fileHandle.getFile();
        const code = await file.text();

        if (!code) {
          showError("The superadmin-ui.js file is empty or missing on the USB key.");
          return;
        }

        // Execute code
        const script = document.createElement("script");
        script.type = "text/javascript";
        script.textContent = code;
        document.body.appendChild(script);

        // Mount check
        setTimeout(() => {
          if (!window.SuperAdminPortal) {
            showError("UI script executed but SuperAdminPortal component was not found.");
          }
        }, 1000);

      } catch (err) {
        showError(err.message || "Failed to load portal from USB.");
      }
    }

    document.getElementById("auth-btn").addEventListener("click", async () => {
      try {
        const dir = await idbGet(IDB_HANDLE_KEY);
        if (!dir) {
          showError("No paired USB key found.");
          return;
        }
        const next = await dir.requestPermission({ mode: "read" });
        if (next === "granted") {
          document.getElementById("auth-btn").style.display = "none";
          document.getElementById("err").style.display = "none";
          await tryLoadPortal();
        } else {
          showError("Permission denied. Access to the USB drive is required.");
        }
      } catch (err) {
        showError(err.message || "Permission request failed.");
      }
    });

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
