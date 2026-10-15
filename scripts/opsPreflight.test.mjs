// ============================================================================
// I12-A — the ops preflight gate, tested as a decision-maker, not a printer.
//
// Every scenario here is one synthetic production state: a box whose backup is
// thirty hours old, whose DATABASE_URL points at the wrong clinic's schema,
// whose compose file lost the ENABLE_SCHEDULERS line, whose .env still carries a
// placeholder password, whose HOPE instance still acknowledges films it cannot
// store. The claim under test is not "the script produced output" but "the
// script reached the correct verdict, and refused to treat missing evidence as a
// pass".
//
// The fixture is a real directory of real files, because the gate's own job is
// to read and parse them; only the external commands it shells out to (git,
// psql, docker, and the node scripts it reuses rather than re-implements) are
// answered by a router. Nothing here touches a real database, a real NAS or a
// real patient row.
// ============================================================================
import {
  mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync, existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  CARE_EMITTED_EVENTS,
  EVIDENCE_FILE,
  FAIL,
  HOPE_UNSUPPORTED_EVENTS,
  INSUFFICIENT_EVIDENCE,
  NOT_APPLICABLE,
  NOT_READY,
  PASS,
  READY,
  REQUIRED_CHECK_IDS,
  REQUIRED_ENV,
  UNKNOWN,
  DRIFT_EXEMPT,
  checkConfigDrift,
  configCopies,
  censusTableCount,
  CENSUS_LINE_RE,
  makeContext,
  auditSidecar,
  credentialShaped,
  hopeEventContractHolds,
  main,
  renderText,
  runPreflight,
} from "./ops-preflight.mjs";

const GOOD_SECRET = "synthetic-strong-value-never-a-real-one-32ch";
const SENTINEL = "SENTINEL-SECRET-DO-NOT-PRINT-9b2c1d";
const NOW = Date.UTC(2026, 9, 15, 12, 0, 0);
// seedTree stamps the artifact this many hours before NOW unless a case asks for a
// different age. See the note in seedTree for why the stamp is never the wall clock.
const DEFAULT_ARTIFACT_AGE_HOURS = 6;
const HEAD_SHA = "a".repeat(40);
const DATABASE_URL = "postgresql://erp@127.0.0.1:59999/diagnostic_erp";

const ENV_TEMPLATE = {
  DB_USER: "erp",
  DB_PASSWORD: GOOD_SECRET,
  DB_NAME: "diagnostic_erp",
  JWT_SECRET: GOOD_SECRET,
  SESSION_SECRET: GOOD_SECRET,
  CRON_SECRET: GOOD_SECRET,
  INTERNAL_API_KEY: GOOD_SECRET,
  ENABLE_SCHEDULERS: "1",
  OBJECT_STORAGE_DIR: "/app/data/object-storage",
  PUBLIC_BASE_URL: "https://care.example",
  INTEGRATION_HOPE_CALLBACK_URL: "http://hope.example:7080/api/integration/care-callback",
  INTEGRATION_HOPE_SIGNING_SECRET: GOOD_SECRET,
  HOPE_PARTNER_KEY: GOOD_SECRET,
  HOPE_CARE_INTEGRATION_FORCE: "1",
  GIT_COMMIT: HEAD_SHA,
  GIT_BRANCH: "main",
  BUILD_DATE: "2026-10-15T03:00:00Z",
  ERP_VERSION: "2.0.0",
  BUILD_NUMBER: "41",
};

const COMPOSE = [
  "services:",
  "  db:",
  "    image: postgres:16",
  "  db-patch-v2:",
  "    build: .",
  "  schema-verify:",
  "    build: .",
  "  api:",
  "    environment:",
  "      ENABLE_SCHEDULERS: ${ENABLE_SCHEDULERS:-}",
  "      CRON_SECRET: ${CRON_SECRET:-}",
  "  web:",
  "    image: node:22",
  "",
].join("\n");

/** The live deploy program, as the drift scan sees it. */
const LIVE_DEPLOY_SH = "#!/bin/bash\n# live deploy program\ngit fetch origin main\n";
const LIVE_DOCKERFILE = "FROM node:22-bookworm-slim AS base\n";

/** The real emit sites, so the registry check is testing something true. */
const EMIT_SITES = {
  "artifacts/api-server/src/services/integration/emitReportToHope.ts":
    // CARE's actual form is a conditional — a scanner that only reads
    // `eventType: "literal"` misses both halves of it.
    'eventType: amendment ? "diagnostic_report.amended" : "diagnostic_report.finalised",\n',
  "artifacts/api-server/src/services/integration/outbox.ts":
    'if (row.eventType === "diagnostic_electronic_film.available") {\n',
  "artifacts/api-server/src/services/integration/criticalEscalation.ts":
    'eventType: "diagnostic_result.escalated",\neventType: "diagnostic_result.critical",\neventType: "diagnostic_order.created",\n',
  "artifacts/api-server/src/services/electronicFilm/hopeEmitter.ts":
    'eventType: "diagnostic_electronic_film.available",\n',
  "artifacts/api-server/src/services/integration/referralIngest.ts":
    'eventType: "diagnostic_referral.received",\neventType: "diagnostic_referral.cancelled",\n'
    + 'eventType: "diagnostic_sample.collected",\neventType: "diagnostic_study.completed",\n'
    + 'eventType: "diagnostic_order.item_status_changed",\neventType: "diagnostic_order.created",\n',
};

/** What an operator who has actually done the work records. Dates are relative
 *  to the frozen NOW so freshness is exercised, not assumed. */
const HEALTHY_EVIDENCE = {
  restore_verification: {
    artifact: "caredeoghar_20261014_030000.sql.gz",
    verified_at: new Date(NOW - 6 * 3_600_000).toISOString(),
    passed: true,
    // The gate only calls a restore proof complete when the artifact's sidecar
    // bracketed it at dump time. The control box is one where that is true; the
    // cases where it is not are below, and they answer UNKNOWN.
    censusAttested: true,
    tables: 439,
    patients: 8123,
  },
  hope_receiver: {
    unsupported_event_refused: true,
    event_type: "diagnostic_electronic_film.available",
    checked_at: new Date(NOW - 20 * 86_400_000).toISOString(),
  },
  rollback: {
    previous_commit: HEAD_SHA,
    api_image: "sha256:aaaa",
    web_image: "sha256:bbbb",
    irreversible_migrations: [],
  },
};

/**
 * The census block `scripts/synology-nas-backup.sh` takes around its own dump and
 * writes into the `.meta` sidecar: one line per core table, per edge.
 *
 * The healthy fixture has to carry these lines because `restore.evidence` derives
 * its attestation from them and from nothing else — anyone can type
 * `"censusAttested": true` into the evidence file, so the gate reads the file the
 * 03:00 job produced instead. A fixture without them is a fixture for a box whose
 * backup job predates the census, and the control has to reach PASS.
 *
 * The table list is read out of the backup job rather than copied, so the fixture
 * cannot quietly census a table the job no longer does. The four numbers are
 * computed, not remembered: the ids are taken to run 1..n, so min=1, max=n,
 * sum=n(n+1)/2, and the after-edge is three rows longer because the clinic keeps
 * writing while a dump runs.
 */
const BACKUP_SH = readFileSync(new URL("./synology-nas-backup.sh", import.meta.url), "utf8");
const CENSUS_TABLES = (BACKUP_SH.match(/^CENSUS_TABLES_DEFAULT="([^"]+)"/m) ?? [])[1]?.trim().split(/\s+/) ?? [];

const censusEdge = (n) => `${n}|1|${n}|${(n * (n + 1)) / 2}`;

function censusSidecarLines(baseRows = 40) {
  const lines = [];
  CENSUS_TABLES.forEach((t, i) => {
    lines.push(`census_before.${t}=${censusEdge(baseRows + i)}`);
    lines.push(`census_after.${t}=${censusEdge(baseRows + i + 3)}`);
  });
  lines.push(`census_tables=${CENSUS_TABLES.join(" ")}`);
  return lines;
}

const SIDECAR_LINES = [
  "artifact=caredeoghar_20261014_030000.sql.gz",
  "created_utc=2026-10-14T03:00:00Z",
  "source_container=care-db",
  "source_database=diagnostic_erp",
  "server_version=PostgreSQL 16.14",
  "exporter=pg_dump",
  "schema_complete=true",
  "create_tables=439",
  "encrypted=no",
  `sha256_artifact=${"0".repeat(64)}`,
  ...censusSidecarLines(),
];

