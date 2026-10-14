#!/usr/bin/env node
/**
 * Fail the build when a credential-shaped string is committed.
 *
 * Why this exists: `.env.example` shipped a real CARE partner key (`intgk_` + 64
 * hex) and a 64-hex callback secret from July until 2026-10-08, and it survived
 * the earlier scrub commit — `4028ef4f "security: scrub committed secrets"`
 * touched `deploy/synology/` and never looked at the root template. Meanwhile
 * AGENTS.md pointed at `deploy/synology/hope.env`, whose values were always
 * `REPLACE_ME_*`. So the leak was not unknown, it was mislocated, and no check
 * existed that could have found either. The template is the one an operator
 * copies to `.env`, which means a committed value there is a value in
 * production.
 *
 * Dependency-free and deliberately narrow: it matches only lines that ASSIGN to
 * a secret-named key, so lockfile integrity hashes (`sha512-…`) and random
 * identifiers in code do not trip it. Broadening it to "any high-entropy string"
 * would produce a wall of false positives on the first run and then get
 * switched off, which is worse than not having it.
 *
 * It cannot fix history. A rotation is a human action at CARE; this only stops
 * the next one.
 *
 * Usage:
 *   node scripts/check-no-committed-secrets.mjs
 *   node scripts/check-no-committed-secrets.mjs --baseline scripts/committed-secrets-baseline.json
 *   node scripts/check-no-committed-secrets.mjs --write-baseline
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// Values a template legitimately contains. Everything else in a secret-named
// assignment is treated as a real credential.
const PLACEHOLDER = /(REPLACE_ME|CHANGE_ME|CHANGEME|YOUR_|PUT_|SET_ME|xxxx|<[^>]+>|dummy|example|sample|test[_-]|placeholder|none|null|true|false)/i;

// A value that is made of words is documentation, not a credential. Issued
// secrets are random blobs; humans writing templates write `
// your-256-bit-jwt-secret` or `generated_with_openssl_rand_hex_32`. Without this
// rule the scanner's first run would be a wall of false positives, and a noisy
// guard gets switched off — which is worse than not having it.
const DESCRIPTIVE = /(secret|password|token|with|generated|openssl|rand|hex|example|your|my_|sample|demo|staging|local|placeholder|gauntlet|ci-|enter|fill|value)/i;

// The credential families that matter here: Hope's own CARE integration, the
// partner keys the sibling clinic stacks share, and any generic secret-ish name.
const SECRET_NAME = /(SECRET|PASSPHRASE|API_KEY|AUTH_TOKEN|ACCESS_TOKEN|_KEY\b|_TOKEN\b|PASSWORD)/i;

// Shapes of real issued values, not generic randomness.
const PATTERNS = [
  { name: "CARE partner key", re: /\bintgk_[0-9a-f]{20,}\b/i },
  { name: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "PEM private key", re: /-----BEGIN (?:[A-Z ]+)?PRIVATE KEY-----/ },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{30,}\b/ },
  { name: "Twilio API key secret", re: /\bsk[A-Za-z]?[0-9a-f]{28,}\b/ },
  { name: "Slack token", re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
];

// Files that legitimately contain a long hex/base64 blob that is not a secret.
const SKIP = [
  // This scanner's own patterns.
  /^scripts\/check-no-committed-secrets\.mjs$/,
  // Dependency integrity hashes.
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json)$/,
  // Synology Drive's own working metadata, committed to this repo by accident;
  // thousands of stub files, none of them source.
  new RegExp("^" + String.fromCharCode(46) + "SynologyWorkingDirectory/"),
  // Binary-ish assets.
  /\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|eot|pdf|zip|gz|mp4)$/,
];

const secrets = [];
// Credential-length values that were skipped because they read as English.
// Counted and listable so the DESCRIPTIVE rule above is auditable rather than a
// silent hole in the guard.
let suppressed = 0;
const suppressedList = [];

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
  .split("\0")
  .filter(Boolean);

for (const file of files) {
  if (SKIP.some((re) => re.test(file))) continue;

  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue; // binary or unreadable
  }
  if (text.includes("\u0000")) continue; // binary

  const lines = text.replace(/\r\n/g, "\n").split("\n");

  lines.forEach((line, i) => {
    const where = `${file}:${i + 1}`;

    // 1) Unconditional credential shapes. A `intgk_` token is only ever a key.
    for (const p of PATTERNS) {
      if (p.re.test(line)) {
        secrets.push({ where, why: p.name, masked: mask(line) });
      }
    }

    // 2) Assignment to a secret-named variable with a non-placeholder value of
    //    credential length. Catches `SESSION_SECRET=<real hex>` written in any
    //    shape (.env line, YAML `KEY: value`, JS `"KEY": "value"`).
    const asg = /^[+\-#]?\s*[A-Za-z0-9_]*(SECRET|PASSPHRASE|API_KEY|AUTH_TOKEN|ACCESS_TOKEN|_KEY|_TOKEN|PASSWORD)[A-Za-z0-9_]*\s*[:=]\s*["']?([^"'\s#]+)/i.exec(line);
    if (asg) {
      const value = asg[2];
      const longEnough = value.length >= 24;
      const credentialCharset = /^[A-Za-z0-9_\-+/=:.]+$/.test(value);
      const descriptive = DESCRIPTIVE.test(value) || PLACEHOLDER.test(value);
      // Publishable/client keys are public by design — a Stripe `pk_live_` key
      // ships in browser JavaScript and carries no authority on its own. Only
      // the `sk_` (secret) half of that pair is a credential, and that stays
      // flagged below.
      const publicByDesign = /^(pk_live_|pk_test_|pub_|public_|client_|anon(ymous)?_)/i.test(value);
      if (longEnough && credentialCharset && !descriptive && !publicByDesign) {
        secrets.push({ where, why: "secret-named assignment", masked: mask(line) });
      } else if (longEnough && credentialCharset && (descriptive || publicByDesign)) {
        suppressed++;
        suppressedList.push(`${where}  ${mask(line).trim()}`);
      }
    }
  });
}

function mask(line) {
  return line
    .replace(/\b(intgk_[0-9a-f]{4})[0-9a-f]+\b/gi, "$1…[masked]")
    .replace(/([0-9a-f]{6})[0-9a-f]{18,}/gi, "$1…[masked]")
    .replace(/(AKIA[0-9A-Z]{4})[0-9A-Z]+/g, "$1…[masked]")
    .replace(/([A-Za-z0-9]{6})[A-Za-z0-9_\-+/=]{18,}/g, "$1…[masked]")
    .slice(0, 120);
}

const unique = [...new Map(secrets.map((s) => [`${s.where}|${s.why}`, s])).values()];

// file → finding count. The baseline is keyed by file, not by line, so a finding
// cannot escape by moving down the same file, and an unrelated edit higher up the
// file does not make the guard cry.
const counts = {};
for (const f of unique) counts[f.where.split(":")[0]] = (counts[f.where.split(":")[0]] || 0) + 1;

const argv = process.argv.slice(2);
const DEFAULT_BASELINE = resolve("scripts/committed-secrets-baseline.json");
const baselinePath = argv.includes("--baseline") ? resolve(argv[argv.indexOf("--baseline") + 1]) : null;
const writeBaseline = argv.includes("--write-baseline");

if (writeBaseline) {
  const target = baselinePath || DEFAULT_BASELINE;
  const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1)));
  writeFileSync(target, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
  console.log(`Wrote ${Object.keys(sorted).length} file entries, ${unique.length} findings, to ${target}`);
  process.exit(0);
}

if (baselinePath) {
  if (!existsSync(baselinePath)) {
    console.error(`ERROR: baseline ${baselinePath} is missing. Generate it with --write-baseline and commit it.`);
    process.exit(1);
  }
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const grew = Object.entries(counts).filter(([file, n]) => n > (baseline[file] ?? -1));
  const shrank = Object.entries(baseline).filter(([file, n]) => (counts[file] ?? 0) < n);

  if (grew.length || shrank.length) {
    console.error(`\nCommitted-secret ratchet FAILED against ${baselinePath}\n`);
    for (const [file, n] of grew) {
      console.error(`  ↑ ${file}: ${baseline[file] ?? 0} → ${n} finding(s). A newly committed credential.`);
    }
    for (const [file, n] of shrank) {
      console.error(`  ↓ ${file}: ${n} → ${counts[file] ?? 0}. Good — now record it:`);
      console.error(`      node scripts/check-no-committed-secrets.mjs --write-baseline`);
    }
    console.error(
      `\nCounts must match the baseline exactly: up is a new leak, down must be committed\n` +
      `so the ratchet never sits above reality and hides the next finding in that file.`,
    );
    process.exit(1);
  }

  console.log(
    `Committed-secret check passed against baseline: ${files.length} tracked files, ` +
    `${unique.length} findings in ${Object.keys(counts).length} files — all recorded, none added ` +
    `(${suppressed} credential-length values skipped as descriptive text).`,
  );
  process.exit(0);
}

if (unique.length) {
  console.error(`\nCommitted-secret check FAILED (${unique.length} finding(s))\n`);
  for (const f of unique) {
    // Values are masked on purpose: an audit log of secrets is a second leak.
    console.error(`  ${f.where}  —  ${f.why}`);
    console.error(`      ${f.masked}`);
  }
  console.error(
    "\nPut the real value in the deployment's .env (never in a tracked file) and\n" +
    "leave REPLACE_ME_* in templates. If this value was ever committed, treat it\n" +
    "as disclosed: rotate it at the issuing service. Deleting the line does not\n" +
    "un-leak it — git history still has it.\n"
  );
  process.exit(1);
}

console.log(
  `Committed-secret check passed (${files.length} tracked files scanned, ` +
  `${unique.length} findings, ${suppressed} credential-length values skipped as ` +
  `descriptive text — run with --show-suppressed to list them)`
);
if (process.argv.includes("--show-suppressed")) {
  for (const s of suppressedList) console.log(`  suppressed: ${s}`);
}
