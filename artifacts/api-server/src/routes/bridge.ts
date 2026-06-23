// Fingerprint Bridge API
// Pairs with a small desktop service (see /bridge-service) that talks to USB
// scanners (ZKTeco, Mantra MFS100, Morpho, etc.) via vendor SDK and performs
// the actual capture + matching locally. The server only stores templates and
// records identification results — never the raw biometric data.
import { Router, type Request, type Response, type NextFunction } from "express";
import crypto from "crypto";
import { db } from "@workspace/db";
import {
  staffTable, staffAttendanceTable,
  bridgeFingerprintTemplatesTable, userSessionsTable,
  usersTable, portalSessionsTable,
} from "@workspace/db/schema";
import { eq, and, sql, desc, gt } from "drizzle-orm";
import { todayIST } from "../lib/istDate";

export const bridgeRouter = Router();

const SESSION_HOURS = 8;

// Bridge MUST present a shared secret. If the env var is not set the server
// refuses all authenticated bridge requests so the service is never left open.
const BRIDGE_SECRET = process.env["FINGERPRINT_BRIDGE_SECRET"] ?? "";

function requireBridgeAuth(req: Request, res: Response, next: NextFunction) {
  if (!BRIDGE_SECRET) {
    res.status(503).json({ error: "Bridge authentication is not configured on this server. Set FINGERPRINT_BRIDGE_SECRET." });
    return;
  }
  const provided = String(req.headers["x-bridge-secret"] ?? "");
  if (provided !== BRIDGE_SECRET) {
    res.status(401).json({ error: "Bridge auth failed" });
    return;
  }
  next();
}

// ── Challenge token stores ────────────────────────
// All sensitive bridge operations require a short-lived, single-use challenge
// token obtained from the ERP server before the bridge is permitted to act.
// This ensures that raw fetch() calls from arbitrary scripts cannot trigger
// biometric operations without going through the proper ERP authorization flow.

interface SimpleChallenge {
  expiresAt: number;
  used: boolean;
}

interface EnrollChallenge extends SimpleChallenge {
  scope: "staff" | "user";
  scopeId: number;
}

const ENROLL_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const PUNCH_CHALLENGE_TTL_MS = 2 * 60 * 1000;
const LOGIN_CHALLENGE_TTL_MS = 2 * 60 * 1000;
const CAPTURE_CHALLENGE_TTL_MS = 2 * 60 * 1000;
const CAPTURE_CHALLENGE_MIN_ROLE = new Set(["admin", "super_admin"]);

const enrollChallenges = new Map<string, EnrollChallenge>();
const punchChallenges = new Map<string, SimpleChallenge>();
const loginChallenges = new Map<string, SimpleChallenge>();
const captureChallenges = new Map<string, SimpleChallenge>();

setInterval(() => {
  const now = Date.now();
  for (const [token, ch] of enrollChallenges) {
    if (ch.used || ch.expiresAt < now) enrollChallenges.delete(token);
  }
  for (const [token, ch] of punchChallenges) {
    if (ch.used || ch.expiresAt < now) punchChallenges.delete(token);
  }
  for (const [token, ch] of loginChallenges) {
    if (ch.used || ch.expiresAt < now) loginChallenges.delete(token);
  }
  for (const [token, ch] of captureChallenges) {
    if (ch.used || ch.expiresAt < now) captureChallenges.delete(token);
  }
}, 60_000);

/** Validates a simple challenge map entry: exists, unused, not expired. Marks it used on success. */
function consumeChallenge(map: Map<string, SimpleChallenge>, token: string): { ok: true } | { ok: false; status: number; error: string } {
  if (!token) return { ok: false, status: 401, error: "Challenge token required" };
  const ch = map.get(token);
  if (!ch) return { ok: false, status: 401, error: "Invalid challenge token" };
  if (ch.used) return { ok: false, status: 401, error: "Challenge token has already been used" };
  if (Date.now() > ch.expiresAt) { map.delete(token); return { ok: false, status: 401, error: "Challenge token has expired" }; }
  ch.used = true;
  return { ok: true };
}

/** Validates a staff Bearer token and returns the session row, or null if invalid/expired. */
async function validateStaffToken(authHeader: string) {
  const raw = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!raw) return null;
  const [session] = await db
    .select()
    .from(portalSessionsTable)
    .where(and(eq(portalSessionsTable.token, raw), eq(portalSessionsTable.scope, "staff"), gt(portalSessionsTable.expiresAt, new Date())))
    .limit(1);
  return session ?? null;
}

