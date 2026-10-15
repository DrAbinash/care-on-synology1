#!/usr/bin/env node
/**
 * ops-preflight.mjs — read-only "is this box actually ready to deploy?" gate.
 * ==========================================================================
 *
 * WHY THIS EXISTS
 *   deploy-synology.sh hard-resets to origin/main, stamps build metadata, checks
 *   three secrets, builds, and then waits for two things to go green. It never
 *   asks whether a backup exists, whether one has ever been restored, whether the
 *   database behind the socket is the clinic's database, whether the
 *   external-result-link audit is clean, or whether the disk holding the next
 *   backup has room. The pre-deployment gate documents all of that; a document an
 *   operator has to remember to read is not a gate. This is the gate.
 *
 * IT IS READ-ONLY AND NEVER FIXES ANYTHING
 *   It runs SELECT-only scripts that already exist, spawns read-only commands,
 *   and reads files. It applies no migration, restarts no container, creates no
 *   backup and writes nothing except the operator's own evidence file when
 *   `--record-*` is asked for explicitly. If it says FAIL, the remedy is a human
 *   action listed beside it — never an automatic repair, because in this product
 *   the automatic repair is the dangerous option (a duplicate link row can carry
 *   a critical-result acknowledgement a clinician already made).
 *
 * STATUS CONTRACT — every check answers exactly one of four
 *   PASS                 the check ran and the condition is verified
 *   FAIL                 the check ran and found an unsafe condition
 *   UNKNOWN              evidence is missing, inaccessible, or insufficient
 *   NOT_APPLICABLE       deliberately outside deployment scope
 *
 *   UNKNOWN is not a soft PASS and is never promoted. A deployment that cannot
 *   show restore evidence reports INSUFFICIENT_EVIDENCE, which is the honest
 *   answer and the one an operator can act on.
 *
 * VERDICT
 *   READY                  no FAIL and no critical UNKNOWN
 *   NOT_READY              at least one FAIL
 *   INSUFFICIENT_EVIDENCE  no FAIL, but a critical check could not be run
 *
 * USAGE
 *   node scripts/ops-preflight.mjs                  # human-readable
 *   node scripts/ops-preflight.mjs --json            # for CI / an operator runbook
 *   node scripts/ops-preflight.mjs --env-file .env   # default: repo .env, else the Synology template
 *   PREFLIGHT_MAX_BACKUP_AGE_HOURS=26 node scripts/ops-preflight.mjs
 *
 * EXIT CODE
 *   0 READY · 1 NOT_READY · 2 INSUFFICIENT_EVIDENCE
 *
 * SECRETS AND PHI
 *   Nothing here prints a credential or a patient field. Credentials are reported
 *   as length + an 8-hex digest prefix at most (the same rule
 *   integration-credential-posture.mjs uses), and the database checks read counts
 *   and identifiers only. The whole output is safe to paste into a support chat,
 *   which is the point: an operator mid-incident will paste it.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, statfsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  PUBLISHED_CREDENTIALS,
  auditEnvSecrets,
  isHopeIntegrationArmed,
  loadEnvFile,
} from "./check-env-secrets.mjs";
import { runSurface as runFinancialSurface, MONEY as FINANCIAL_MONEY, CLOSES as FINANCIAL_CLOSES, UNVERIFIED as FINANCIAL_UNVERIFIED } from "./financial-integrity.mjs";

export const PASS = "PASS";
export const FAIL = "FAIL";
export const UNKNOWN = "UNKNOWN";
export const NOT_APPLICABLE = "NOT_APPLICABLE";

export const READY = "READY";
export const NOT_READY = "NOT_READY";
export const INSUFFICIENT_EVIDENCE = "INSUFFICIENT_EVIDENCE";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");

/** The keys compose and the API cannot work without. Sourced from
 *  deploy/synology/care.env, which is the file deploy-synology.sh seeds .env
 *  from — so "required" here means "the template ships a slot for it".
 *  ENABLE_SCHEDULERS is deliberately NOT in this list: a host may legitimately
 *  set it to 0, and its own check reports the consequence. */
export const REQUIRED_ENV = [
  "DB_USER",
  "DB_PASSWORD",
  "DB_NAME",
  "JWT_SECRET",
  "SESSION_SECRET",
  "CRON_SECRET",
  "INTERNAL_API_KEY",
  "OBJECT_STORAGE_DIR",
  "PUBLIC_BASE_URL",
];

/**
 * The services a deploy cannot work without.
 *
 * schema-verify is in this list because care-api starts only after both
 * db-patch-v2 AND schema-verify complete, and deploy-synology.sh's own closing
 * banner names care-schema-verify as something it verified. redis is NOT,
 * because lib/redisClient.ts degrades when it is unconfigured.
 */
export const REQUIRED_COMPOSE_SERVICES = ["db", "db-patch-v2", "schema-verify", "api", "web"];

/**
 * CARE's outbound HOPE event types, as a set this file can check against the
 * source. It is deliberately NOT a copy of HOPE's list: the only honest
 * statement available from this repository is what CARE sends, and the one type
 * HOPE cannot interpret (`diagnostic_electronic_film.available`) is named here
 * precisely so a check can fail if it silently becomes something else.
 * `hopeEventContractHolds()` compares this against the emit sites in the source.
 */
export const CARE_EMITTED_EVENTS = [
  "diagnostic_referral.received",
  "diagnostic_order.created",
  "diagnostic_referral.cancelled",
  "diagnostic_sample.collected",
  "diagnostic_study.completed",
  "diagnostic_order.item_status_changed",
  "diagnostic_report.finalised",
  "diagnostic_report.amended",
  "diagnostic_result.critical",
  "diagnostic_result.escalated",
  "diagnostic_electronic_film.available",
];
export const HOPE_UNSUPPORTED_EVENTS = ["diagnostic_electronic_film.available"];

/** Checks whose UNKNOWN must stop a "READY" verdict. Everything that decides
 *  whether patient data can be recovered, or whether the wrong database is
 *  about to be migrated, is in this list. */export const CRITICAL_CHECKS = [
  "repo.commit",
  "env.required",
  "credentials.safe",
  "database.identity",
  "migrations.static",
  "migrations.pending",
  "links.external_result_duplicates",
  "financial.money_identity",
  "financial.day_close_identity",
  "backup.artifacts_present",
  "backup.freshness",
  "backup.metadata",
  "restore.evidence",
  "disk.space",
  "compose.valid",
  "hope.integration",
  "hope.receiver_version",
  "schedulers.consistent",
];

/** Every check id the gate is expected to emit. Exported so the test suite can
 *  assert each one is reachable — a check that can only ever answer UNKNOWN is
 *  decoration, and this list is how that gets noticed. */
export const REQUIRED_CHECK_IDS = [
  "repo.commit",
  "repo.clean_deployment_config",
  "env.required",
  "credentials.safe",
  "database.identity",
  "migrations.static",
  "migrations.pending",
  "links.external_result_duplicates",
  "financial.money_identity",
  "financial.day_close_identity",
  "backup.artifacts_present",
  "backup.freshness",
  "backup.metadata",
  "restore.evidence",
  "disk.space",
  "compose.valid",
  "compose.services_required",
  "hope.integration",
  "hope.receiver_version",
  "rollback.prerequisites",
  "schedulers.consistent",
  "deploy.metadata",
  "deploy.config_single_source",
  "backup.orthanc_images",
];

export const DEFAULT_BACKUP_ROOTS = [
  "/volume1/backup/care-erp/db",
  "/volume1/backups/caredeoghar",
];

export const ARTIFACT_GLOBS = [
  /^caredeoghar_.*\.sql\.gz(\.enc)?$/,
  /^backup_.*\.sql(\.enc)?$/,
  /^care_db_daily_.*\.sql\.gz$/,
];

// ─── helpers ─────────────────────────────────────────────────────────────────

const defaultExec = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: opts.timeout ?? 60_000, cwd: opts.cwd ?? REPO });
  return { code: r.status, stdout: r.stdout || "", stderr: r.stderr || "", missing: r.error !== undefined };
};

const firstLine = (s) => String(s || "").split(/\r?\n/).find((l) => l.trim()) || "";

