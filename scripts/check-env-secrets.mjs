#!/usr/bin/env node
/**
 * check-env-secrets.mjs — fail fast when a deployment ships a weak or burned key.
 *
 * Used by deploy-synology.sh before `docker compose up`. Never prints secret values:
 * a finding names the variable and, at most, its length.
 *
 *   node scripts/check-env-secrets.mjs
 *   node scripts/check-env-secrets.mjs --file .env
 *   node scripts/check-env-secrets.mjs --warn-only
 *
 * Two classes of finding:
 *   • weak — a placeholder, too short, too few distinct characters, sequential.
 *   • published — byte-for-byte a credential this repository has committed. The
 *     Hope ↔ Care pair was in `deploy/synology/*.env`, `.env.example`, the README
 *     and `deploy-synology.sh` while the repo was PUBLIC, so any live host still
 *     presenting either digest is authenticating with a value anyone can read off
 *     GitHub. Comparing digests (never values) is what lets the gate say that
 *     without becoming a second copy of the leak.
 *
 * Missing credentials only matter when the host is actually wired for Hope, so a
 * clinic that never enabled the integration is not blocked by this gate.
 */

import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MIN_SECRET_LENGTH = 16;
// An issued partner key is `intgk_` + 64 hex and the HMAC secret is 64 hex, so a
// live value shorter than this is a truncated copy, not a credential.
const MIN_INTEGRATION_SECRET_LENGTH = 32;

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
  "todo", "tbd", "xxx", "none", "null", "undefined",
  "replace_with_your_internal_api_key",
  "your-internal-api-key-here",
  "your-secure-internal-api-key-here",
]);

/**
 * sha256 of every credential value this repository has ever committed, with the
 * aliases that carry the same secret on each side of the integration. These are
 * digests, not secrets: revealing one grants nothing, and keeping only the digest
 * is what stops this file from re-publishing the value it is guarding against.
 */
export const PUBLISHED_CREDENTIALS = [
  {
    digest: "5dce9552501ceca7142bc329aa21596c7b826f96143d9b1fe2bf2a44928d3305",
    label: "the HOPE↔CARE partner key (committed as HOPE_PARTNER_KEY / CARE_PARTNER_KEY)",
  },
  {
    digest: "2c2c65bbe5fd7e5218ca068ab164699e787d389a646eb17afa4e4db7e712b598",
    label: "the HOPE↔CARE callback signing secret (committed as INTEGRATION_HOPE_SIGNING_SECRET / CARE_CALLBACK_SECRET)",
  },
  // Measured live on the clinic on 2026-10-29, read-only: each of these was
  // byte-for-byte the value in the deploy directory's `.env` AND the value in the
  // running care-api container's environment. They were in `deploy/synology/care.env`,
  // which `deploy/synology/README.md:103` tells an operator to copy straight to
  // `.env` — so a template, not a mistake in a one-off file. Only values with
  // enough entropy to survive a digest are listed: a 4-digit PIN digest would
  // publish the PIN itself, so SUPER_ADMIN_USB_PIN and DB_PASSWORD are rotated by
  // hand and named in the deployment runbook instead.
  {
    digest: "c0d1665aaa66a08f5d6d5709b664131ea9e3cf4e8ecaab2a18edd3ebb86b2b35",
    label: "the JSON Web Token signing key (committed as JWT_SECRET)",
  },
  {
    digest: "f947018e7a1f6c7fd7f795b0c5240aaaf8072813ec5d54bed80ef9368d1c4e6d",
    label:
      "the session signing key (committed as SESSION_SECRET) — anyone holding it can mint a valid staff session",
  },
  {
    digest: "765bf4581431a8e1eca8a0aa8e768961ec310917ba56d0557810d23d0894ec38",
    label:
      "the encrypted-backup passphrase (committed as BACKUP_PASSPHRASE) — it decrypts every dump in /volume1/backup/care-erp",
  },
  {
    digest: "57b3097ac82b1035c7c6b600a7007338e95ee8fab063f3b036d0dc27983aab1e",
    label: "the cron trigger secret (committed as CRON_SECRET)",
  },
  {
    digest: "e98b24b6622f36760684d43341754132d6be8cd1165e2671c970eceb8b8dc236",
    label:
      "the Super Admin pen-drive key (committed as SUPER_ADMIN_USB_KEY) — this is the value that lives on superadmin.key; holding it defeats the physical-possession model of POST /api/super-admin/login",
  },
  {
    digest: "6cdf501e0072f3716e289edd76fcf27d9c8523f2286508aa6cd650290f186656",
    label: "the ICICI payment gateway key (committed as ICICI_SECRET_KEY)",
  },
  {
    digest: "1048e5e9d5ddb0edf986a62768ad815119153e72f26ae56a772f41f2422cb294",
    label: "the internal API key (committed as INTERNAL_API_KEY)",
  },
  {
    digest: "1b8b5fa23afac633132a338e2899092aa46882ec77639361d9137f247a4229b4",
    label: "the OCR worker token (committed as OCR_WORKER_TOKEN)",
  },
];

