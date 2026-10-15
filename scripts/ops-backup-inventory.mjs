#!/usr/bin/env node
/**
 * ops-backup-inventory.mjs — read-only ERP backup inventory (§9 / I12-D).
 * ============================================================================
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT A SECOND GATE
 *   `ops-preflight.mjs` asks one backup question: is there a recent, complete,
 *   correctly-attributed artifact to deploy against. That answer looks at the
 *   NEWEST file and stops. An operator deciding a retention change, or asking
 *   whether Tuesday is still recoverable, needs the opposite shape — every
 *   artifact that exists, what its sidecar claims, what has actually been proved,
 *   and where the holes are. This produces that list and reaches no verdict, so
 *   the two tools cannot drift into disagreeing about what "ready" means.
 *
 * READ-ONLY, STRICTLY
 *   It reads a directory and its `.meta` sidecars. It takes no backup, restores
 *   nothing, deletes nothing, changes no DSM task, and prints no credential. The
 *   only database access is the recorded-restore query, and only when
 *   DATABASE_URL is set — the same read-only path the gate already uses.
 *
 * THE FOUR STATES, KEPT APART ON PURPOSE
 *   An artifact existing, a manifest being present, a checksum being recorded,
 *   and a restore being proved are four different facts, and the clinic's old
 *   tooling reported the first as if it were the fourth. Every row therefore says
 *   which of the four are actually established:
 *
 *     present     a restorable-looking file is on disk
 *     manifest    its sidecar names the database it came from (audited, not just read)
 *     checksum    `recorded` = the sidecar carries a digest; `verified` = THIS tool
 *                 recomputed it over the bytes and it matched. Recorded is never
 *                 promoted to verified, because an un-recomputed digest is a claim.
 *     restored    a restore of THIS artifact is recorded (evidence file, or the
 *                 backup_verification table when a database is reachable)
 *
 * WHAT IT PRINTS
 *   This output is pasted into tickets and handovers, so it is treated as a publishable
 *   document. Manifest fields leave through `sanitizeManifest`: the audited allowlist only,
 *   with any value shaped like a credential redacted — and a value redacted in the manifest
 *   is redacted in the problem lines too, because quoting the bad value is how a tool ends
 *   up printing it. Names leave through `reportName`: the names the backup job writes
 *   (`caredeoghar_*`, `backup_*`, `care_db_daily_*`) are printed in full, because the
 *   operator has to ask for one by name, and anything else is reported by kind, because a
 *   hand-typed name in a backup directory can carry a patient identifier. Auditing always
 *   uses the real bytes and the real name — masking happens only at the point of printing.
 *
 * DICOM IS OUT OF SCOPE BY OWNER DECISION
 *   I12 §2 excludes Orthanc/DICOM image backup from ERP disaster recovery. This
 *   inventory watches the ERP dump destination and nothing else; it does not
 *   report images, skip them, or imply they are protected.
 *
 * USAGE
 *   node scripts/ops-backup-inventory.mjs                 # operator-readable
 *   node scripts/ops-backup-inventory.mjs --json          # for a script or ticket
 *   node scripts/ops-backup-inventory.mjs --verify-checksums
 *   BACKUP_DIR=/volume1/backup/care-erp/db node scripts/ops-backup-inventory.mjs
 *
 * EXIT CODE
 *   0 an inventory was produced (including one that shows problems — that is
 *     still an inventory) · 2 no backup directory could be read at all, which is
 *     a finding about the box, not a pass.
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  EVIDENCE_FILE,
  auditSidecar,
  backupRoots,
  credentialShaped,
  evidenceAgeOk,
  isArtifact,
  makeContext,
  parseSidecar,
  readEvidence,
  showValue,
} from "./ops-preflight.mjs";

const DAY_MS = 86_400_000;

/** A real calendar day in the narrow band a backup can plausibly carry. */
export function isPlausibleDay(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text ?? ""));
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  // Round-trip rejects 2026-02-31, month 13, day 40 — the digits that an
  // unvalidated regex happily turns into a coverage day.
  return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d;
}

