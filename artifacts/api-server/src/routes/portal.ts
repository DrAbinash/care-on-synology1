import { Router, type Request, type Response, type NextFunction } from "express";
import crypto from "node:crypto";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import {
  clinicSettingsTable,
  portalSessionsTable,
  patientsTable,
  usersTable,
  billsTable,
  paymentsTable,
  ordersTable,
  orderTestsTable,
  testsTable,
  appointmentsTable,
  appointmentCounterTable,
  doctorsTable,
  rolePermissionsTable,
} from "@workspace/db/schema";
import { eq, and, desc, gt, sql, count, or } from "drizzle-orm";
import { sanitizePatient } from "./patients";
import { requireStaffAuth, requireStaffPermission, normalizeRole } from "../middleware/requireStaffAuth";

export const portalRouter = Router();

// Session lifetime: 24 hours (full working day — avoids mid-shift expiry)
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

// ── LAN-only login helpers ────────────────────────────────────────────────────
// Resolve the client IP from multiple sources (Express req.ip, X-Forwarded-For,
// X-Real-Ip, socket remoteAddress). When behind a reverse proxy, req.ip can be
// empty or unhelpful; this fallback chain prevents accidental open-gate.
function resolveClientIp(req: Request): string {
  if (req.ip && req.ip.trim() !== "") return req.ip.trim();
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim() !== "") {
    const first = forwarded.split(",")[0].trim();
    if (first) return first;
  }
  const realIp = req.headers["x-real-ip"];
  if (typeof realIp === "string" && realIp.trim() !== "") return realIp.trim();
  const raw = req.socket?.remoteAddress;
  if (raw && raw.trim() !== "") return raw.trim();
  return "";
}

// Returns true if the IP is a private/loopback address (RFC 1918 + loopback)
// or is explicitly listed in the operator's extra allowlist.
function isLanOrAllowedIp(ip: string, extraIps: string[]): boolean {
  // Empty IP → cannot determine origin → DENY (prevents accidental open-gate
  // when proxies don't forward client addresses).
  if (!ip || ip.trim() === "") return false;

  // Strip IPv6-mapped IPv4 prefix (e.g. "::ffff:192.168.1.5" → "192.168.1.5")
  const clean = ip.replace(/^::ffff:/i, "");

  // Loopback — always allow (server-side calls, health checks)
  if (clean === "127.0.0.1" || clean === "::1") return true;

  // RFC 1918 private ranges
  const parts = clean.split(".").map(Number);
  if (parts.length === 4 && parts.every((p) => !isNaN(p))) {
    const [a, b] = parts;
    if (a === 10) return true;                         // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16.0.0/12
    if (a === 192 && b === 168) return true;            // 192.168.0.0/16
  }

  // Operator-defined extra IPs (exact match against raw or cleaned form)
  return extraIps.some((e) => {
    const t = e.trim();
    return t === clean || t === ip;
  });
}

// Allowed appointment time slots — matches the UI's fixed list.
// The server enforces this so callers cannot inject arbitrary slot strings.
const ALLOWED_SLOTS = new Set([
  "09:00 AM", "10:00 AM", "11:00 AM", "12:00 PM",
  "02:00 PM", "03:00 PM", "04:00 PM", "05:00 PM",
]);

// Maximum active (scheduled) appointments a single patient may hold at once.
const MAX_ACTIVE_APPOINTMENTS = 5;

// Per-patient login failure tracking (in-memory).
// Key: patient DB id. Value: { attempts, lockedUntil }
const patientLoginFailures = new Map<number, { attempts: number; lockedUntil: number }>();
const MAX_PATIENT_LOGIN_ATTEMPTS = 5;
const PATIENT_LOCKOUT_MS = 30 * 60 * 1000; // 30 minutes

// =====================================================================
// Rate limiters — keyed by IP address
// =====================================================================

const patientLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again in 15 minutes." },
});

const staffLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again in 15 minutes." },
});

// Throttle appointment creation: max 10 per hour per IP.
const appointmentBookingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many booking requests. Please try again later." },
});

// =====================================================================
// Helpers
// =====================================================================

async function pruneExpiredSessions() {
  try {
    await db.delete(portalSessionsTable).where(sql`${portalSessionsTable.expiresAt} < now()`);
  } catch {
    /* swallow */
  }
}

