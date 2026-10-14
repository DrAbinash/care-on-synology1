#!/usr/bin/env node
/**
 * Idempotent Hope ↔ Care integration bootstrap for Synology.
 *
 * - Registers HOPE partner with the API key from HOPE_PARTNER_KEY env (or .env)
 * - Enables ff_hope_care_referrals feature flag
 *
 * FAILS CLOSED when HOPE_PARTNER_KEY is absent or too short to be an issued key.
 * It used to fall back to a key committed to this (public) repository, which
 * meant an unconfigured host came up authenticating HOPE with a credential anyone
 * could read off GitHub. There is no default credential: see
 * docs/hope-care-integration/06_CREDENTIAL_ROTATION.md.
 *
 * AUTOMATIC: care-api runs this on every container start via
 * docker/api-entrypoint.sh (and again from TypeScript in index.ts).
 * You do NOT need to exec it by hand after deploy.
 *
 * Manual (optional):
 *   docker compose exec api node scripts/bootstrap-hope-care-integration.mjs
 *
 * Or locally with DATABASE_URL pointing at Care Postgres.
 */
import { createHash } from "node:crypto";
import pg from "pg";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, "..");

const DEFAULT_CALLBACK =
  "http://172.16.1.139:7080/api/integration/care-callback";

const HOPE_PERMISSIONS = [
  "diagnostic_referral:create",
  "diagnostic_referral:update",
  "diagnostic_referral:cancel",
  "diagnostic_referral:read",
  "diagnostic_result:acknowledge",
  "whatsapp:enqueue",
];

function loadDotEnv() {
  const path = resolve(ROOT, ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (!(k in process.env)) process.env[k] = v;
  }
}

export function hashApiKey(raw) {
  return createHash("sha256").update(raw).digest("hex");
}

// Mirrors MIN_PARTNER_KEY_LENGTH in bootstrapHopeCareIntegration.ts: an issued
// key is `intgk_` + 64 hex, so anything shorter is a truncated copy that would
// register a partner nobody can authenticate as.
export const MIN_PARTNER_KEY_LENGTH = 32;

/** Reason strings name the variable and its length, never its value. */
export function resolvePartnerKey(raw) {
  const key = (raw ?? "").trim();
  if (!key) return { ok: false, reason: "HOPE_PARTNER_KEY is not set" };
  if (key.length < MIN_PARTNER_KEY_LENGTH) {
    return {
      ok: false,
      reason: `HOPE_PARTNER_KEY is only ${key.length} characters (an issued key is at least ${MIN_PARTNER_KEY_LENGTH})`,
    };
  }
  return { ok: true, rawKey: key };
}

async function main() {
  loadDotEnv();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("[bootstrap] DATABASE_URL not set");
    process.exit(1);
  }

  const credential = resolvePartnerKey(process.env.HOPE_PARTNER_KEY);
  if (!credential.ok) {
    console.error(
      `[bootstrap] ${credential.reason} — refusing to register the HOPE partner. ` +
      `No default key is installed (docs/hope-care-integration/06_CREDENTIAL_ROTATION.md)`,
    );
    process.exit(1);
  }

  const rawKey = credential.rawKey;
  const callbackUrl =
    process.env.INTEGRATION_HOPE_CALLBACK_URL || DEFAULT_CALLBACK;
  const keyHash = hashApiKey(rawKey);
  const keyPrefix = rawKey.slice(0, 14);

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();

  try {
    const existing = await client.query(
      `SELECT id FROM integration_partners WHERE code = 'HOPE' LIMIT 1`,
    );

    if (existing.rows.length === 0) {
      await client.query(
        `INSERT INTO integration_partners
           (code, name, direction, key_hash, key_prefix, callback_url,
            source_org_code, destination_org_code, permissions, is_active, created_by)
         VALUES ('HOPE', 'Hope NeuroTrauma Hospital', 'inbound', $1, $2, $3,
                 'HOPE', 'CARE', $4::jsonb, true, 'bootstrap-script')`,
        [keyHash, keyPrefix, callbackUrl, JSON.stringify(HOPE_PERMISSIONS)],
      );
      console.log("[bootstrap] Created HOPE integration partner");
    } else {
      await client.query(
        `UPDATE integration_partners
            SET key_hash = $1, key_prefix = $2, callback_url = $3,
                permissions = $4::jsonb, is_active = true, updated_at = now()
          WHERE code = 'HOPE'`,
        [keyHash, keyPrefix, callbackUrl, JSON.stringify(HOPE_PERMISSIONS)],
      );
      console.log("[bootstrap] Updated HOPE integration partner key + callback");
    }

    await client.query(
      `INSERT INTO feature_flags (key, enabled, description)
       VALUES ('ff_hope_care_referrals', true,
               'HOPE → CARE diagnostic referral integration')
       ON CONFLICT (key) DO UPDATE SET enabled = true`,
    );
    console.log("[bootstrap] Enabled ff_hope_care_referrals");

    console.log("\n[bootstrap] Done.");
    console.log(`  Callback URL: ${callbackUrl}`);
  } finally {
    await client.end();
  }
}

// Imported by scripts/bootstrap-hope-care-integration.test.mjs for the pure
// helpers; only a direct invocation may open a database connection.
const invokedDirectly =
  !!process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  main().catch((err) => {
    console.error("[bootstrap] Failed:", err.message);
    process.exit(1);
  });
}