/**
 * The UTC day an artifact belongs to, from its own record first: the sidecar, then
 * the name, then the modification time — and WHICH of those answered is returned,
 * because a coverage span built from mtimes describes when files were copied, not
 * when the clinic was backed up. A restored or rsynced tree has fresh mtimes on
 * every file in it.
 *
 * The name patterns are the ones actually present on the clinic box, measured
 * 2026-10-15 in `/volume1/backup/care-erp/db`, `/volume1/docker/backups/*`:
 *   backup_DB_2026-10-15T09-31-02-967Z.sql.enc   (ISO date, then -separated time)
 *   caredeoghar_20261015_023000.sql.gz           (compact, this is what the old
 *                                                  parser matched — and nothing else)
 *   care_erp_2026-10-15_02-15.dump               (dated subdirectory job)
 *   care_db_daily_2026-10-15.sql.gz              (day only, dashed)
 * A bare run of eight digits is no longer trusted: `backup_1762394400.sql` is a
 * unix timestamp and used to become the day 1762-39-44, which then poisoned the
 * oldest/newest span and reported months of missing backups.
 */
export function artifactDay(a, meta) {
  const fromMeta = String(meta?.created_utc || "").slice(0, 10);
  if (isPlausibleDay(fromMeta)) return { day: fromMeta, source: "sidecar" };

  const name = String(a?.name ?? "");
  const dashed = name.match(/(2\d{3})-(\d{2})-(\d{2})/);
  if (dashed && isPlausibleDay(`${dashed[1]}-${dashed[2]}-${dashed[3]}`)) {
    return { day: `${dashed[1]}-${dashed[2]}-${dashed[3]}`, source: "name" };
  }
  const compact = name.match(/(2\d{3})(\d{2})(\d{2})/);
  if (compact && isPlausibleDay(`${compact[1]}-${compact[2]}-${compact[3]}`)) {
    return { day: `${compact[1]}-${compact[2]}-${compact[3]}`, source: "name" };
  }

  return { day: String(a?.mtimeIso || "").slice(0, 10), source: "mtime" };
}

/**
 * Sort the destination into artifacts, sidecars, interrupted writes and anything
 * else, and pair each artifact with its sidecar. An orphan `.meta` is reported:
 * a manifest whose dump was deleted is how a retention bug shows up late.
 */
export function classify(ctx, roots) {
  const files = [];
  const subdirs = [];
  const rootsSeen = [];
  for (const root of roots) {
    const entries = ctx.listDir(root);
    rootsSeen.push({ root, readable: entries !== null });
    if (entries === null) continue;
    for (const name of entries.slice().sort()) {
      const st = ctx.stat(path.join(root, name));
      if (!st) continue;
      // A dated subdirectory would otherwise read as "no artifacts", which is a
      // false alarm about a box whose job simply organises its output. Reported
      // instead, so the operator sees what was not looked inside.
      if (st.isDirectory()) { subdirs.push(path.join(root, name)); continue; }
      files.push({ root, name, file: path.join(root, name), bytes: st.size, mtimeMs: st.mtimeMs });
    }
  }
  const artifacts = files.filter((f) => isArtifact(f.name));
  const sidecars = files.filter((f) => f.name.endsWith(".meta"));
  const partials = files.filter((f) => f.name.endsWith(".partial"));
  const other = files.filter((f) => !isArtifact(f.name) && !f.name.endsWith(".meta") && !f.name.endsWith(".partial"));
  const byName = new Map(sidecars.map((s) => [s.name.slice(0, -".meta".length), s]));
  const artifactNames = new Set(artifacts.map((a) => a.name));
  return {
    roots: rootsSeen,
    anyRootReadable: rootsSeen.some((r) => r.readable),
    artifacts,
    partials,
    other,
    subdirs,
    orphanSidecars: sidecars.filter((s) => !artifactNames.has(s.name.slice(0, -".meta".length))),
    sidecarFor: (name) => byName.get(name) ?? null,
  };
}

/** sha256 of a file, streamed: a 600 MB dump must not be loaded into memory. */
export function sha256Of(file) {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(file)
      .on("error", reject)
      .on("data", (c) => h.update(c))
      .on("end", () => resolve(h.digest("hex")));
  });
}

/**
 * A file whose name does not follow the dump convention is reported by its kind, not by
 * its name. Job-generated names are printed in full because the operator has to pick one
 * to restore — and they are exactly the names `isArtifact` accepts, which the output
 * contract test pins, because a job pattern missing here would hide a real backup.
 * A name someone typed by hand can carry a patient identifier, and this report gets
 * pasted into tickets.
 */
const CONVENTION_NAME = /^(caredeoghar|backup|care_db_daily)[._-]/i;
export function reportName(name) {
  const base = String(name ?? "").split(/[\\/]/).pop();
  if (CONVENTION_NAME.test(base)) return base;
  const dot = base.indexOf(".");
  return `<unrecognised-name${dot > 0 ? base.slice(dot) : ""}>`;
}

