import type { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";
import { logger } from "../lib/logger";

const HEADER_NAME = "x-sa-usb-key";

function getExpectedKey(): string | null {
  const v = process.env["SUPER_ADMIN_USB_KEY"];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function constantTimeEqualString(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

let warned = false;

/**
 * Shared helper: extracts and normalises the X-SA-USB-Key header value.
 */
export function getUsbKeyHeader(req: Request): string {
  const headerVal = req.header(HEADER_NAME);
  return (typeof headerVal === "string" ? headerVal : "").trim();
}

/**
 * Express middleware that validates the X-SA-USB-Key request header against the
 * SUPER_ADMIN_USB_KEY environment secret. The secret is the contents of the
 * `superadmin.key` file the operator carries on their physical USB pen drive.
 *
 * Without this header (or with the wrong value) the request is rejected with
 * 401, so the super-admin surface is invisible to anyone who does not have the
 * pen drive plugged in. Defense-in-depth on top of the existing PIN + session
 * token flow.
 *
 * Backward-compat: if SUPER_ADMIN_USB_KEY is unset (e.g. fresh dev environment
 * before the operator has provisioned the secret), the middleware logs a single
 * warning and lets the request through. This avoids locking everyone out of
 * super-admin during initial setup. Set the env to enforce the gate.
 */
export function requireSuperAdminUsb(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const expected = getExpectedKey();
  if (!expected) {
    if (!warned) {
      logger.warn(
        "SUPER_ADMIN_USB_KEY is not set — USB pen-drive gate is DISABLED. " +
        "Super-admin endpoints are only protected by PIN + session token. " +
        "Set the secret to enforce the pen-drive requirement.",
      );
      warned = true;
    }
    next();
    return;
  }

  const headerVal = req.header(HEADER_NAME);
  const presented = (typeof headerVal === "string" ? headerVal : "").trim();
  if (!presented) {
    res.status(401).json({ error: "USB key required" });
    return;
  }
  if (!constantTimeEqualString(presented, expected)) {
    res.status(401).json({ error: "Invalid USB key" });
    return;
  }
  next();
}

/** Pure helper used by the /usb/verify endpoint. */
export function isValidUsbKey(presented: string): boolean {
  const expected = getExpectedKey();
  if (!expected) return true; // gate disabled when secret unset (see above)
  if (typeof presented !== "string") return false;
  const trimmed = presented.trim();
  if (trimmed.length === 0) return false;
  return constantTimeEqualString(trimmed, expected);
}

/** True when the pen-drive gate is actively enforced on this server. */
export function isUsbGateEnforced(): boolean {
  return getExpectedKey() !== null;
}
