import rateLimit from "express-rate-limit";

/**
 * Pre-configured rate limiters for high-risk and expensive endpoints.
 *
 * Trust proxy is already set in app.ts (app.set("trust proxy", 1)) so the
 * built-in key generator uses the real client IP, not the Replit proxy IP.
 * We intentionally do NOT set a custom keyGenerator — express-rate-limit's
 * default handles IPv6 correctly and passes v8 validation.
 */

const standardHeaders = true;
const legacyHeaders = false;

/** Login / brute-force endpoints — strict. */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders,
  legacyHeaders,
  message: { error: "Too many login attempts. Please try again later." },
});

/** Public portal endpoints — moderate. */
export const portalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders,
  legacyHeaders,
  message: { error: "Too many requests. Please slow down." },
});

/** Backup generation — expensive operation, very tight. */
export const backupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders,
  legacyHeaders,
  message: { error: "Too many backup requests. Please wait an hour." },
});

/** Audit log CSV export — can be large. */
export const exportLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10,
  standardHeaders,
  legacyHeaders,
  message: { error: "Too many export requests. Please slow down." },
});

/** Super admin mutations (delete, reset permissions, etc.) */
export const adminMutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders,
  legacyHeaders,
  message: { error: "Too many admin requests. Please slow down." },
});

/** n8n → CARE internal automation triggers (/api/internal/automations/*).
 *  Generous enough for a scheduler polling health every minute plus a few
 *  daily dispatch triggers, tight enough to bound abuse of a bearer token
 *  that leaked or was guessed. */
export const n8nAutomationLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 60,
  standardHeaders,
  legacyHeaders,
  message: { error: "Too many automation requests. Please slow down." },
});

/**
 * Returns true only when the request carries a bearer token that exactly
 * matches INTERNAL_API_KEY. Used to let trusted server-to-server callers
 * (DICOM pull agent, HL7 inbound, backup cron, etc.) skip the shared public
 * rate limiter, since they are already independently authenticated by
 * requireInternalApiKey / requireStaffOrInternalAuth at the route level in
 * internal-radiology.ts, internal-backup.ts, and hl7.ts.
 *
 * This does NOT weaken security: a request with a missing or wrong key
 * still counts against the public limiter's quota (so credential-guessing
 * traffic is still throttled), and every internal route still independently
 * verifies the key/session itself — this function only decides whether the
 * *rate limiter* applies, never whether the *request* is authorized.
 */
export function hasValidInternalApiKey(req: import("express").Request): boolean {
  const expected = process.env["INTERNAL_API_KEY"];
  if (!expected) return false; // no key configured -> never skip, fail closed
  const header = req.header("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  return provided.length > 0 && provided === expected;
}

/**
 * Portal auth POST endpoints that already carry their own dedicated
 * express-rate-limit middleware (staffLoginLimiter / patientLoginLimiter in
 * portal.ts). Those limiters track only failed attempts (skipSuccessfulRequests)
 * and use a 15-minute window suited to brute-force defence. Applying the
 * general 300-req/min public limiter on top of them can block a legitimate
 * first login with "Too many requests. Please slow down." whenever the clinic
 * IP is already busy with ordinary ERP traffic (multi-tab usage, shared WiFi).
 */
export function isDedicatedAuthLoginPath(req: import("express").Request): boolean {
  const path = (req.originalUrl ?? req.url ?? req.path ?? "").split("?")[0] ?? "";
  return (
    path.endsWith("/portal/staff-login") ||
    path.endsWith("/portal/patient-login")
  );
}

/**
 * General API — generous but prevents abuse.
 *
 * Skips trusted internal automation traffic (paths under /internal/, e.g.
 * /api/internal/radiology/studies, /api/internal/radiology/dicom-event) when
 * a valid INTERNAL_API_KEY bearer token is present, so a busy DICOM batch
 * pull cannot be intermittently 429'd by sharing the same quota as ordinary
 * public API traffic. Public routes and any /internal/* request without a
 * valid key are rate-limited exactly as before.
 *
 * Also skips portal login POSTs — they have dedicated limiters (see above).
 */
export const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 300,
  standardHeaders,
  legacyHeaders,
  message: { error: "Too many requests. Please slow down." },
  skip: (req) =>
    (req.path.startsWith("/internal/") && hasValidInternalApiKey(req)) ||
    isDedicatedAuthLoginPath(req),
});

/** Standard document/image upload routes (JSON base64, up to 25 MB). */
export const standardUploadLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 20,
  standardHeaders,
  legacyHeaders,
  message: { error: "Too many upload requests. Please slow down." },
});

/** DICOM / imaging upload routes — streaming multipart, very expensive. */
export const dicomUploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 10,
  standardHeaders,
  legacyHeaders,
  message: { error: "Too many imaging upload requests. Please slow down." },
});