export function makeContext(over = {}) {
  const env = { ...(over.envFileEnv ?? {}), ...(over.env ?? process.env) };
  return {
    repo: over.repo ?? REPO,
    env,
    exec: over.exec ?? defaultExec,
    now: over.now ?? (() => Date.now()),
    readFile: over.readFile ?? ((p) => (existsSync(p) ? readFileSync(p, "utf8") : null)),
    listDir: over.listDir ?? ((p) => (existsSync(p) ? readdirSync(p) : null)),
    readDir: over.readDir ?? ((p) => {
      try {
        return readdirSync(p, { withFileTypes: true });
      } catch {
        return null;
      }
    }),
    stat: over.stat ?? ((p) => (existsSync(p) ? statSync(p) : null)),
    statfs: over.statfs ?? ((p) => { try { return statfsSync(p); } catch { return null; } }),
    envFile: over.envFile ?? null,
  };
}

/** Resolve the environment the deploy will actually use: an explicit file, else
 *  the repo .env, else the Synology template. process.env wins, because that is
 *  what docker compose interpolation sees.
 *
 *  `template: true` matters. deploy/synology/care.env is committed example
 *  content — every key is present, so "all 9 required variables exist" would be
 *  a PASS read off a file that is not the one the container starts from. Any
 *  check that depends on the live values degrades to UNKNOWN when only the
 *  template was found, and says so. */
export function resolveEnvFile(ctx, explicit) {
  if (explicit) return { file: explicit, values: loadEnvFileSafe(ctx, explicit), template: false };
  const live = path.join(ctx.repo, ".env");
  if (ctx.readFile(live) !== null) return { file: live, values: loadEnvFileSafe(ctx, live), template: false };
  const template = path.join(ctx.repo, "deploy", "synology", "care.env");
  if (ctx.readFile(template) !== null) {
    return { file: template, values: loadEnvFileSafe(ctx, template), template: true };
  }
  return { file: null, values: {}, template: false };
}

function loadEnvFileSafe(ctx, file) {
  try {
    return loadEnvFile(file);
  } catch {
    return {};
  }
}

export function isArtifact(name) {
  return ARTIFACT_GLOBS.some((re) => re.test(name)) && !name.endsWith(".partial") && !name.endsWith(".meta");
}

/**
 * A `.meta` sidecar is `key=value` per line, and the last occurrence wins — which
 * is what `scripts/verify-backup-restore.sh`'s `meta_get` does too. Two readers of
 * one format must agree on a duplicated key or one tool calls broken what the other
 * passes.
 */