// ── Health & configuration ────────────────────────
bridgeRouter.get("/info", (_req, res) => {
  res.json({
    requiresAuth: !!BRIDGE_SECRET,
    sessionHours: SESSION_HOURS,
    serverTime: new Date().toISOString(),
    supportedScopes: ["staff", "user"],
  });
});

// ── Issue a capture challenge token ───────────────
// Requires a valid staff session. The ERP UI must call this before asking the
// bridge to perform a raw fingerprint capture, ensuring that biometric template
// data is never exposed without going through a proper authorization flow.
bridgeRouter.post("/capture-challenge", async (req, res) => {
  const session = await validateStaffToken(String(req.headers.authorization ?? ""));
  if (!session) {
    res.status(401).json({ error: "Staff session required to initiate fingerprint capture" });
    return;
  }

  const [caller] = await db
    .select({ id: usersTable.id, role: usersTable.role, permissions: usersTable.permissions })
    .from(usersTable)
    .where(eq(usersTable.id, session.subjectId))
    .limit(1);

  let parsedPerms: string[] = [];
  try {
    if (caller?.permissions) {
      const p = JSON.parse(caller.permissions);
      if (Array.isArray(p)) parsedPerms = p.filter((v: unknown): v is string => typeof v === "string");
    }
  } catch {}

  const hasSettingsPerm = parsedPerms.includes("/settings");
  if (!caller || (!CAPTURE_CHALLENGE_MIN_ROLE.has(caller.role) && !hasSettingsPerm)) {
    res.status(403).json({ error: "Only administrators or settings-level staff can initiate fingerprint capture" });
    return;
  }

  const captureToken = crypto.randomBytes(32).toString("hex");
  captureChallenges.set(captureToken, { expiresAt: Date.now() + CAPTURE_CHALLENGE_TTL_MS, used: false });
  res.json({ captureToken, expiresInSeconds: CAPTURE_CHALLENGE_TTL_MS / 1000 });
});

// ── Issue an enrollment challenge token ──────────
// Requires a valid staff session with admin/settings permission.
// Returns a short-lived one-time token that authorises exactly one enrollment
// of the requested scope/scopeId through the bridge. The bridge must present
// this token as x-enroll-token when it calls /api/bridge/enroll.
bridgeRouter.post("/enroll-challenge", async (req, res) => {
  const session = await validateStaffToken(String(req.headers.authorization ?? ""));
  if (!session) {
    res.status(401).json({ error: "Staff session required to initiate fingerprint enrollment" });
    return;
  }

  const [caller] = await db.select({ id: usersTable.id, role: usersTable.role, permissions: usersTable.permissions })
    .from(usersTable).where(eq(usersTable.id, session.subjectId)).limit(1);

  const body = req.body as { scope?: string; scopeId?: number };
  const scope = body.scope === "user" ? "user" : "staff";
  const scopeId = Number(body.scopeId);
  if (!scopeId) {
    res.status(400).json({ error: "scopeId required" });
    return;
  }

  const ADMIN_ROLES = new Set(["admin", "super_admin"]);
  const isAdmin = caller && ADMIN_ROLES.has(caller.role);
  let parsedPerms: string[] = [];
  try {
    if (caller?.permissions) {
      const p = JSON.parse(caller.permissions);
      if (Array.isArray(p)) parsedPerms = p.filter((v: unknown) => typeof v === "string");
    }
  } catch { /* leave empty */ }
  const hasSettingsPerm = parsedPerms.includes("/settings");
  const isSelfEnrollUser = scope === "user" && caller && scopeId === caller.id;

  if (!isAdmin && !hasSettingsPerm && !isSelfEnrollUser) {
    res.status(403).json({ error: "Only administrators or settings-level staff can enroll fingerprints for other accounts. You may only enroll your own fingerprint." });
    return;
  }

  // Verify that the subject being enrolled actually exists
  if (scope === "staff") {
    const [s] = await db.select({ id: staffTable.id }).from(staffTable).where(eq(staffTable.id, scopeId));
    if (!s) {
      res.status(404).json({ error: "Staff not found" });
      return;
    }
  } else {
    const [u] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, scopeId));
    if (!u) {
      res.status(404).json({ error: "User not found" });
      return;
    }
  }

  const challengeToken = crypto.randomBytes(32).toString("hex");
  enrollChallenges.set(challengeToken, {
    scope,
    scopeId,
    expiresAt: Date.now() + ENROLL_CHALLENGE_TTL_MS,
    used: false,
  });

  res.json({ enrollToken: challengeToken, expiresInSeconds: ENROLL_CHALLENGE_TTL_MS / 1000 });
});

