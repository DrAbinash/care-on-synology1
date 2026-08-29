// Weak-secret rejection for the machine-to-machine bearer tokens that gate the
// /api/internal/* routers.
//
// Those routers sit under the PUBLIC /api/ prefix — docker/nginx.conf proxies
// all of /api/ straight from the internet — and one of them
// (/api/internal/backup/download) runs pg_dump and streams the entire patient
// database. There is no IP allowlist. The bearer token is the only thing
// standing in front of it.
//
// Production was deployed with INTERNAL_API_KEY=1234, which makes that endpoint
// a public database export:
//
//   curl -H "Authorization: Bearer 1234" \
//     https://<host>/api/internal/backup/download?format=gzip
//
// The auth code itself was already correct — it fails closed when the variable
// is unset and compares in constant time. The hole was purely the deployed
// VALUE, and nothing in the system could tell the difference between a strong
// secret and "1234". This closes that gap: a secret too weak to be worth
// checking is treated exactly like a missing one.
//
// Deliberately a 503 (endpoint disabled) rather than a refusal to boot. A clinic
// ERP must not go dark because of a config value; disabling the one affected
// endpoint closes the exposure while patient-facing traffic keeps serving.

/** Minimum length for a machine-generated bearer token. */
export const MIN_SECRET_LENGTH = 16;

/**
 * Values that must never guard a public endpoint, whatever their length.
 * Compared case-insensitively against the trimmed secret.
 */
const KNOWN_WEAK = new Set([
  "1234", "12345", "123456", "1234567", "12345678", "123456789", "1234567890",
  "changeme", "change-me", "change_me",
  "password", "passwd", "pass",
  "secret", "secrets", "mysecret",
  "admin", "administrator", "root",
  "test", "testing", "test123",
  "default", "example", "sample",
  "apikey", "api-key", "api_key", "key",
  "token", "bearer",
  "internal", "internalapikey",
  "cronsecret", "cron-secret", "cron_secret",
  "replace_with_your_internal_api_key",
  "your-internal-api-key-here",
  "your-secure-internal-api-key-here",
]);

export type SecretWeakness = {
  /** Short, safe-to-log reason. Never contains the secret itself. */
  reason: string;
};

/**
 * Returns a weakness if this secret is unfit to guard a public endpoint,
 * or null if it is acceptable.
 *
 * Never returns or logs the secret value — callers log the reason and the
 * variable NAME only.
 */
export function checkSecretStrength(raw: string | undefined | null): SecretWeakness | null {
  const secret = (raw ?? "").trim();

  if (secret.length === 0) {
    return { reason: "not set" };
  }
  if (KNOWN_WEAK.has(secret.toLowerCase())) {
    return { reason: "a well-known placeholder value" };
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    return { reason: `only ${secret.length} characters (minimum ${MIN_SECRET_LENGTH})` };
  }
  // "aaaaaaaaaaaaaaaaaaaa" clears the length bar but has no entropy.
  if (new Set(secret).size < 5) {
    return { reason: `only ${new Set(secret).size} distinct characters` };
  }
  // Purely sequential runs like "12345678901234567890".
  if (/^(?:0123456789)+\d*$/.test(secret) || /^(?:abcdefghij)+[a-z]*$/i.test(secret)) {
    return { reason: "a sequential pattern" };
  }
  return null;
}

/**
 * Builds the operator-facing message for a disabled endpoint. Names the
 * environment variable and the reason, never the value.
 */
export function weakSecretMessage(varName: string, weakness: SecretWeakness): string {
  return (
    `${varName} is ${weakness.reason} — this endpoint is disabled because it is reachable ` +
    `from the public internet. Set ${varName} to a random string of at least ` +
    `${MIN_SECRET_LENGTH} characters (e.g. \`openssl rand -base64 32\`) and restart.`
  );
}

/**
 * Secrets that guard internet-reachable endpoints, and what a weak value still
 * exposes even after the hard blocks above.
 *
 * INTERNAL_API_KEY is shared by FOUR consumers, and only one of them can be
 * closed by code without breaking clinical operations:
 *
 *   internal-backup.ts     full-database export  → BLOCKED when weak (no
 *                                                  operational dependency: the
 *                                                  in-app scheduler calls
 *                                                  pg_dump directly, not over
 *                                                  HTTP)
 *   internal-radiology.ts  DICOM study intake    → still open; blocking it
 *                                                  would stop Orthanc pushing
 *                                                  studies into the ERP
 *   hl7.ts                 HL7 inbound           → still open
 *   rateLimits.ts          rate-limit bypass     → still open
 *
 * So a weak INTERNAL_API_KEY remains a real exposure that only rotation fixes.
 * This makes that unmissable on every boot instead of silent.
 */
const GUARDED_SECRETS: ReadonlyArray<{ name: string; stillExposed: string }> = [
  {
    name: "INTERNAL_API_KEY",
    stillExposed:
      "DICOM study intake (/api/internal/radiology*), HL7 inbound and the rate-limit bypass " +
      "remain reachable with this value — the full-database export is blocked, the rest are not. " +
      "Rotate the key; it is also hardcoded in care_erp_sync.py and must be changed in both places.",
  },
  {
    name: "CRON_SECRET",
    stillExposed: "Scheduled-backup, restore-verification and money-trail triggers are blocked while weak.",
  },
  {
    name: "WHATSAPP_AUTOMATION_SECRET",
    stillExposed: "n8n's WhatsApp automation triggers (/api/internal/automations/whatsapp/*) are blocked while weak.",
  },
  {
    name: "REPORTING_STUDIO_API_KEY",
    stillExposed:
      "CARE Reporting Studio bridge (/api/internal/reporting-studio/*) remains reachable with this value — rotate and update Studio Settings → Integrations.",
  },
];

/**
 * Logs a prominent warning at boot for every internet-reachable secret that is
 * weak. Returns the names found weak so callers can assert on it.
 *
 * Deliberately does not throw: a clinic ERP must not fail to start over a
 * config value. The per-endpoint blocks above are what actually close the hole.
 */
export function reportWeakGuardedSecrets(
  log: (msg: string) => void,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const weak: string[] = [];
  for (const { name, stillExposed } of GUARDED_SECRETS) {
    const weakness = checkSecretStrength(env[name]);
    // An unset CRON_SECRET is a normal "feature off" state, not a misconfig —
    // only warn when something is actually set to a weak value.
    if (!weakness || weakness.reason === "not set") continue;
    weak.push(name);
    log(`SECURITY: ${weakSecretMessage(name, weakness)} ${stillExposed}`);
  }
  return weak;
}