export function parseSidecar(text) {
  return Object.fromEntries(
    String(text).split(/\r?\n/).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
}

/**
 * A field value shaped like a credential. Both readers of a sidecar use this: the
 * inventory to redact a manifest field, and here to stop a *diagnostic message* from
 * quoting the value it just rejected. Redacting one and not the other is how a tool
 * that claims to hide secrets ends up printing them.
 */
export function credentialShaped(value) {
  return /postgres(ql)?:\/\/|\bios-iam\b|BEGIN (RSA|OPENSSH) PRIVATE KEY|\bintgk_[A-Za-z0-9]/i.test(String(value ?? ""));
}

/** A value as it may be printed. */
export function showValue(value) {
  return credentialShaped(value) ? "[redacted]" : String(value ?? "");
}

/**
 * What an artifact's own manifest has to say for the artifact to be trustworthy.
 * One implementation, used by the deployment gate and by
 * `scripts/ops-backup-inventory.mjs`, so the two can never disagree about what "a
 * valid backup" means. A field that is merely absent is reported: an absent checksum
 * is not a passing checksum.
 */
export function auditSidecar(meta, { actualBytes = null, expectedDatabase = null } = {}) {
  const bad = [];
  if (!meta.source_database) bad.push("no source_database recorded");
  else if (expectedDatabase && meta.source_database !== expectedDatabase) {
    bad.push(`source_database=${showValue(meta.source_database)} but this host is ${expectedDatabase}`);
  }
  if (meta.schema_complete && meta.schema_complete !== "true") bad.push(`schema_complete=${showValue(meta.schema_complete)}`);
  if (meta.exporter && meta.exporter !== "pg_dump" && !/remote/.test(meta.exporter)) bad.push(`exporter=${showValue(meta.exporter)}`);
  if (meta.create_tables && Number(meta.create_tables) < 1) bad.push(`create_tables=${showValue(meta.create_tables)}`);
  if (meta.bytes && actualBytes !== null && Number(meta.bytes) !== actualBytes) {
    bad.push(`bytes=${showValue(meta.bytes)} but file is ${actualBytes}`);
  }
  if (meta.sha256_artifact && !/^[0-9a-f]{64}$/.test(meta.sha256_artifact)) bad.push("sha256_artifact is malformed");
  if (!meta.sha256_artifact) bad.push("sha256_artifact is not recorded, so the artifact cannot be verified");
  if (!meta.created_utc) bad.push("created_utc is not recorded, so freshness rests on the file mtime alone");
  return bad;
}

/** Where the operator said the backups are, or where the NAS jobs write them. */
export function backupRoots(env) {
  return (env.BACKUP_DIR ? [env.BACKUP_DIR] : DEFAULT_BACKUP_ROOTS).filter(Boolean);
}

/** Find the newest artifact under the configured destination(s). */
export function scanBackups(ctx, roots) {
  const found = [];
  const searched = [];
  for (const root of roots) {
    searched.push(root);
    const entries = ctx.listDir(root);
    if (entries === null) continue;
    for (const name of entries) {
      if (!isArtifact(name)) continue;
      const st = ctx.stat(path.join(root, name));
      if (!st) continue;
      found.push({ file: path.join(root, name), name, bytes: st.size, mtimeMs: st.mtimeMs });
    }
  }
  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return { found, searched, anyRootExists: roots.some((r) => ctx.listDir(r) !== null) };
}

/**
 * Operator-recorded evidence, read-only.
 *
 * Two facts matter to this gate and cannot be observed from this repository:
 * what the deployed HOPE build does with an event it cannot interpret, and
 * whether a restore was actually proven on this box. Rather than guess, the
 * gate reads a record the operator wrote while doing it — the same way
 * `deploy/synology/last-deploy.json` is written before a deploy.
 *
 * It lives OUTSIDE git on purpose: deploy-synology.sh runs
 * `git reset --hard origin/main`, which would erase a tracked evidence file
 * every single deploy. The path is gitignored for that reason.
 */
export const EVIDENCE_FILE = "ops-evidence.json";

export function readEvidence(ctx) {
  const text = ctx.readFile(path.join(ctx.repo, EVIDENCE_FILE));
  if (text === null) return { present: false, data: null };
  try {
    return { present: true, data: JSON.parse(text) };
  } catch (e) {
    return { present: true, error: `unparseable JSON (${String(e.message).split("\n")[0]})`, data: null };
  }
}

const MAX_EVIDENCE_AGE_DAYS = 90;

export function evidenceAgeOk(stamp, now) {
  if (!stamp) return { ok: false, reason: "no timestamp" };
  const t = Date.parse(stamp);
  if (Number.isNaN(t)) return { ok: false, reason: `unreadable timestamp '${String(stamp).slice(0, 20)}'` };
  const days = (now - t) / 86_400_000;
  return { ok: days <= MAX_EVIDENCE_AGE_DAYS, days };
}

// ─── the checks ──────────────────────────────────────────────────────────────

/** A1 + A2 — what is about to be deployed, and is the tree the one git says. */
function checkRepo(ctx) {
  const head = ctx.exec("git", ["rev-parse", "HEAD"]);
  if (head.code !== 0 || head.missing) {
    return [{ id: "repo.commit", status: UNKNOWN, critical: true, detail: "git unavailable — the deployed commit cannot be identified", remediation: "Run the preflight from the repository checkout, not a copy of it." }];
  }
  const sha = firstLine(head.stdout);
  const branch = firstLine(ctx.exec("git", ["branch", "--show-current"]).stdout);
  const remote = ctx.exec("git", ["rev-parse", "origin/main"]);
  const remoteSha = remote.code === 0 ? firstLine(remote.stdout) : null;
  const dirty = ctx.exec("git", ["status", "--porcelain"]);
  const dirtyLines = (dirty.stdout || "").split(/\r?\n/).filter((l) => l.trim());
  const criticalPaths = dirtyLines.filter((l) =>
    /(^|\s)(docker-compose\.yml|deploy-synology\.sh|migrations\/|deploy\/)/.test(l));

  const commit = {
    id: "repo.commit",
    status: remoteSha === null ? UNKNOWN : remoteSha === sha ? PASS : FAIL,
    critical: true,
    detail: `HEAD ${sha.slice(0, 12)} on '${branch || "detached"}'; origin/main ${remoteSha ? remoteSha.slice(0, 12) : "unknown"}`,
    remediation: remoteSha && remoteSha !== sha
      ? "The checkout is not origin/main. deploy-synology.sh will hard-reset it anyway — but then nothing you verified here is what ships. Preflight the tree AFTER the fetch."
      : "git fetch origin main first.",
  };
  const clean = {
    id: "repo.clean_deployment_config",
    status: dirty.code !== 0 ? UNKNOWN : criticalPaths.length ? FAIL : dirtyLines.length ? UNKNOWN : PASS,
    critical: false,
    detail: criticalPaths.length
      ? `${criticalPaths.length} uncommitted change(s) to deployment-critical files: ${criticalPaths.map((l) => l.slice(3).trim().split(/\s+/)[0]).join(", ")}`
      : dirtyLines.length
        ? `${dirtyLines.length} uncommitted file(s) elsewhere in the tree`
        : "working tree matches HEAD",
    remediation: criticalPaths.length ? "Commit or discard these before deploying; they will be destroyed by `git reset --hard origin/main`." : "",
  };
  return [commit, clean];
}

/** A3 — required variables, and A4 — unsafe fallback credentials. */
function checkEnv(ctx, envFile) {
  const env = envFile.values;
  const merged = { ...env, ...ctx.env };
  const missing = REQUIRED_ENV.filter((k) => !(merged[k] ?? "").trim());
  const source = envFile.file === null ? null : path.relative(ctx.repo, envFile.file) || envFile.file;
  const where = envFile.template
    ? `${source} is the committed template, not this box's live .env`
    : `source: ${source}`;
  const required = {
    id: "env.required",
    status: envFile.file === null ? UNKNOWN : missing.length ? FAIL : envFile.template ? UNKNOWN : PASS,
    critical: true,
    detail: envFile.file === null
      ? "no .env or deploy/synology/care.env readable"
      : missing.length
        ? `missing: ${missing.join(", ")}`
        : envFile.template
          ? `${REQUIRED_ENV.length} keys are listed, but ${where}`
          : `${REQUIRED_ENV.length} required variables present (${where})`,
    remediation: missing.length
      ? `Set ${missing.join(", ")} in ${envFile.file || ".env"}. DB_PASSWORD=changeme is not a password.`
      : envFile.template
        ? "Run the preflight on the NAS, or point it at the live file: node scripts/ops-preflight.mjs --env-file /volume1/docker/care/.env"
        : "",
  };

  const { problems } = auditEnvSecrets(merged, { published: PUBLISHED_CREDENTIALS });
  const publishedHits = problems.filter((p) => p.exposed);
  const weakHits = problems.filter((p) => !p.exposed && p.reason && p.reason !== "not set");
  const creds = {
    id: "credentials.safe",
    status: publishedHits.length
      ? FAIL
      : envFile.template
        ? UNKNOWN
        : weakHits.length
          ? FAIL
          : PASS,
    critical: true,
    detail: publishedHits.length
      ? `${publishedHits.length} credential(s) still equal a value published in this repository: ${publishedHits.map((p) => p.name).join(", ")}`
      : envFile.template
        ? `not judged, because ${where}`
        : weakHits.length
          ? `${weakHits.length} guarded credential(s) weak: ${weakHits.map((p) => `${p.name} ${p.reason}`).join("; ")}`
          : "no published or weak guarded credential in scope (values never printed)",
    remediation: publishedHits.length
      ? "Rotate on BOTH hosts before deploying. docs/hope-care-integration/06_CREDENTIAL_ROTATION.md is the procedure; the committed value stays exposed in git history regardless."
      : envFile.template
        ? "Re-run against the live .env — a strength check on example values says nothing about this deployment."
        : "Generate with `openssl rand -base64 32`.",
  };
  return [required, creds, merged];
}

/** A5 — is the database behind this socket the one we mean. */
function expectedDbName(ctx) {
  return (ctx.env.DB_NAME || ctx.env.EXPECTED_DB_NAME || "diagnostic_erp").trim();
}

function checkDatabaseIdentity(ctx) {
  const url = (ctx.env.DATABASE_URL || "").trim();
  const expected = expectedDbName(ctx);
  if (!url) {
    return {
      id: "database.identity",
      status: UNKNOWN,
      critical: true,
      detail: "DATABASE_URL is not set here, so which database would be migrated cannot be established",
      remediation: `DATABASE_URL=... node scripts/ops-preflight.mjs   # or run it on the NAS`,
    };
  }
  const q = (sql) => ctx.exec("psql", [url, "-Atc", sql], { timeout: 20_000 });
  const db = q("select current_database()");
  if (db.code !== 0) {
    return { id: "database.identity", status: UNKNOWN, critical: true, detail: `psql could not connect (${firstLine(db.stderr) || "no message"}). No identity claim is being made.`, remediation: "Reachable from the API container only? Run inside it: docker exec care-api psql \"$DATABASE_URL\" -Atc 'select current_database()'" };
  }
  const name = firstLine(db.stdout);
  const ident = q("select app_name, environment from system_database_identity where id = 1");
  const identLine = ident.code === 0 ? firstLine(ident.stdout) : "";
  return {
    id: "database.identity",
    status: name === expected ? PASS : FAIL,
    critical: true,
    detail: `current_database() = [${name}] but this host expects [${expected}]; system_database_identity ${identLine ? `says ${identLine}` : "absent (pre-patch database)"}`,
    remediation: name === expected ? "" : "Wrong database. This box has run a second stack whose 'db_data' holds patient-shaped data with a different history — migrating or restoring into it is not recoverable.",
  };
}

/** A6 — static migration order + journal/file consistency (runs anywhere). */
function checkMigrationsStatic(ctx) {
  const r = ctx.exec("node", [path.join("scripts", "check-migration-order.cjs"), "--json"], { timeout: 120_000 });
  if (r.code === 0 && r.stdout.trim().startsWith("{")) {
    let parsed = null;
    try { parsed = JSON.parse(r.stdout); } catch { /* fall through */ }
    if (!Array.isArray(parsed?.violations)) {
      return {
        id: "migrations.static",
        status: UNKNOWN,
        critical: true,
        detail: "check-migration-order.cjs answered without a violations list — its output format changed and this gate would be guessing",
        remediation: "node scripts/check-migration-order.cjs",
      };
    }
    const violations = parsed.violations.length;
    return {
      id: "migrations.static",
      status: violations || parsed.ok === false ? FAIL : PASS,
      critical: true,
      detail: violations
        ? `${violations} migration dependency-order violation(s): ${parsed.violations.slice(0, 3).map((v) => v.file ?? v.message ?? v).join("; ")}`
        : "check-migration-order reports no ordering violation: feature migrations line up against the Drizzle core",
      remediation: violations ? "Fix the filename order or add the missing CREATE earlier; db-patch-entrypoint.sh applies alphabetically and stops hard." : "",
    };
  }
  return {
    id: "migrations.static",
    status: r.missing ? UNKNOWN : r.code === 1 ? FAIL : UNKNOWN,
    critical: true,
    detail: r.code === 1 ? `check-migration-order reported violations (${firstLine(r.stdout) || firstLine(r.stderr)})` : `could not run check-migration-order.cjs (${firstLine(r.stderr) || "no output"})`,
    remediation: "node scripts/check-migration-order.cjs",
  };
}

/** A7 — pending feature migrations, against the ledger. */
function checkMigrationsPending(ctx) {
  const url = (ctx.env.DATABASE_URL || "").trim();
  if (!url) return { id: "migrations.pending", status: UNKNOWN, critical: true, detail: "no DATABASE_URL: the migration ledger cannot be read", remediation: "Run on the NAS, or export DATABASE_URL." };
  const files = (() => {
    const entries = ctx.listDir(path.join(ctx.repo, "migrations"));
    return entries ? entries.filter((f) => f.endsWith(".sql")).sort() : null;
  })();
  if (!files) return { id: "migrations.pending", status: UNKNOWN, critical: true, detail: "migrations/ not readable", remediation: "" };
  const ledger = ctx.exec("psql", [url, "-Atc", "select name from schema_migrations_log"], { timeout: 20_000 });
  if (ledger.code !== 0) {
    return { id: "migrations.pending", status: UNKNOWN, critical: true, detail: `schema_migrations_log unreadable (${firstLine(ledger.stderr) || "no message"}) — absence is a finding, not a clean bill`, remediation: "care-db-patch-v2 stamps this table; if it does not exist the DB was migrated by a non-standard path." };
  }
  const applied = new Set(ledger.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
  const pending = files.filter((f) => !applied.has(f));
  return {
    id: "migrations.pending",
    status: pending.length ? UNKNOWN : PASS,
    critical: true,
    detail: pending.length
      ? `${pending.length} of ${files.length} feature migrations not recorded as applied: ${pending.slice(0, 6).join(", ")}${pending.length > 6 ? ", …" : ""}`
      : `all ${files.length} feature migrations present in schema_migrations_log`,
    remediation: pending.length ? "Expected on a pre-deploy run: db-patch-v2 applies them during Step 4. Do not treat UNKNOWN as PASS after the deploy — re-run this then." : "",
  };
}

/** A8 — the #999 duplicate audit, reused rather than re-implemented. */
function checkExternalLinks(ctx) {
  const url = (ctx.env.DATABASE_URL || "").trim();
  if (!url) {
    return { id: "links.external_result_duplicates", status: UNKNOWN, critical: true, detail: "DATABASE_URL not set: scripts/audit-external-result-links.mjs needs one database and never guesses which", remediation: "DATABASE_URL=... node scripts/audit-external-result-links.mjs" };
  }
  const r = ctx.exec("node", [path.join("scripts", "audit-external-result-links.mjs")], { timeout: 180_000 });
  const out = `${r.stdout}${r.stderr}`;
  if (r.code === 2) return { id: "links.external_result_duplicates", status: UNKNOWN, critical: true, detail: "the audit refused to run (exit 2 — no DATABASE_URL in its own environment)", remediation: "export DATABASE_URL then re-run" };
  const dupes = /(\d+)\s+duplicate.*group\(s\) exist/.exec(out);
  if (r.code !== 0 && !dupes) {
    return { id: "links.external_result_duplicates", status: UNKNOWN, critical: true, detail: `audit did not complete (${firstLine(out) || `exit ${r.code}`})`, remediation: "node scripts/audit-external-result-links.mjs" };
  }
  if (dupes) {
    return { id: "links.external_result_duplicates", status: FAIL, critical: true, detail: `${dupes[1]} duplicate (referral_id, care_report_id) group(s). The UNIQUE migration WILL refuse, and one row of a pair may hold a critical acknowledgement a clinician already made.`, remediation: "Reconcile by hand. This tool never picks a winner and never deletes." };
  }
  return { id: "links.external_result_duplicates", status: PASS, critical: true, detail: "the existing audit reports no duplicate link groups" };
}

/**
 * The money self-consistency gate. `scripts/financial-integrity.mjs` owns the SQL and
 * the gate/advisory split; this asks only the gate half of it, because those 16
 * invariants measured zero violations on the live clinic (8,370 bills / 9,207 payments /
 * 11,588 vouchers, 2026-10-15) while the advisory half measures a real backlog that
 * would leave the gate permanently red. `critical: true` means an unrunnable check stops
 * a READY verdict: a money check that could not run is not a money check that passed.
 */
export function checkFinancialIntegrity(ctx) {
  return [FINANCIAL_MONEY, FINANCIAL_CLOSES].map((surface) => {
    const r = runFinancialSurface({ exec: ctx.exec, env: ctx.env, surface, gatesOnly: true });
    return {
      ...r,
      status: r.status === FINANCIAL_UNVERIFIED ? UNKNOWN : r.status,
      // The per-row detail belongs to the tool's own output; the gate line stays a
      // count, and nothing here can carry a patient field.
      results: undefined,
    };
  });
}

/** A9 + A10 + sidecar metadata. */
function checkBackups(ctx) {
  const roots = backupRoots(ctx.env);
  const scan = scanBackups(ctx, roots);
  const maxAgeH = Number(ctx.env.PREFLIGHT_MAX_BACKUP_AGE_HOURS || ctx.env.BACKUP_DEADMAN_MAX_AGE_HOURS || 26);
  // A zero-byte artifact is not a backup. Measured on this NAS 2026-10-15: the
  // dated dumps in /volume1/docker/backups/postgres/care hold 20 empty files out of
  // 62, including six consecutive nights (10-10 to 10-15) — the job ran, the file
  // appeared, the log said success. Counting one of those as the newest artifact
  // turns the whole backup gate green on nothing at all, so the restorable set is
  // what freshness is measured against, and the empties are named.
  const empties = scan.found.filter((f) => f.bytes === 0);
  const restorable = scan.found.filter((f) => f.bytes > 0);

  const present = {
    id: "backup.artifacts_present",
    status: !scan.anyRootExists ? UNKNOWN : restorable.length ? PASS : FAIL,
    critical: true,
    detail: !scan.anyRootExists
      ? `no backup directory readable: ${roots.join(" or ")}`
      : restorable.length
        ? `${scan.found.length} artifact(s), newest restorable ${restorable[0].name} (${(restorable[0].bytes / 1024 / 1024).toFixed(1)} MB)`
          + (empties.length ? ` — ${empties.length} of them are 0 bytes and cannot be restored` : "")
        : scan.found.length
          ? `${scan.found.length} artifact(s) and EVERY one is 0 bytes (newest ${scan.found[0].name}) — the job is producing files, not backups`
          : `the backup directory exists and holds nothing restorable: ${roots.join(", ")}`,
    remediation: !scan.anyRootExists
      ? "Set BACKUP_DIR to where the job writes, or run this on the NAS."
      : restorable.length || !scan.found.length
        ? ""
        : "Find out why the dump writes an empty file (disk full, pg_dump failing after the redirect opened, a `> file` that never completed). Do not delete the empty artifacts until something restorable exists beside them.",
  };

  if (!scan.found.length) {
    return [present,
      { id: "backup.freshness", status: UNKNOWN, critical: true, detail: "no artifact to date", remediation: "" },
      { id: "backup.metadata", status: UNKNOWN, critical: true, detail: "no artifact to read a sidecar for", remediation: "" }];
  }

  if (!restorable.length) {
    return [present,
      { id: "backup.freshness", status: FAIL, critical: true, detail: `no non-empty artifact to date — ${empties.length} file(s) exist and all are 0 bytes`, remediation: "The last real backup is unknown. Re-run the dump and check pg_dump's exit status, not just the file's existence." },
      { id: "backup.metadata", status: UNKNOWN, critical: true, detail: "no restorable artifact to read a sidecar for", remediation: "" }];
  }

  const newest = restorable[0];
  const ageH = (ctx.now() - newest.mtimeMs) / 3.6e6;
  const shadowed = scan.found[0].bytes === 0;
  const fresh = {
    id: "backup.freshness",
    status: ageH <= maxAgeH ? PASS : FAIL,
    critical: true,
    detail: `newest restorable artifact is ${ageH.toFixed(1)}h old (limit ${maxAgeH}h)`
      + (shadowed ? ` — note the MOST RECENT file ${scan.found[0].name} is 0 bytes and was not counted` : ""),
    remediation: ageH <= maxAgeH
      ? shadowed ? "The newest write was empty: check the dump job's exit status before trusting the next copy." : ""
      : "The daily job is not producing anything readable. A directory full of stale files is not a backup policy.",
  };

  const metaPath = `${newest.file}.meta`;
  const metaText = ctx.readFile(metaPath);
  if (metaText === null) {
    return [present, fresh, {
      id: "backup.metadata",
      status: UNKNOWN,
      critical: true,
      detail: `${newest.name} has no .meta sidecar — which database it holds, whether it is schema-complete, and its checksum are unrecorded`,
      remediation: "Sidecars are written by synology-nas-backup.sh since #1004. Take a fresh backup, then verify it restores.",
    }];
  }
  const meta = parseSidecar(metaText);
  const bad = auditSidecar(meta, { actualBytes: newest.bytes, expectedDatabase: expectedDbName(ctx) });

  const metadata = {
    id: "backup.metadata",
    status: bad.length ? FAIL : PASS,
    critical: true,
    // The passing branch prints the values themselves, and `auditSidecar` deliberately
    // accepts any `exporter` containing "remote" — so a hand-edited sidecar can hold a
    // connection string in a field that audits clean. Same predicate as the failures.
    detail: bad.length
      ? `${newest.name}: ${bad.join("; ")}`
      : `${newest.name}: source_database=${showValue(meta.source_database)} exporter=${showValue(meta.exporter)} create_tables=${showValue(meta.create_tables ?? "?")} encrypted=${showValue(meta.encrypted ?? "?")}`,
    remediation: bad.length ? "Do not rely on this artifact. Re-take the backup from the care-db container." : "",
  };
  return [present, fresh, metadata];
}

/**
 * A census line as the backup job writes it. Duplicated from
 * `restoreVerification.ts` on purpose — the verifier is TypeScript inside the API
 * and this gate has to run on a box where the API is not reachable — and pinned to
 * the same shape by a test, because two definitions that drift is how the census
 * stops meaning anything while still printing a PASS.
 */
export const CENSUS_LINE_RE = /^census_before\.([a-z_][a-z0-9_]*)=(\d+)\|(\d+)\|(\d+)\|(\d+)$/;

/**
 * How many tables this artifact's sidecar brackets with a dump-time census.
 *
 * Derived from the file the backup job wrote, never typed by the operator: anyone
 * can write `"censusAttested": true` into the evidence file, which would make the
 * strongest claim in it the easiest one to fake. The sidecar is what the job
 * produced at 03:00 while the clinic was asleep, and this reads it.
 */
export function censusTableCount(ctx, artifact) {
  const name = String(artifact ?? "").trim();
  if (!name) return 0;
  const base = path.basename(name);
  for (const root of backupRoots(ctx.env)) {
    const text = ctx.readFile(path.join(root, `${base}.meta`));
    if (text === null || text === undefined) continue;
    return text.split(/\r?\n/).filter((l) => CENSUS_LINE_RE.test(l.trim())).length;
  }
  return 0;
}

/** A11 — restore evidence. An artifact is not a restore. */
function checkRestoreEvidence(ctx) {
  const url = (ctx.env.DATABASE_URL || "").trim();
  const evidence = readEvidence(ctx);
  const recorded = evidence.data?.restore_verification;

  const fromRecord = (row) => {
    if (!row || !row.artifact) return null;
    const age = evidenceAgeOk(row.verified_at, ctx.now());
    const stale = age.ok ? "" : ` (${age.reason ?? `${age.days.toFixed(0)}d old, limit ${MAX_EVIDENCE_AGE_DAYS}d`})`;
    // Re-read from the artifact every run, rather than believing the flag the
    // recorder wrote. The evidence file is what the operator typed; the sidecar is
    // what the 03:00 job measured, and only the second one can show that the
    // artifact held what the database held. A reader that took the flag on faith
    // would let a hand-edited JSON produce this gate's strongest PASS — and an
    // honest record whose artifact has since aged out of retention still has to go
    // and get itself proved again against a backup that is on the box now.
    const censusHere = censusTableCount(ctx, row.artifact);
    const attested = censusHere > 0;
    const claimed = row.censusAttested === true;
    const unattested = row.passed === true && age.ok && !attested;
    return {
      id: "restore.evidence",
      status: row.passed === true && age.ok && attested ? PASS : row.passed === false ? FAIL : UNKNOWN,
      critical: true,
      detail: `recorded proof: ${row.artifact} restored ${row.verified_at ?? "undated"}${row.tables ? `, ${row.tables} tables` : ""}${row.patients != null ? `, ${row.patients} patients` : ""}${stale}${unattested ? `; no dump-time census in its .meta${claimed ? ", although the evidence file claims one" : ""}` : ""}`,
      remediation: row.passed === false
        ? "The last restore attempt recorded on this box FAILED. Fix the backup before anything else."
        : stale
          ? `Re-run scripts/verify-backup-restore.sh, then record the new proof with --record-restore rather than editing ${EVIDENCE_FILE}.`
          : !attested
            ? `Re-run scripts/verify-backup-restore.sh against a census-bearing artifact and record it with --record-restore; the attestation is read from the artifact's .meta, never typed.`
            : "",
    };
  };

  if (url) {
    // The third field is what turns "a restore happened" into "the artifact was
    // shown to hold what the database had when the dump was taken". Proofs written
    // before the backup job recorded a census say `absent`, and that is UNKNOWN:
    // the restore genuinely worked, and it cannot answer the completeness question.
    const r = ctx.exec("psql", [url, "-Atc", "select status, ran_at, coalesce(detail->>'censusAttested','absent') from radiology_ops_checks where check_name='restore_verification' order by ran_at desc limit 1"], { timeout: 20_000 });
    if (r.code !== 0) {
      return fromRecord(recorded) ?? { id: "restore.evidence", status: UNKNOWN, critical: true, detail: `radiology_ops_checks unreadable (${firstLine(r.stderr) || "no message"})`, remediation: "" };
    }
    const line = firstLine(r.stdout);
    if (line) {
      const [status, ranAt, census] = line.split("|");
      const attested = census === "true";
      return {
        id: "restore.evidence",
        status: status === "pass" ? (attested ? PASS : UNKNOWN) : FAIL,
        critical: true,
        detail: `latest in-app restore_verification = ${status} at ${ranAt}; backup-time census ${attested ? "attested" : census === "absent" ? "not recorded by the version that produced this proof" : `reported as "${census}"`}`,
        remediation: status !== "pass"
          ? "A failed restore proof on the only artifact you have is the finding, not the deploy."
          : attested
            ? ""
            : "Take one backup with the census-bearing scripts/synology-nas-backup.sh, then verify that artifact. A restore proof without the census cannot say what the database held when the dump was taken, so it is not evidence of completeness.",
      };
    }
    // The table answers, and the answer is nothing. An operator-recorded proof
    // from the NAS may still exist, so consult it before reporting UNKNOWN.
    const rec = fromRecord(recorded);
    if (rec) return rec;
    return {
      id: "restore.evidence",
      status: UNKNOWN,
      critical: true,
      detail: "the database has never recorded a restore verification, and no operator record exists",
      remediation: 'bash scripts/verify-backup-restore.sh "$BACKUP_DIR", then write the artifact name and counts into ops-evidence.json',
    };
  }

  const rec = fromRecord(recorded);
  if (rec) return rec;
  return {
    id: "restore.evidence",
    status: UNKNOWN,
    critical: true,
    detail: `neither DATABASE_URL nor a recorded proof exists: no restore has been demonstrated from this directory`,
    remediation: 'On the NAS: bash scripts/verify-backup-restore.sh "$BACKUP_DIR" — then record it in ops-evidence.json.',
  };
}

/** A12 — disk space where backups and uploads land. */
function checkDisk(ctx) {
  const targets = [ctx.env.BACKUP_DIR, ctx.env.OBJECT_STORAGE_DIR, ctx.repo].filter(Boolean);
  for (const t of targets) {
    const st = ctx.statfs(t);
    if (!st) continue;
    const freePct = (Number(st.bavail) / Number(st.blocks)) * 100;
    return {
      id: "disk.space",
      status: freePct >= 10 ? PASS : FAIL,
      critical: true,
      detail: `${freePct.toFixed(1)}% free on ${t}`,
      remediation: freePct >= 10 ? "" : "Under 10%. A backup job that cannot write will fail, and so will every upload; retention deletes still run.",
    };
  }
  return { id: "disk.space", status: UNKNOWN, critical: true, detail: "statfs unavailable for every candidate path on this platform", remediation: "Run on the NAS: df -h /volume1" };
}

/** A13 + A14 — the compose file is valid and holds what the deploy assumes. */
function checkCompose(ctx) {
  const text = ctx.readFile(path.join(ctx.repo, "docker-compose.yml"));
  if (text === null) {
    return [{ id: "compose.valid", status: UNKNOWN, critical: true, detail: "docker-compose.yml not readable", remediation: "" },
      { id: "compose.services_required", status: UNKNOWN, critical: false, detail: "", remediation: "" }];
  }
  const d = ctx.exec("docker", ["compose", "-f", "docker-compose.yml", "config", "-q"], { timeout: 60_000 });
  const valid = {
    id: "compose.valid",
    status: d.missing || d.code === null ? UNKNOWN : d.code === 0 ? PASS : FAIL,
    critical: true,
    detail: d.missing ? "docker is not on this machine — the compose file is read but not validated against the CLI" : d.code === 0 ? "docker compose config accepts the file" : `docker compose config rejected it: ${firstLine(d.stderr)}`,
    remediation: d.missing ? "Run on the NAS: docker compose config -q" : "",
  };
  const missing = REQUIRED_COMPOSE_SERVICES.filter((s) => !new RegExp(`^  ${s}:`, "m").test(text));
  const services = {
    id: "compose.services_required",
    status: missing.length ? FAIL : PASS,
    critical: false,
    detail: missing.length ? `services absent from compose: ${missing.join(", ")}` : `all of ${REQUIRED_COMPOSE_SERVICES.join(", ")} defined`,
    remediation: missing.length ? "deploy-synology.sh waits on care-db-patch-v2 and serves api+web; a missing service is a failed deploy, not a warning." : "",
  };
  return [valid, services];
}

/** A15 — the CARE-side integration contract, and the receiver's version. */
function checkHope(ctx, merged) {
  const armed = isHopeIntegrationArmed(merged);
  const rows = [];
  if (!armed) {
    rows.push({
      id: "hope.integration",
      status: NOT_APPLICABLE,
      critical: false,
      detail: "HOPE integration is not armed on this host (no HOPE_PARTNER_KEY / callback URL) — nothing to check, and no delivery is claimed",
      remediation: "Set HOPE_PARTNER_KEY and INTEGRATION_HOPE_CALLBACK_URL to arm it.",
    });
    rows.push({
      id: "hope.receiver_version",
      status: NOT_APPLICABLE,
      critical: false,
      detail: "no callbacks are configured, so the receiver's build cannot affect this deployment",
      remediation: "",
    });
    return rows;
  }

  const contract = hopeEventContractHolds(ctx);
  const callback = (merged.INTEGRATION_HOPE_CALLBACK_URL || "").trim();
  const problems = [];
  if (!callback) problems.push("INTEGRATION_HOPE_CALLBACK_URL is empty, so signed deliveries have nowhere to go");
  if (!contract.ok) problems.push(...contract.problems);
  rows.push({
    id: "hope.integration",
    status: problems.length ? FAIL : PASS,
    critical: true,
    detail: problems.length
      ? problems.join("; ")
      : `armed; ${contract.emitted.length} event type(s) emitted across ${contract.files} source file(s), all in the registry of ${CARE_EMITTED_EVENTS.length}; callback configured`,
    remediation: contract.ok ? "" : "CARE's emit sites no longer match the registry in ops-preflight — update CARE_EMITTED_EVENTS deliberately, with HOPE's supported list in hand.",
  });

  const receiver = receiverVersionCheck(ctx);
  rows.push(receiver);
  return rows;
}

/**
 * Whether the HOPE instance that will receive these callbacks refuses an event
 * it cannot interpret is a fact about a deployment, not about this repository.
 * DrAbinash/hope#191 merged in code; code merged is not code running. So the
 * gate reports UNKNOWN until an operator records the probe they actually ran —
 * and if they recorded that films were acknowledged, that is a FAIL, because it
 * means CARE's outbox is being told "delivered" about a document nobody keeps.
 */
function receiverVersionCheck(ctx) {
  const evidence = readEvidence(ctx);
  const row = evidence.data?.hope_receiver;
  if (!row) {
    return {
      id: "hope.receiver_version",
      status: UNKNOWN,
      critical: true,
      detail: `not observable from this repository: DrAbinash/hope#191 is merged in code, and whether the deployed build refuses ${HOPE_UNSUPPORTED_EVENTS.join(", ")} has not been recorded`,
      remediation: `Send one synthetic film event at the deployed HOPE and confirm it answers 422 unsupported_event_type, then write {hope_receiver:{unsupported_event_refused:true,checked_at:"…"}} into ${EVIDENCE_FILE}`,
    };
  }
  const age = evidenceAgeOk(row.checked_at, ctx.now());
  if (row.unsupported_event_refused === false) {
    return {
      id: "hope.receiver_version",
      status: FAIL,
      critical: true,
      detail: `recorded: the deployed HOPE still acknowledges ${row.event_type ?? "unsupported events"} instead of refusing them, so CARE records deliveries that were discarded`,
      remediation: "Deploy the build containing hope#191 before any film or report delivery is trusted.",
    };
  }
  return {
    id: "hope.receiver_version",
    status: row.unsupported_event_refused === true && age.ok ? PASS : UNKNOWN,
    critical: true,
    detail: row.unsupported_event_refused === true
      ? `recorded refusal check at ${row.checked_at}${age.ok ? "" : " (stale)"}`
      : `hope_receiver record present but unsupported_event_refused is not stated`,
    remediation: row.unsupported_event_refused === true && !age.ok ? `Re-run the probe within ${MAX_EVIDENCE_AGE_DAYS} days.` : "",
  };
}

/**
 * Compare the registry this file carries against CARE's actual emit sites.
 *
 * The list of files is NOT hardcoded: a gate that only looks where someone
 * remembered to look goes silently true the day a new service starts emitting.
 * So every non-test source under these roots is scanned, which means an emit
 * site added in a brand-new file fails the contract check instead of passing it.
 *
 * The scan is line-based because CARE's real emits include the conditional form
 * `eventType: amendment ? "diagnostic_report.amended" : "diagnostic_report.finalised"`;
 * a `eventType:\s*"…"` regex silently misses both halves of it. Limitation, in
 * exchange for being small: an event type passed through a variable or a
 * template literal is not seen.
 */
export const EMIT_SITE_ROOTS = [
  "artifacts/api-server/src/services",
  "artifacts/api-server/src/routes",
];

const SKIP_DIRS = new Set(["node_modules", ".git", "tmp", "dist", "build", "coverage", "__snapshots__"]);

/**
 * Repo-relative path of every file in the tree, skipping install and build
 * output. One readdir-with-types per directory, so a 30k-entry checkout costs
 * tens of milliseconds rather than a stat call per entry.
 */
function walkTree(ctx, rel = "", acc = [], depth = 0) {
  if (depth > 12) return acc;
  const entries = ctx.readDir(path.join(ctx.repo, rel));
  if (entries === null) return acc;
  for (const e of entries.slice().sort((x, y) => (x.name < y.name ? -1 : 1))) {
    if (SKIP_DIRS.has(e.name)) continue;
    const child = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walkTree(ctx, child, acc, depth + 1);
    else acc.push(child);
  }
  return acc;
}

/** The walk is shared: the event scan and the drift scan want the same tree. */
const TREE_CACHE = new WeakMap();
function treeOf(ctx) {
  if (!TREE_CACHE.has(ctx)) TREE_CACHE.set(ctx, walkTree(ctx));
  return TREE_CACHE.get(ctx);
}

function sourcesUnder(ctx, rel) {
  return treeOf(ctx)
    .filter((p) => p.startsWith(`${rel}/`) && /\.ts$/.test(p) && !/\.(test|spec)\.ts$/.test(p))
    .map((p) => ({ rel: p, text: ctx.readFile(path.join(ctx.repo, p)) ?? "" }));
}

/** Event-type literals that appear where an event is being built. */
export function emittedEventTypes(text) {
  const out = new Set();
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes("eventType")) continue;
    // `eventType === "x"` is a reader deciding what to do, not a writer emitting
    // it. Counting readers would make the registry wrong in the other direction.
    if (/eventType\s*[!=]==/.test(line) && !/eventType\s*:/.test(line)) continue;
    for (const m of line.matchAll(/"(diagnostic_[a-z0-9_.]+)"/g)) out.add(m[1]);
  }
  return out;
}

