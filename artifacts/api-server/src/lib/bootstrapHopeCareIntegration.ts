/**
 * Idempotent Hope ↔ Care integration bootstrap (runs on API container start).
 *
 * Mirrors scripts/bootstrap-hope-care-integration.mjs so Synology deploys
 * need no `docker compose exec …` after migrations — same spirit as
 * care-db-patch-v2 applying schema automatically.
 *
 * When the host is wired for Hope (HOPE_PARTNER_KEY / HOPE_CARE_INTEGRATION_FORCE /
 * INTEGRATION_HOPE_SIGNING_SECRET) AND a partner key is configured, this:
 *   - upserts the HOPE integration_partners row (hashed partner key)
 *   - enables ff_hope_care_referrals
 *
 * Without HOPE_PARTNER_KEY it registers nothing. This module used to fall back
 * to a `DEFAULT_HOPE_PARTNER_KEY` literal that was committed to a public
 * repository, so an unconfigured host came up holding a credential anyone could
 * read off GitHub — and HOPE_CARE_INTEGRATION_FORCE=1, which the Synology
 * templates set, armed that path on every container start. A credential is
 * never invented here: it comes from the environment or the integration stays
 * off. See docs/hope-care-integration/06_CREDENTIAL_ROTATION.md.
 *
 * Pure decision helpers live at module top-level with no @workspace/db
 * import so unit tests can run without DATABASE_URL. The DB work uses a
 * dynamic import inside bootstrapHopeCareIntegration().
 */
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";

export const DEFAULT_HOPE_CALLBACK_URL =
  "http://172.16.1.139:7080/api/integration/care-callback";

export const HOPE_INTEGRATION_PERMISSIONS = [
  "diagnostic_referral:create",
  "diagnostic_referral:update",
  "diagnostic_referral:cancel",
  "diagnostic_referral:read",
  "diagnostic_result:acknowledge",
  "whatsapp:enqueue",
] as const;

export function hashPartnerApiKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * `generateIntegrationKey()` issues `intgk_` + 64 hex (70 characters). Anything
 * shorter is a typo or a truncated copy, and registering it would leave the
 * partner permanently unable to authenticate with no obvious cause — so it is
 * refused at bootstrap, where the reason can still be printed.
 */
export const MIN_PARTNER_KEY_LENGTH = 32;

export type PartnerCredentialResolution =
  | { ok: true; rawKey: string }
  | { ok: false; reason: string };

/**
 * The partner key comes from the environment only. Returns a reason that is safe
 * to log: it names the variable and its length, never its value.
 */
export function resolvePartnerCredential(env: NodeJS.ProcessEnv): PartnerCredentialResolution {
  const rawKey = (env["HOPE_PARTNER_KEY"] || "").trim();
  if (!rawKey) return { ok: false, reason: "HOPE_PARTNER_KEY is not set" };
  if (rawKey.length < MIN_PARTNER_KEY_LENGTH) {
    return {
      ok: false,
      reason: `HOPE_PARTNER_KEY is only ${rawKey.length} characters (an issued key is at least ${MIN_PARTNER_KEY_LENGTH})`,
    };
  }
  return { ok: true, rawKey };
}

/**
 * True when this Care instance is wired for Hope (env present).
 * Skips bootstrap on hosts that never set Hope integration vars.
 */
export function shouldBootstrapHopeCare(env: NodeJS.ProcessEnv): boolean {
  if (env["HOPE_CARE_INTEGRATION_FORCE"] === "1" || env["HOPE_CARE_INTEGRATION_FORCE"] === "true") {
    return true;
  }
  if ((env["HOPE_PARTNER_KEY"] || "").trim().length > 0) return true;
  if ((env["INTEGRATION_HOPE_SIGNING_SECRET"] || "").trim().length > 0) return true;
  if ((env["INTEGRATION_HOPE_CALLBACK_URL"] || "").trim().length > 0) return true;
  return false;
}

export type HopeCareBootstrapResult =
  | { skipped: true; reason: string }
  | { skipped: false; partnerAction: "created" | "updated"; flagEnabled: true };

export async function bootstrapHopeCareIntegration(
  env: NodeJS.ProcessEnv = process.env,
): Promise<HopeCareBootstrapResult> {
  if (!shouldBootstrapHopeCare(env)) {
    return { skipped: true, reason: "Hope integration env not configured" };
  }

  // Before the dynamic import, so an unconfigured host never reaches the database
  // and never leaves a partner row that was authenticated by a published value.
  const credential = resolvePartnerCredential(env);
  if (!credential.ok) {
    const why =
      `${credential.reason} — the HOPE partner was not registered and ff_hope_care_referrals ` +
      `was not enabled. No default key is installed; set HOPE_PARTNER_KEY from the deployment ` +
      `.env (docs/hope-care-integration/06_CREDENTIAL_ROTATION.md)`;
    console.error(`[hope-integration] ${why}`);
    return { skipped: true, reason: why };
  }

  // Dynamic import so pure helpers above can be unit-tested without DATABASE_URL.
  const { db, featureFlagsTable, integrationPartnersTable } = await import("@workspace/db");

  const rawKey = credential.rawKey;
  const callbackUrl =
    (env["INTEGRATION_HOPE_CALLBACK_URL"] || "").trim() || DEFAULT_HOPE_CALLBACK_URL;
  const keyHash = hashPartnerApiKey(rawKey);
  const keyPrefix = rawKey.slice(0, 14);
  const permissions = [...HOPE_INTEGRATION_PERMISSIONS];

  const existing = await db
    .select({ id: integrationPartnersTable.id })
    .from(integrationPartnersTable)
    .where(eq(integrationPartnersTable.code, "HOPE"))
    .limit(1);

  let partnerAction: "created" | "updated";
  if (existing.length === 0) {
    await db.insert(integrationPartnersTable).values({
      code: "HOPE",
      name: "Hope NeuroTrauma Hospital",
      direction: "inbound",
      keyHash,
      keyPrefix,
      callbackUrl,
      sourceOrgCode: "HOPE",
      destinationOrgCode: "CARE",
      permissions,
      isActive: true,
      createdBy: "api-startup-bootstrap",
    });
    partnerAction = "created";
  } else {
    await db
      .update(integrationPartnersTable)
      .set({
        keyHash,
        keyPrefix,
        callbackUrl,
        permissions,
        isActive: true,
        updatedAt: new Date(),
      })
      .where(eq(integrationPartnersTable.code, "HOPE"));
    partnerAction = "updated";
  }

  await db
    .insert(featureFlagsTable)
    .values({
      key: "ff_hope_care_referrals",
      enabled: true,
      description: "HOPE → CARE diagnostic referral integration",
      updatedBy: "api-startup-bootstrap",
    })
    .onConflictDoUpdate({
      target: featureFlagsTable.key,
      set: {
        enabled: true,
        description: "HOPE → CARE diagnostic referral integration",
        updatedBy: "api-startup-bootstrap",
        updatedAt: new Date(),
      },
    });

  return { skipped: false, partnerAction, flagEnabled: true };
}
