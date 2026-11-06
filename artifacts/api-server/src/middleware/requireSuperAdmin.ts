import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { superAdminSessionsTable, usersTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { usbGateFailure } from "./requireSuperAdminUsb";
import { normalizeRole } from "./requireStaffAuth";

/**
 * Express middleware that requires a valid, active, non-expired super-admin
 * session token in the `X-SA-Token` request header. Used to gate sensitive
 * compliance routes (referral commission, doctor payout ledger) so they are
 * only accessible from the Super Admin Portal — not from the regular ERP UI.
 */
export async function requireSuperAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // The pen-drive rule lives in usbGateFailure so there is exactly one
  // implementation of it. This middleware used to re-implement the rule and
  // carried an exception the others did not: a user with remote_login_enabled
  // could pass here without the drive while every other surface refused. Nothing
  // in the application ever wrote that column — a direct SQL UPDATE was the only
  // way to earn it, which made it an undocumented second way in.
  const failure = usbGateFailure(req);
  if (failure) {
    res.status(failure.status).json(failure.body);
    return;
  }
  await validateSuperAdminSession(req, res, next);
}

async function validateSuperAdminSession(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const headerVal = req.header("x-sa-token");
  const token = (typeof headerVal === "string" ? headerVal : "").trim();
  if (!token) {
    res.status(401).json({ error: "Super admin token required" });
    return;
  }

  const [session] = await db
    .select()
    .from(superAdminSessionsTable)
    .where(and(eq(superAdminSessionsTable.token, token), eq(superAdminSessionsTable.isActive, true)));

  if (!session) {
    res.status(401).json({ error: "Invalid super admin session" });
    return;
  }
  if (new Date(session.expiresAt) < new Date()) {
    res.status(401).json({ error: "Super admin session expired" });
    return;
  }
  const [user] = await db
    .select({ isActive: usersTable.isActive, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, session.userId))
    .limit(1);
  if (!user || !user.isActive || normalizeRole(user.role) !== "super_admin") {
    res.status(401).json({ error: "Super admin session is no longer valid" });
    return;
  }
  next();
}