/**
 * The keys a `.meta` sidecar is allowed to contribute to the output. A manifest is
 * machine-written by the backup job, and an operator who once added `passphrase=` or a
 * connection string to it would otherwise have every `--json` run reprint it — this tool
 * is routinely pasted into tickets and handovers. Anything outside the allowlist is
 * replaced by a count, so the row still says "this sidecar has extra fields" without
 * saying what they hold. Values are shape-checked too, because a legitimate key can
 * carry a credential in it.
 */
const MANIFEST_FIELDS = [
  "artifact", "created_utc", "source_container", "source_database", "server_version",
  "exporter", "schema_complete", "create_tables", "encrypted", "bytes",
  "sha256_sql_gzipped", "sha256_artifact",
];
const SECRET_KEY = /(passphrase|password|secret|token|apikey|api_key|credential|connection|uri|url|key)$/i;

export function sanitizeManifest(meta) {
  const out = {};
  let hidden = 0;
  for (const [k, v] of Object.entries(meta ?? {})) {
    if (!MANIFEST_FIELDS.includes(k)) { hidden++; continue; }
    out[k] = SECRET_KEY.test(k) || credentialShaped(v) ? "[redacted]" : v;
  }
  if (hidden) out.redacted_fields = hidden;
  return out;
}

/**
 * One row per artifact. `status` is the worst state that applies, because an
 * inventory that prints "looks fine" next to a file whose sidecar names the wrong
 * database is the exact failure this round exists to remove.
 */
