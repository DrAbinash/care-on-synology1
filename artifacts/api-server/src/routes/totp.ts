/**
 * TOTP two-factor authentication routes for admin/super_admin accounts.
 *
 * Setup flow:
 *   POST /api/portal/totp/setup    → generate secret + QR URI (staff auth required)
 *   POST /api/portal/totp/verify   → verify code and enable TOTP (staff auth required)
 *   POST /api/portal/totp/disable  → disable TOTP (staff auth + PIN confirmation)
 *   GET  /api/portal/totp/status   → check TOTP status (staff auth required)
 *
 * Login flow (called from staff-login):
 *   POST /api/portal/totp/verify-login → verify TOTP code and exchange temp token for real session
 *     This one runs BEFORE any session exists, so it is mounted outside
 *     requireStaffAuth and authenticates the temp token from its own body.
 */
import { Router, type Response } from "express";
import * as OTPAuth from "otpauth";
import rateLimit from "express-rate-limit";
import { db } from "@workspace/db";
import { usersTable, portalSessionsTable, clinicSettingsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";
import { normalizeRole } from "../middleware/requireStaffAuth";
import { auditFromRequest } from "../lib/audit";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";

/** Post-session management: every router here needs a real staff session. */
export const totpRouter = Router();

/** The pre-session login exchange. Must NOT sit behind requireStaffAuth. */
export const totpPublicRouter = Router();

const VERIFY_WINDOW_MS = 15 * 60 * 1000;

/**
 * /verify-login is a 6-digit code oracle: TOTP_WINDOW=1 accepts two 30-second
 * steps, so an unthrottled caller gets ~2 valid codes a minute out of 1,000,000
 * and the temp token lives 5 minutes. A successful exchange consumes the token,
 * so only failures are counted.
 */
const verifyLoginLimiter = rateLimit({
  windowMs: VERIFY_WINDOW_MS,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: "Too many failed authentication attempts. Please wait a few minutes and try again." },
});

const TOTP_ISSUER = "Care Diagnostics ERP";
const TOTP_WINDOW = 1;

// ── Helpers ──────────────────────────────────────────────────────────────────

function requireAdminRole(req: StaffAuthRequest, res: Response): boolean {
  const staff = req.staffSession;
  if (!staff) {
    res.status(401).json({ error: "Staff authentication required" });
    return false;
  }
  const role = normalizeRole(staff.role);
  if (role !== "admin" && role !== "super_admin") {
    res.status(403).json({ error: "Only admin and super-admin can manage 2FA" });
    return false;
  }
  return true;
}

function generateBackupCodes(count: number = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const code = crypto.randomBytes(4).toString("hex").toUpperCase();
    codes.push(code);
  }
  return codes;
}

// ── POST /setup — generate secret and QR URI ─────────────────────────────────

totpRouter.post("/setup", async (req: StaffAuthRequest, res) => {
  if (!requireAdminRole(req, res)) return;
  const staff = req.staffSession!;

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, staff.subjectId))
    .limit(1);

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (user.totpEnabled) {
    res.status(400).json({ error: "2FA is already enabled. Disable it first to reconfigure." });
    return;
  }

  const secret = new OTPAuth.Secret({ size: 20 });
  const totp = new OTPAuth.TOTP({
    issuer: TOTP_ISSUER,
    label: user.username || user.email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret,
  });

  const secretBase32 = secret.base32;
  const otpauthUri = totp.toString();

  res.json({
    secret: secretBase32,
    otpauthUri,
  });
});

// ── POST /verify — verify code and enable TOTP ───────────────────────────────