export function hopeEventContractHolds(ctx) {
  const problems = [];
  const found = new Set();
  const sources = EMIT_SITE_ROOTS.flatMap((rel) => sourcesUnder(ctx, rel));
  if (!sources.length) {
    problems.push(`none of ${EMIT_SITE_ROOTS.join(", ")} could be read — the event contract was not checked`);
  }
  for (const { text } of sources) for (const e of emittedEventTypes(text)) found.add(e);
  const unlisted = [...found].filter((e) => !CARE_EMITTED_EVENTS.includes(e));
  if (unlisted.length) problems.push(`emitted but not in the preflight registry: ${unlisted.join(", ")}`);
  return { ok: problems.length === 0, problems, emitted: [...found], files: sources.length };
}

/** A16 — what a rollback would need, before it is needed. */
function checkRollback(ctx) {
  const evidence = readEvidence(ctx);
  const row = evidence.data?.rollback;
  if (!row) {
    return {
      id: "rollback.prerequisites",
      status: UNKNOWN,
      critical: false,
      detail: `no recorded pre-deploy state: a rollback today would be improvised from whatever the containers still report`,
      remediation: `Before the build step: docker inspect --format '{{.Name}} {{.Image}}' care-api care-web care-db, and record them plus the deployed commit in ${EVIDENCE_FILE}`,
    };
  }
  const missing = ["previous_commit", "api_image", "web_image"].filter((k) => !(row[k] ?? "").toString().trim());
  const irreversible = (row.irreversible_migrations ?? []);
  return {
    id: "rollback.prerequisites",
    status: missing.length ? FAIL : PASS,
    critical: false,
    detail: missing.length
      ? `rollback record incomplete, missing: ${missing.join(", ")}`
      : `previous commit ${String(row.previous_commit).slice(0, 12)} with image IDs recorded; ${irreversible.length} irreversible migration(s) noted`,
    remediation: missing.length ? "Record the running image IDs and commit BEFORE rebuilding — after Step 3 the old images may be pruned." : "",
  };
}

