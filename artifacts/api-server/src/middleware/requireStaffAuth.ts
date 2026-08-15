import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { portalSessionsTable, usersTable, clinicSettingsTable } from "@workspace/db/schema";
import { and, eq, gt } from "drizzle-orm";
import { getCached, setCached, invalidateCached } from "../lib/ttlCache";

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

/** Short-lived staff auth cache — billing desk hits this middleware twice per save. */
const STAFF_AUTH_CACHE_TTL_MS = 20_000;
/**
 * Minimum interval between portal_sessions.last_activity_at writes on cache hits.
 * Feature-flags / polling endpoints hit requireStaffAuth many times per second;
 * writing on every request exhausts the pg pool (connectionTimeoutMillis) and
 * cascades into Save & Print / Register 500s.
 */
const SESSION_DB_TOUCH_MIN_INTERVAL_MS = 30_000;
type CachedStaffAuth = {
  sessionId: number;
  subjectId: number;
  subjectName: string;
  role: string;
  permissions: string[];
  maxDiscount: number | null;
  expiresAtMs: number;
  lastActivityAtMs: number;
  /** Last time we actually wrote last_activity_at to Postgres. */
  lastDbTouchAtMs: number;
};

function staffAuthCacheKey(token: string): string {
  return `staff-auth:${token}`;
}

/** Drop a cached staff auth entry (logout / idle expiry / force re-check). */
export function invalidateStaffAuthCache(token: string): void {
  invalidateCached(staffAuthCacheKey(token));
}

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

  const idleMinutes = await getIdleTimeoutMinutes();
  const cacheKey = staffAuthCacheKey(token);
  const cached = getCached<CachedStaffAuth>(cacheKey);
  const nowMs = Date.now();

  // Cache hit: skip session + user SELECTs. Billing desk save does order then
  // bill — the second auth is almost always a hit within the 20s TTL.
  if (cached && cached.expiresAtMs > nowMs) {
    if (idleMinutes > 0) {
      const idleMs = nowMs - cached.lastActivityAtMs;
      if (idleMs > idleMinutes * 60 * 1000) {
        invalidateCached(cacheKey);
        await db.delete(portalSessionsTable).where(eq(portalSessionsTable.id, cached.sessionId));
        res.status(401).json({ error: "Session expired due to inactivity. Please log in again." });
        return;
      }
    }

    cached.lastActivityAtMs = nowMs;
    // Throttle DB touch — in-memory idle clock still updates every request.
    if (nowMs - (cached.lastDbTouchAtMs || 0) >= SESSION_DB_TOUCH_MIN_INTERVAL_MS) {
      cached.lastDbTouchAtMs = nowMs;
      db.update(portalSessionsTable)
        .set({ lastActivityAt: new Date(nowMs) })
        .where(eq(portalSessionsTable.id, cached.sessionId))
        .catch((err) => req.log?.warn?.({ err }, "session last_activity_at touch failed"));
    }
    setCached(cacheKey, cached, STAFF_AUTH_CACHE_TTL_MS);

    req.staffSession = {
      id: cached.sessionId,
      subjectId: cached.subjectId,
      subjectName: cached.subjectName,
      role: cached.role,
      permissions: cached.permissions,
      maxDiscount: cached.maxDiscount,
    };
    next();
    return;
  }

  // Cache miss — load session from Postgres.
  const [session] = await db
    .select()
    .from(portalSessionsTable)
    .where(
      and(
        eq(portalSessionsTable.token, token),
        eq(portalSessionsTable.scope, "staff"),
        gt(portalSessionsTable.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!session) {
    invalidateCached(cacheKey);
    res.status(401).json({ error: "Invalid or expired staff session. Please log in again." });
    return;
  }

  // ── Idle timeout enforcement ──────────────────────────────────────────────
  // If clinic_settings.session_idle_timeout_minutes > 0, expire the
  // session when it has been idle longer than the configured window.
  if (idleMinutes > 0 && session.lastActivityAt) {
    const idleMs = Date.now() - new Date(session.lastActivityAt).getTime();
    if (idleMs > idleMinutes * 60 * 1000) {
      invalidateCached(cacheKey);
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
    invalidateCached(cacheKey);
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

  const role = normalizeRole(user.role);
  const maxDiscount = user.maxDiscount != null ? Number(user.maxDiscount) : null;

  // Touch last_activity_at so the idle timeout resets on every authenticated
  // request. Fired WITHOUT await: this is a committed write (WAL fsync) that
  // used to gate every single response — including both halves of a
  // billing-desk save — and nothing downstream reads its result.
  db.update(portalSessionsTable)
    .set({ lastActivityAt: new Date() })
    .where(eq(portalSessionsTable.id, session.id))
    .catch((err) => req.log?.warn?.({ err }, "session last_activity_at touch failed"));

  setCached(
    cacheKey,
    {
      sessionId: session.id,
      subjectId: session.subjectId,
      subjectName: session.subjectName,
      role,
      permissions,
      maxDiscount,
      expiresAtMs: new Date(session.expiresAt).getTime(),
      lastActivityAtMs: nowMs,
      lastDbTouchAtMs: nowMs,
    } satisfies CachedStaffAuth,
    STAFF_AUTH_CACHE_TTL_MS,
  );

  req.staffSession = {
    id: session.id,
    subjectId: session.subjectId,
    subjectName: session.subjectName,
    role,
    permissions,
    maxDiscount,
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
