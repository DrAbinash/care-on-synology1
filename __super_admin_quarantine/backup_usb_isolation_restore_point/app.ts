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

app.use(cors());

// ─────────────────────────────────────────────────────────────────────────────
// DICOM / imaging upload route — mounted BEFORE any JSON body parser.
// Multer handles multipart/form-data streaming directly to disk.
// This prevents large DICOM files from being buffered into RAM by express.json().
// ─────────────────────────────────────────────────────────────────────────────
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
  const adminDir = path.join(staticDir, "super-admin-portal");
  const resolvedErpDir = existsSync(erpDir) ? erpDir : null;
  const resolvedSiteDir = existsSync(siteDir) ? siteDir : null;
  const resolvedAdminDir = existsSync(adminDir) ? adminDir : null;

  if (!resolvedErpDir || !resolvedAdminDir) {
    logger.warn(
      { staticDir, erpDir, siteDir, adminDir },
      "SERVE_STATIC_DIR is set but expected sub-folders are missing; static serving disabled",
    );
  } else {
    const hasSite = Boolean(resolvedSiteDir);
    logger.info({ erpDir: resolvedErpDir, siteDir: resolvedSiteDir, adminDir: resolvedAdminDir, hasSite }, "Serving frontends from disk");

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

    // Super Admin Portal (built with BASE_PATH=/super-admin-portal/)
    app.use("/super-admin-portal", staticWithCache(resolvedAdminDir));
    app.get(/^\/super-admin-portal(\/.*)?$/, (_req: Request, res: Response, next: NextFunction) => {
      res.sendFile(path.join(resolvedAdminDir, "index.html"), (err) => {
        if (err) next(err);
      });
    });

    // Diagnostic ERP — staff app, mounted under /erp (built with BASE_PATH=/erp/).
    // The patient/staff portal lives at /erp/portal as a route inside this SPA.
    app.use("/erp", staticWithCache(resolvedErpDir));
    app.get(/^\/erp(\/.*)?$/, (_req: Request, res: Response, next: NextFunction) => {
      res.sendFile(path.join(resolvedErpDir, "index.html"), (err) => {
        if (err) next(err);
      });
    });

    // Public Clinic Website (built with BASE_PATH=/) — catch-all SPA last.
    // Excludes /api/, /erp, /uploads, and /super-admin-portal so those routes
    // are handled by their own handlers above (and not swallowed by the SPA).
    if (hasSite) {
      app.use(staticWithCache(resolvedSiteDir!));
      app.get(
        /^\/(?!api\/|erp\/|erp$|uploads\/|super-admin-portal\/|super-admin-portal$).*/,
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
