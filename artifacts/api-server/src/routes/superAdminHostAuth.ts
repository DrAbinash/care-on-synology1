/**
 * Host-side Super Admin auth endpoints that work BEFORE the USB plugin is
 * loaded. Registered ahead of the plugin gate in routes/index.ts so that
 * `/super-admin/login` never returns "Super Admin plugin is not loaded."
 *
 * Identity matching (historical Replit bug):
 *   - Accept display name OR username (case-insensitive)
 *   - With a valid usbPin, if name is omitted / wrong, fall back to the sole
 *     active super_admin (or BOOTSTRAP_ADMIN_NAME) instead of requiring the
 *     exact string "Dr Abinash Kumar"
 */
import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { usersTable, superAdminSessionsTable } from "@workspace/db/schema";
import { and, eq, or, sql } from "drizzle-orm";
import { loginLimiter } from "../middleware/rateLimits";
import {
  getUsbKeyHeader,
  isUsbGateEnforced,
  isValidUsbKey,
} from "../middleware/requireSuperAdminUsb";
import { logger } from "../lib/logger";

export const superAdminHostAuthRouter: IRouter = Router();

const LoginBody = z.object({
  name: z.string().trim().optional(),
  pin: z.string().trim().optional(),
  usbPin: z.string().trim().optional(),
}).refine((data) => {
  if (!data.usbPin) return Boolean(data.name?.length && data.pin?.length);
  return true;
}, { message: "Name and PIN are required when usbPin is not provided", path: ["name"] });

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

type SaUser = typeof usersTable.$inferSelect;

async function findSuperAdminByIdentity(name: string | undefined): Promise<SaUser | null> {
  const needle = (name ?? "").trim();
  if (!needle) return null;

  // Numeric index / user id (legacy Replit behaviour: some clients sent the
  // users.id instead of the display name).
  if (/^\d+$/.test(needle)) {
    const [byId] = await db.select().from(usersTable)
      .where(and(eq(usersTable.id, Number(needle)), eq(usersTable.isActive, true)))
      .limit(1);
    if (byId) return byId;
  }

  const [byNameOrUser] = await db.select().from(usersTable)
    .where(and(
      or(
        sql`lower(${usersTable.name}) = lower(${needle})`,
        sql`lower(coalesce(${usersTable.username}, '')) = lower(${needle})`,
        sql`lower(${usersTable.email}) = lower(${needle})`,
      ),
      eq(usersTable.isActive, true),
    ))
    .limit(1);
  return byNameOrUser ?? null;
}

async function resolveUsbPinSuperAdmin(preferredName?: string): Promise<SaUser | null> {
  const direct = await findSuperAdminByIdentity(preferredName);
  if (direct && direct.role === "super_admin") return direct;

  const bootstrapName = (process.env["BOOTSTRAP_ADMIN_NAME"] || "Dr Abinash Kumar").trim();
  if (!preferredName || preferredName.trim().toLowerCase() !== bootstrapName.toLowerCase()) {
    const boot = await findSuperAdminByIdentity(bootstrapName);
    if (boot && boot.role === "super_admin") return boot;
  }

  // Sole active super_admin — avoids brittle exact-name auto-login.
  const supers = await db.select().from(usersTable)
    .where(and(eq(usersTable.role, "super_admin"), eq(usersTable.isActive, true)))
    .limit(2);
  if (supers.length === 1) return supers[0]!;
  return null;
}

superAdminHostAuthRouter.post("/login", loginLimiter, async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }
  const { name, pin, usbPin } = parsed.data;

  const pinOk = Boolean(usbPin && isUsbPinEnforced() && usbPinMatches(usbPin));

  let user: SaUser | null = null;
  if (pinOk) {
    user = await resolveUsbPinSuperAdmin(name);
  } else {
    user = await findSuperAdminByIdentity(name);
  }

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

  let autoLogin = false;
  if (pinOk) {
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
