/**
 * One implementation of "is this the second factor".
 *
 * Both login doors — the ERP staff login (`routes/totp.ts` /verify-login) and the Super Admin host
 * login (`routes/superAdminHostAuth.ts`) — have to answer the same question, and the answer has
 * details that must not drift: the issuer and label are part of the OTPAuth key derivation, so a
 * verifier built with a different label silently rejects every genuine code; and a used backup code
 * has to be removed from the row exactly once, or it becomes a permanent second password.
 */
import * as OTPAuth from "otpauth";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";

export const TOTP_ISSUER = "Care Diagnostics ERP";
export const TOTP_WINDOW = 1;

export interface TotpFactorUser {
  id: number;
  /**
   * The label the secret was enrolled under. The ERP enrolment stores it as
   * `user.username || user.email`, and the label is part of the OTPAuth key
   * derivation — pass something else and every genuine code is rejected.
   */
  label: string;
  totpEnabled?: boolean | null;
  totpSecret?: string | null;
  totpBackupCodes?: string[] | null;
}

export type FactorResult =
  | { ok: true; via: "totp" | "backup" }
  | { ok: false; error: "not_enrolled" | "missing" | "invalid" };

/** True when the account can present a second factor at all. */
export function hasTotpFactor(user: TotpFactorUser | null | undefined): boolean {
  return Boolean(user && user.totpEnabled === true && typeof user.totpSecret === "string" && user.totpSecret.length > 0);
}

/**
 * Verify a 6-digit authenticator code, or consume one backup code. Never throws: a malformed
 * base32 secret is reported as `invalid`, because the caller is a login route and must answer
 * 401 rather than 500.
 */
export async function verifyTotpFactor(
  user: TotpFactorUser,
  presented: { code?: string; backupCode?: string },
): Promise<FactorResult> {
  if (!hasTotpFactor(user)) return { ok: false, error: "not_enrolled" };

  const code = typeof presented.code === "string" ? presented.code.trim() : "";
  if (code) {
    try {
      const totp = new OTPAuth.TOTP({
        issuer: TOTP_ISSUER,
        label: user.label,
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        secret: OTPAuth.Secret.fromBase32(user.totpSecret as string),
      });
      return totp.validate({ token: code, window: TOTP_WINDOW }) !== null
        ? { ok: true, via: "totp" }
        : { ok: false, error: "invalid" };
    } catch {
      return { ok: false, error: "invalid" };
    }
  }

  const raw = typeof presented.backupCode === "string" ? presented.backupCode : "";
  const backup = raw.replace(/-/g, "").toUpperCase();
  if (!backup) return { ok: false, error: "missing" };

  const codes = Array.isArray(user.totpBackupCodes) ? [...user.totpBackupCodes] : [];
  const index = codes.indexOf(backup);
  if (index === -1) return { ok: false, error: "invalid" };

  codes.splice(index, 1);
  await db.update(usersTable).set({ totpBackupCodes: codes }).where(eq(usersTable.id, user.id));
  return { ok: true, via: "backup" };
}