async function getSettings() {
  try {
    const rows = await db.select().from(clinicSettingsTable).limit(1);
    if (rows[0]) return rows[0];
    const [created] = await db.insert(clinicSettingsTable).values({}).returning();
    return created;
  } catch {
    // Drizzle schema may be ahead of the production DB (missing columns).
    // Return safe defaults so the portal UI can still load while migrations catch up.
    return {
      portalEnabled: false,
      fido2Enabled: false,
      portalHeading: "Care Diagnostics",
      portalWelcomeMessage: "",
      name: "Care Diagnostics",
      tagline: "Diagnostic & Pathology Services",
      address: "",
      phone: "",
      email: "",
      logoDataUrl: null,
      portalAllowAppointmentBooking: true,
      portalAllowProfileEdit: true,
    } as any;
  }
}

async function requirePortalEnabled(res: Response): Promise<boolean> {
  const s = await getSettings();
  if (!s.portalEnabled) {
    res.status(403).json({ error: "Patient portal is currently disabled" });
    return false;
  }
  return true;
}

// =====================================================================
// Public endpoints
// =====================================================================

// Public portal info — clients use this to render the landing page.
portalRouter.get("/settings", async (_req, res) => {
  const s = await getSettings();
  res.json({
    enabled: s.portalEnabled,
    fido2Enabled: s.fido2Enabled,
    heading: s.portalHeading || s.name,
    welcomeMessage: s.portalWelcomeMessage,
    centerName: s.name,
    tagline: s.tagline,
    address: s.address,
    phone: s.phone,
    email: s.email,
    logoDataUrl: s.logoDataUrl,
    allowAppointmentBooking: s.portalAllowAppointmentBooking,
    allowProfileEdit: s.portalAllowProfileEdit,
  });
});