totpRouter.post("/verify", async (req: StaffAuthRequest, res) => {
  if (!requireAdminRole(req, res)) return;
  const staff = req.staffSession!;
  const { secret, code } = req.body as { secret?: string; code?: string };

  if (!secret || !code) {
    res.status(400).json({ error: "Secret and code are required" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, staff.subjectId))
    .limit(1);

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (user.totpEnabled) {
    res.status(400).json({ error: "2FA is already enabled" });
    return;
  }

  const totp = new OTPAuth.TOTP({
    issuer: TOTP_ISSUER,
    label: user.username || user.email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });

  const delta = totp.validate({ token: code, window: TOTP_WINDOW });
  if (delta === null) {
    res.status(400).json({ error: "Invalid TOTP code" });
    return;
  }

  const backupCodes = generateBackupCodes(8);

  await db
    .update(usersTable)
    .set({
      totpSecret: secret,
      totpEnabled: true,
      totpBackupCodes: backupCodes,
    })
    .where(eq(usersTable.id, staff.subjectId));

  void auditFromRequest(req, {
    userId: staff.subjectId,
    userName: staff.subjectName,
    role: normalizeRole(staff.role),
    action: "totp_enabled",
    module: "system",
    entityType: "user",
    entityId: String(staff.subjectId),
  });

  res.json({
    success: true,
    backupCodes,
  });
});

// ── POST /disable — disable TOTP (requires PIN confirmation) ─────────────────

totpRouter.post("/disable", async (req: StaffAuthRequest, res) => {
  if (!requireAdminRole(req, res)) return;
  const staff = req.staffSession!;
  const { pin } = req.body as { pin?: string };

  if (!pin) {
    res.status(400).json({ error: "PIN confirmation required" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, staff.subjectId))
    .limit(1);

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (!user.totpEnabled) {
    res.status(400).json({ error: "2FA is not enabled" });
    return;
  }

  if (!user.pin) {
    res.status(401).json({ error: "User has no PIN set" });
    return;
  }

  const pinMatches = await bcrypt.compare(pin, user.pin);
  if (!pinMatches) {
    res.status(401).json({ error: "Incorrect PIN" });
    return;
  }

  await db
    .update(usersTable)
    .set({
      totpSecret: null,
      totpEnabled: false,
      totpBackupCodes: null,
    })
    .where(eq(usersTable.id, staff.subjectId));

  void auditFromRequest(req, {
    userId: staff.subjectId,
    userName: staff.subjectName,
    role: normalizeRole(staff.role),
    action: "totp_disabled",
    module: "system",
    entityType: "user",
    entityId: String(staff.subjectId),
  });

  res.json({ success: true });
});

// ── GET /status — check TOTP status ──────────────────────────────────────────

totpRouter.get("/status", async (req: StaffAuthRequest, res) => {
  if (!requireAdminRole(req, res)) return;
  const staff = req.staffSession!;

  const [user] = await db
    .select({ totpEnabled: usersTable.totpEnabled })
    .from(usersTable)
    .where(eq(usersTable.id, staff.subjectId))
    .limit(1);

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json({ enabled: user.totpEnabled });
});

// ── POST /verify-login — verify TOTP during login (temp token exchange) ──────
// Pre-session: the caller holds only the 5-minute `totp_pending` token that
// staff-login issued, and proves it here from the request body. Mounted on
// totpPublicRouter because requireStaffAuth would reject it — that middleware
// looks for scope "staff", which does not exist yet at this point in the login.

totpPublicRouter.post("/verify-login", verifyLoginLimiter, async (req, res) => {
  const { tempToken, code, backupCode } = req.body as {
    tempToken?: string;
    code?: string;
    backupCode?: string;
  };

  if (!tempToken || (!code && !backupCode)) {
    res.status(400).json({ error: "Temp token and code are required" });
    return;
  }

  const [tempSession] = await db
    .select()
    .from(portalSessionsTable)
    .where(and(
      eq(portalSessionsTable.token, tempToken),
      eq(portalSessionsTable.scope, "totp_pending"),
    ))
    .limit(1);

  if (!tempSession) {
    res.status(401).json({ error: "Invalid or expired temp token" });
    return;
  }

  if (new Date(tempSession.expiresAt) < new Date()) {
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, tempToken));
    res.status(401).json({ error: "Temp token expired" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, tempSession.subjectId))
    .limit(1);

  if (!user || !user.totpEnabled || !user.totpSecret) {
    res.status(401).json({ error: "TOTP not enabled for this user" });
    return;
  }

  let verified = false;

  if (code) {
    const totp = new OTPAuth.TOTP({
      issuer: TOTP_ISSUER,
      label: user.username || user.email,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(user.totpSecret),
    });
    const delta = totp.validate({ token: code, window: TOTP_WINDOW });
    verified = delta !== null;
  } else if (backupCode) {
    const backupCodes = user.totpBackupCodes || [];
    const normalizedCode = backupCode.replace(/-/g, "").toUpperCase();
    const codeIndex = backupCodes.indexOf(normalizedCode);
    if (codeIndex !== -1) {
      backupCodes.splice(codeIndex, 1);
      await db
        .update(usersTable)
        .set({ totpBackupCodes: backupCodes })
        .where(eq(usersTable.id, user.id));
      verified = true;
    }
  }

  if (!verified) {
    res.status(401).json({ error: "Invalid TOTP code" });
    return;
  }

  const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
  const realToken = crypto.randomBytes(24).toString("hex");
  const now = new Date();

  await db.insert(portalSessionsTable).values({
    token: realToken,
    scope: "staff",
    subjectId: user.id,
    subjectName: user.name,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    ipAddress: tempSession.ipAddress,
    userAgent: tempSession.userAgent,
    lastActivityAt: now,
  });

  await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, tempToken));

  const permissions = await import("../lib/staffSessionUser").then(m => m.resolveStaffPermissions(user));

  void auditFromRequest(req, {
    userId: user.id,
    userName: user.name,
    role: normalizeRole(user.role),
    action: "totp_verified",
    module: "system",
    entityType: "user",
    entityId: String(user.id),
  });

  res.json({
    token: realToken,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
      role: normalizeRole(user.role),
      permissions,
      maxDiscount: user.maxDiscount ?? null,
      photoDataUrl: user.photoDataUrl ?? null,
      signatureDataUrl: user.signatureDataUrl ?? null,
      sidebarTheme: user.sidebarTheme ?? null,
      pacsNetworkProfile: user.pacsNetworkProfile ?? null,
      defaultStartPage: user.defaultStartPage ?? null,
      mustChangePin: user.mustChangePin === true,
    },
  });
});