// ── Issue a punch challenge token ─────────────────
// Requires a valid staff session. The ERP UI must call this before asking the
// bridge to capture and record an attendance punch, ensuring only an
// authenticated ERP user (e.g. receptionist, HR) can initiate punch sessions.
bridgeRouter.post("/punch-challenge", async (req, res) => {
  const session = await validateStaffToken(String(req.headers.authorization ?? ""));
  if (!session) {
    res.status(401).json({ error: "Staff session required to initiate attendance punch" });
    return;
  }

  const punchToken = crypto.randomBytes(32).toString("hex");
  punchChallenges.set(punchToken, { expiresAt: Date.now() + PUNCH_CHALLENGE_TTL_MS, used: false });
  res.json({ punchToken, expiresInSeconds: PUNCH_CHALLENGE_TTL_MS / 1000 });
});

// ── Validate a capture challenge token ────────────
// Called by the bridge service to verify a captureToken before returning raw
// biometric template data. Uses the bridge secret for authentication.
bridgeRouter.post("/validate-capture-token", requireBridgeAuth, (req, res) => {
  const { captureToken } = req.body as { captureToken?: string };
  const check = consumeChallenge(captureChallenges, captureToken ?? "");
  if (!check.ok) {
    res.status(check.status).json({ ok: false, error: check.error });
    return;
  }
  res.json({ ok: true });
});

// ── Issue a login challenge token ─────────────────
// No session required — this is part of the fingerprint login flow itself.
// The token is short-lived and single-use; requiring it means that calling
// /api/bridge/user-login demands a proper two-step flow rather than a raw
// single fetch(), which breaks simple scripted automation.
bridgeRouter.post("/login-challenge", (_req, res) => {
  const loginToken = crypto.randomBytes(32).toString("hex");
  loginChallenges.set(loginToken, { expiresAt: Date.now() + LOGIN_CHALLENGE_TTL_MS, used: false });
  res.json({ loginToken, expiresInSeconds: LOGIN_CHALLENGE_TTL_MS / 1000 });
});

// ── Enroll a fingerprint template ─────────────────
// Bridge captures the print using vendor SDK and POSTs the resulting template here.
// In addition to the bridge secret, the bridge must supply an x-enroll-token
// that was previously issued by POST /api/bridge/enroll-challenge to an
// authenticated staff session. The token is single-use and expires in 5 minutes.
bridgeRouter.post("/enroll", requireBridgeAuth, async (req, res) => {
  const enrollToken = String(req.headers["x-enroll-token"] ?? "");
  if (!enrollToken) {
    res.status(401).json({ error: "x-enroll-token is required. Obtain one via POST /api/bridge/enroll-challenge with a valid staff session." });
    return;
  }

  const challenge = enrollChallenges.get(enrollToken);
  if (!challenge) {
    res.status(401).json({ error: "Invalid enrollment token" });
    return;
  }
  if (challenge.used) {
    res.status(401).json({ error: "Enrollment token has already been used" });
    return;
  }
  if (Date.now() > challenge.expiresAt) {
    enrollChallenges.delete(enrollToken);
    res.status(401).json({ error: "Enrollment token has expired" });
    return;
  }

  const body = req.body as { scope?: string; scopeId?: number; vendor?: string; template?: string; fingerName?: string; quality?: number };
  const scope = body.scope === "user" ? "user" : "staff";
  const scopeId = Number(body.scopeId);
  const template = body.template;
  if (!scopeId || !template || template.length < 8) {
    res.status(400).json({ error: "scopeId and template required" });
    return;
  }

  // Enforce that the token authorises exactly the scope/scopeId being enrolled.
  if (challenge.scope !== scope || challenge.scopeId !== scopeId) {
    res.status(403).json({ error: "Enrollment token is not valid for this scope/scopeId" });
    return;
  }

  // Mark as used before the DB write so a concurrent duplicate request is rejected.
  challenge.used = true;

  // Sanity check the scopeId exists
  if (scope === "staff") {
    const [s] = await db.select().from(staffTable).where(eq(staffTable.id, scopeId));
    if (!s) {
      res.status(404).json({ error: "Staff not found" });
      return;
    }
  } else {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, scopeId));
    if (!u) {
      res.status(404).json({ error: "User not found" });
      return;
    }
  }

  const [row] = await db.insert(bridgeFingerprintTemplatesTable).values({
    scope, scopeId,
    vendor: (body.vendor as string) || "generic",
    template,
    fingerName: body.fingerName ?? null,
    quality: body.quality ?? null,
  }).returning({
    id: bridgeFingerprintTemplatesTable.id,
    scope: bridgeFingerprintTemplatesTable.scope,
    scopeId: bridgeFingerprintTemplatesTable.scopeId,
    vendor: bridgeFingerprintTemplatesTable.vendor,
    fingerName: bridgeFingerprintTemplatesTable.fingerName,
    enrolledAt: bridgeFingerprintTemplatesTable.enrolledAt,
  });
  res.status(201).json(row);
});