export function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/** null when acceptable, otherwise the reason — a placeholder, short, or sequential. */
export function checkSecretStrength(raw, minLength = MIN_SECRET_LENGTH) {
  const secret = (raw ?? "").trim();
  if (secret.length === 0) return { reason: "not set" };
  if (KNOWN_WEAK.has(secret.toLowerCase())) return { reason: "a well-known placeholder value" };
  if (secret.length < minLength) return { reason: `only ${secret.length} characters (minimum ${minLength})` };
  if (new Set(secret).size < 5) return { reason: `only ${new Set(secret).size} distinct characters` };
  if (/^(?:0123456789)+\d*$/.test(secret) || /^(?:abcdefghij)+[a-z]*$/i.test(secret)) {
    return { reason: "a sequential pattern" };
  }
  return null;
}

/** sha256 hex of a value, or null for unset. Value never leaves this function. */
export function credentialDigest(raw) {
  const secret = (raw ?? "").trim();
  if (!secret) return null;
  return createHash("sha256").update(secret).digest("hex");
}

export function findPublishedMatch(raw, published = PUBLISHED_CREDENTIALS) {
  const digest = credentialDigest(raw);
  if (!digest) return null;
  return published.find((p) => p.digest === digest) ?? null;
}

/**
 * True when this deployment is wired to talk to Hope, in which case its two
 * credentials are load-bearing rather than optional.
 */
export function isHopeIntegrationArmed(env) {
  const force = (env["HOPE_CARE_INTEGRATION_FORCE"] || "").trim().toLowerCase();
  if (force === "1" || force === "true") return true;
  if ((env["INTEGRATION_HOPE_CALLBACK_URL"] || "").trim()) return true;
  if ((env["HOPE_PARTNER_KEY"] || "").trim()) return true;
  if ((env["INTEGRATION_HOPE_SIGNING_SECRET"] || "").trim()) return true;
  return false;
}

// Guarded regardless of arming: a weak value is a weak value.
export const GUARDED = [
  {
    name: "INTERNAL_API_KEY",
    note:
      "Rotate in BOTH .env and care_erp_sync.py (ERP_INTERNAL_API_KEY) on the Orthanc/NAS host before redeploying.",
  },
  { name: "CRON_SECRET", note: "Used by POST /api/internal/cron/* triggers." },
  { name: "WHATSAPP_AUTOMATION_SECRET", note: "Used by n8n WhatsApp automation triggers." },
];

// The Hope ↔ Care pair. Both sides of each must hold the same value, so rotating
// one alone breaks the channel: CARE's .env and HOPE's .env are both in scope.
export const INTEGRATION_GUARDED = [
  {
    name: "HOPE_PARTNER_KEY",
    minLength: MIN_INTEGRATION_SECRET_LENGTH,
    note:
      "HOPE sends it as `Authorization: Bearer …` (its own copy is CARE_PARTNER_KEY). CARE stores only its "
      + "sha256 in integration_partners.key_hash, and bootstrapHopeCareIntegration() writes THAT value on "
      + "every API start — so rotate by setting the new key in BOTH .env files and restarting, not with "
      + "POST /api/integration/admin/partners/:id/rotate-key (the next boot would overwrite it).",
  },
  {
    name: "INTEGRATION_HOPE_SIGNING_SECRET",
    minLength: MIN_INTEGRATION_SECRET_LENGTH,
    note:
      "HMAC for CARE→HOPE callbacks; HOPE's copy is CARE_CALLBACK_SECRET. Outbox delivery stays "
      + "`pending` with delivery_not_configured while it is missing — events queue, none are sent.",
  },
];