export async function inspect(ctx, roots, opts = {}) {
  const inv = classify(ctx, roots);
  const now = ctx.now();
  const expectedDatabase = (ctx.env.DB_NAME || ctx.env.EXPECTED_DB_NAME || "diagnostic_erp").trim();
  const maxAgeH = Number(ctx.env.PREFLIGHT_MAX_BACKUP_AGE_HOURS || ctx.env.BACKUP_DEADMAN_MAX_AGE_HOURS || 26);

  const evidence = readEvidence(ctx);
  const recordedRestore = evidence.data?.restore_verification ?? null;
  // null means "not read", [] means "read and empty". Collapsing them would let a
  // box with no database claim the table holds nothing, which is a different claim.
  const dbRows = opts.restoreRows === undefined ? null : opts.restoreRows;

  const provenByName = new Map();
  for (const r of dbRows ?? []) {
    if (r?.artifact && (r.status ?? r.result ?? "").toString().toUpperCase() === "PASSED") provenByName.set(r.artifact, r);
  }

  const rows = [];
  for (const a of inv.artifacts) {
    const sidecar = inv.sidecarFor(a.name);
    const mtimeIso = new Date(a.mtimeMs).toISOString();
    const row = {
      artifact: a.name,
      path: a.file,
      bytes: a.bytes,
      mtimeIso,
      ageHours: Number((((now - a.mtimeMs) / 3.6e6)).toFixed(1)),
      day: mtimeIso.slice(0, 10),
      daySource: "mtime",
      manifest: null,
      problems: [],
      checksum: "absent",
      recordedSha: null,
      verifiedSha: null,
      restored: "unproven",
      restoredAt: null,
      status: "OK",
    };

    if (!sidecar) {
      // An absent sidecar is UNKNOWN about the artifact's identity, not a
      // condemnation of the bytes: pre-#1004 dumps have no sidecar at all and may
      // still restore. UNVERIFIED says "nothing here proves what database this is".
      row.problems.push("no .meta sidecar: source database, completeness and checksum are unrecorded");
      row.status = "UNVERIFIED";
    } else {
      const text = ctx.readFile(sidecar.file);
      if (text === null) {
        row.problems.push(`${sidecar.name} is listed but unreadable`);
        row.status = "UNVERIFIED";
      } else {
        const meta = parseSidecar(text);
        // Audited raw, emitted sanitized: a credential in the sidecar must not survive into
        // the report, but it must still be checked where it matters (`sha256_artifact`
        // format, `bytes` against the real file, `source_database` against this host).
        row.manifest = sanitizeManifest(meta);
        row.recordedSha = meta.sha256_artifact ?? null;
        row.checksum = meta.sha256_artifact ? "recorded" : "absent";
        row.problems.push(...auditSidecar(meta, { actualBytes: a.bytes, expectedDatabase }));
        row.status = row.problems.length ? "INVALID" : "OK";
      }
    }

    const dated = artifactDay(a, row.manifest);
    row.day = dated.day;
    row.daySource = dated.source;
    // An empty file is the worst kind of green: the job exits 0, the log says
    // success, the file exists with today's name, and there is nothing in it.
    // Measured 2026-10-15 in /volume1/docker/backups/postgres/care — 20 of 62 dumps
    // are 0 bytes, including six consecutive nights.
    if (a.bytes === 0) {
      row.problems.push("0 bytes — the dump produced nothing; this artifact cannot restore");
      row.status = "INVALID";
    }
    // A file dated ahead of the clock is not a cosmetic problem: the retention
    // pass is `find -mtime +N -delete`, so a future mtime makes that artifact
    // invisible to its own cleanup, and an age computed against it goes negative.
    if (a.mtimeMs > now + 60_000) {
      row.problems.push(`mtime ${((a.mtimeMs - now) / 3.6e6).toFixed(1)}h in the future — \`find -mtime\` retention cannot see this file`);
      row.status = "INVALID";
    }

    // "Restored" means someone proved it, for THIS artifact. The recorded
    // operator entry names one file; the table names one file per row.
    if (recordedRestore?.artifact === a.name && recordedRestore.passed === true) {
      const age = evidenceAgeOk(recordedRestore.verified_at, now);
      row.restored = age.ok ? "recorded" : "stale-record";
      row.restoredAt = recordedRestore.verified_at ?? null;
      if (!age.ok) row.problems.push(`restore proof is ${age.days.toFixed(0)}d old — re-prove it`);
    } else if (provenByName.has(a.name)) {
      row.restored = "in-database";
      row.restoredAt = provenByName.get(a.name).verified_at ?? provenByName.get(a.name).created_at ?? null;
    }
    if (row.restored === "stale-record" && row.status === "OK") row.status = "STALE";
    rows.push(row);
  }

  // Freshness is a property of the NEWEST artifact only. Retention deliberately
  // keeps older ones, so flagging every file past the limit would turn a healthy
  // week of daily dumps into seven problems and bury the one that matters.
  rows.sort((x, y) => (x.mtimeIso < y.mtimeIso ? 1 : -1));
  if (rows.length && rows[0].ageHours > maxAgeH && rows[0].status === "OK") {
    rows[0].problems.push(`${rows[0].ageHours}h old, past the ${maxAgeH}h freshness limit`);
    rows[0].status = "STALE";
  }

  if (opts.verifyChecksums) {
    for (const row of rows) {
      if (row.checksum !== "recorded") continue;
      row.verifiedSha = await sha256Of(row.path);
      if (row.verifiedSha === row.recordedSha) {
        row.checksum = "verified";
      } else {
        row.checksum = "MISMATCH";
        row.problems.push(`sha256 mismatch: sidecar says ${showValue(row.recordedSha)}, the bytes are ${row.verifiedSha}`);
        row.status = "INVALID";
      }
    }
  }

  rows.sort((x, y) => (x.mtimeIso < y.mtimeIso ? 1 : -1));

  // Day coverage. A directory can be full of Tuesday's four attempts and have
  // nothing from Monday, which an "N artifacts" count hides completely.
  const restorableRows = rows.filter((r) => r.bytes > 0);
  const days = [...new Set(restorableRows.map((r) => r.day))].sort();
  const coverage = days.length ? coverageGaps(days, now) : null;

  const counts = rows.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
  const recorded = rowOrNull(recordedRestore);
  const restoreEvidence = {
    // The recorded name came from an operator typing `--artifact`, not from the job, so it
    // goes through the same mask as everything else that leaves this tool.
    recorded: recorded ? { ...recorded, artifact: reportName(recorded.artifact) } : null,
    databaseRows: dbRows === null ? null : dbRows.length,
    note: opts.restoreRowsNote ?? (dbRows === null ? "not read (no DATABASE_URL)" : "backup_verification read"),
    evidenceError: evidence.error ?? null,
  };

  return {
    generatedAt: new Date(now).toISOString(),
    roots: inv.roots,
    anyRootReadable: inv.anyRootReadable,
    expectedDatabase,
    maxAgeHours: maxAgeH,
    artifacts: rows,
    counts,
    interrupted: inv.partials.map((p) => ({ artifact: reportName(p.name), bytes: p.bytes, mtimeIso: new Date(p.mtimeMs).toISOString() })),
    orphanSidecars: inv.orphanSidecars.map((s) => reportName(s.name)),
    subdirectories: inv.subdirs,
    unwatched: inv.other.map((f) => reportName(f.name)),
    days,
    coverage,
    restoreEvidence,
    checksums: opts.verifyChecksums ? "recomputed here" : "not recomputed (pass --verify-checksums to prove them)",
    evidenceFile: evidence.present ? EVIDENCE_FILE : `${EVIDENCE_FILE} not present`,
  };
}

