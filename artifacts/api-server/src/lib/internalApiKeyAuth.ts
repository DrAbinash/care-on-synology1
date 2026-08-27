import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { logger } from "./logger";
import { checkSecretStrength, weakSecretMessage } from "./secretStrength";

/** Constant-time string compare — uniform across all internal bearer guards. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

let weakKeyLogged = false;

function logWeakKeyOnce(weakness: NonNullable<ReturnType<typeof checkSecretStrength>>): void {
  if (weakKeyLogged) return;
  weakKeyLogged = true;
  logger.error(weakSecretMessage("INTERNAL_API_KEY", weakness));
}

export function extractBearerToken(req: Request): string {
  const header = req.header("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

/** Trimmed key when set and strong enough; null when unset or weak. */
export function getStrongInternalApiKey(): string | null {
  const raw = process.env["INTERNAL_API_KEY"];
  const weakness = checkSecretStrength(raw);
  if (weakness) return null;
  return (raw ?? "").trim();
}

/** Trimmed key when set (weak values allowed); null when unset. */
export function getInternalApiKeyAllowWeak(): string | null {
  const raw = (process.env["INTERNAL_API_KEY"] ?? "").trim();
  return raw.length > 0 ? raw : null;
}

/** True when bearer matches any configured key (constant-time). Weak keys allowed. */
export function bearerMatchesInternalApiKey(req: Request): boolean {
  const expected = getInternalApiKeyAllowWeak();
  if (!expected) return false;
  const provided = extractBearerToken(req);
  if (!provided) return false;
  return safeEqual(provided, expected);
}

/** True only when bearer matches a strong configured key — for rate-limit bypass. */
export function bearerMatchesStrongInternalApiKey(req: Request): boolean {
  const expected = getStrongInternalApiKey();
  if (!expected) return false;
  const provided = extractBearerToken(req);
  if (!provided) return false;
  return safeEqual(provided, expected);
}

/**
 * Blocks weak/unset keys with 503. For endpoints that must never serve behind
 * a guessable secret (full DB export).
 */
export function requireStrongInternalApiKey(req: Request, res: Response, next: NextFunction): void {
  const raw = process.env["INTERNAL_API_KEY"];
  const weakness = checkSecretStrength(raw);
  if (weakness) {
    logWeakKeyOnce(weakness);
    res.status(503).json({ error: weakSecretMessage("INTERNAL_API_KEY", weakness) });
    return;
  }
  const key = (raw ?? "").trim();
  const provided = extractBearerToken(req);
  if (!safeEqual(provided, key)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

/**
 * Standard internal API auth for PACS/HL7 automation. Fails closed in production
 * when unset; does NOT block weak keys — rotation closes that gap (see
 * lib/secretStrength.test.ts).
 */
export function requireInternalApiKey(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env["INTERNAL_API_KEY"];
  if (!expected) {
    if (process.env["NODE_ENV"] === "production") {
      logger.error("INTERNAL_API_KEY is not set in production — internal endpoints are disabled");
      res.status(503).json({
        error:
          "Service unavailable: INTERNAL_API_KEY is not configured. Set this secret before using internal endpoints.",
      });
      return;
    }
    logger.warn("INTERNAL_API_KEY not set — internal endpoints are unprotected (non-production only)");
    next();
    return;
  }
  const provided = extractBearerToken(req);
  if (!safeEqual(provided, expected)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}
