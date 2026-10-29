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
 *
 * When SUPER_ADMIN_REQUIRE_2FA is set, a valid authenticator code (or a single
 * use backup code) is required as well — see the block in /login for why that
 * step is its own switch rather than the ERP's require_admin_2fa flag.
 */
import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { usersTable, superAdminSessionsTable } from "@workspace/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { loginLimiter } from "../middleware/rateLimits";
import { hasTotpFactor, verifyTotpFactor } from "../lib/totpFactor";
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
  totpCode: optionalPin,
  backupCode: optionalPin,
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

/**
 * Opt-in second factor for the Super Admin login. Anything other than an empty
 * value counts as on, so `1`/`true`/`yes` all work and an absent line — the
 * state of every deployment today — keeps the door as it was.
 */
function isSuperAdmin2FaRequired(): boolean {
  const v = process.env["SUPER_ADMIN_REQUIRE_2FA"];
  return typeof v === "string" && v.trim().length > 0 && !/^(0|false|no|off)$/i.test(v.trim());
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
  let { name, pin, usbPin, totpCode, backupCode } = parsed.data;

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

  // The pen drive must be present for a host login, with no exception. Two things
  // used to excuse it here: remote_login_enabled — a column nothing in the
  // application could ever set, so the only way to earn it was a direct SQL UPDATE
  // — and an unset SUPER_ADMIN_USB_KEY, which docker-compose.yml forwards as an
  // empty string and the old code read as "gate is off". Either one turned the
  // physical key into theatre; a server that cannot verify the drive now refuses,
  // and says why.
  if (!isUsbGateEnforced()) {
    res.status(503).json({ error: "Super Admin USB gate is not configured on this server" });
    return;
  }
  const usb = getUsbKeyHeader(req);
  if (!usb || !isValidUsbKey(usb)) {
    res.status(401).json({ error: "USB key required" });
    return;
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

  // ── Second factor ─────────────────────────────────────────────────────────
  // Until now this route was the one door in the product that minted a full
  // 8-hour Super Admin session from possession of an object (the pen drive) plus
  // a secret, with nothing proving the holder was present at that moment.
  //
  // The switch is its own environment variable rather than the ERP's
  // `clinic_settings.require_admin_2fa`, and that choice is deliberate. That
  // setting is a database value toggled in the clinic's own Settings screen and
  // governs the counter's admin login; reusing it would couple two unrelated
  // decisions and would start enforcing here the instant this deployed, on every
  // deployment, including one whose paired pen drive predates the code field.
  // Default-off means the server can be deployed first and the operator turns it
  // on after pairing an authenticator — and emptying the line reverses it.
  let factorUsed: "totp" | "backup" | "none" = "none";
  if (isSuperAdmin2FaRequired()) {
    const label = user.username || user.email || "";
    if (!hasTotpFactor({ id: user.id, label, totpEnabled: user.totpEnabled, totpSecret: user.totpSecret })) {
      res.status(403).json({
        error:
          "Super Admin login requires two-factor authentication. Enrol an authenticator app by signing in to the ERP as this account and opening Settings → Security, then sign in here again.",
        requiresTotpEnrollment: true,
      });
      return;
    }
    const factor = await verifyTotpFactor(
      {
        id: user.id,
        label,
        totpEnabled: user.totpEnabled,
        totpSecret: user.totpSecret,
        totpBackupCodes: user.totpBackupCodes,
      },
      { code: totpCode, backupCode },
    );
    if (!factor.ok) {
      // Same 401 shape either way, but `requiresTotp` is what the caller keys on
      // to decide it must ask for a code rather than report a bad PIN.
      res.status(401).json({
        error: factor.error === "missing"
          ? "Authentication code required"
          : "Invalid authentication code",
        requiresTotp: true,
      });
      return;
    }
    factorUsed = factor.via;
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

  // Never the code, the PIN, or the key — only which factor carried the login.
  logger.info(
    {
      userId: user.id,
      userName: user.name,
      factor: factorUsed,
      twoFactorRequired: isSuperAdmin2FaRequired(),
    },
    "Super Admin host session issued",
  );

  res.json({ token, userName: user.name, expiresAt: expiresAt.toISOString() });
});
