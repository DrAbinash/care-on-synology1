import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { portalSessionsTable, usersTable, clinicSettingsTable } from "@workspace/db/schema";
import { and, eq, gt } from "drizzle-orm";
import { getCached, setCached } from "../lib/ttlCache";

export interface StaffAuthRequest extends Request {
  staffSession?: {
    id: number;
    subjectId: number;
    subjectName: string;
    role: string;
    permissions: string[];
    maxDiscount: number | null;
  };
}

export function normalizeRole(role: string): string {
  if (!role) return "";
  const r = role.toLowerCase().replace(/[^a-z0-9]/g, "_").trim();
  if (r === "superadmin" || r === "super" || r === "owner" || r === "super_admin") return "super_admin";
  if (r === "admin") return "admin";
  return r;
}

export const FULL_ACCESS_ROLES = new Set(["admin", "super_admin"]);

const IDLE_TIMEOUT_CACHE_KEY = "clinic-settings:session-idle-timeout-minutes";
const IDLE_TIMEOUT_CACHE_TTL_MS = 60_000;

async function getIdleTimeoutMinutes(): Promise<number> {
  const cached = getCached<number>(IDLE_TIMEOUT_CACHE_KEY);
  if (cached !== undefined) return cached;
  const [cfg] = await db
    .select({ idleMinutes: clinicSettingsTable.sessionIdleTimeoutMinutes })
    .from(clinicSettingsTable)
    .limit(1);
  const idleMinutes = cfg?.idleMinutes ?? 0;
  setCached(IDLE_TIMEOUT_CACHE_KEY, idleMinutes, IDLE_TIMEOUT_CACHE_TTL_MS);
  return idleMinutes;
}

/**
 * Express middleware that requires a valid, active, non-expired staff portal
 * session token in the `Authorization: Bearer <token>` request header.
 *
 * After validating the session it loads the corresponding user record to:
 *   - Verify the account is still active (`isActive = true`).
 *   - Attach `role`, `permissions`, and `maxDiscount` so that downstream
 *     `requireStaffPermission` middleware can enforce module-level access
 *     control entirely on the server side.
 */
export async function requireStaffAuth(
  req: StaffAuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const auth = req.headers.authorization ?? "";
  const queryToken = typeof req.query.staffToken === "string" ? req.query.staffToken.trim() : "";
  const token = (auth.startsWith("Bearer ") ? auth.slice(7).trim() : "") || queryToken;

  if (!token) {
    res.status(401).json({ error: "Staff authentication required" });
    return;
  }

  // The session lookup and the clinic idle-timeout setting are independent —
  // fetch them in one round-trip wave. This middleware runs on every
  // authenticated request (twice per billing-desk save: POST /api/orders then
  // POST /api/bills), so each serial round-trip here delays the receipt print.
  // The idle-timeout setting is a single reference value that changes ~never,
  // so it is served from the in-process TTL cache (ttlCache.ts, same pattern
  // as clinicSettings.ts/display.ts) — a config change takes at most 60s to
  // reach this middleware, well within the minute-resolution the setting has.
  const [[session], idleMinutes] = await Promise.all([
    db
      .select()
      .from(portalSessionsTable)
      .where(
        and(
          eq(portalSessionsTable.token, token),
          eq(portalSessionsTable.scope, "staff"),
          gt(portalSessionsTable.expiresAt, new Date()),
        ),
      )
      .limit(1),
    getIdleTimeoutMinutes(),
  ]);

  if (!session) {
    res.status(401).json({ error: "Invalid or expired staff session. Please log in again." });
    return;
  }

  // ── Idle timeout enforcement ──────────────────────────────────────────────
  // If clinic_settings.session_idle_timeout_minutes > 0, invalidate the
  // session when it has been idle longer than the configured window.
  if (idleMinutes > 0 && session.lastActivityAt) {
    const idleMs = Date.now() - new Date(session.lastActivityAt).getTime();
    if (idleMs > idleMinutes * 60 * 1000) {
      await db.delete(portalSessionsTable).where(eq(portalSessionsTable.id, session.id));
      res.status(401).json({ error: "Session expired due to inactivity. Please log in again." });
      return;
    }
  }

  const [user] = await db
    .select({
      id: usersTable.id,
      role: usersTable.role,
      permissions: usersTable.permissions,
      maxDiscount: usersTable.maxDiscount,
      isActive: usersTable.isActive,
    })
    .from(usersTable)
    .where(eq(usersTable.id, session.subjectId))
    .limit(1);

  if (!user || !user.isActive) {
    res.status(401).json({ error: "Staff account is inactive or no longer exists. Please contact an administrator." });
    return;
  }

  let permissions: string[] = [];
  try {
    if (user.permissions) {
      const parsed = JSON.parse(user.permissions);
      if (Array.isArray(parsed)) {
        permissions = parsed.filter((p) => typeof p === "string");
      }
    }
  } catch {
    /* leave permissions empty */
  }

  // Touch last_activity_at so the idle timeout resets on every authenticated
  // request. Fired WITHOUT await: this is a committed write (WAL fsync) that
  // used to gate every single response — including both halves of a
  // billing-desk save — and nothing downstream reads its result. It is NOT
  // debounced: the idle check above compares against this timestamp, so any
  // staleness window would shrink the effective idle timeout by that much
  // and could log out actively-working staff.
  db.update(portalSessionsTable)
    .set({ lastActivityAt: new Date() })
    .where(eq(portalSessionsTable.id, session.id))
    .catch((err) => req.log?.warn?.({ err }, "session last_activity_at touch failed"));

  req.staffSession = {
    id: session.id,
    subjectId: session.subjectId,
    subjectName: session.subjectName,
    role: normalizeRole(user.role),
    permissions,
    maxDiscount: user.maxDiscount != null ? Number(user.maxDiscount) : null,
  };

  next();
}