let root;
let backupDir;
let artifactPath;

function write(rel, text) {
  const full = path.join(root, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, text, "utf8");
  return full;
}

/**
 * Lay down a healthy tree. `knobs` is the whole test surface:
 *   env          — .env contents (undefined deletes a key)
 *   compose      — replacement docker-compose.yml text
 *   emitSites    — replacement emit-site map (used by T10)
 *   ageHours     — mtime of the newest backup artifact, hours before NOW
 *   withSidecar  — false to remove the .meta the backup job writes
 *   sidecarLines — replacement `.meta` lines (the job's `bytes=` line is still appended)
 *   evidence     — replacement ops-evidence.json object (null to remove it)
 *   ledger       — filenames the migration ledger claims are applied
 */
function seedTree(knobs = {}) {
  const env = { ...ENV_TEMPLATE, ...(knobs.env ?? {}) };
  if (knobs.env) for (const [k, v] of Object.entries(knobs.env)) if (v === undefined) delete env[k];
  write(".env", Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
  write("docker-compose.yml", knobs.compose ?? COMPOSE);
  write("deploy-synology.sh", knobs.deployScript ?? LIVE_DEPLOY_SH);
  write("Dockerfile", knobs.dockerfile ?? LIVE_DOCKERFILE);
  if (knobs.copies) for (const [rel, text] of Object.entries(knobs.copies)) write(rel, text);
  write("version.json", JSON.stringify({ version: "2.0.0", buildNumber: 41 }));
  write("migrations/20260101_a.sql", "CREATE TABLE public.thing (id int);\n");
  write("migrations/20260102_b.sql", "CREATE INDEX thing_id ON public.thing (id);\n");
  for (const [f, body] of Object.entries(knobs.emitSites ?? EMIT_SITES)) write(f, body);

  artifactPath = path.join(backupDir, "caredeoghar_20261014_030000.sql.gz");
  writeFileSync(artifactPath, Buffer.from("synthetic gzip bytes"));
  if (knobs.withSidecar === false) {
    rmSync(`${artifactPath}.meta`, { force: true });
  } else {
    writeFileSync(`${artifactPath}.meta`, [...(knobs.sidecarLines ?? SIDECAR_LINES), `bytes=${readFileSync(artifactPath).length}`, ""].join("\n"));
  }
  // The mtime is pinned to the frozen NOW rather than left at the wall clock, and
  // always pinned — not only when a test asks for an age. `makeCtx().now()` is a
  // fixed instant, so an artifact stamped "when the test ran" ages backwards once
  // the real clock passes that instant, and any case that orders two artifacts by
  // mtime flips on its own. T6c did exactly that: green in CI before 11:00 UTC on
  // 2026-10-15, red after it, with no code change between the two runs.
  const when = new Date(NOW - (knobs.ageHours ?? DEFAULT_ARTIFACT_AGE_HOURS) * 3_600_000);
  utimesSync(artifactPath, when, when);
  const evidence = knobs.evidence === undefined ? HEALTHY_EVIDENCE : knobs.evidence;
  if (evidence === null) rmSync(path.join(root, EVIDENCE_FILE), { force: true });
  else write(EVIDENCE_FILE, JSON.stringify(evidence, null, 2));
  if (knobs.templateOnly) {
    // The laptop case: no live .env, only the committed deploy template. The
    // five build-identity keys are genuinely absent there — deploy-synology.sh
    // Step 2 writes them into the live .env — so the template mirrors that.
    rmSync(path.join(root, ".env"), { force: true });
    const { GIT_COMMIT, GIT_BRANCH, BUILD_DATE, ERP_VERSION, BUILD_NUMBER, ...templateEnv } = env;
    write(path.join("deploy", "synology", "care.env"),
      Object.entries({ ...templateEnv, HOPE_PARTNER_KEY: "", INTEGRATION_HOPE_SIGNING_SECRET: "" })
        .map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
  }
}

/** Canned answers for the external commands the gate calls. */
function router(over = {}) {
  const table = {
    "git rev-parse HEAD": { stdout: `${HEAD_SHA}\n` },
    "git rev-parse origin/main": { stdout: `${HEAD_SHA}\n` },
    "git branch --show-current": { stdout: "main\n" },
    "git status --porcelain": { stdout: "" },
    "check-migration-order.cjs": { stdout: '{"violations":[],"checkedFiles":2}\n' },
    "audit-external-result-links.mjs": { stdout: "No duplicates found: the constraint can be added without touching a single existing row.\n" },
    "docker compose": { stdout: "" },
    current_database: { stdout: "diagnostic_erp\n" },
    system_database_identity: { stdout: "care-erp|production\n" },
    schema_migrations_log: { stdout: "20260101_a.sql\n20260102_b.sql\n" },
    restore_verification: { stdout: "" },
    // The money gate: every statement carries `financial-integrity:<id>` in a comment,
    // and the healthy box answers each with a marked zero row.
    "financial-integrity:": { stdout: "FI|0|\n" },
    ...over,
  };
  return (cmd, args) => {
    const joined = [cmd, ...(args ?? [])].join(" ");
    for (const [needle, value] of Object.entries(table)) {
      if (value !== null && joined.includes(needle)) {
        return { code: value.code ?? 0, stdout: value.stdout ?? "", stderr: value.stderr ?? "", missing: !!value.missing };
      }
    }
    return { code: 0, stdout: "", stderr: "", missing: false };
  };
}

function makeCtx(extra = {}) {
  return makeContext({
    repo: root,
    env: { BACKUP_DIR: backupDir, DATABASE_URL, ...(extra.env ?? {}) },
    exec: extra.exec ?? router(),
    statfs: extra.statfs ?? (() => ({ blocks: 1000, bavail: 400 })),
    now: () => NOW,
  });
}

function build(knobs = {}, cmdOverrides = {}, ctxExtra = {}) {
  seedTree(knobs);
  const report = runPreflight({ ctx: makeCtx({ exec: router(cmdOverrides), ...ctxExtra }) });
  return { report, by: Object.fromEntries(report.checks.map((c) => [c.id, c])) };
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "i12-pre-"));
  backupDir = path.join(root, "backups");
  mkdirSync(backupDir, { recursive: true });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("the control: a box with real evidence reaches READY", () => {
  test("every check is PASS or explicitly NOT_APPLICABLE", () => {
    const { report } = build();
    const problems = report.checks
      .filter((c) => c.status !== PASS && c.status !== NOT_APPLICABLE)
      .map((c) => `${c.id}=${c.status} ${c.detail}`);
    expect(problems).toEqual([]);
    expect(report.verdict).toBe(READY);
  });

  test("no check is unreachable decoration", () => {
    // The quiet way a gate becomes theatre is a check that can only ever answer
    // UNKNOWN. The control must be able to reach every one of them.
    const { report } = build();
    for (const id of REQUIRED_CHECK_IDS) {
      const c = report.checks.find((x) => x.id === id);
      expect(c, `${id} must exist`).toBeTruthy();
      expect(c.status, `${id} must be reachable`).toBeOneOf([PASS, NOT_APPLICABLE]);
    }
  });
});

describe("T1–T4 — deployment configuration", () => {
  test("T1 a missing required variable is FAIL and NOT_READY", () => {
    const { by, report } = build({ env: { CRON_SECRET: undefined } });
    expect(REQUIRED_ENV).toContain("CRON_SECRET");
    expect(by["env.required"].status).toBe(FAIL);
    expect(by["env.required"].detail).toContain("CRON_SECRET");
    expect(report.verdict).toBe(NOT_READY);
  });

  test("T2 a placeholder credential is FAIL, and its value is never printed", () => {
    const { by, report } = build({ env: { INTERNAL_API_KEY: "changeme" } });
    expect(by["credentials.safe"].status).toBe(FAIL);
    expect(by["credentials.safe"].detail).toMatch(/placeholder/);
    expect(by["credentials.safe"].detail).not.toContain("changeme");
    expect(report.verdict).toBe(NOT_READY);
  });

  test("T3 a database that answers with the wrong name is FAIL", () => {
    // The staging trap: `db_data` is patient-shaped with a different history.
    const { by, report } = build({}, { current_database: { stdout: "db_data\n" } });
    expect(by["database.identity"].status).toBe(FAIL);
    expect(by["database.identity"].detail).toMatch(/db_data/);
    expect(report.verdict).toBe(NOT_READY);
  });

  test("T3b a database that cannot be reached is UNKNOWN, never a clean bill", () => {
    const { by, report } = build({}, {}, { env: { DATABASE_URL: "" } });
    expect(by["database.identity"].status).toBe(UNKNOWN);
    expect(report.verdict).toBe(INSUFFICIENT_EVIDENCE);
  });

  test("T3c the committed template is not the live .env, so value checks say UNKNOWN", () => {
    // deploy/synology/care.env lists every key with example values. A gate that
    // read it would print "9 required variables present" on a box that has none,
    // and that is the exact false green this check exists to prevent.
    const { by, report } = build({ templateOnly: true });
    expect(by["env.required"].status).toBe(UNKNOWN);
    expect(by["env.required"].detail).toMatch(/template/);
    expect(by["credentials.safe"].status).toBe(UNKNOWN);
    expect(by["deploy.metadata"].status).toBe(UNKNOWN);
    expect(report.envIsTemplate).toBe(true);
    expect(report.verdict).toBe(INSUFFICIENT_EVIDENCE);
    expect(renderText(report)).toMatch(/the live \.env was not found/);
  });

  test("T3d a template that is missing a key is still FAIL — absence is a fact either way", () => {
    const { by, report } = build({ templateOnly: true, env: { CRON_SECRET: undefined } });
    expect(by["env.required"].status).toBe(FAIL);
    expect(by["env.required"].detail).toContain("CRON_SECRET");
    expect(report.verdict).toBe(NOT_READY);
  });

  test("T4 duplicate external-result links are FAIL and are not repaired here", () => {
    const { by, report } = build({}, {
      "audit-external-result-links.mjs": { stdout: "3 duplicate (referral_id, care_report_id) group(s) exist. The migration WILL refuse.\n" },
    });
    expect(by["links.external_result_duplicates"].status).toBe(FAIL);
    expect(by["links.external_result_duplicates"].remediation).toMatch(/hand/i);
    expect(report.verdict).toBe(NOT_READY);
  });

  test("T4b an audit that could not run reports UNKNOWN, not 'no duplicates'", () => {
    const { by, report } = build({}, {
      "audit-external-result-links.mjs": { code: 1, stdout: "", stderr: "audit failed: connection terminated" },
    });
    expect(by["links.external_result_duplicates"].status).toBe(UNKNOWN);
    expect(report.verdict).toBe(INSUFFICIENT_EVIDENCE);
  });

  test("T4c money invariants that hold make both financial gates PASS", () => {
    const { by, report } = build({}, {});
    expect(by["financial.money_identity"].status).toBe(PASS);
    expect(by["financial.day_close_identity"].status).toBe(PASS);
    expect(by["financial.money_identity"].detail).toContain("11 bills, payments and vouchers invariants hold");
    expect(by["financial.day_close_identity"].detail).toContain("5 clinic and staff day close invariants hold");
    expect(report.verdict).toBe(READY);
  });

  test("T4d a violated money invariant is FAIL and NOT_READY — a failed integrity check blocks the deploy", () => {
    const { by, report } = build({}, { "financial-integrity:": { stdout: "FI|2|17,9184\n" } });
    expect(by["financial.money_identity"].status).toBe(FAIL);
    expect(by["financial.money_identity"].detail).toMatch(/2 violations \(rows 17, 9184/);
    expect(by["financial.day_close_identity"].status).toBe(FAIL);
    expect(report.verdict).toBe(NOT_READY);
  });

  test("T4e an unreachable database is UNKNOWN with a critical flag, never a pass", () => {
    const { by, report } = build({}, { "financial-integrity:": { code: 2, stdout: "", stderr: "psql: error: connection to server failed" } });
    expect(by["financial.money_identity"].status).toBe(UNKNOWN);
    expect(by["financial.money_identity"].critical).toBe(true);
    expect(by["financial.money_identity"].detail).toMatch(/could not be evaluated/);
    expect(report.verdict).toBe(INSUFFICIENT_EVIDENCE);
  });

  test("T4f an empty answer is not zero violations", () => {
    // The router's default for an unmatched command is exit 0 with empty stdout, so a
    // gate that read emptiness as cleanliness would be green on a box that ran nothing.
    const { by, report } = build({}, { "financial-integrity:": { stdout: "" } });
    expect(by["financial.money_identity"].status).toBe(UNKNOWN);
    expect(report.verdict).toBe(INSUFFICIENT_EVIDENCE);
  });

  test("T4g no DATABASE_URL means the money checks name that instead of judging nothing", () => {
    const { by, report } = build({}, {}, { env: { DATABASE_URL: undefined } });
    expect(by["financial.money_identity"].status).toBe(UNKNOWN);
    expect(by["financial.money_identity"].detail).toContain("no DATABASE_URL");
    expect(by["financial.money_identity"].critical, "an unrun money gate must be able to stop READY").toBe(true);
    expect(by["financial.day_close_identity"].detail).toContain("no DATABASE_URL");
    expect(report.verdict).toBe(INSUFFICIENT_EVIDENCE);
  });

  test("T4h no UNVERIFIED leaks out of the money tool into the gate's vocabulary", () => {
    const { report } = build({}, {});
    const financial = report.checks.filter((c) => c.id.startsWith("financial."));
    expect(financial.length).toBe(2);
    for (const c of financial) expect([PASS, FAIL, UNKNOWN, NOT_APPLICABLE]).toContain(c.status);
  });
});

describe("T5–T8 — backup and restore evidence", () => {
  test("T5 a backup directory that holds nothing is FAIL", () => {
    seedTree({});
    rmSync(artifactPath, { force: true });
    rmSync(`${artifactPath}.meta`, { force: true });
    const report = runPreflight({ ctx: makeCtx() });
    const by = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(by["backup.artifacts_present"].status).toBe(FAIL);
    expect(by["backup.freshness"].status).toBe(UNKNOWN);
    expect(by["backup.metadata"].status).toBe(UNKNOWN);
    expect(report.verdict).toBe(NOT_READY);
  });

  test("T5b a backup directory that is not this box's is UNKNOWN", () => {
    seedTree({});
    const report = runPreflight({ ctx: makeCtx({ env: { BACKUP_DIR: path.join(root, "nowhere") } }) });
    expect(report.checks.find((c) => c.id === "backup.artifacts_present").status).toBe(UNKNOWN);
  });

  test("T6 a 30-hour-old artifact is FAIL against the 26-hour limit", () => {
    const { by, report } = build({ ageHours: 30 });
    expect(by["backup.freshness"].status).toBe(FAIL);
    expect(by["backup.freshness"].detail).toMatch(/30\.0h/);
    expect(report.verdict).toBe(NOT_READY);
  });

  test("T6b the limit is the operator's, not a constant nobody can change", () => {
    const { by } = build({ ageHours: 30 }, {}, { env: { PREFLIGHT_MAX_BACKUP_AGE_HOURS: "36" } });
    expect(by["backup.freshness"].status).toBe(PASS);
  });

  // A zero-byte artifact is the worst kind of green: the dump job exits 0, the log
  // says success, the file exists with today's name, and there is nothing in it.
  // This is not hypothetical on this NAS — the dated dumps in
  // /volume1/docker/backups/postgres/care hold 20 empty files out of 62, including
  // six consecutive nights (2026-10-10 to 2026-10-15), measured 2026-10-15 read-only.
  const addEmptyNewer = (name = "caredeoghar_20261015_030000.sql.gz", ageMs = 3_600_000) => {
    const empty = path.join(backupDir, name);
    writeFileSync(empty, Buffer.alloc(0));
    const when = new Date(NOW - ageMs);
    utimesSync(empty, when, when);
    return empty;
  };

  test("T6c a 0-byte newest artifact is never the thing freshness is measured against", () => {
    seedTree({});
    addEmptyNewer();
    const by = Object.fromEntries(runPreflight({ ctx: makeCtx() }).checks.map((c) => [c.id, c]));
    expect(by["backup.artifacts_present"].status).toBe(PASS);
    expect(by["backup.artifacts_present"].detail).toMatch(/1 of them are 0 bytes/);
    expect(by["backup.freshness"].status).toBe(PASS);
    expect(by["backup.freshness"].detail).toMatch(/newest restorable/);
    expect(by["backup.freshness"].detail).toMatch(/the MOST RECENT file caredeoghar_20261015_030000\.sql\.gz is 0 bytes and was not counted/);
    expect(by["backup.freshness"].remediation).toMatch(/exit status/);
  });

  test("T6d a directory whose every artifact is 0 bytes is FAIL, not a box with backups", () => {
    seedTree({});
    writeFileSync(artifactPath, Buffer.alloc(0));
    const report = runPreflight({ ctx: makeCtx() });
    const by = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(by["backup.artifacts_present"].status).toBe(FAIL);
    expect(by["backup.artifacts_present"].detail).toMatch(/EVERY one is 0 bytes/);
    expect(by["backup.freshness"].status).toBe(FAIL);
    expect(by["backup.metadata"].status).toBe(UNKNOWN);
    expect(report.verdict).toBe(NOT_READY);
  });

  test("T6e a fresh empty write does not rescue a stale restorable backup", () => {
    seedTree({ ageHours: 30 });
    addEmptyNewer();
    const by = Object.fromEntries(runPreflight({ ctx: makeCtx() }).checks.map((c) => [c.id, c]));
    // The old code would have reported the 1-hour-old file as fresh and passed.
    expect(by["backup.freshness"].status).toBe(FAIL);
    expect(by["backup.freshness"].detail).toMatch(/30\.0h/);
  });

  test("T7 a sidecar that contradicts the artifact is FAIL, naming every mismatch", () => {
    seedTree({});
    writeFileSync(`${artifactPath}.meta`, [
      "source_database=db_data", "exporter=fallback", "schema_complete=false",
      "create_tables=0", "bytes=999999", "sha256_artifact=not-a-hash", "",
    ].join("\n"));
    const c = runPreflight({ ctx: makeCtx() }).checks.find((x) => x.id === "backup.metadata");
    expect(c.status).toBe(FAIL);
    expect(c.detail).toMatch(/schema_complete=false/);
    expect(c.detail).toMatch(/create_tables=0/);
    expect(c.detail).toMatch(/bytes=999999/);
    expect(c.detail).toMatch(/sha256_artifact is malformed/);
  });

  test("T7b a sidecar naming the wrong source database is FAIL on its own", () => {
    seedTree({});
    writeFileSync(`${artifactPath}.meta`, [...SIDECAR_LINES, `bytes=${readFileSync(artifactPath).length}`, "source_database=db_data", ""].join("\n"));
    const c = runPreflight({ ctx: makeCtx() }).checks.find((x) => x.id === "backup.metadata");
    expect(c.status).toBe(FAIL);
    expect(c.detail).toMatch(/db_data/);
  });

  test("T7c a sidecar that audits clean still cannot make the gate print a credential", () => {
    // `auditSidecar` accepts any `exporter` containing "remote" (that is what a dump pulled
    // from a partner host looks like), so a hand-edited sidecar can carry a connection string
    // in a field the audit passes — and the PASS branch of `backup.metadata` prints those very
    // fields as its detail. Redacting only the failure path would hide a password in one
    // branch and print it in the other.
    const lines = SIDECAR_LINES.map((l) =>
      l.startsWith("exporter=") ? `exporter=remote-postgresql://erp:${SENTINEL}@10.0.0.5:5432/diagnostic_erp` : l,
    );
    const { by, report } = build({ sidecarLines: lines });
    expect(by["backup.metadata"].status).toBe(PASS);
    expect(by["backup.metadata"].detail).toMatch(/exporter=\[redacted\]/);
    for (const surface of [renderText(report), JSON.stringify(report)]) {
      expect(surface).not.toContain(SENTINEL);
      expect(surface).not.toMatch(/postgres(ql)?:\/\//i);
    }
    // The pass is still a pass with readable fields, not a blank one.
    expect(by["backup.metadata"].detail).toMatch(/source_database=diagnostic_erp/);
    expect(by["backup.metadata"].detail).toMatch(/create_tables=439/);
  });

  test("T8 an artifact with no sidecar is UNKNOWN, never PASS", () => {
    const { by, report } = build({ withSidecar: false });
    expect(by["backup.metadata"].status).toBe(UNKNOWN);
    expect(by["backup.metadata"].critical).toBe(true);
    expect(report.verdict).toBe(INSUFFICIENT_EVIDENCE);
  });

  test("T8b a restore never proven anywhere is UNKNOWN and blocks READY", () => {
    const { report } = build({ evidence: null });
    const by = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(by["restore.evidence"].status).toBe(UNKNOWN);
    expect(by["backup.artifacts_present"].status).toBe(PASS);
    expect(report.verdict).toBe(INSUFFICIENT_EVIDENCE);
    expect(report.insufficientEvidence.join(" ")).toMatch(/restore/);
    expect(existsSync(path.join(root, EVIDENCE_FILE))).toBe(false);
  });

  test("T8c a recorded FAILED restore is FAIL, not a shrug", () => {
    const ev = { ...HEALTHY_EVIDENCE, restore_verification: { ...HEALTHY_EVIDENCE.restore_verification, passed: false } };
    const { by, report } = build({ evidence: ev });
    expect(by["restore.evidence"].status).toBe(FAIL);
    expect(report.verdict).toBe(NOT_READY);
  });

  test("T8d proof from 200 days ago is not proof", () => {
    const ev = { ...HEALTHY_EVIDENCE, restore_verification: { ...HEALTHY_EVIDENCE.restore_verification, verified_at: new Date(NOW - 200 * 86_400_000).toISOString() } };
    const { by } = build({ evidence: ev });
    expect(by["restore.evidence"].status).toBe(UNKNOWN);
    expect(by["restore.evidence"].detail).toMatch(/200d old/);
  });

  test("T8e the database's own record wins over an operator's older note", () => {
    const { by } = build({}, { restore_verification: { stdout: "fail|2026-10-15 02:00:00+00\n" } });
    expect(by["restore.evidence"].status).toBe(FAIL);
    expect(by["restore.evidence"].detail).toMatch(/in-app/);
  });

  test("T8f an unparseable evidence file is reported, never treated as clean", () => {
    seedTree({});
    write(EVIDENCE_FILE, "{ this is not json");
    const report = runPreflight({ ctx: makeCtx() });
    const by = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(by["restore.evidence"].status).toBe(UNKNOWN);
    expect(report.verdict).toBe(INSUFFICIENT_EVIDENCE);
  });
});

describe("T9–T12 — platform, integration and metadata", () => {
  test("T9 4% free disk is FAIL", () => {
    const { by, report } = build({}, {}, { statfs: () => ({ blocks: 1000, bavail: 40 }) });
    expect(by["disk.space"].status).toBe(FAIL);
    expect(report.verdict).toBe(NOT_READY);
  });

  test("T9b a platform that will not answer statfs is UNKNOWN", () => {
    const { by, report } = build({}, {}, { statfs: () => null });
    expect(by["disk.space"].status).toBe(UNKNOWN);
    expect(report.verdict).toBe(INSUFFICIENT_EVIDENCE);
  });

  test("T10 an emitted event type outside the registry is FAIL", () => {
    const sites = { ...EMIT_SITES, "artifacts/api-server/src/services/integration/invoicing.ts": 'eventType: "diagnostic_invoice.issued",\n' };
    const { by, report } = build({ emitSites: sites });
    expect(by["hope.integration"].status).toBe(FAIL);
    expect(by["hope.integration"].detail).toMatch(/diagnostic_invoice\.issued/);
    expect(report.verdict).toBe(NOT_READY);
  });

  test("T10b the film event is named as the one HOPE cannot interpret", () => {
    const { by } = build();
    expect(HOPE_UNSUPPORTED_EVENTS).toContain("diagnostic_electronic_film.available");
    expect(CARE_EMITTED_EVENTS).toContain("diagnostic_electronic_film.available");
    expect(by["hope.integration"].status).toBe(PASS);
  });

  test("T10c an unrecorded receiver version is UNKNOWN — code merged is not code deployed", () => {
    const { by, report } = build({ evidence: { ...HEALTHY_EVIDENCE, hope_receiver: undefined } });
    expect(by["hope.receiver_version"].status).toBe(UNKNOWN);
    expect(by["hope.receiver_version"].detail).toMatch(/191|not observable/i);
    expect(report.verdict).toBe(INSUFFICIENT_EVIDENCE);
  });

  test("T10d a recorded refusal-check that FAILED is a FAIL, not a footnote", () => {
    const ev = { ...HEALTHY_EVIDENCE, hope_receiver: { unsupported_event_refused: false, event_type: "diagnostic_electronic_film.available", checked_at: new Date(NOW - 86_400_000).toISOString() } };
    const { by, report } = build({ evidence: ev });
    expect(by["hope.receiver_version"].status).toBe(FAIL);
    expect(report.verdict).toBe(NOT_READY);
  });

  test("T10e an unarmed integration is NOT_APPLICABLE, not a pass and not a failure", () => {
    const { by, report } = build({ env: { HOPE_PARTNER_KEY: undefined, INTEGRATION_HOPE_CALLBACK_URL: undefined, HOPE_CARE_INTEGRATION_FORCE: undefined, INTEGRATION_HOPE_SIGNING_SECRET: undefined } });
    expect(by["hope.integration"].status).toBe(NOT_APPLICABLE);
    expect(report.verdict).not.toBe(NOT_READY);
  });

  test("T10f a conditional emit is read — the form CARE actually uses", () => {
    // `eventType: amendment ? "…amended" : "…finalised"` is on one line and is
    // how every report leaves the box. A scanner that requires `eventType: "…"`
    // misses both halves and the registry goes unchecked in practice.
    const sites = {
      ...EMIT_SITES,
      "artifacts/api-server/src/services/integration/resultsEmitter.ts":
        'eventType: urgent ? "diagnostic_result.escalated" : "diagnostic_invoice.issued",\n',
    };
    const { by, report } = build({ emitSites: sites });
    expect(by["hope.integration"].status).toBe(FAIL);
    expect(by["hope.integration"].detail).toMatch(/diagnostic_invoice\.issued/);
    expect(by["hope.integration"].detail).not.toMatch(/diagnostic_result\.escalated/);
    expect(report.verdict).toBe(NOT_READY);
  });

  test("T10g a reader of eventType is not mistaken for a writer of it", () => {
    // outbox.ts compares against the film type to decide what to retry. Counting
    // readers would flag types nothing sends, and the check would be wrong in
    // the other direction — so this must stay PASS.
    const sites = {
      ...EMIT_SITES,
      "artifacts/api-server/src/services/integration/retention.ts":
        'if (row.eventType === "diagnostic_archive.requested") return "not sent";\n',
    };
    const { by } = build({ emitSites: sites });
    expect(by["hope.integration"].status).toBe(PASS);
    const contract = hopeEventContractHolds(makeCtx());
    expect(contract.emitted).toContain("diagnostic_report.amended");
    expect(contract.emitted).not.toContain("diagnostic_archive.requested");
    expect(by["hope.integration"].detail).toMatch(/across \d+ source file/);
  });

  test("T10h a dependency whose output shape changed reports UNKNOWN, not a quiet PASS", () => {
    seedTree({});
    const ctx = makeCtx({ exec: router({ "check-migration-order.cjs": { stdout: '{"ok":true}\n' } }) });
    const by = Object.fromEntries(runPreflight({ ctx }).checks.map((c) => [c.id, c]));
    expect(by["migrations.static"].status).toBe(UNKNOWN);
    expect(by["migrations.static"].detail).toMatch(/violations list/);
  });

  test("T11 a compose file that stopped forwarding ENABLE_SCHEDULERS is FAIL", () => {
    const compose = COMPOSE.replace("      ENABLE_SCHEDULERS: ${ENABLE_SCHEDULERS:-}\n", "");
    const { by, report } = build({ compose });
    expect(by["schedulers.consistent"].status).toBe(FAIL);
    expect(report.verdict).toBe(NOT_READY);
  });

  test("T11b ENABLE_SCHEDULERS empty is UNKNOWN — off may be intended, the gate cannot know", () => {
    // A box whose backups come from a DSM task legitimately leaves this off, so
    // FAIL would be a guess. UNKNOWN is the honest answer, and it still blocks
    // READY: nobody should deploy while unsure whether the jobs are running.
    const { by, report } = build({ env: { ENABLE_SCHEDULERS: "" } });
    expect(by["schedulers.consistent"].status).toBe(UNKNOWN);
    expect(by["schedulers.consistent"].detail).toMatch(/nothing is scheduled/i);
    expect(report.verdict).toBe(INSUFFICIENT_EVIDENCE);
  });

  test("T11c schedulers on both api and worker is FAIL (jobs double-fire)", () => {
    const compose = COMPOSE.replace("  web:", '  worker:\n    environment:\n      ENABLE_SCHEDULERS: "1"\n  web:');
    const { by } = build({ compose });
    expect(by["schedulers.consistent"].status).toBe(FAIL);
    expect(by["schedulers.consistent"].detail).toMatch(/double-fires/);
  });

  test("T12 missing build metadata is FAIL and names the keys", () => {
    const { by, report } = build({ env: { GIT_COMMIT: undefined, BUILD_NUMBER: "" } });
    expect(by["deploy.metadata"].status).toBe(FAIL);
    expect(by["deploy.metadata"].detail).toMatch(/GIT_COMMIT/);
    expect(report.verdict).toBe(NOT_READY);
  });

  test("T12h the recorder writes what the reader reads — evidence survives a reload", () => {
    // The operator's path is a one-line shell command, not hand-written JSON. A
    // recorder whose output the reader could not parse would leave the gate at
    // UNKNOWN forever, which is indistinguishable from "nobody did the restore".
    seedTree({ evidence: null });
    const ctx = makeCtx();
    const code = main(
      ["--record-restore", "--artifact", "caredeoghar_20261014_030000.sql.gz", "--tables", "439", "--patients", "8123", "--no-rerun"],
      { ctx, writeFile: (f, t) => writeFileSync(f, t, "utf8") },
    );
    expect(code).toBe(0);
    const by = Object.fromEntries(runPreflight({ ctx }).checks.map((c) => [c.id, c]));
    expect(by["restore.evidence"].status).toBe(PASS);
    expect(by["restore.evidence"].detail).toMatch(/8123 patients/);
    // Sections the operator has not recorded stay absent, not blanked.
    const data = JSON.parse(readFileSync(path.join(root, EVIDENCE_FILE), "utf8"));
    expect(data.hope_receiver).toBeUndefined();
  });

  test("T12c1 the census line the gate counts is the line the backup job writes", () => {
    // A census has three definitions in this system: the shell that writes it, the
    // TypeScript verifier that grades it, and this gate that derives the deploy
    // PASS from it. Two of those three drift here. Each `${var}` is planted with a
    // DIFFERENT number, so a job that emits the fields in a different order than
    // psql returned them changes the parsed census instead of sliding through a
    // shape-only regex.
    const template = (BACKUP_SH.match(/AS census_table[\s\S]*?FROM "@T@"/) ?? [""])[0];
    expect([...template.matchAll(/AS (\w+)/g)].map((m) => m[1]))
      .toEqual(["census_table", "row_count", "id_min", "id_max", "id_sum"]);
    const read = (BACKUP_SH.match(/while IFS='\|' read -r (\w+) (\w+) (\w+) (\w+) (\w+)/) ?? []).slice(1);
    expect(read).toEqual(["t", "r", "mn", "mx", "s"]);
    const digits = { r: "41", mn: "7", mx: "9301", s: "41288350" };
    const emit = BACKUP_SH.match(/^\s*echo "census_\$\{which\}\.\$\{t\}=([^"]+)"/m);
    expect(emit, "the backup job must write a census_<edge>.<table> line").toBeTruthy();
    const line = `census_before.audit_logs=` + emit[1].replace(/\$\{(\w+)\}/g, (_, v) => digits[v] ?? `<<${v}>>`);
    expect(line).toBe("census_before.audit_logs=41|7|9301|41288350");
    expect(line.match(CENSUS_LINE_RE)?.slice(1)).toEqual(["audit_logs", "41", "7", "9301", "41288350"]);
    // And the fixture this file builds is the same shape, not a private dialect.
    for (const l of censusSidecarLines()) if (l.startsWith("census_before.")) expect(l).toMatch(CENSUS_LINE_RE);
  });

  test("T12c2 the census tables the fixture censes are the tables the job censes", () => {
    // Nothing here is allowed to invent its own table list, or this file would keep
    // passing against a job that quietly stopped bracketing half the record.
    expect(CENSUS_TABLES).toEqual(expect.arrayContaining(["patient_reports", "audit_logs", "radiology_worklist"]));
    expect(CENSUS_TABLES.length).toBeGreaterThanOrEqual(5);
    expect(new Set(CENSUS_TABLES).size).toBe(CENSUS_TABLES.length);
  });

  test("T12c3 the attestation counts dump-time edges, and only those", () => {
    seedTree({});
    const ctx = makeCtx();
    const ART = "caredeoghar_20261014_030000.sql.gz";
    expect(censusTableCount(ctx, ART)).toBe(CENSUS_TABLES.length);
    // An `after` with no `before` is a half bracket and proves nothing.
    const half = censusSidecarLines().filter((l) => !l.startsWith("census_before."));
    seedTree({ sidecarLines: [...SIDECAR_LINES.filter((l) => !l.startsWith("census")), ...half] });
    expect(censusTableCount(makeCtx(), ART)).toBe(0);
    // A census the job could not take is reported, not counted.
    seedTree({ sidecarLines: [...SIDECAR_LINES.filter((l) => !l.startsWith("census")), "census_error=psql exited 1"] });
    expect(censusTableCount(makeCtx(), ART)).toBe(0);
    // A census line whose numbers are not numbers is not a measurement.
    seedTree({ sidecarLines: [...SIDECAR_LINES.filter((l) => !l.startsWith("census")), "census_before.audit_logs=N/A|?|?|?"] });
    expect(censusTableCount(makeCtx(), ART)).toBe(0);
    // And a line that only MENTIONS a census is not one either: the sidecar is a
    // key=value file, and a note field that quotes the format must not be read as
    // the measurement it describes.
    seedTree({ sidecarLines: [...SIDECAR_LINES.filter((l) => !l.startsWith("census")), "note=census_before.audit_logs=1|2|3|4"] });
    expect(censusTableCount(makeCtx(), ART)).toBe(0);
    // No sidecar at all, and no artifact named at all.
    seedTree({ withSidecar: false });
    expect(censusTableCount(makeCtx(), ART)).toBe(0);
    expect(censusTableCount(makeCtx(), "   ")).toBe(0);
    expect(censusTableCount(makeCtx(), null)).toBe(0);
    // A path, not a bare name: the sidecar lives next to the artifact.
    seedTree({});
    expect(censusTableCount(makeCtx(), path.join(backupDir, ART))).toBe(CENSUS_TABLES.length);
  });

  test("T12c4 an operator cannot type the strongest claim in the evidence file", () => {
    // The whole point of deriving the census from the sidecar: a recorder that
    // accepted `--census-attested`, or a reader that believed a hand-edited flag,
    // would make PASS the easiest field in the file to produce.
    const censusFree = SIDECAR_LINES.filter((l) => !l.startsWith("census"));
    seedTree({ evidence: null, sidecarLines: censusFree });
    const chunks = [];
    const realWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (c) => { chunks.push(String(c)); return true; };
    let code;
    try {
      code = main(["--record-restore", "--artifact", "caredeoghar_20261014_030000.sql.gz", "--census-attested", "true", "--no-rerun"],
        { ctx: makeCtx(), writeFile: (f, t) => writeFileSync(f, t, "utf8") });
    } finally { process.stdout.write = realWrite; }
    expect(code).toBe(0);
    const data = JSON.parse(readFileSync(path.join(root, EVIDENCE_FILE), "utf8"));
    expect(data.restore_verification.censusAttested).toBe(false);
    expect(chunks.join("")).toMatch(/NOTE:.*no backup-time census/);
    const by = Object.fromEntries(runPreflight({ ctx: makeCtx() }).checks.map((c) => [c.id, c]));
    expect(by["restore.evidence"].status).toBe(UNKNOWN);
    expect(by["restore.evidence"].detail).toMatch(/no dump-time census/);
    expect(by["restore.evidence"].remediation).toMatch(/census-bearing/);
    // The recovery the refusal names is the one this repo has: the script exists,
    // and the flag it is told to use is the flag the binary accepts.
    expect(existsSync(new URL("./verify-backup-restore.sh", import.meta.url))).toBe(true);
    expect(by["restore.evidence"].remediation).toContain("--record-restore");
    // And with the census present, the same command records the attestation on its
    // own and says nothing about it.
    seedTree({ evidence: null });
    const said = [];
    process.stdout.write = (c) => { said.push(String(c)); return true; };
    try {
      main(["--record-restore", "--artifact", "caredeoghar_20261014_030000.sql.gz", "--no-rerun"],
        { ctx: makeCtx(), writeFile: (f, t) => writeFileSync(f, t, "utf8") });
    } finally { process.stdout.write = realWrite; }
    expect(JSON.parse(readFileSync(path.join(root, EVIDENCE_FILE), "utf8")).restore_verification.censusAttested).toBe(true);
    expect(said.join("")).not.toMatch(/NOTE/);
  });

  test("T12c5 the reader re-reads the artifact and does not inherit the file's claim", () => {
    const censusFree = SIDECAR_LINES.filter((l) => !l.startsWith("census"));
    // A forged attestation: the JSON says the census exists, the artifact's sidecar
    // says it does not. The artifact is the evidence, so it wins.
    seedTree({ sidecarLines: censusFree });
    let by = Object.fromEntries(runPreflight({ ctx: makeCtx() }).checks.map((c) => [c.id, c]));
    expect(by["restore.evidence"].status).toBe(UNKNOWN);
    expect(by["restore.evidence"].detail).toMatch(/although the evidence file claims one/);
    // The other direction, which is the one that must not cost a clinic a deploy:
    // a proof recorded before this field existed, against an artifact that does
    // carry a census. The completeness argument is in the sidecar right now, so the
    // gate reads it and PASSes without being told.
    seedTree({ evidence: { ...HEALTHY_EVIDENCE, restore_verification: { ...HEALTHY_EVIDENCE.restore_verification, censusAttested: undefined } } });
    by = Object.fromEntries(runPreflight({ ctx: makeCtx() }).checks.map((c) => [c.id, c]));
    expect(by["restore.evidence"].status).toBe(PASS);
  });

  test("T12c6 the in-app route holds the same bar as the operator's record", () => {
    // Two routes to PASS with two evidence bars is how a gate teaches people to
    // route around the harder one.
    const db = (stdout) => build({}, { restore_verification: { stdout } }).by["restore.evidence"];
    expect(db("pass|2026-10-15 02:00:00+00|true\n").status).toBe(PASS);
    const absent = db("pass|2026-10-15 02:00:00+00|absent\n");
    expect(absent.status).toBe(UNKNOWN);
    expect(absent.detail).toMatch(/not recorded by the version that produced this proof/);
    expect(absent.remediation).toMatch(/census-bearing scripts\/synology-nas-backup\.sh/);
    const odd = db("pass|2026-10-15 02:00:00+00|maybe\n");
    expect(odd.status).toBe(UNKNOWN);
    expect(odd.detail).toMatch(/reported as "maybe"/);
    // A census cannot rescue a failed restore.
    expect(db("fail|2026-10-15 02:00:00+00|true\n").status).toBe(FAIL);
  });

  test("T12c7 a census claim in the verifier's own row is not read as a boolean", () => {
    // `detail->>'censusAttested'` is JSON text: `true`, `false`, or absent. A check
    // written as a string comparison against anything else lands on UNKNOWN, which
    // is the honest answer; the day it lands on PASS is the day the gate is lying.
    const { by } = build({}, { restore_verification: { stdout: "pass|2026-10-15 02:00:00+00|false\n" } });
    expect(by["restore.evidence"].status).toBe(UNKNOWN);
    expect(by["restore.evidence"].detail).toMatch(/reported as "false"/);
  });

  test("T12i a recorder refuses to invent the one field that makes the proof mean something", () => {
    seedTree({ evidence: null });
    const written = [];
    const code = main(["--record-restore"], { ctx: makeCtx(), writeFile: (f) => written.push(f) });
    expect(code).toBe(1);
    expect(written).toEqual([]);
    expect(existsSync(path.join(root, EVIDENCE_FILE))).toBe(false);
  });

  test("T12p a malformed count is refused, not stored as null next to a success banner", () => {
    // `--tables abc` used to write `tables: null` and print "Recorded". The file then
    // looked like a completed proof, and nothing in it said the number had never been
    // measured — which is the same failure shape as a backup tool reporting success on
    // a zero-byte dump.
    seedTree({ evidence: null });
    const written = [];
    for (const args of [["--record-restore", "--artifact", "caredeoghar_20261014_030000.sql.gz", "--tables", "abc"],
      ["--record-restore", "--artifact", "caredeoghar_20261014_030000.sql.gz", "--tables=12.5"],
      ["--record-restore", "--artifact", "caredeoghar_20261014_030000.sql.gz", "--patients", "-3"]]) {
      expect(main(args, { ctx: makeCtx(), writeFile: (f) => written.push(f) })).toBe(1);
    }
    expect(written).toEqual([]);
    expect(existsSync(path.join(root, EVIDENCE_FILE))).toBe(false);
    const ok = main(["--record-restore", "--artifact", "caredeoghar_20261014_030000.sql.gz", "--tables", "439", "--patients", "8123", "--no-rerun"], { ctx: makeCtx(), writeFile: (f, t) => writeFileSync(f, t, "utf8") });
    expect(ok).toBe(0);
    const data = JSON.parse(readFileSync(path.join(root, EVIDENCE_FILE), "utf8"));
    expect(data.restore_verification).toMatchObject({ tables: 439, patients: 8123 });
  });

  test("T12q an artifact of only spaces names no artifact", () => {
    seedTree({ evidence: null });
    const written = [];
    expect(main(["--record-restore", "--artifact", "   ", "--no-rerun"], { ctx: makeCtx(), writeFile: (f) => written.push(f) })).toBe(1);
    expect(written).toEqual([]);
    expect(existsSync(path.join(root, EVIDENCE_FILE))).toBe(false);
  });

  test("T12j recording is additive: an existing section is merged, not overwritten", () => {
    seedTree({});
    const before = JSON.parse(readFileSync(path.join(root, EVIDENCE_FILE), "utf8"));
    main(["--record-hope-probe", "--refused", "--no-rerun"], { ctx: makeCtx(), writeFile: (f, t) => writeFileSync(f, t, "utf8") });
    const after = JSON.parse(readFileSync(path.join(root, EVIDENCE_FILE), "utf8"));
    expect(after.restore_verification).toEqual(before.restore_verification);
    expect(after.hope_receiver.unsupported_event_refused).toBe(true);
    // Fields the operator recorded earlier in the SAME section survive a later
    // recording that does not mention them — replacing the section would silently
    // drop the event type the probe was actually run against.
    expect(after.hope_receiver.event_type).toBe(before.hope_receiver.event_type);
  });

  test("T12o a re-recorded probe keeps the event type it was run against", () => {
    seedTree({
      evidence: {
        ...HEALTHY_EVIDENCE,
        hope_receiver: { unsupported_event_refused: true, event_type: "diagnostic_order.created", checked_at: new Date(NOW - 40 * 86_400_000).toISOString() },
      },
    });
    main(["--record-hope-probe", "--refused", "--no-rerun"], { ctx: makeCtx(), writeFile: (f, t) => writeFileSync(f, t, "utf8") });
    const after = JSON.parse(readFileSync(path.join(root, EVIDENCE_FILE), "utf8"));
    expect(after.hope_receiver.event_type).toBe("diagnostic_order.created");
    expect(new Date(after.hope_receiver.checked_at).getTime()).toBe(NOW);
  });

  test("T12k recording the probe as NOT refused is a FAIL, and saying so beats silence", () => {
    seedTree({ evidence: null });
    main(["--record-hope-probe", "--not-refused", "--no-rerun"], { ctx: makeCtx(), writeFile: (f, t) => writeFileSync(f, t, "utf8") });
    const by = Object.fromEntries(runPreflight({ ctx: makeCtx() }).checks.map((c) => [c.id, c]));
    expect(by["hope.receiver_version"].status).toBe(FAIL);
    expect(by["hope.receiver_version"].detail).toMatch(/acknowledges|discarded/);
  });

  test("T12l --help names only what this binary accepts", () => {
    // An operator pastes from --help in the middle of an incident. Every command
    // the runbook tells them to type is asserted here, so the help text and the
    // document cannot drift apart from the code that answers them.
    seedTree({});
    const chunks = [];
    const realWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (c) => { chunks.push(String(c)); return true; };
    let code;
    try { code = main(["--help"]); } finally { process.stdout.write = realWrite; }
    expect(code).toBe(0);
    const help = chunks.join("");
    for (const named of ["--record-restore", "--record-hope-probe", "--record-rollback", "--env-file", "--json", "ops-evidence.json"]) {
      expect(help, `help documents ${named}`).toContain(named);
    }
    expect(help).toContain("INSUFFICIENT_EVIDENCE");
    expect(help).toMatch(/never prints a credential/);
  });

  test("T12m a recorder with no answer recorded writes nothing rather than guessing", () => {
    seedTree({ evidence: null });
    const written = [];
    const code = main(["--record-hope-probe"], { ctx: makeCtx(), writeFile: (f) => written.push(f) });
    expect(code).toBe(1);
    expect(written).toEqual([]);
    expect(existsSync(path.join(root, EVIDENCE_FILE))).toBe(false);
  });

  test("T12n re-recording a section keeps the fields already recorded in it", () => {
    // An operator proves a restore, records it, then a week later records the
    // next one with only the new artifact name. The counts they typed the first
    // time must not vanish — and the artifact they just named must win.
    seedTree({ evidence: null });
    const wr = (f, t) => writeFileSync(f, t, "utf8");
    main(["--record-restore", "--artifact", "old_20261001.sql.gz", "--tables", "439", "--no-rerun"], { ctx: makeCtx(), writeFile: wr });
    main(["--record-restore", "--artifact", "new_20261014.sql.gz", "--no-rerun"], { ctx: makeCtx(), writeFile: wr });
    const data = JSON.parse(readFileSync(path.join(root, EVIDENCE_FILE), "utf8"));
    expect(data.restore_verification.artifact).toBe("new_20261014.sql.gz");
    expect(data.restore_verification.tables).toBe(439);
  });

  test("T12f build metadata read off the live .env is PASS", () => {
    const { by } = build();
    expect(by["deploy.metadata"].status).toBe(PASS);
    expect(by["deploy.metadata"].detail).toMatch(/a{12}/);
  });

  test("T12b a compose file missing a required service is FAIL", () => {
    const compose = COMPOSE.replace("  db-patch-v2:\n    build: .\n", "");
    const { by, report } = build({ compose });
    expect(by["compose.services_required"].status).toBe(FAIL);
    expect(by["compose.services_required"].detail).toMatch(/db-patch-v2/);
    expect(report.verdict).toBe(NOT_READY);
  });

  test("T12c docker absent means UNKNOWN, because the file was never validated", () => {
    const { by, report } = build({}, { "docker compose": { missing: true } });
    expect(by["compose.valid"].status).toBe(UNKNOWN);
    expect(report.verdict).toBe(INSUFFICIENT_EVIDENCE);
  });

  test("T12d an incomplete rollback record is FAIL; absence alone is UNKNOWN", () => {
    const ev = { ...HEALTHY_EVIDENCE, rollback: { previous_commit: HEAD_SHA } };
    const { by, report } = build({ evidence: ev });
    expect(by["rollback.prerequisites"].status).toBe(FAIL);
    expect(by["rollback.prerequisites"].detail).toMatch(/api_image/);
    expect(report.verdict).toBe(NOT_READY);

    const absent = build({ evidence: { ...HEALTHY_EVIDENCE, rollback: undefined } });
    expect(absent.by["rollback.prerequisites"].status).toBe(UNKNOWN);
    // Not critical: a missing rollback note degrades the deploy, it does not
    // silently destroy data. The verdict must stay READY.
    expect(absent.report.verdict).toBe(READY);
  });
});

describe("T13 — deployment-configuration drift (§7)", () => {
  test("T13 a second runnable copy of a deployment file is FAIL and names it", () => {
    const { by, report } = build({
      copies: { "SOP/RECOVERY/01_INFRASTRUCTURE/deploy-synology.sh": "#!/bin/bash\npnpm install\npnpm db:deploy\n" },
    });
    expect(by["deploy.config_single_source"].status).toBe(FAIL);
    expect(by["deploy.config_single_source"].detail).toMatch(/SOP\/RECOVERY\/01_INFRASTRUCTURE\/deploy-synology\.sh/);
    expect(report.verdict).toBe(NOT_READY);
  });

  test("T13b a copy that declares itself retired is not a runnable second path", () => {
    const { by } = build({
      copies: { "SOP/RECOVERY/01_INFRASTRUCTURE/deploy-synology.sh": "#!/bin/bash\n# RETIRED — DO NOT RUN\nexit 1\n" },
    });
    expect(by["deploy.config_single_source"].status).toBe(PASS);
    expect(by["deploy.config_single_source"].detail).toMatch(/retired/);
  });

  test("T13c a byte-identical mirror is drift-free but still not the live file", () => {
    const { by } = build({
      copies: { "SOP/RECOVERY/16_RUNBOOKS/docker-compose.yml": COMPOSE },
    });
    expect(by["deploy.config_single_source"].status).toBe(PASS);
  });

  test("T13d the exemption is a different program, not an unchecked copy", () => {
    // deploy/windows-emergency/overlay/docker-compose.yml is the DS225+ stack,
    // which is deliberately smaller. A copy under an exempt prefix must still be
    // invisible to the scan — and that must be a named list, not a silent skip.
    const { by } = build({ copies: { "deploy/windows-emergency/overlay/docker-compose.yml": "services:\n  x:\n" } });
    expect(by["deploy.config_single_source"].status).toBe(PASS);
    expect(DRIFT_EXEMPT.length).toBeGreaterThan(0);
  });

  test("T13e the real repository tree has no runnable second deployment path", () => {
    // The guard the brief asks for: if anyone re-adds a stale deploy script,
    // compose file or Dockerfile to the recovery binder without retiring it,
    // CI fails here rather than the clinic finding it during an incident.
    const copies = configCopies(makeContext(), "deploy-synology.sh");
    expect(copies.length).toBeGreaterThan(1); // root + binder pointers, or the guard is vacuous
    const check = checkConfigDrift(makeContext());
    expect(check.detail, check.detail).not.toMatch(/drifted duplicate/);
    expect(check.status).toBe(PASS);
  });

  test("T13f the binder pointers say what they replace and why", () => {
    const copies = configCopies(makeContext(), "deploy-synology.sh");
    const retired = copies.filter((c) => c.rel !== "deploy-synology.sh");
    expect(retired.length).toBeGreaterThan(0);
    for (const c of retired) {
      expect(c.text, `${c.rel} must mark itself retired`).toMatch(/RETIRED — DO NOT RUN/);
      expect(c.text, `${c.rel} must name the live script`).toMatch(/deploy-synology\.sh/);
      expect(c.text, `${c.rel} must preflight first`).toMatch(/ops-preflight/);
    }
  });
});

describe("T14–T16 — verdict contract and output hygiene", () => {  test("T14 FAIL outranks UNKNOWN when both are present", () => {
    const { report } = build({ ageHours: 30, evidence: null });
    expect(report.verdict).toBe(NOT_READY);
    expect(report.counts.FAIL).toBeGreaterThan(0);
    expect(report.counts.UNKNOWN).toBeGreaterThan(0);
  });

  test("T14b a drifted checkout is FAIL", () => {
    const { by, report } = build({}, { "git rev-parse origin/main": { stdout: `${"b".repeat(40)}\n` } });
    expect(by["repo.commit"].status).toBe(FAIL);
    expect(report.verdict).toBe(NOT_READY);
  });

  test("T14c uncommitted changes to deployment-critical files are FAIL", () => {
    const { by, report } = build({}, { "git status --porcelain": { stdout: " M docker-compose.yml\n?? stray.txt\n" } });
    expect(by["repo.clean_deployment_config"].status).toBe(FAIL);
    expect(report.verdict).toBe(NOT_READY);
  });

  test("T14d a critical UNKNOWN alone never says READY", () => {
    const { report } = build({ evidence: null });
    expect(report.verdict).toBe(INSUFFICIENT_EVIDENCE);
    const text = renderText(report);
    expect(text).toMatch(/INSUFFICIENT_EVIDENCE/);
    expect(text).toMatch(/UNKNOWN is not a pass/);
  });

  test("T15 Orthanc image backup is NOT_APPLICABLE and never PASS", () => {
    const { by, report } = build();
    const c = by["backup.orthanc_images"];
    expect(c.status).toBe(NOT_APPLICABLE);
    expect(c.critical).toBe(false);
    expect(c.detail).toMatch(/NOT a pass/i);
    expect(report.checks.map((x) => x.id)).toContain("backup.orthanc_images");
    const stale = build({ ageHours: 30 });
    expect(stale.by["backup.orthanc_images"].status).toBe(NOT_APPLICABLE);
  });

  test("T16 no credential value and no patient field appears in any output mode", () => {
    seedTree({ env: { JWT_SECRET: SENTINEL, SESSION_SECRET: SENTINEL, CRON_SECRET: SENTINEL, INTERNAL_API_KEY: SENTINEL, HOPE_PARTNER_KEY: SENTINEL } });
    write("clinical-note.txt", "Ramesh Kumar 9999999999 impression: acute infarct\n");
    const report = runPreflight({ ctx: makeCtx() });
    for (const surface of [renderText(report), JSON.stringify(report)]) {
      expect(surface).not.toContain(SENTINEL);
      expect(surface).not.toContain("Ramesh");
      expect(surface).not.toContain("9999999999");
      expect(surface).not.toContain("acute infarct");
    }
  });

  test("the JSON contract carries the verdict and the reason for it", () => {
    const { report } = build({}, { "audit-external-result-links.mjs": { stdout: "2 duplicate (referral_id, care_report_id) group(s) exist.\n" } });
    expect(report.verdict).toBe(NOT_READY);
    expect(report.blocking.join(" ")).toMatch(/duplicate/);
    expect(report.checks.every((c) => [PASS, FAIL, UNKNOWN, NOT_APPLICABLE].includes(c.status))).toBe(true);
    expect(report.checks.every((c) => typeof c.id === "string" && typeof c.detail === "string")).toBe(true);
  });
});

describe("auditSidecar prints the value it rejects, unless that value is a credential", () => {
  test("an ordinary wrong value is quoted so the operator can see it", () => {
    const bad = auditSidecar({ source_database: "db_data", created_utc: "x", sha256_artifact: "0".repeat(64) }, { expectedDatabase: "diagnostic_erp" });
    expect(bad.join(" ")).toMatch(/source_database=db_data but this host is diagnostic_erp/);
  });

  test("a credential-shaped value is redacted in the message, not just in the manifest", () => {
    // A hand-edited sidecar for a remote dump often puts the connection string in
    // `source_database`. `sanitizeManifest` hides it there; the same value is interpolated into
    // the problem line by `auditSidecar`, which the gate and the inventory both print. One
    // predicate has to cover both, or the tool redacts the field and prints the password.
    const meta = {
      source_database: `postgresql://erp:${SENTINEL}@127.0.0.1:5432/diagnostic_erp`,
      exporter: `intgk_${SENTINEL}`,
      created_utc: "x",
      sha256_artifact: "0".repeat(64),
    };
    const bad = auditSidecar(meta, { expectedDatabase: "diagnostic_erp" });
    const text = bad.join(" ");
    expect(text).not.toContain(SENTINEL);
    expect(text).not.toMatch(/postgres(ql)?:\/\//i);
    expect(text).toMatch(/source_database=\[redacted\]/);
    expect(text).toMatch(/exporter=\[redacted\]/);
    // The predicate itself, so a shape added here is added for both readers at once.
    // The PEM header is assembled at run time: written as one literal it is itself a
    // committed PEM string, and `check-no-committed-secrets.mjs` counts that pattern
    // per file on a shrink-only ratchet. A test fixture has no business raising it.
    const pemHead = ["-----BEGIN RSA", "PRIVATE KEY-----"].join(" ");
    expect(credentialShaped(pemHead)).toBe(true);
    expect(credentialShaped("diagnostic_erp")).toBe(false);
  });
});

describe("the count the runbook tells the operator", () => {
  test("the runbook's check count is the count the gate runs", () => {
    // §6 asks whether a documented claim holds in the environment it targets. The runbook
    // states how many checks the gate will run, and that figure drifts the moment a check is
    // added — nothing executes prose, so it had quietly gone stale ("all four below and 17
    // more" against a gate that emits 22). Assert it against the module, not against memory.
    const runbook = readFileSync(path.join(makeContext().repo, "docs", "CARE_ERP_DEPLOYMENT_RUNBOOK.md"), "utf8");
    const stated = [...runbook.matchAll(/\(all (\d+) checks;/g)].map((m) => Number(m[1]));
    expect(stated.length, "the runbook must state the gate's check count where the operator reads it").toBeGreaterThan(0);
    const { report } = build({});
    for (const n of stated) {
      expect(n).toBe(REQUIRED_CHECK_IDS.length);
      expect(n).toBe(report.checks.length);
    }
    expect(REQUIRED_CHECK_IDS.length).toBeGreaterThan(1); // the pin is not vacuous
  });
});
