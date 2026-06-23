import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { superAdminSessionsTable, usersTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { isValidUsbKey, isUsbGateEnforced, getUsbKeyHeader } from "./requireSuperAdminUsb";
import { logger } from "../lib/logger";

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
  // Defense in depth: if the USB pen-drive gate is enforced on this server,
  // every super-admin-protected request must also carry the X-SA-USB-Key
  // header. This means even a stolen session token is useless without the
  // physical pen drive plugged in.
  if (isUsbGateEnforced()) {
    const usbVal = getUsbKeyHeader(req);
    if (!usbVal || !isValidUsbKey(usbVal)) {
      // Session token is present — look up the user to see if remote login
      // is enabled for them. This lets the owner/admin log in without the
      // pen drive while all other staff are still gated by the USB key.
      const token = (req.header("x-sa-token") ?? "").trim();
      if (token) {
        const [session] = await db
          .select()
          .from(superAdminSessionsTable)
          .where(and(eq(superAdminSessionsTable.token, token), eq(superAdminSessionsTable.isActive, true)));
        if (session) {
          const [user] = await db
            .select({ isActive: usersTable.isActive, role: usersTable.role, remoteLoginEnabled: usersTable.remoteLoginEnabled })
            .from(usersTable)
            .where(eq(usersTable.id, session.userId))
            .limit(1);
          if (user?.isActive && user?.role === "super_admin" && user?.remoteLoginEnabled) {
            logger.warn({ userId: session.userId, userName: session.userName, path: req.path },
              "USB gate bypassed — remoteLoginEnabled user accessed super-admin route without pen drive");
            // Fall through to normal token validation below
          } else {
            res.status(401).json({ error: "USB key required" });
            return;
          }
        } else {
          res.status(401).json({ error: "USB key required" });
          return;
        }
      } else {
        res.status(401).json({ error: "USB key required" });
        return;
      }
    }
  }

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
  if (!user || !user.isActive || user.role !== "super_admin") {
    res.status(401).json({ error: "Super admin session is no longer valid" });
    return;
  }
  next();
}