// ── List templates for a scope (so the bridge can pull candidates for matching) ──
bridgeRouter.get("/templates", requireBridgeAuth, async (req, res) => {
  const { scope, scopeId } = req.query as Record<string, string>;
  const conditions = [];
  if (scope === "staff" || scope === "user") conditions.push(eq(bridgeFingerprintTemplatesTable.scope, scope));
  if (scopeId) conditions.push(eq(bridgeFingerprintTemplatesTable.scopeId, Number(scopeId)));
  const rows = await db.select().from(bridgeFingerprintTemplatesTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(bridgeFingerprintTemplatesTable.enrolledAt));
  res.json(rows);
});

// List enrolled fingers for a single subject (frontend uses this to show count)
bridgeRouter.get("/templates/list", requireBridgeAuth, async (req, res) => {
  const scope = req.query.scope === "user" ? "user" : "staff";
  const scopeId = Number(req.query.scopeId);
  if (!scopeId) {
    res.status(400).json({ error: "scopeId required" });
    return;
  }
  const rows = await db.select({
    id: bridgeFingerprintTemplatesTable.id,
    vendor: bridgeFingerprintTemplatesTable.vendor,
    fingerName: bridgeFingerprintTemplatesTable.fingerName,
    quality: bridgeFingerprintTemplatesTable.quality,
    enrolledAt: bridgeFingerprintTemplatesTable.enrolledAt,
    lastUsedAt: bridgeFingerprintTemplatesTable.lastUsedAt,
  }).from(bridgeFingerprintTemplatesTable)
    .where(and(eq(bridgeFingerprintTemplatesTable.scope, scope), eq(bridgeFingerprintTemplatesTable.scopeId, scopeId)))
    .orderBy(desc(bridgeFingerprintTemplatesTable.enrolledAt));
  res.json(rows);
});

bridgeRouter.delete("/templates/:id", requireBridgeAuth, async (req, res) => {
  await db.delete(bridgeFingerprintTemplatesTable).where(eq(bridgeFingerprintTemplatesTable.id, Number(req.params.id)));
  res.json({ ok: true });
});

