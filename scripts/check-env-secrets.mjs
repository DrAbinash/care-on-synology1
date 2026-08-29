#!/usr/bin/env node
/**
 * check-env-secrets.mjs — fail fast when .env ships weak machine-to-machine keys.
 *
 * Used by deploy-synology.sh before `docker compose up`. Never prints secret values.
 *
 *   node scripts/check-env-secrets.mjs
 *   node scripts/check-env-secrets.mjs --file .env
 *   node scripts/check-env-secrets.mjs --warn-only
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const MIN_SECRET_LENGTH = 16;
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

function parseArgs() {
  const args = process.argv.slice(2);
  let file = ".env";
  let warnOnly = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--file" && args[i + 1]) file = args[++i];
    else if (args[i] === "--warn-only") warnOnly = true;
  }
  return { file: resolve(file), warnOnly };
}

function loadEnvFile(path) {
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

function checkSecretStrength(raw) {
  const secret = (raw ?? "").trim();
  if (secret.length === 0) return { reason: "not set" };
  if (KNOWN_WEAK.has(secret.toLowerCase())) return { reason: "a well-known placeholder value" };
  if (secret.length < MIN_SECRET_LENGTH) return { reason: `only ${secret.length} characters (minimum ${MIN_SECRET_LENGTH})` };
  if (new Set(secret).size < 5) return { reason: `only ${new Set(secret).size} distinct characters` };
  if (/^(?:0123456789)+\d*$/.test(secret) || /^(?:abcdefghij)+[a-z]*$/i.test(secret)) {
    return { reason: "a sequential pattern" };
  }
  return null;
}

const GUARDED = [
  {
    name: "INTERNAL_API_KEY",
    note:
      "Rotate in BOTH .env and care_erp_sync.py (ERP_INTERNAL_API_KEY) on the Orthanc/NAS host before redeploying.",
  },
  { name: "CRON_SECRET", note: "Used by POST /api/internal/cron/* triggers." },
  { name: "WHATSAPP_AUTOMATION_SECRET", note: "Used by n8n WhatsApp automation triggers." },
];

function main() {
  const { file, warnOnly } = parseArgs();
  const env = loadEnvFile(file);
  const problems = [];

  for (const { name, note } of GUARDED) {
    const weakness = checkSecretStrength(env[name]);
    if (!weakness || weakness.reason === "not set") continue;
    problems.push({ name, reason: weakness.reason, note });
  }

  if (problems.length === 0) {
    console.log(`✓ ${file}: guarded secrets look acceptable (values not shown).`);
    process.exit(0);
  }

  const header = warnOnly ? "WARNING" : "ERROR";
  console.error(`${header}: weak machine-to-machine secret(s) in ${file}:`);
  for (const p of problems) {
    console.error(`  • ${p.name} is ${p.reason}. ${p.note}`);
  }
  if (!warnOnly) {
    console.error("");
    console.error("Generate a strong key:");
    console.error("  bash scripts/rotate-internal-api-key.sh");
    console.error("Or manually:");
    console.error("  openssl rand -base64 32");
    process.exit(1);
  }
  process.exit(0);
}

main();