function rowOrNull(r) {
  return r && typeof r === "object" ? r : null;
}

/** Missing UTC days between the oldest and newest artifact, inclusive. */
export function coverageGaps(days, now) {
  const set = new Set(days);
  const oldest = days[0];
  const newest = days[days.length - 1];
  const missing = [];
  let cursor = Date.parse(`${oldest}T00:00:00.000Z`);
  const end = Date.parse(`${newest}T00:00:00.000Z`);
  let guard = 0;
  while (cursor <= end && guard++ < 3650) {
    const key = new Date(cursor).toISOString().slice(0, 10);
    if (!set.has(key)) missing.push(key);
    cursor += DAY_MS;
  }
  const today = new Date(now).toISOString().slice(0, 10);
  return { oldest, newest, distinctDays: days.length, missing, missingToday: !set.has(today) };
}

export function render(inv) {
  const lines = [];
  lines.push(`ERP backup inventory — ${inv.generatedAt}`);
  lines.push(`searched: ${inv.roots.map((r) => `${r.root}${r.readable ? "" : " (not readable)"}`).join(", ")}`);
  lines.push(`expected database: ${inv.expectedDatabase} · freshness limit: ${inv.maxAgeHours}h · checksums: ${inv.checksums}`);
  lines.push("");
  if (!inv.artifacts.length) {
    lines.push(inv.anyRootReadable
      ? "No restorable artifact in the directory. A directory that exists and holds nothing is the finding."
      : "No backup directory could be read from here. That is UNKNOWN about the backups, not evidence that there are none — run this on the NAS, or set BACKUP_DIR.");
  } else {
    const head = ["artifact", "size", "age", "source_database", "tables", "manifest", "checksum", "restored", "status"];
    const w = [40, 9, 7, 17, 7, 10, 9, 12, 10];
    lines.push(head.map((h, i) => h.padEnd(w[i])).join(" "));
    for (const r of inv.artifacts) {
      lines.push([
        r.artifact.slice(0, 40),
        r.bytes < 1024 * 1024 ? `${(r.bytes / 1024).toFixed(0)}K` : `${(r.bytes / 1024 / 1024).toFixed(1)}M`,
        r.ageHours < 0 ? `${(-r.ageHours).toFixed(1)}h AHEAD` : `${r.ageHours}h`,
        (r.manifest?.source_database ?? "-"),
        (r.manifest?.create_tables ?? "-"),
        r.manifest ? "yes" : "NO",
        r.checksum,
        r.restored,
        r.status,
      ].map((c, i) => String(c).padEnd(w[i])).join(" "));
      for (const p of r.problems) lines.push(`    ! ${p}`);
    }
  }
  lines.push("");
  const c = inv.counts;
  lines.push(`counts: ${Object.entries(c).map(([k, v]) => `${k} ${v}`).join(", ") || "no artifacts"}`
    + ` · interrupted .partial: ${inv.interrupted.length}`
    + ` · orphan .meta: ${inv.orphanSidecars.length}`);
  if (inv.interrupted.length) {
    lines.push("  A .partial left behind means a job died mid-write. It is not a backup and must never be restored from.");
    for (const p of inv.interrupted) lines.push(`    ${p.artifact} (${(p.bytes / 1024 / 1024).toFixed(1)}M, ${p.mtimeIso})`);
  }
  if (inv.orphanSidecars.length) {
    lines.push("  A .meta whose artifact is gone means the dump was removed without its manifest — check what deleted it before trusting retention.");
    for (const o of inv.orphanSidecars) lines.push(`    ${o}`);
  }
  if (inv.unwatched.length) lines.push(`  ${inv.unwatched.length} file(s) here are not recognized as backups: ${inv.unwatched.slice(0, 6).join(", ")}${inv.unwatched.length > 6 ? " …" : ""}`);
  if (inv.subdirectories.length) {
    lines.push(`  ${inv.subdirectories.length} subdirector(ies) were NOT searched (this inventory reads one level): ${inv.subdirectories.slice(0, 4).join(", ")}${inv.subdirectories.length > 4 ? " …" : ""}`);
    lines.push("  If the job files dumps into dated folders, BACKUP_DIR must point at them — otherwise this list says \"no artifacts\" about backups that exist.");
  }
  if (inv.coverage) {
    const bySource = inv.artifacts.reduce((acc, r) => {
      acc[r.daySource ?? "mtime"] = (acc[r.daySource ?? "mtime"] || 0) + 1;
      return acc;
    }, {});
    const empties = inv.artifacts.filter((r) => r.bytes === 0).length;
    lines.push(`coverage: ${inv.coverage.distinctDays} distinct day(s) from ${inv.coverage.oldest} to ${inv.coverage.newest}`
      + ` — dated by sidecar=${bySource.sidecar || 0}, name=${bySource.name || 0}, mtime=${bySource.mtime || 0}`
      + (empties ? `, and ${empties} zero-byte artifact(s) excluded from it` : ""));
    if (bySource.mtime) {
      lines.push("  mtime-dated artifact(s): their own name and sidecar carried no date, so the day this tool reports is when the FILE was written — a copied or restored tree reports its copy date, not the backup's.");
    }
    if (empties) lines.push("  zero-byte artifact(s) cannot restore, so they are listed with their status and never counted as a day of coverage.");
    if (inv.coverage.missing.length) {
      lines.push(`  MISSING ${inv.coverage.missing.length} day(s) in that span: ${inv.coverage.missing.slice(0, 14).join(", ")}${inv.coverage.missing.length > 14 ? " …" : ""}`);
      lines.push("  A gap means no artifact for that date, so nothing from it is recoverable. A directory full of one day's retries looks healthy by count and is not.");
    } else lines.push("  no missing day inside that span");
    if (inv.coverage.missingToday) lines.push("  nothing dated today — the daily job has not produced anything yet");
  }
  lines.push(`restore evidence: ${inv.restoreEvidence.recorded ? `recorded for ${inv.restoreEvidence.recorded.artifact}` : "none recorded"}; backup_verification: ${inv.restoreEvidence.databaseRows === null ? inv.restoreEvidence.note : `${inv.restoreEvidence.databaseRows} row(s)`} (${inv.evidenceFile})`);
  // Only say it when there is something to say it about. With no readable
  // destination the honest line is the one above ("UNKNOWN about the backups");
  // "no artifact has a proven restore" would claim knowledge of a directory this
  // tool was not allowed to see.
  if (inv.artifacts.length && !inv.artifacts.some((r) => r.restored !== "unproven")) {
    lines.push("  NO artifact in this inventory has a proven restore. That is the honest state of this box, and it is the one a backup count cannot show.");
  }
  return lines.join("\n");
}

