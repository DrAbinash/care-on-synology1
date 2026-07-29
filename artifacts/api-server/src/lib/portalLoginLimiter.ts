import type { Request, Response } from "express";
import { ipKeyGenerator } from "express-rate-limit";

/** Key staff login attempts per username so one wrong PIN on shared clinic WiFi
 *  does not block every other staff member behind the same NAT. */
export function staffLoginRateLimitKey(req: Request): string {
  const handle = String(req.body?.username ?? req.body?.email ?? "").trim().toLowerCase();
  if (handle) return `staff-login:${handle}`;
  return ipKeyGenerator(req.ip ?? "");
}

/** Only genuine wrong-credential 401s consume the staff login quota.
 * 403 (account locked / LAN-only), 400 (validation), and 200 (success) must
 * not exhaust the shared IP bucket — that was blocking first-time logins. */
export function staffLoginResponseCountsTowardLimit(_req: Request, res: Response): boolean {
  return res.statusCode === 401;
}
