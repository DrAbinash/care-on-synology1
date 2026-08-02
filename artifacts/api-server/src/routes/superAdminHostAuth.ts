/**
 * Host-side Super Admin login that works BEFORE the USB plugin is loaded.
 * Registered ahead of the plugin gate so `/super-admin/login` never returns
 * "Super Admin plugin is not loaded."
 *
 * Intentionally STRICT (same bar as the original plugin login):
 *   - Exact display-name match only (case-insensitive trim)
 *   - No username / email / numeric-id aliases
 *   - No "wrong name + usbPin → still log in" fallback
 *   - Name is always required, even when usbPin is present
 *
 * usbPin only skips the database PIN check after the name has already matched
 * a super_admin row.
 */
import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { usersTable, superAdminSessionsTable } from "@workspace/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { loginLimiter } from "../middleware/rateLimits";
import {
  getUsbKeyHeader,
  isUsbGateEnforced,
  isValidUsbKey,
} from "../middleware/requireSuperAdminUsb";
import { logger } from "../lib/logger";

export const superAdminHostAuthRouter: IRouter = Router();

const optionalPin = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v) => {
    if (v === null || v === undefined) return undefined;
    const s = String(v).trim();
    return s.length > 0 ? s : undefined;
  });

const LoginBody = z.object({
  name: z.string().trim().min(1, "Name is required"),
  pin: optionalPin,
  usbPin: optionalPin,
}).refine((data) => {
  // Without usbPin, the database PIN (or pen-drive PIN typed into the PIN box) is required.
  if (!data.usbPin) return Boolean(data.pin?.length);
  return true;
}, { message: "PIN is required when usbPin is not provided", path: ["pin"] });

function generateToken(): string {
  return crypto.randomBytes(48).toString("hex");
}

function isBcryptHash(value: string): boolean {
  return value.startsWith("$2a$") || value.startsWith("$2b$") || value.startsWith("$2y$");
}

async function verifyPin(plain: string, stored: string): Promise<boolean> {
  if (isBcryptHash(stored)) return bcrypt.compare(plain, stored);
  const a = Buffer.from(plain);
  const b = Buffer.from(stored);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function getUsbPinEnv(): string | null {
  const v = process.env["SUPER_ADMIN_USB_PIN"];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function isUsbPinEnforced(): boolean {
  return getUsbPinEnv() !== null;
}

function usbPinMatches(presented: string): boolean {
  const expected = getUsbPinEnv();
  if (!expected) return false;
  const pinBuf = Buffer.from(presented);
  const expectedBuf = Buffer.from(expected);
  if (pinBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(pinBuf, expectedBuf);
}

superAdminHostAuthRouter.post("/login", loginLimiter, async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? "Invalid request";
    res.status(400).json({ error: first, details: parsed.error.issues });
    return;
  }
  let { name, pin, usbPin } = parsed.data;

  // Pen-drive PIN typed into the PIN box (common after auto-login UI failure)
  // must count as usbPin auto-login — 2321 is SUPER_ADMIN_USB_PIN, not the DB PIN.
  if (!usbPin && pin && isUsbPinEnforced() && usbPinMatches(pin)) {
    usbPin = pin;
  }

  // STRICT: exact display name only.
  const [user] = await db.select().from(usersTable)
    .where(and(sql`lower(${usersTable.name}) = lower(${name})`, eq(usersTable.isActive, true)))
    .limit(1);

  if (!user) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  if (user.role !== "super_admin") {
    res.status(403).json({ error: "Access denied — not a super admin" });
    return;
  }

  if (isUsbGateEnforced()) {
    const usb = getUsbKeyHeader(req);
    const hasUsb = Boolean(usb && isValidUsbKey(usb));
    if (!hasUsb && !user.remoteLoginEnabled) {
      res.status(401).json({ error: "USB key required" });
      return;
    }
    if (!hasUsb && user.remoteLoginEnabled) {
      logger.warn(
        { userId: user.id, userName: user.name },
        "USB gate bypassed — remoteLoginEnabled super-admin logged in without pen drive",
      );
    }
  }

  // usbPin (or PIN box matching SUPER_ADMIN_USB_PIN) skips the DB PIN check.
  let autoLogin = false;
  if (isUsbPinEnforced() && usbPin && usbPinMatches(usbPin)) {
    autoLogin = true;
    logger.info({ userId: user.id, userName: user.name }, "Auto-login via usbPin (host auth)");
  }

  if (!autoLogin) {
    if (!pin || !pin.length) {
      res.status(401).json({ error: "PIN is required" });
      return;
    }
    if (!user.pin) {
      res.status(401).json({ error: "No PIN configured for this user" });
      return;
    }
    const matches = await verifyPin(pin, user.pin);
    if (!matches) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    if (!isBcryptHash(user.pin)) {
      const hashed = await bcrypt.hash(pin, 12);
      await db.update(usersTable).set({ pin: hashed }).where(eq(usersTable.id, user.id));
    }
  }

  const token = generateToken();
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);

  await db.insert(superAdminSessionsTable).values({
    token,
    userId: user.id,
    userName: user.name,
    expiresAt,
    isActive: true,
  });

  res.json({ token, userName: user.name, expiresAt: expiresAt.toISOString() });
});
