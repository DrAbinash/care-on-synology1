import type { Request } from "express";
import { getUsbKeyHeader, isValidUsbKey } from "./requireSuperAdminUsb";

/**
 * Referral-commission data is Super-Admin-only: the pen drive is the single
 * source for it. Commission rates and commission settings live on otherwise
 * ordinary staff-facing rows (`doctors.defaultCommission*`,
 * `clinic_settings.commission*`), so those routes cannot simply be moved behind
 * requireSuperAdminUsb without breaking the doctor picker and the settings
 * screen that every staff member needs.
 *
 * Instead each such route asks this helper whether the caller is holding the
 * pen drive, and hides (on read) or ignores (on write) the commission fields
 * when they are not.
 *
 * Backward-compat matches requireSuperAdminUsb: when SUPER_ADMIN_USB_KEY is not
 * provisioned the gate is not enforced, so a fresh install is not locked out of
 * its own commission configuration.
 */
export function hasCommissionAccess(req: Request): boolean {
  return isValidUsbKey(readUsbKey(req));
}

/**
 * Reads the USB key header without assuming a full Express Request.
 *
 * These routes are also driven directly by unit tests (and by internal callers)
 * with a plain `{ body }` object that has no `header()` method, so calling it
 * unconditionally would throw — and the surrounding try/catch would surface
 * that as a 500 on an unrelated settings save. Fall back to the raw `headers`
 * bag, then to "no key", which fails closed.
 */
function readUsbKey(req: Request): string {
  if (typeof (req as Partial<Request>).header === "function") {
    return getUsbKeyHeader(req);
  }
  const bag = (req as Partial<Request>).headers as Record<string, unknown> | undefined;
  const raw = bag?.["x-sa-usb-key"];
  return typeof raw === "string" ? raw.trim() : "";
}

/** Commission-bearing columns on `doctors`. */
export const DOCTOR_COMMISSION_FIELDS = [
  "defaultCommission",
  "defaultCommissionType",
] as const;

/** Commission-bearing columns on `clinic_settings`. */
export const CLINIC_COMMISSION_FIELDS = [
  "commissionDiscountMode",
  "commissionEligibilityPolicy",
  "commissionEligibilityMinAmount",
] as const;

/** Returns a copy of `row` with the given keys removed. */
export function stripFields<T extends Record<string, unknown>>(
  row: T,
  fields: readonly string[],
): T {
  const out = { ...row } as Record<string, unknown>;
  for (const f of fields) delete out[f];
  return out as T;
}
