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
 * The whole pen-drive rule in one function, so every surface that needs it cannot
 * drift. Returns the refusal to send, or null when the caller is holding the
 * drive.
 *
 * Fails CLOSED. The gate used to treat an unset SUPER_ADMIN_USB_KEY as "not
 * configured, let it through" and log one warning — which is silently the worst
 * possible default, because docker-compose.yml forwards the secret as
 * `${SUPER_ADMIN_USB_KEY:-}`. An empty substitution is not "unconfigured on
 * purpose", it is the pen-drive requirement disappearing with no error and no
 * failed deploy: every super-admin endpoint, including the one that mounts
 * arbitrary Node code from the drive, would answer to a request carrying nothing.
 * A server with no secret is now a server that refuses, and says why.
 */
export function usbGateFailure(req: Request): { status: number; body: Record<string, string> } | null {
  const expected = getExpectedKey();
  if (!expected) {
    if (!warned) {
      logger.error(
        "SUPER_ADMIN_USB_KEY is not set — the Super Admin surface is CLOSED. " +
        "Set the secret (the contents of superadmin.key on the pen drive) in the API " +
        "environment to enable it. An empty value is treated the same as a missing one.",
      );
      warned = true;
    }
    // 503 rather than 401: the caller did nothing wrong, the server is not
    // configured to answer. The distinction matters at 22:00 when the only person
    // who can fix it is standing in front of a refused screen.
    return {
      status: 503,
      body: {
        error: "Super Admin USB gate is not configured on this server",
        detail: "SUPER_ADMIN_USB_KEY is unset or empty, so the pen drive cannot be verified.",
      },
    };
  }

  const presented = getUsbKeyHeader(req);
  if (!presented) return { status: 401, body: { error: "USB key required" } };
  if (!constantTimeEqualString(presented, expected)) return { status: 401, body: { error: "Invalid USB key" } };
  return null;
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
 */
export function requireSuperAdminUsb(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const failure = usbGateFailure(req);
  if (failure) {
    res.status(failure.status).json(failure.body);
    return;
  }
  next();
}

/** Pure helper used by the /usb/verify endpoint and by commission visibility. */
export function isValidUsbKey(presented: string): boolean {
  const expected = getExpectedKey();
  if (!expected) return false; // fail closed — see usbGateFailure above
  if (typeof presented !== "string") return false;
  const trimmed = presented.trim();
  if (trimmed.length === 0) return false;
  return constantTimeEqualString(trimmed, expected);
}

/** True when a pen-drive secret is configured on this server. */
export function isUsbGateEnforced(): boolean {
  return getExpectedKey() !== null;
}
