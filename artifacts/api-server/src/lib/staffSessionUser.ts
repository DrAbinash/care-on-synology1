/**
 * staffSessionUser.ts
 *
 * The single definition of the `user` payload a staff login returns.
 *
 * Two routes issue staff sessions — POST /api/portal/staff-login (username +
 * PIN) and POST /api/auth/webauthn/authenticate/complete (security key). The
 * ERP stores whatever they return verbatim in localStorage under `erp_session`,
 * and readStaffSession() DISCARDS the session unless `user.permissions` is an
 * array, so a login that returns a partial user silently logs the staff member
 * straight back out. The WebAuthn route used to return only {id, name, role},
 * which both tripped that guard and threw on `user.email.toLowerCase()` in the
 * portal's finalizeSession() — a security key could never sign anyone in.
 *
 * Both routes now build their payload here so the two can no longer drift.
 */
import { db } from "@workspace/db";
import { usersTable, rolePermissionsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { normalizeRole } from "../middleware/requireStaffAuth";

type UserRow = typeof usersTable.$inferSelect;

/** role_permissions module name → the legacy path-permission string the ERP
 *  sidebar and requireStaffPermission() expect. */
export const MODULE_TO_PATH: Record<string, string> = {
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

/** Extra paths that come with a granted module, for pages that never had a
 *  module of their own. */
export const LEGACY_PIGGYBACKS: Record<string, string[]> = {
  "/reports": ["/report-generator", "/patient-reports", "/signatures"],
  "/radiology/worklist": ["/radiology/reporting-workspace", "/radiology/pacs-dashboard", "/pacs", "/teleradiology", "/radiology/dicom-qr"],
  "/samples": ["/scan-station", "/report-hub", "/report-delivery"],
  "/patients": ["/register"],
  "/billing": ["/", "/dues"],
  "/dashboard": ["/my-daily-summary"],
};

/**
 * Resolve the effective path permissions for a user.
 *
 * Admins/super-admins bypass permission checks entirely, so they keep only
 * their legacy list. Everyone else gets role_permissions (the source of truth)
 * merged with any legacy JSON, and the result is persisted back to
 * users.permissions so later requests need no re-derivation.
 */
export async function resolveStaffPermissions(
  user: Pick<UserRow, "id" | "role" | "permissions">,
): Promise<string[]> {
  const isFullAccess =
    normalizeRole(user.role) === "admin" || normalizeRole(user.role) === "super_admin";

  const derivedPermissions: string[] = [];
  if (!isFullAccess) {
    const rolePerms = await db
      .select()
      .from(rolePermissionsTable)
      .where(eq(rolePermissionsTable.role, user.role));
    for (const rp of rolePerms) {
      if (!rp.canView) continue;
      const path = MODULE_TO_PATH[rp.module];
      if (!path || derivedPermissions.includes(path)) continue;
      derivedPermissions.push(path);
      for (const extra of LEGACY_PIGGYBACKS[path] ?? []) {
        if (!derivedPermissions.includes(extra)) derivedPermissions.push(extra);
      }
    }
  }

  let legacyPermissions: string[] = [];
  try {
    if (user.permissions) {
      const parsed = JSON.parse(user.permissions);
      if (Array.isArray(parsed)) legacyPermissions = parsed.filter((p) => typeof p === "string");
    }
  } catch { /* ignore — empty permissions */ }

  const permissions = isFullAccess
    ? legacyPermissions // admins keep all legacy paths (they bypass checks anyway)
    : Array.from(new Set([...derivedPermissions, ...legacyPermissions]));

  if (!isFullAccess) {
    await db
      .update(usersTable)
      .set({ permissions: JSON.stringify(permissions) })
      .where(eq(usersTable.id, user.id));
  }

  return permissions;
}

export interface StaffSessionUser {
  id: number;
  name: string;
  email: string | null;
  username: string | null;
  role: string;
  permissions: string[];
  /** users.max_discount is a numeric column, so the driver hands back a
   *  string. Kept as-is to preserve the existing wire format that the PIN
   *  login already returns. */
  maxDiscount: string | number | null;
  photoDataUrl: string | null;
  signatureDataUrl: string | null;
  sidebarTheme: string | null;
  pacsNetworkProfile: string | null;
  defaultStartPage: string | null;
  mustChangePin: boolean;
}

/**
 * Build the complete `user` object for a staff session response. The role is
 * normalized here so the ERP never has to deal with "Owner" / "Super Admin"
 * casing variants.
 */
export async function buildStaffSessionUser(user: UserRow): Promise<StaffSessionUser> {
  const permissions = await resolveStaffPermissions(user);
  return {
    id: user.id,
    name: user.name,
    email: user.email ?? null,
    username: user.username ?? null,
    role: normalizeRole(user.role),
    permissions,
    maxDiscount: user.maxDiscount ?? null,
    photoDataUrl: user.photoDataUrl ?? null,
    signatureDataUrl: user.signatureDataUrl ?? null,
    sidebarTheme: user.sidebarTheme ?? null,
    pacsNetworkProfile: user.pacsNetworkProfile ?? null,
    defaultStartPage: user.defaultStartPage ?? null,
    // Frontend uses this to force a PIN-change screen before letting the user
    // into the ERP. The flag is cleared by /staff-change-pin.
    mustChangePin: user.mustChangePin === true,
  };
}