/**
 * Middleware factory that enforces a module-level permission on top of
 * `requireStaffAuth`. Must be used *after* `requireStaffAuth` in the chain.
 *
 * Admin and super_admin roles always pass through.  All other roles must have
 * the requested permission string present in their `permissions` array.
 *
 * @param permission  The permission path string, e.g. `"/patients"`,
 *                    `"/billing"`, `"/accounting"`, `"/settings"`.
 */
export function requireStaffPermission(permission: string) {
  return (req: StaffAuthRequest, res: Response, next: NextFunction): void => {
    const session = req.staffSession;
    if (!session) {
      res.status(401).json({ error: "Staff authentication required" });
      return;
    }

    if (FULL_ACCESS_ROLES.has(session.role)) {
      next();
      return;
    }

    const hasAccess = session.permissions.some(p => p === permission || p.startsWith(permission + ":"));
    if (hasAccess) {
      next();
      return;
    }

    res.status(403).json({ error: "Access denied: you do not have permission to access this module." });
  };
}

export function requireStaffSubPermission(modulePath: string, action: string) {
  return (req: StaffAuthRequest, res: Response, next: NextFunction): void => {
    const session = req.staffSession;
    if (!session) {
      res.status(401).json({ error: "Staff authentication required" });
      return;
    }

    if (FULL_ACCESS_ROLES.has(session.role)) {
      next();
      return;
    }

    if (session.permissions.includes(modulePath) || session.permissions.includes(`${modulePath}:${action}`)) {
      next();
      return;
    }

    res.status(403).json({ error: `Access denied: you do not have permission to perform '${action}' on this resource.` });
  };
}

/**
 * Strict admin/super_admin-only gate — unlike requireStaffPermission, this
 * is NOT toggleable via the per-user permissions array in Settings → Users.
 * Used for tools that should never be exposed to non-admin staff regardless
 * of permission configuration, e.g. the request-diagnostics dashboard which
 * shows internal endpoint performance data.
 */
export function requireAdminRole(req: StaffAuthRequest, res: Response, next: NextFunction): void {
  const session = req.staffSession;
  if (!session) {
    res.status(401).json({ error: "Staff authentication required" });
    return;
  }
  if (!FULL_ACCESS_ROLES.has(session.role)) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}

/**
 * Super-admin staff session only (regular ERP login, not X-SA-Token).
 * Owner / "Super Admin" already collapse to `super_admin` via normalizeRole.
 */
export function requireSuperAdminRole(req: StaffAuthRequest, res: Response, next: NextFunction): void {
  const session = req.staffSession;
  if (!session) {
    res.status(401).json({ error: "Staff authentication required" });
    return;
  }
  if (session.role !== "super_admin") {
    res.status(403).json({ error: "Super admin login required" });
    return;
  }
  next();
}