/**
 * `backup_verification` is the table #1005's verifier writes when a restore is
 * actually proven on the box. Reading it is what makes "restored" mean THIS
 * artifact rather than some artifact. With no DATABASE_URL the result is `null`
 * and the inventory says the table was not read — which is not the same claim as
 * it being empty, and the distinction is the whole point of this tool.
 */
export function restoreRows(ctx) {
  const url = (ctx.env.DATABASE_URL || "").trim();
  if (!url) return { rows: null, note: "DATABASE_URL not set: backup_verification was not read" };
  const r = ctx.exec("psql", [url, "-Atc", "select artifact, verified_at, status from backup_verification order by verified_at desc limit 200"], { timeout: 20_000 });
  if (r.missing || r.code !== 0) {
    return { rows: null, note: `backup_verification could not be read (${(r.stderr || "").split(/\r?\n/)[0] || "no message"})` };
  }
  const rows = (r.stdout || "").split(/\r?\n/).filter((l) => l.includes("|")).map((l) => {
    const [artifact, verified_at, status] = l.split("|");
    return { artifact, verified_at, status };
  });
  return { rows, note: `${rows.length} row(s) read` };
}

export async function main(argv = process.argv.slice(2), options = {}) {
  const ctx = options.ctx ?? makeContext(options);
  const roots = options.roots ?? backupRoots(ctx.env);
  const queried = options.restoreRows === undefined ? restoreRows(ctx) : { rows: options.restoreRows, note: "supplied" };
  const inv = await inspect(ctx, roots, {
    verifyChecksums: argv.includes("--verify-checksums"),
    restoreRows: queried.rows,
    restoreRowsNote: queried.note,
  });
  if (argv.includes("--json")) process.stdout.write(JSON.stringify(inv, null, 2) + "\n");
  else process.stdout.write(render(inv) + "\n");
  return inv.anyRootReadable ? 0 : 2;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) main().then((code) => process.exit(code));