// ── Identify staff and punch attendance ───────────
// Bridge has already done the matching and posts the matched template id.
// Requires x-punch-token issued by POST /api/bridge/punch-challenge, which in
// turn requires a valid staff session — so only authenticated ERP users can
// trigger an attendance punch.
bridgeRouter.post("/staff-punch", requireBridgeAuth, async (req, res) => {
  const punchCheck = consumeChallenge(punchChallenges, String(req.headers["x-punch-token"] ?? ""));
  if (!punchCheck.ok) {
    res.status(punchCheck.status).json({ error: punchCheck.error });
    return;
  }

  const body = req.body as { templateId?: number; action?: string };
  const templateId = Number(body.templateId);
  if (!templateId) {
    res.status(400).json({ error: "templateId required" });
    return;
  }
  const action = body.action === "out" ? "out" : "in";

  const [tmpl] = await db.select().from(bridgeFingerprintTemplatesTable).where(eq(bridgeFingerprintTemplatesTable.id, templateId));
  if (!tmpl || tmpl.scope !== "staff") {
    res.status(404).json({ error: "Template not found" });
    return;
  }

  await db.update(bridgeFingerprintTemplatesTable).set({ lastUsedAt: new Date() }).where(eq(bridgeFingerprintTemplatesTable.id, templateId));
  const [staff] = await db.select().from(staffTable).where(eq(staffTable.id, tmpl.scopeId));
  if (!staff) {
    res.status(404).json({ error: "Staff not found" });
    return;
  }

  const today = todayIST();
  const now = new Date();

  // Smart toggle: if action='in' but already punched in (no out), treat as out
  const [existing] = await db.select().from(staffAttendanceTable)
    .where(and(eq(staffAttendanceTable.staffId, staff.id), eq(staffAttendanceTable.attendanceDate, today)));
  const resolved = action === "in" && existing?.punchIn && !existing.punchOut ? "out" : action;

  const result = await db.transaction(async (tx) => {
    if (resolved === "in") {
      const inserted = await tx.insert(staffAttendanceTable)
        .values({ staffId: staff.id, attendanceDate: today, punchIn: now, source: "usb-bridge" })
        .onConflictDoNothing({ target: [staffAttendanceTable.staffId, staffAttendanceTable.attendanceDate] })
        .returning();
      if (inserted.length > 0) return inserted[0];
      const updated = await tx.update(staffAttendanceTable)
        .set({ punchIn: now, source: "usb-bridge" })
        .where(and(
          eq(staffAttendanceTable.staffId, staff.id),
          eq(staffAttendanceTable.attendanceDate, today),
          sql`${staffAttendanceTable.punchIn} IS NULL`,
        ))
        .returning();
      if (updated.length > 0) return updated[0];
      throw new Error("Already punched in today");
    } else {
      const updated = await tx.update(staffAttendanceTable)
        .set({ punchOut: now })
        .where(and(
          eq(staffAttendanceTable.staffId, staff.id),
          eq(staffAttendanceTable.attendanceDate, today),
          sql`${staffAttendanceTable.punchIn} IS NOT NULL`,
          sql`${staffAttendanceTable.punchOut} IS NULL`,
        ))
        .returning();
      if (updated.length === 0) throw new Error("Must punch in first");
      return updated[0];
    }
  }).catch((e: Error) => ({ error: e.message }));

  if ("error" in result) return res.status(409).json({ error: result.error, staff });
  return res.json({ staff: { id: staff.id, name: `${staff.firstName} ${staff.lastName}`, staffId: staff.staffId, role: staff.role }, attendance: result, action: resolved });
});

// ── Identify user and create login session ────────
// Requires x-login-token issued by POST /api/bridge/login-challenge. No session
// is needed to obtain the login-challenge token (fingerprint IS the auth), but
// the two-step flow prevents a single raw fetch() from triggering logins.
bridgeRouter.post("/user-login", requireBridgeAuth, async (req, res) => {
  const loginCheck = consumeChallenge(loginChallenges, String(req.headers["x-login-token"] ?? ""));
  if (!loginCheck.ok) {
    res.status(loginCheck.status).json({ error: loginCheck.error });
    return;
  }

  const body = req.body as { templateId?: number };
  const templateId = Number(body.templateId);
  if (!templateId) {
    res.status(400).json({ error: "templateId required" });
    return;
  }

  const [tmpl] = await db.select().from(bridgeFingerprintTemplatesTable).where(eq(bridgeFingerprintTemplatesTable.id, templateId));
  if (!tmpl || tmpl.scope !== "user") {
    res.status(404).json({ error: "Template not found" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, tmpl.scopeId));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (!user.isActive) {
    res.status(403).json({ error: "User is deactivated" });
    return;
  }

  await db.update(bridgeFingerprintTemplatesTable).set({ lastUsedAt: new Date() }).where(eq(bridgeFingerprintTemplatesTable.id, templateId));

  const token = crypto.randomBytes(48).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000);
  await db.insert(userSessionsTable).values({
    token, userId: user.id, userName: user.name, expiresAt, loginMethod: "fingerprint",
  });

  res.json({
    token,
    expiresAt: expiresAt.toISOString(),
    user: { id: user.id, name: user.name, role: user.role },
  });
});

// ── Verify a session token (used by client to bootstrap) ──
bridgeRouter.get("/session/verify", async (req, res) => {
  const token = String(req.query.token ?? "");
  if (!token) {
    res.json({ active: false });
    return;
  }
  const [s] = await db.select().from(userSessionsTable).where(eq(userSessionsTable.token, token));
  if (!s || !s.isActive || new Date(s.expiresAt) < new Date()) {
    res.json({ active: false });
    return;
  }
  res.json({ active: true, user: { id: s.userId, name: s.userName }, loginMethod: s.loginMethod, expiresAt: s.expiresAt });
});

bridgeRouter.post("/session/logout", async (req, res) => {
  const token = String(req.body.token ?? "");
  if (token) await db.update(userSessionsTable).set({ isActive: false }).where(eq(userSessionsTable.token, token));
  res.json({ ok: true });
});

export default bridgeRouter;