/** A17 — schedulers must run on exactly one always-on process. */
function checkSchedulers(ctx, merged) {
  const compose = ctx.readFile(path.join(ctx.repo, "docker-compose.yml"));
  const value = (merged.ENABLE_SCHEDULERS || "").trim();
  if (compose === null) return { id: "schedulers.consistent", status: UNKNOWN, critical: true, detail: "docker-compose.yml not readable", remediation: "" };
  const forwarded = /ENABLE_SCHEDULERS:\s*\$\{ENABLE_SCHEDULERS:-\}/.test(compose);
  const workerHasIt = /worker:[\s\S]{0,2000}?ENABLE_SCHEDULERS:\s*["']?1/.test(compose);
  if (!forwarded) {
    return { id: "schedulers.consistent", status: FAIL, critical: true, detail: "ENABLE_SCHEDULERS is not forwarded into the api service, so no cron timer registers in production: backups, PACS sync and billing jobs all stay dormant", remediation: "Restore the compose line ENABLE_SCHEDULERS: ${ENABLE_SCHEDULERS:-}" };
  }
  if (value !== "1") {
    return { id: "schedulers.consistent", status: UNKNOWN, critical: true, detail: `ENABLE_SCHEDULERS='${value || "unset"}' — nothing is scheduled. If the clinic's backups come from the in-app scheduler, this is why there are none.`, remediation: "Set ENABLE_SCHEDULERS=1 on exactly one always-on instance." };
  }
  return { id: "schedulers.consistent", status: workerHasIt ? FAIL : PASS, critical: true, detail: workerHasIt ? "ENABLE_SCHEDULERS is on in api AND the worker — every cron double-fires" : "enabled on the api service only (compose shows one holder)", remediation: workerHasIt ? "Take it off one of them." : "" };
}

/**
 * §7 — deployment-configuration drift.
 *
 * The recovery binder carried a second copy of three deployment files. Each was
 * written when the live one was shorter, and none was updated: the binder's
 * deploy-synology.sh was 51 lines against 292 live, its docker-compose.yml 281
 * against 649, its Dockerfile 87 against 223. The binder's index called all
 * three "Active". An operator who followed it would have run a deploy that never
 * fetches main, never stamps a version, never checks secrets and never verifies
 * health — and been told "Deployment completed successfully!".
 *
 * A copy is therefore allowed only when it is byte-identical to the live file
 * (a mirror someone is keeping) or when it declares itself retired. Anything
 * else fails the gate, because a runnable second path to production is a defect
 * whether or not anyone means to use it.
 */
export const RETIRED_MARK = /RETIRED|DO NOT RUN/i;
export const DRIFT_WATCH = ["deploy-synology.sh", "docker-compose.yml", "Dockerfile"];
/** Not copies of the live file — different programs that share the name. */
export const DRIFT_EXEMPT = [
  /^deploy\/windows-emergency\//, // the DS225+ emergency overlay, by design a smaller stack
  /^dicom-to-windows-export\//, // vendored electronic-film helper
];

export function configCopies(ctx, name) {
  return treeOf(ctx)
    .filter((p) => p.split("/").pop() === name)
    .filter((p) => !DRIFT_EXEMPT.some((re) => re.test(p)))
    .map((rel) => ({ rel, text: ctx.readFile(path.join(ctx.repo, rel)) ?? "" }));
}

export function checkConfigDrift(ctx) {
  const drifted = [];
  const mirrored = [];
  let watched = 0;
  for (const name of DRIFT_WATCH) {
    const copies = configCopies(ctx, name);
    if (!copies.length) continue;
    watched += 1;
    const live = copies.find((c) => c.rel === name);
    const others = copies.filter((c) => c.rel !== name);
    if (!live) {
      drifted.push(`${name}: ${others.length} copy(ies) but no live file at the repository root (${others.map((c) => c.rel).join(", ")})`);
      continue;
    }
    for (const c of others) {
      if (c.text === live.text) mirrored.push(c.rel);
      else if (RETIRED_MARK.test(c.text)) mirrored.push(`${c.rel} (retired)`);
      else drifted.push(`${c.rel} is neither identical to ${name} nor marked retired (${c.text.split(/\r?\n/).length} lines vs ${live.text.split(/\r?\n/).length})`);
    }
  }
  if (!watched) {
    return {
      id: "deploy.config_single_source",
      status: UNKNOWN,
      critical: false,
      detail: "none of the deployment files this check watches were found — the drift scan had nothing to compare",
      remediation: `Run from the deployment checkout: node ${path.join("scripts", "ops-preflight.mjs")}`,
    };
  }
  return {
    id: "deploy.config_single_source",
    status: drifted.length ? FAIL : PASS,
    critical: false,
    detail: drifted.length
      ? `${drifted.length} drifted duplicate(s): ${drifted.join("; ")}`
      : `single live ${DRIFT_WATCH.slice(0, watched).join(", ")} — ${mirrored.length} binder copy(ies) identical or explicitly retired`,
    remediation: drifted.length
      ? "Copy the live file in byte-for-byte, or replace the duplicate with a stub that says RETIRED and names the live path. Never leave a runnable second deploy path."
      : "",
  };
}

/** A18 — deployment metadata the running container will actually carry. */
function checkDeployMetadata(ctx, envFile) {
  const keys = ["GIT_COMMIT", "GIT_BRANCH", "BUILD_DATE", "ERP_VERSION", "BUILD_NUMBER"];
  const fileVals = envFile.values || {};
  const merged = { ...fileVals, ...ctx.env };
  const missing = keys.filter((k) => !(merged[k] ?? "").trim());
  return {
    id: "deploy.metadata",
    status: missing.length ? (envFile.template ? UNKNOWN : FAIL) : PASS,
    critical: false,
    detail: missing.length
      ? `${envFile.template ? "cannot be judged from the committed template; " : ""}no build identity for: ${missing.join(", ")} — /health will report unknown and a rollback cannot be attributed`
      : `build identity present: commit ${String(merged.GIT_COMMIT).slice(0, 12)} v${merged.ERP_VERSION} build ${merged.BUILD_NUMBER}`,
    remediation: missing.length ? "deploy-synology.sh Step 2 writes these into .env; running the preflight before Step 2 legitimately reports this, so re-run after it." : "",
  };
}

// ─── orchestration ───────────────────────────────────────────────────────────

export function runPreflight(options = {}) {
  const ctx = options.ctx ?? makeContext(options);
  const envFile = resolveEnvFile(ctx, options.envFile);
  const checks = [];
  const push = (...rs) => checks.push(...rs);

  push(...checkRepo(ctx));
  const [required, creds, mergedEnv] = checkEnv(ctx, envFile);
  push(required, creds);
  push(checkDatabaseIdentity(ctx));
  push(checkMigrationsStatic(ctx));
  push(checkMigrationsPending(ctx));
  push(checkExternalLinks(ctx));
  push(...checkFinancialIntegrity(ctx));
  push(...checkBackups(ctx));
  push(checkRestoreEvidence(ctx));
  push(checkDisk(ctx));
  push(...checkCompose(ctx));
  push(...checkHope(ctx, mergedEnv));
  push(checkRollback(ctx));
  push(checkSchedulers(ctx, mergedEnv));
  push(checkDeployMetadata(ctx, envFile));
  push(checkConfigDrift(ctx));

  // Owner decision, recorded so nobody re-litigates it or mistakes it for a pass.
  checks.push({
    id: "backup.orthanc_images",
    status: NOT_APPLICABLE,
    critical: false,
    detail: "DICOM image backup is excluded from ERP disaster recovery by explicit owner decision (I12 §2). This is NOT a pass and must not be read as one.",
    remediation: "",
  });

  const fails = checks.filter((c) => c.status === FAIL);
  const criticalUnknowns = checks.filter((c) => c.status === UNKNOWN && c.critical);
  const verdict = fails.length ? NOT_READY : criticalUnknowns.length ? INSUFFICIENT_EVIDENCE : READY;

  return {
    verdict,
    generatedAt: new Date(ctx.now()).toISOString(),
    envFile: envFile.file ? path.relative(ctx.repo, envFile.file) || envFile.file : null,
    envIsTemplate: !!envFile.template,
    counts: {
      PASS: checks.filter((c) => c.status === PASS).length,
      FAIL: fails.length,
      UNKNOWN: checks.filter((c) => c.status === UNKNOWN).length,
      NOT_APPLICABLE: checks.filter((c) => c.status === NOT_APPLICABLE).length,
    },
    blocking: fails.map((c) => `${c.id}: ${c.detail}`),
    insufficientEvidence: criticalUnknowns.map((c) => `${c.id}: ${c.detail}`),
    checks,
  };
}

export function renderText(report) {
  const lines = [];
  lines.push(`CARE ops preflight — ${report.generatedAt}`);
  if (report.envFile) lines.push(`env source: ${report.envFile}${report.envIsTemplate ? " (committed template — the live .env was not found; checks that read values report UNKNOWN)" : ""}`);
  lines.push("");
  let last = "";
  for (const c of report.checks) {
    const area = c.id.split(".")[0];
    if (area !== last) { lines.push(`${area}:`); last = area; }
    lines.push(`  ${c.status.padEnd(15)} ${c.id.padEnd(34)} ${c.detail}`);
    if (c.remediation && c.status !== PASS) lines.push(`  ${" ".repeat(17)}↳ ${c.remediation}`);
  }
  lines.push("");
  lines.push(`counts: ${report.counts.PASS} PASS, ${report.counts.FAIL} FAIL, ${report.counts.UNKNOWN} UNKNOWN, ${report.counts.NOT_APPLICABLE} NOT_APPLICABLE`);
  if (report.verdict === READY) lines.push(`VERDICT: ${READY} — no FAIL, no critical UNKNOWN.`);
  if (report.verdict === NOT_READY) {
    lines.push(`VERDICT: ${NOT_READY} — ${report.blocking.length} failing check(s):`);
    for (const b of report.blocking) lines.push(`   · ${b}`);
  }
  if (report.verdict === INSUFFICIENT_EVIDENCE) {
    lines.push(`VERDICT: ${INSUFFICIENT_EVIDENCE} — nothing failed, but ${report.insufficientEvidence.length} critical check(s) could not be run:`);
    for (const u of report.insufficientEvidence) lines.push(`   · ${u}`);
    lines.push("   UNKNOWN is not a pass. Do not deploy on this verdict without reading each line.");
  }
  return lines.join("\n");
}

/**
 * The evidence file is the operator's, not the gate's — but asking a clinician
 * to hand-write JSON is how evidence ends up wrong. `--record-*` writes one
 * section, leaves the others alone, and never invents a value: every field comes
 * from the flag, and a missing flag is left out rather than guessed.
 */
export function recordEvidence(ctx, section, values, writeFile) {
  const file = path.join(ctx.repo, EVIDENCE_FILE);
  const existing = readEvidence(ctx);
  const data = existing.data ?? {};
  data[section] = { ...(data[section] ?? {}), ...values };
  writeFile(file, JSON.stringify(data, null, 2) + "\n");
  return { file, data };
}

function flag(argv, name) {
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split("=").slice(1).join("=");
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined;
}

const USAGE = `CARE ops preflight — read-only deployment gate (I12-A)

  pnpm ops:preflight                        text report + verdict
  pnpm ops:preflight --json                 the same answers, machine-readable
  pnpm ops:preflight --env-file .env        which environment to read
  PREFLIGHT_MAX_BACKUP_AGE_HOURS=26 ...     freshness limit the operator owns

WHAT IT WILL NOT DO
  It never writes to the database, never applies a migration, never runs a
  restore, never touches a container, never prints a credential or a patient
  field. Unknown is reported as unknown.

VERDICTS                                  exit code
  READY                       0  every critical check passed
  NOT_READY                   1  something is wrong — fix it first
  INSUFFICIENT_EVIDENCE       2  a critical check could not be run here

RECORDING EVIDENCE THE GATE CANNOT OBSERVE
  Three facts live outside this repository. Record them when you have actually
  established them; the gate reads ops-evidence.json (gitignored on purpose —
  deploy-synology.sh's \`git reset --hard\` would delete a tracked copy) and
  treats anything older than ${MAX_EVIDENCE_AGE_DAYS} days as unknown again.

    node scripts/ops-preflight.mjs --record-restore \\
        --artifact caredeoghar_20261014_030000.sql.gz --tables 439 --patients 8123
        # only after scripts/verify-backup-restore.sh exited 0 on that artifact

    node scripts/ops-preflight.mjs --record-hope-probe --refused
        # after a synthetic film event at the deployed HOPE answered 422
        # (--refused when it did; --not-refused records the failure, which is a FAIL)

    node scripts/ops-preflight.mjs --record-rollback \\
        --previous-commit <sha> --api-image <id> --web-image <id>
        # BEFORE deploy-synology.sh rebuilds; afterwards the ids are gone
`;

export function main(argv = process.argv.slice(2), options = {}) {
  const ctx = options.ctx ?? makeContext(options);
  const writeFile = options.writeFile ?? ((f, text) => writeFileSync(f, text, "utf8"));

  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE + "\n");
    return 0;
  }

  for (const [flagName, section] of [["--record-restore", "restore_verification"], ["--record-hope-probe", "hope_receiver"], ["--record-rollback", "rollback"]]) {
    if (!argv.includes(flagName)) continue;
    const values = {};
    if (section === "restore_verification") {
      const artifact = (flag(argv, "artifact") ?? "").trim();
      if (!artifact) {
        process.stderr.write("--record-restore needs --artifact <name>: a restore proof without an artifact names nothing that was proved. Nothing was written.\n");
        return 1;
      }
      values.artifact = artifact;
      values.verified_at = new Date(ctx.now()).toISOString();
      values.passed = true;
      // Derived from the sidecar, never accepted as an argument. What decides PASS
      // versus UNKNOWN is the artifact's own `.meta`, re-read by `restore.evidence`
      // every run; this field is what the file said at record time. A recorder that
      // let `--census` through would let an operator type the strongest claim in the
      // file instead of producing the backup that earns it.
      const censusTables = censusTableCount(ctx, artifact);
      values.censusAttested = censusTables > 0;
      if (censusTables === 0) {
        process.stdout.write(
          `NOTE: ${artifact} has no backup-time census in its .meta, so this proof is recorded as unattested and ` +
          `restore.evidence will answer UNKNOWN rather than PASS. Take one backup with the current ` +
          `scripts/synology-nas-backup.sh, verify that artifact, and record it.\n`,
        );
      }
      for (const k of ["tables", "patients"]) {
        const v = flag(argv, k);
        if (v === undefined) continue;
        // A count that is not a whole number used to be stored as `null` with exit 0,
        // so the evidence file looked complete and the reader could not tell that the
        // number was never measured. Refuse the argument instead: an operator who is
        // told "Nothing was written" will retype it, and one who is told nothing will
        // go on trusting a proof that recorded nothing.
        if (!/^\d+$/.test(v.trim())) {
          process.stderr.write(`--record-restore --${k} needs a whole number and was given ${JSON.stringify(v)}. Nothing was written.\n`);
          return 1;
        }
        values[k] = Number(v.trim());
      }
    } else if (section === "hope_receiver") {
      if (argv.includes("--not-refused")) values.unsupported_event_refused = false;
      else if (argv.includes("--refused")) values.unsupported_event_refused = true;
      else {
        process.stderr.write("--record-hope-probe needs --refused or --not-refused: the whole point is which way the probe went. Nothing was written.\n");
        return 1;
      }
      // Only what the operator actually said. Defaulting the event type here would
      // overwrite the type an earlier probe recorded, and the evidence file is the
      // operator's statement about the past, not this program's guess.
      const et = flag(argv, "event-type");
      if (et !== undefined) values.event_type = et;
      values.checked_at = new Date(ctx.now()).toISOString();
    } else {
      for (const [k, f] of [["previous_commit", "previous-commit"], ["api_image", "api-image"], ["web_image", "web-image"]]) {
        const v = flag(argv, f);
        if (v !== undefined) values[k] = v;
      }
      const ir = flag(argv, "irreversible-migrations");
      if (ir !== undefined) values.irreversible_migrations = ir ? ir.split(",").map((x) => x.trim()).filter(Boolean) : [];
    }
    const { file, data } = recordEvidence(ctx, section, values, writeFile);
    process.stdout.write(`Recorded ${section} in ${path.relative(ctx.repo, file) || file}
`);
    process.stdout.write(`${JSON.stringify(data[section], null, 2)}

`);
    if (argv.includes("--no-rerun")) return 0;
    const after = runPreflight({ ...options, ctx, envFile: flag(argv, "env-file") });
    process.stdout.write(renderText(after) + "\n");
    return after.verdict === READY ? 0 : after.verdict === NOT_READY ? 1 : 2;
  }

  const report = options.report ?? runPreflight({ ...options, ctx, envFile: flag(argv, "env-file") });
  if (argv.includes("--json")) process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  else process.stdout.write(renderText(report) + "\n");
  return report.verdict === READY ? 0 : report.verdict === NOT_READY ? 1 : 2;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) process.exit(main());