/**
 * The whole audit, as data. Never returns a value, only names, lengths and reasons.
 */
export function auditEnvSecrets(env, { published = PUBLISHED_CREDENTIALS } = {}) {
  const problems = [];

  for (const { name, note } of GUARDED) {
    const weakness = checkSecretStrength(env[name]);
    if (!weakness || weakness.reason === "not set") continue;
    problems.push({ name, reason: weakness.reason, note });
  }

  const armed = isHopeIntegrationArmed(env);
  for (const { name, minLength, note } of INTEGRATION_GUARDED) {
    const hit = findPublishedMatch(env[name], published);
    if (hit) {
      problems.push({
        name,
        reason: "byte-for-byte a credential this repository published while it was public",
        note: `Treat it as disclosed and rotate it — ${hit.label}. ${note}`,
        exposed: true,
      });
      continue;
    }
    const weakness = checkSecretStrength(env[name], minLength);
    if (!weakness) continue;
    if (weakness.reason === "not set") {
      // Only a host that never mentions Hope may leave these unset: nothing can
      // authenticate as HOPE and nothing signs, so the channel is simply dark.
      if (!armed) continue;
      problems.push({
        name,
        reason: "not set while the Hope integration is armed",
        note: `${note} Set it in the deployment .env, or unset HOPE_CARE_INTEGRATION_FORCE and `
          + `INTEGRATION_HOPE_CALLBACK_URL if this host must not talk to Hope.`,
      });
      continue;
    }
    problems.push({ name, reason: weakness.reason, note });
  }

  // Any value in the deployment env that digests to a credential this repository
  // published is disclosed, whatever variable it now sits in — moving or renaming
  // a burned secret is not rotation. The two integration names above are already
  // covered, so each variable is reported once.
  const reported = new Set(problems.map((p) => p.name));
  for (const [name, value] of Object.entries(env)) {
    if (reported.has(name)) continue;
    if (typeof value !== "string" || !value.trim()) continue;
    const hit = findPublishedMatch(value, published);
    if (!hit) continue;
    problems.push({
      name,
      reason: "byte-for-byte a credential this repository published while it was public",
      note: `Treat it as disclosed and rotate it — ${hit.label}. The value is still in git history, `
        + `so removing it from the file does not un-leak it.`,
      exposed: true,
    });
  }

  return { problems, armed };
}

function parseArgs(argv) {
  let file = ".env";
  let warnOnly = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--file" && argv[i + 1]) file = argv[++i];
    else if (argv[i] === "--warn-only") warnOnly = true;
  }
  return { file: resolve(file), warnOnly };
}

function main() {
  const { file, warnOnly } = parseArgs(process.argv.slice(2));
  const env = loadEnvFile(file);
  const { problems, armed } = auditEnvSecrets(env);

  if (problems.length === 0) {
    console.log(
      `✓ ${file}: guarded secrets look acceptable (values not shown)` +
      (armed ? "; Hope integration armed." : "; Hope integration not armed."),
    );
    process.exit(0);
  }

  const header = warnOnly ? "WARNING" : "ERROR";
  console.error(`${header}: machine-to-machine secret problem(s) in ${file}:`);
  for (const p of problems) {
    console.error(`  • ${p.name} is ${p.reason}. ${p.note}`);
  }
  console.error("");
  console.error("Generate a strong key and put it in the deployment .env (never in a tracked file):");
  console.error("  openssl rand -hex 32");
  console.error("For the Hope pair, set the same new value on BOTH sides and restart, then follow");
  console.error("  docs/hope-care-integration/06_CREDENTIAL_ROTATION.md.");
  console.error("To deploy anyway without this gate (one run, prints warnings only):");
  console.error("  node scripts/check-env-secrets.mjs --file .env --warn-only");
  if (!warnOnly) process.exit(1);
  process.exit(0);
}

const invokedDirectly =
  !!process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) main();
