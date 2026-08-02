/**
 * Idempotent Hope ↔ Care integration bootstrap (runs on API container start).
 *
 * Mirrors scripts/bootstrap-hope-care-integration.mjs so Synology deploys
 * need no `docker compose exec …` after migrations — same spirit as
 * care-db-patch-v2 applying schema automatically.
 *
 * When configured (HOPE_PARTNER_KEY / HOPE_CARE_INTEGRATION_FORCE /
 * INTEGRATION_HOPE_SIGNING_SECRET), this:
 *   - upserts the HOPE integration_partners row (hashed partner key)
 *   - enables ff_hope_care_referrals
 *
 * Pure decision helpers live at module top-level with no @workspace/db
 * import so unit tests can run without DATABASE_URL. The DB work uses a
 * dynamic import inside bootstrapHopeCareIntegration().
 */
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";

/** Shared with deploy/synology/*.env and the standalone .mjs bootstrap. */
export const DEFAULT_HOPE_PARTNER_KEY =
  "intgk_8ffb1b9c5b982148cfbe89448064cc4986b172bea48fe73b0f622f4a192da7e7";

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

  // Dynamic import so pure helpers above can be unit-tested without DATABASE_URL.
  const { db, featureFlagsTable, integrationPartnersTable } = await import("@workspace/db");

  const rawKey = (env["HOPE_PARTNER_KEY"] || "").trim() || DEFAULT_HOPE_PARTNER_KEY;
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
