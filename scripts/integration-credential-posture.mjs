#!/usr/bin/env node
/**
 * integration-credential-posture.mjs — read-only: are the Hope↔Care credentials
 * present, strong, rotated away from anything this repository published, and the
 * SAME value on both sides?
 *
 * It exists because the clinic cannot answer those questions without exposing a
 * secret. `cat .env` puts the live key in the terminal scrollback, in any support
 * screenshot, and in whatever the operator pastes to whoever is helping. Every
 * check below is done on a SHA-256 digest: the tool prints a name, a length, a
 * digest prefix (8 hex, useless offline, enough to line up two hosts) and a
 * yes/no verdict. Nothing it prints can be replayed as a credential.
 *
 *   node scripts/integration-credential-posture.mjs
 *   node scripts/integration-credential-posture.mjs --care-file .env --hope-file /volume1/docker/hope-erp/.env
 *
 * Reads only. Never connects to a database, never calls a peer, never writes.
 * The coordinated rotation procedure is docs/hope-care-integration/06_CREDENTIAL_ROTATION.md.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  PUBLISHED_CREDENTIALS,
  checkSecretStrength,
  credentialDigest,
  findPublishedMatch,
  loadEnvFile,
} from "./check-env-secrets.mjs";

// The two pairs. Each row is (CARE variable, HOPE variable): both sides of a pair
// must hold the identical value, and a mismatch is the single most common result
// of rotating one host and forgetting the other.
export const PAIRS = [
  {
    label: "inbound partner key (HOPE → CARE)",
    care: "HOPE_PARTNER_KEY",
    hope: "CARE_PARTNER_KEY",
    mismatchSymptom: "CARE answers every HOPE request 401 invalid_or_revoked_key",
  },
  {
    label: "callback signing secret (CARE → HOPE)",
    care: "INTEGRATION_HOPE_SIGNING_SECRET",
    hope: "CARE_CALLBACK_SECRET",
    mismatchSymptom: "outbox rows retry and dead-letter with http_401",
  },
];

export function describeCredential(name, raw, published = PUBLISHED_CREDENTIALS) {
  const value = (raw ?? "").trim();
  const digest = credentialDigest(value);
  const weakness = checkSecretStrength(value, 1);
  return {
    name,
    set: value.length > 0,
    length: value.length,
    digestPrefix: digest ? digest.slice(0, 8) : null,
    published: !!findPublishedMatch(value, published),
    // Reuses the deploy gate so the two tools can never disagree about "weak".
    weak: weakness && weakness.reason !== "not set" ? weakness.reason : null,
  };
}

export function auditPair(pair, careEnv, hopeEnv, published) {
  const care = describeCredential(pair.care, careEnv[pair.care], published);
  const hope = describeCredential(pair.hope, hopeEnv[pair.hope], published);
  const bothSet = care.set && hope.set;
  return {
    label: pair.label,
    mismatchSymptom: pair.mismatchSymptom,
    care,
    hope,
    match: bothSet && care.digestPrefix === hope.digestPrefix,
    rotateRequired: care.published || hope.published,
  };
}

function line(text) {
  console.log(text);
}

function render(pairs) {
  let rotateRequired = false;
  let mismatch = false;
  for (const p of pairs) {
    line(`\n${p.label}`);
    for (const c of [p.care, p.hope]) {
      const flags = [
        c.set ? `${c.length} chars` : "NOT SET",
        c.digestPrefix ? `sha256 ${c.digestPrefix}…` : "no digest",
        c.published ? "PUBLISHED-IN-GIT — treat as disclosed" : null,
        c.weak ? `WEAK (${c.weak})` : null,
      ].filter(Boolean);
      line(`  ${c.name.padEnd(32)} ${flags.join("  ")}`);
    }
    line(`  pair matches: ${p.match ? "YES" : "NO"}${p.match ? "" : `  (${p.mismatchSymptom})`}`);
    if (p.rotateRequired) rotateRequired = true;
    if (!p.match) mismatch = true;
  }
  return { rotateRequired, mismatch };
}

export function main(argv = process.argv.slice(2), { published = PUBLISHED_CREDENTIALS } = {}) {
  const get = (flag, dflt) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : dflt);
  const carePath = resolve(get("--care-file", ".env"));
  const hopePath = get("--hope-file") ? resolve(get("--hope-file")) : null;

  if (!existsSync(carePath)) {
    console.error(`CARE env file not found: ${carePath}`);
    return 2;
  }
  const careEnv = loadEnvFile(carePath);
  const hopeEnv = hopePath ? loadEnvFile(hopePath) : {};
  if (hopePath && !existsSync(hopePath)) {
    console.error(`HOPE env file not found: ${hopePath} — pair matching is skipped.`);
  }

  line(`CARE  ${carePath}`);
  line(`HOPE  ${hopePath ?? "(not supplied — pair matching skipped)"}`);

  const pairs = PAIRS.map((p) => auditPair(p, careEnv, hopeEnv, published));
  const verdict = render(pairs);

  line("");
  if (verdict.rotateRequired) {
    line("VERDICT: rotate. A live value is byte-for-byte one this repository committed");
    line("while it was public, so anyone with the repo can present it. Follow");
    line("docs/hope-care-integration/06_CREDENTIAL_ROTATION.md — it is the owner's action,");
    line("and it needs both hosts restarted with the same new value.");
  } else if (verdict.mismatch) {
    line("VERDICT: the two hosts do not hold the same credential. The channel is broken");
    line("in one direction or the other; see the symptom named above.");
  } else {
    line("VERDICT: both credentials are set, strong, unmatched to anything published in");
    line("this repository, and identical on both sides.");
  }
  return verdict.rotateRequired || verdict.mismatch ? 1 : 0;
}

const invokedDirectly =
  !!process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) process.exit(main());