// Patient login — phone + date of birth + staff-issued portal access code.
//
// Three factors are required:
//   1. Registered phone number (last-10-digit match)
//   2. Date of birth (exact string match)
//   3. Portal access code — a PIN set by reception staff; stored as a bcrypt
//      hash in patients.portal_pin_hash. Without this code a caller who knows
//      a patient's demographics cannot log in.
//
// Per-patient lockout: after 5 wrong access-code attempts the patient account
// is locked for 30 minutes, limiting brute-force attacks on the PIN.
portalRouter.post("/patient-login", patientLoginLimiter, async (req, res) => {
  if (!(await requirePortalEnabled(res))) return;

  const phone = String(req.body?.phone ?? "").trim();
  const dob = String(req.body?.dateOfBirth ?? "").trim();
  const accessCode = String(req.body?.accessCode ?? "").trim();

  if (!phone || !dob) {
    res.status(400).json({ error: "Mobile number and date of birth are required" });
    return;
  }
  // NOTE: accessCode is optional while portal PIN self-service is not yet enabled.

  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) {
    res.status(400).json({ error: "Please enter a valid mobile number" });
    return;
  }

  // Normalize DOB to YYYY-MM-DD (accept YYYY-MM-DD or DD/MM/YYYY or DD-MM-YYYY)
  let normalizedDob = dob;
  if (/^\d{2}[\/\-]\d{2}[\/\-]\d{4}$/.test(dob)) {
    const parts = dob.split(/[\/\-]/);
    normalizedDob = `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDob)) {
    res.status(400).json({ error: "Please enter a valid date of birth (DD/MM/YYYY)" });
    return;
  }

  // Look up by phone (last-10-digits match to handle +91 etc.)
  const last10 = digits.slice(-10);
  const matches = await db
    .select()
    .from(patientsTable)
    .where(sql`regexp_replace(${patientsTable.phone}, '\\D', '', 'g') LIKE ${"%" + last10}`);

  // Use a generic 401 for both "unknown phone" and "wrong DOB" to prevent
  // patient enumeration via the API.
  const genericError = "We could not verify your identity. Please check your mobile number, date of birth, and portal access code, or contact reception.";

  if (matches.length === 0) {
    res.status(401).json({ error: genericError });
    return;
  }

  if (matches.length > 1) {
    matches.sort((a, b) => (b.createdAt?.getTime?.() ?? 0) - (a.createdAt?.getTime?.() ?? 0));
  }
  const patient = matches[0];

  // Factor 2: date of birth must match
  if (!patient.dateOfBirth || patient.dateOfBirth.trim() !== normalizedDob) {
    res.status(401).json({ error: genericError });
    return;
  }

  // Factor 3: portal access code (optional while self-service PIN is not enabled).
  // If the patient has a portalPinHash and an accessCode is supplied, verify it.
  // Otherwise login with phone + DOB only.
  if (accessCode && patient.portalPinHash) {
    // Per-patient lockout check
    const now = Date.now();
    const failure = patientLoginFailures.get(patient.id);
    if (failure && failure.lockedUntil > now) {
      const minutesLeft = Math.ceil((failure.lockedUntil - now) / 60_000);
      res.status(429).json({
        error: `Too many incorrect access code attempts. Please try again in ${minutesLeft} minute${minutesLeft !== 1 ? "s" : ""} or contact reception.`,
      });
      return;
    }

    const codeMatches = await bcrypt.compare(accessCode, patient.portalPinHash);
    if (!codeMatches) {
      const prev = patientLoginFailures.get(patient.id) ?? { attempts: 0, lockedUntil: 0 };
      const newAttempts = prev.attempts + 1;
      if (newAttempts >= MAX_PATIENT_LOGIN_ATTEMPTS) {
        patientLoginFailures.set(patient.id, { attempts: newAttempts, lockedUntil: now + PATIENT_LOCKOUT_MS });
      } else {
        patientLoginFailures.set(patient.id, { attempts: newAttempts, lockedUntil: 0 });
      }
      res.status(401).json({ error: genericError });
      return;
    }

    // Successful PIN verify — clear failure record
    patientLoginFailures.delete(patient.id);
  }

  await pruneExpiredSessions();
  const token = crypto.randomBytes(24).toString("hex");
  await db.insert(portalSessionsTable).values({
    token,
    scope: "patient",
    subjectId: patient.id,
    subjectName: `${patient.firstName} ${patient.lastName}`.trim(),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });

  res.json({
    token,
    patient: {
      id: patient.id,
      patientId: patient.patientId,
      firstName: patient.firstName,
      lastName: patient.lastName,
      phone: patient.phone,
      email: patient.email,
      photoDataUrl: patient.photoDataUrl,
    },
  });
});

// Staff login — email + PIN against existing users table.
// PINs are stored as bcrypt hashes; plaintext legacy values are migrated
// transparently on the first successful login.
portalRouter.post("/staff-login", staffLoginLimiter, async (req, res) => {
  // Staff login is always available regardless of patient-portal toggle.
  // Accept the new `username` field as the primary handle, but keep the
  // older `email` field too so any saved/autofilled creds keep working.
  // Either one can be supplied — we look up by username first, then fall
  // back to email so legacy users (no username assigned) can still sign in.
  const handle = String(req.body?.username ?? req.body?.email ?? "")
    .trim()
    .toLowerCase();
  const pin = String(req.body?.pin ?? "").trim();
  if (!handle || !pin) {
    res.status(400).json({ error: "Username and PIN are required" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(or(eq(usersTable.username, handle), eq(usersTable.email, handle)))
    .limit(1);
  if (!user || !user.isActive || !user.pin) {
    res.status(401).json({ error: "Invalid username or PIN" });
    return;
  }

  // ── Account lockout check ────────────────────────────────────────────────
  // Super-admins are exempt.  If lockedUntil is in the future, reject login
  // with a clear message so the UI can show lockout status.
  if (normalizeRole(user.role) !== "super_admin") {
    if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
      const remaining = Math.ceil((new Date(user.lockedUntil).getTime() - Date.now()) / 60000);
      res.status(403).json({ error: `Account locked. Try again in ${remaining} minute(s).` });
      return;
    }
  }

  const pinMatches = await verifyPin(pin, user.pin);
  if (!pinMatches) {
    // ── Failed-login bookkeeping (non-super-admin only) ───────────────────
    if (normalizeRole(user.role) !== "super_admin") {
      const [cfg] = await db
        .select({ maxFailed: clinicSettingsTable.maxFailedLoginAttempts, lockoutMinutes: clinicSettingsTable.accountLockoutDurationMinutes })
        .from(clinicSettingsTable)
        .limit(1);
      const maxFailed = cfg?.maxFailed ?? 5;
      const lockoutMinutes = cfg?.lockoutMinutes ?? 30;
      const newAttempts = (user.failedLoginAttempts ?? 0) + 1;
      let lockedUntil: Date | null = user.lockedUntil ?? null;
      if (newAttempts >= maxFailed && maxFailed > 0) {
        lockedUntil = new Date(Date.now() + lockoutMinutes * 60_000);
      }
      await db.update(usersTable)
        .set({ failedLoginAttempts: newAttempts, lockedUntil: lockedUntil ? new Date(lockedUntil) : null })
        .where(eq(usersTable.id, user.id));

      // Alert admin on lockout
      if (lockedUntil && lockedUntil > new Date()) {
        const ipAddress = resolveClientIp(req);
        void import("../email").then(({ sendAccountLockedEmail }) =>
          sendAccountLockedEmail({
            userName: user.name,
            userEmail: user.email,
            attempts: newAttempts,
            lockedUntil,
            ipAddress,
          }),
        );
      }
    }
    res.status(401).json({ error: "Invalid username or PIN" });
    return;
  }

  // Reset failed attempts on successful login
  if ((user.failedLoginAttempts ?? 0) > 0 || user.lockedUntil) {
    await db.update(usersTable)
      .set({ failedLoginAttempts: 0, lockedUntil: null })
      .where(eq(usersTable.id, user.id));
  }

  // Transparently upgrade plaintext legacy PINs to bcrypt on first successful login
  if (!isBcryptHash(user.pin)) {
    const hashed = await bcrypt.hash(pin, 12);
    await db.update(usersTable).set({ pin: hashed }).where(eq(usersTable.id, user.id));
  }

  // ── LAN-only login enforcement ────────────────────────────────────────────
  // Admin and super_admin roles are always exempt. For all other roles, if the
  // clinic has enabled LAN-only login, reject requests coming from outside
  // the hospital network.
  if (normalizeRole(user.role) !== "admin" && normalizeRole(user.role) !== "super_admin") {
    const [cfg] = await db
      .select({ lanOnlyLogin: clinicSettingsTable.lanOnlyLogin, lanAllowedIps: clinicSettingsTable.lanAllowedIps })
      .from(clinicSettingsTable)
      .limit(1);
    if (cfg?.lanOnlyLogin) {
      let extraIps: string[] = [];
      try { extraIps = JSON.parse(cfg.lanAllowedIps ?? "[]"); } catch { /* ignore */ }
      const clientIp = resolveClientIp(req);
      if (!isLanOrAllowedIp(clientIp, extraIps)) {
        res.status(403).json({ error: "Login is only allowed from within the hospital network." });
        return;
      }
    }
  }

  // ── Derive permissions from role_permissions table (source of truth) ────
  // Query the role_permissions matrix for this user's role and translate
  // module names into the legacy path-permission strings the ERP sidebar
  // and middleware expect. Also add legacy piggyback paths so /form-f,
  // /report-generator, /signatures, /patient-reports, etc. flow through.
  const MODULE_TO_PATH: Record<string, string> = {
    dashboard: "/dashboard",
    patients: "/patients",
    appointments: "/appointments",
    queue: "/queue",
    billing: "/billing",
    payments: "/payments",
    orders: "/orders",
    tests: "/tests",
    reports: "/reports",
    radiology: "/radiology/worklist", // radiology gets access to all radiology subpaths
    lab: "/samples",
    doctors: "/doctors",
    commission: "/referrals",
    accounting: "/accounting",
    inventory: "/inventory",
    expenses: "/expenses",
    form_f: "/form-f",
    settings: "/settings",
    backups: "/backups",
    audit: "/audit",
    banking: "/banking",
  };
  const LEGACY_PIGGYBACKS: Record<string, string[]> = {
    "/reports": ["/report-generator", "/patient-reports", "/signatures"],
    "/radiology/worklist": ["/radiology/reporting-workspace", "/radiology/pacs-dashboard", "/pacs", "/teleradiology", "/radiology/dicom-qr"],
    "/samples": ["/scan-station", "/report-hub", "/report-delivery"],
    "/patients": ["/register"],
    "/billing": ["/", "/dues"],
    "/dashboard": ["/my-daily-summary"],
  };

  let derivedPermissions: string[] = [];
  if (normalizeRole(user.role) !== "admin" && normalizeRole(user.role) !== "super_admin") {
    const rolePerms = await db
      .select()
      .from(rolePermissionsTable)
      .where(eq(rolePermissionsTable.role, user.role));
    for (const rp of rolePerms) {
      if (rp.canView) {
        const path = MODULE_TO_PATH[rp.module];
        if (path && !derivedPermissions.includes(path)) {
          derivedPermissions.push(path);
          // Add piggyback paths
          const extras = LEGACY_PIGGYBACKS[path];
          if (extras) {
            for (const extra of extras) {
              if (!derivedPermissions.includes(extra)) derivedPermissions.push(extra);
            }
          }
        }
      }
    }
  }

  // Merge with legacy JSON stored in users.permissions (as fallback for
  // modules not yet in the matrix, or for backward compat)
  let legacyPermissions: string[] = [];
  try {
    if (user.permissions) {
      const parsed = JSON.parse(user.permissions);
      if (Array.isArray(parsed)) legacyPermissions = parsed.filter((p) => typeof p === "string");
    }
  } catch { /* ignore — empty permissions */ }

  const permissions = normalizeRole(user.role) === "admin" || normalizeRole(user.role) === "super_admin"
    ? legacyPermissions // admins keep all legacy paths (they bypass checks anyway)
    : Array.from(new Set([...derivedPermissions, ...legacyPermissions]));

  // Persist derived permissions back to users.permissions so every
  // request uses fresh permissions without re-querying role_permissions.
  if (normalizeRole(user.role) !== "admin" && normalizeRole(user.role) !== "super_admin") {
    await db
      .update(usersTable)
      .set({ permissions: JSON.stringify(permissions) })
      .where(eq(usersTable.id, user.id));
  }

  // ── Concurrent session limit enforcement ────────────────────────────────
  // If the user has maxConcurrentSessions > 0, use that. Otherwise fall
  // back to the clinic-wide default. Super-admins are exempt.
  if (normalizeRole(user.role) !== "admin" && normalizeRole(user.role) !== "super_admin") {
    const limit = user.maxConcurrentSessions > 0
      ? user.maxConcurrentSessions
      : ((await db.select({ v: clinicSettingsTable.defaultMaxConcurrentSessions }).from(clinicSettingsTable).limit(1))[0]?.v ?? 3);
    const activeSessions = await db
      .select({ id: portalSessionsTable.id })
      .from(portalSessionsTable)
      .where(and(
        eq(portalSessionsTable.scope, "staff"),
        eq(portalSessionsTable.subjectId, user.id),
        gt(portalSessionsTable.expiresAt, new Date()),
      ));
    if (activeSessions.length >= (limit ?? 3)) {
      // Invalidate oldest sessions until we're under the limit
      const toRemove = activeSessions.slice(0, activeSessions.length - (limit ?? 3) + 1);
      for (const s of toRemove) {
        await db.delete(portalSessionsTable).where(eq(portalSessionsTable.id, s.id));
      }
    }
  }

  await pruneExpiredSessions();
  const token = crypto.randomBytes(24).toString("hex");
  const now = new Date();
  const ipAddress = resolveClientIp(req);
  const userAgent = String(req.headers["user-agent"] ?? "").substring(0, 255);
  await db.insert(portalSessionsTable).values({
    token,
    scope: "staff",
    subjectId: user.id,
    subjectName: user.name,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    ipAddress,
    userAgent,
    lastActivityAt: now,
  });

  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
      role: normalizeRole(user.role),
      permissions,
      maxDiscount: user.maxDiscount ?? null,
      photoDataUrl: user.photoDataUrl ?? null,
      sidebarTheme: user.sidebarTheme ?? null,
      pacsNetworkProfile: user.pacsNetworkProfile ?? null,
      defaultStartPage: user.defaultStartPage ?? null,
      // Frontend uses this to force a PIN-change screen before letting
      // the user into the ERP. The flag is cleared by /staff-change-pin.
      mustChangePin: user.mustChangePin === true,
    },
  });
});

// First-login PIN change. Authenticated by the staff session token issued
// by /staff-login. The user proves knowledge of the current PIN, picks a
// new one, and we clear the must_change_pin flag in the same write so they
// can land in the ERP without being bounced again.
portalRouter.post("/staff-change-pin", async (req, res) => {
  // Staff PIN change is always available regardless of patient-portal toggle.
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) {
    res.status(401).json({ error: "Login required" });
    return;
  }

  const [session] = await db
    .select()
    .from(portalSessionsTable)
    .where(and(
      eq(portalSessionsTable.token, token),
      eq(portalSessionsTable.scope, "staff"),
      gt(portalSessionsTable.expiresAt, new Date()),
    ))
    .limit(1);
  if (!session) {
    res.status(401).json({ error: "Session expired — please sign in again" });
    return;
  }

  const currentPin = String(req.body?.currentPin ?? "").trim();
  const newPin = String(req.body?.newPin ?? "").trim();
  if (!currentPin || !newPin) {
    res.status(400).json({ error: "currentPin and newPin are required" });
    return;
  }
  if (newPin.length < 4) {
    res.status(400).json({ error: "New PIN must be at least 4 characters" });
    return;
  }
  if (currentPin === newPin) {
    res.status(400).json({ error: "New PIN must be different from the current PIN" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, session.subjectId)).limit(1);
  if (!user || !user.pin) {
    res.status(401).json({ error: "Account not found" });
    return;
  }
  if (!(await verifyPin(currentPin, user.pin))) {
    res.status(401).json({ error: "Current PIN is incorrect" });
    return;
  }

  const hashed = await bcrypt.hash(newPin, 12);
  await db
    .update(usersTable)
    .set({ pin: hashed, mustChangePin: false })
    .where(eq(usersTable.id, user.id));

  res.json({ ok: true });
});

// =====================================================================
// PIN helpers
// =====================================================================

function isBcryptHash(value: string): boolean {
  return value.startsWith("$2a$") || value.startsWith("$2b$") || value.startsWith("$2y$");
}

// Constant-time PIN verification with plaintext legacy fallback
async function verifyPin(plain: string, stored: string): Promise<boolean> {
  if (isBcryptHash(stored)) {
    return bcrypt.compare(plain, stored);
  }
  // Legacy plaintext — constant-time compare using crypto.timingSafeEqual
  const a = Buffer.from(plain);
  const b = Buffer.from(stored);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// =====================================================================
// Authenticated middleware — patient scope
// =====================================================================

interface PortalAuthRequest extends Request {
  portalSession?: { id: number; scope: string; subjectId: number; subjectName: string };
}

async function requirePatientAuth(req: PortalAuthRequest, res: Response, next: NextFunction) {
  if (!(await requirePortalEnabled(res))) return;

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) {
    res.status(401).json({ error: "Login required" });
    return;
  }

  const [session] = await db
    .select()
    .from(portalSessionsTable)
    .where(and(eq(portalSessionsTable.token, token), gt(portalSessionsTable.expiresAt, new Date())))
    .limit(1);

  if (!session || session.scope !== "patient") {
    res.status(401).json({ error: "Session expired. Please log in again." });
    return;
  }

  req.portalSession = session;
  next();
}

// =====================================================================
// Staff-only admin endpoints
// =====================================================================

// Set or reset a patient's portal access code.
// Staff must be authenticated. The code is bcrypt-hashed before storage.
// Send { patientId: number, accessCode: string } to set a new code, or
// { patientId: number, accessCode: null } to revoke portal access.
portalRouter.post("/admin/set-patient-portal-code", requireStaffAuth, requireStaffPermission("/patients"), async (req: PortalAuthRequest, res) => {
  const patientId = req.body?.patientId == null ? null : Number(req.body.patientId);
  if (!Number.isInteger(patientId) || (patientId as number) <= 0) {
    res.status(400).json({ error: "patientId must be a positive integer" });
    return;
  }

  const raw = req.body?.accessCode;

  if (raw === null || raw === undefined || String(raw).trim() === "") {
    // Revoke access
    await db
      .update(patientsTable)
      .set({ portalPinHash: null, updatedAt: new Date() })
      .where(eq(patientsTable.id, patientId as number));
    // Clear any failure tracking
    patientLoginFailures.delete(patientId as number);
    res.json({ ok: true, message: "Portal access revoked for patient" });
    return;
  }

  const code = String(raw).trim();
  if (code.length < 4 || code.length > 20) {
    res.status(400).json({ error: "Access code must be 4–20 characters" });
    return;
  }

  const hash = await bcrypt.hash(code, 12);
  const [updated] = await db
    .update(patientsTable)
    .set({ portalPinHash: hash, updatedAt: new Date() })
    .where(eq(patientsTable.id, patientId as number))
    .returning({ id: patientsTable.id });

  if (!updated) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  // Clear any existing lockout when staff resets the code
  patientLoginFailures.delete(patientId as number);
  res.json({ ok: true, message: "Portal access code updated" });
});

// Check whether a patient has a portal access code set (without revealing the hash).
portalRouter.get("/admin/patient-portal-status/:patientId", requireStaffAuth, requireStaffPermission("/patients"), async (req: PortalAuthRequest, res) => {
  const patientId = Number(req.params.patientId);
  if (!Number.isInteger(patientId) || patientId <= 0) {
    res.status(400).json({ error: "Invalid patient ID" });
    return;
  }
  const [p] = await db
    .select({ id: patientsTable.id, portalPinHash: patientsTable.portalPinHash })
    .from(patientsTable)
    .where(eq(patientsTable.id, patientId))
    .limit(1);
  if (!p) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  res.json({ hasPortalAccess: p.portalPinHash !== null });
});

// =====================================================================
// Patient self-service endpoints
// =====================================================================

// Logout (any scope)
portalRouter.post("/logout", async (req, res) => {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (token) await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token));
  res.json({ ok: true });
});

// Profile
portalRouter.get("/me", requirePatientAuth, async (req: PortalAuthRequest, res) => {
  const id = req.portalSession!.subjectId;
  const [p] = await db.select().from(patientsTable).where(eq(patientsTable.id, id)).limit(1);
  if (!p) { res.status(404).json({ error: "Patient not found" }); return; }
  res.json(sanitizePatient(p));
});

portalRouter.put("/me", requirePatientAuth, async (req: PortalAuthRequest, res) => {
  const s = await getSettings();
  if (!s.portalAllowProfileEdit) {
    res.status(403).json({ error: "Profile editing is disabled by the clinic" });
    return;
  }
  const id = req.portalSession!.subjectId;
  const allowed = ["firstName", "lastName", "phone", "email", "address", "bloodGroup"] as const;
  const update: Record<string, unknown> = { updatedAt: new Date() };
  for (const f of allowed) {
    const v = req.body?.[f];
    if (v !== undefined) {
      if (v !== null && typeof v !== "string") {
        res.status(400).json({ error: `${f} must be a string` });
        return;
      }
      const trimmed = typeof v === "string" ? v.trim() : v;
      // Per-field validation
      if (f === "firstName" || f === "lastName") {
        if (!trimmed || (trimmed as string).length < 1 || (trimmed as string).length > 100) {
          res.status(400).json({ error: `${f === "firstName" ? "First" : "Last"} name is required (max 100 chars)` });
          return;
        }
      }
      if (f === "phone") {
        const digits = String(trimmed ?? "").replace(/\D/g, "");
        if (digits.length < 6 || digits.length > 20) {
          res.status(400).json({ error: "Please enter a valid mobile number — you'll need it to log in." });
          return;
        }
      }
      if (f === "email" && trimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed as string)) {
        res.status(400).json({ error: "Please enter a valid email address" });
        return;
      }
      if (typeof trimmed === "string" && trimmed.length > 500) {
        res.status(400).json({ error: `${f} too long (max 500 chars)` });
        return;
      }
      update[f] = trimmed === "" ? null : trimmed;
    }
  }
  if (Object.keys(update).length <= 1) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }
  const [updated] = await db.update(patientsTable).set(update).where(eq(patientsTable.id, id)).returning();
  res.json(sanitizePatient(updated));
});

// Bills + payments
portalRouter.get("/me/bills", requirePatientAuth, async (req: PortalAuthRequest, res) => {
  const id = req.portalSession!.subjectId;
  const bills = await db
    .select()
    .from(billsTable)
    .where(eq(billsTable.patientId, id))
    .orderBy(desc(billsTable.createdAt));

  // Attach payment summary
  const enriched = await Promise.all(
    bills.map(async (b) => {
      const pays = await db.select().from(paymentsTable).where(eq(paymentsTable.billId, b.id));
      return { ...b, payments: pays };
    }),
  );
  res.json(enriched);
});

// Visit history (orders)
portalRouter.get("/me/visits", requirePatientAuth, async (req: PortalAuthRequest, res) => {
  const id = req.portalSession!.subjectId;
  const orders = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.patientId, id))
    .orderBy(desc(ordersTable.createdAt));

  const enriched = await Promise.all(
    orders.map(async (o) => {
      const tests = await db
        .select({
          id: orderTestsTable.id,
          testId: orderTestsTable.testId,
          testName: testsTable.name,
          price: orderTestsTable.price,
          result: orderTestsTable.result,
          resultStatus: orderTestsTable.resultStatus,
        })
        .from(orderTestsTable)
        .leftJoin(testsTable, eq(orderTestsTable.testId, testsTable.id))
        .where(eq(orderTestsTable.orderId, o.id));
      return { ...o, tests };
    }),
  );
  res.json(enriched);
});

// Reports = completed test results (exposed via order tests with result text)
portalRouter.get("/me/reports", requirePatientAuth, async (req: PortalAuthRequest, res) => {
  const id = req.portalSession!.subjectId;
  const rows = await db
    .select({
      orderId: ordersTable.id,
      orderNumber: ordersTable.orderNumber,
      orderDate: ordersTable.createdAt,
      testId: orderTestsTable.testId,
      testName: testsTable.name,
      result: orderTestsTable.result,
      resultStatus: orderTestsTable.resultStatus,
    })
    .from(orderTestsTable)
    .innerJoin(ordersTable, eq(orderTestsTable.orderId, ordersTable.id))
    .leftJoin(testsTable, eq(orderTestsTable.testId, testsTable.id))
    .where(eq(ordersTable.patientId, id))
    .orderBy(desc(ordersTable.createdAt));

  // Only show ones that have a result captured
  res.json(rows.filter((r) => r.result && r.result.trim().length > 0));
});

// Appointments
portalRouter.get("/me/appointments", requirePatientAuth, async (req: PortalAuthRequest, res) => {
  const id = req.portalSession!.subjectId;
  const rows = await db
    .select({
      appointment: appointmentsTable,
      doctor: { id: doctorsTable.id, name: doctorsTable.name },
    })
    .from(appointmentsTable)
    .leftJoin(doctorsTable, eq(appointmentsTable.doctorId, doctorsTable.id))
    .where(eq(appointmentsTable.patientId, id))
    .orderBy(desc(appointmentsTable.appointmentDate), desc(appointmentsTable.createdAt));

  res.json(rows.map((r) => ({ ...r.appointment, doctor: r.doctor })));
});

portalRouter.post(
  "/me/appointments",
  appointmentBookingLimiter,
  requirePatientAuth,
  async (req: PortalAuthRequest, res) => {
    const s = await getSettings();
    if (!s.portalAllowAppointmentBooking) {
      res.status(403).json({ error: "Appointment booking is disabled by the clinic" });
      return;
    }

    const id = req.portalSession!.subjectId;
    const date = String(req.body?.appointmentDate ?? "").trim();
    const slot = String(req.body?.timeSlot ?? "").trim();
    const doctorId = req.body?.doctorId == null ? null : Number(req.body.doctorId);
    const notes = req.body?.notes ? String(req.body.notes).slice(0, 500) : null;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: "Please pick a valid date" });
      return;
    }
    if (!slot) {
      res.status(400).json({ error: "Please pick a time slot" });
      return;
    }
    // Reject slots not in the clinic's allowed list
    if (!ALLOWED_SLOTS.has(slot)) {
      res.status(400).json({ error: "Please select a valid time slot" });
      return;
    }
    // Reject past dates
    if (new Date(date + "T23:59:59").getTime() < Date.now() - 24 * 3600_000) {
      res.status(400).json({ error: "Date is in the past" });
      return;
    }
    if (doctorId != null && (!Number.isInteger(doctorId) || doctorId <= 0)) {
      res.status(400).json({ error: "Invalid doctor" });
      return;
    }

    // Validate doctor exists if specified
    if (doctorId != null) {
      const [doc] = await db
        .select({ id: doctorsTable.id })
        .from(doctorsTable)
        .where(eq(doctorsTable.id, doctorId))
        .limit(1);
      if (!doc) {
        res.status(400).json({ error: "Selected doctor not found" });
        return;
      }
    }

    // Enforce maximum active appointments per patient
    const [{ activeCount }] = await db
      .select({ activeCount: count() })
      .from(appointmentsTable)
      .where(
        and(
          eq(appointmentsTable.patientId, id),
          eq(appointmentsTable.status, "scheduled"),
        ),
      );
    if (Number(activeCount) >= MAX_ACTIVE_APPOINTMENTS) {
      res.status(422).json({
        error: `You already have ${MAX_ACTIVE_APPOINTMENTS} scheduled appointments. Please cancel an existing appointment before booking a new one.`,
      });
      return;
    }

    // Prevent duplicate bookings (same patient + date + slot)
    const [duplicate] = await db
      .select({ id: appointmentsTable.id })
      .from(appointmentsTable)
      .where(
        and(
          eq(appointmentsTable.patientId, id),
          eq(appointmentsTable.appointmentDate, date),
          eq(appointmentsTable.timeSlot, slot),
          eq(appointmentsTable.status, "scheduled"),
        ),
      )
      .limit(1);
    if (duplicate) {
      res.status(409).json({ error: "You already have an appointment booked for that date and time slot" });
      return;
    }

    // Generate appointment ID — atomic increment to avoid race conditions
    // when multiple patients book simultaneously.
    let seq: number;
    const updated = await db
      .update(appointmentCounterTable)
      .set({ counter: sql`${appointmentCounterTable.counter} + 1` })
      .returning({ counter: appointmentCounterTable.counter });
    if (updated.length > 0) {
      seq = updated[0].counter;
    } else {
      const [created] = await db.insert(appointmentCounterTable).values({ counter: 1 }).returning();
      seq = created.counter;
    }
    const now = new Date();
    const yymm = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}`;
    const apptId = `APT-${yymm}-${String(seq).padStart(4, "0")}`;

    const [created] = await db
      .insert(appointmentsTable)
      .values({
        appointmentId: apptId,
        patientId: id,
        doctorId,
        appointmentDate: date,
        timeSlot: slot,
        status: "scheduled",
        type: "portal",
        notes,
      })
      .returning();
    res.status(201).json(created);
  },
);

// Public list of doctors (for booking dropdown). No PII beyond name.
portalRouter.get("/doctors", async (_req, res) => {
  if (!(await requirePortalEnabled(res))) return;
  const rows = await db
    .select({ id: doctorsTable.id, name: doctorsTable.name, specialization: doctorsTable.specialization })
    .from(doctorsTable);
  res.json(rows);
});
