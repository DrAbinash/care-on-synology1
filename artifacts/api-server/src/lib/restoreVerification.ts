/**
 * restoreVerification.ts — Ticket BEND-1 Phase 8: PROOF that a backup
 * restores. A "success" in backup_job_logs only ever attested that a dump
 * file was produced; this workflow proves the dump actually restores:
 *
 *   dump exists → size > 0 → sha256 recorded → gzip/decrypt integrity →
 *   restore into a THROWAWAY database → core radiology tables exist →
 *   row counts match the source → signed structured reports survive the
 *   jsonb round-trip AND their content hashes still verify → amendment
 *   chains stay linear → audit-chain linkage verifies → throwaway dropped.
 *
 * NEVER touches production data: it only CREATEs/DROPs `restore_verify_*`
 * databases and reads the source. Results persist to radiology_ops_checks so
 * health reports the latest restore proof. Runs as an admin-triggered durable
 * job (or the standalone script wrapper) — never automatically over anything.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { db } from "@workspace/db";
import { radiologyOpsChecksTable } from "@workspace/db/schema";
import { sql } from "drizzle-orm";
import { verifyChainRows } from "./audit";
import { decryptBackupToSql } from "./backupCrypto";
import { verifyContentSha256 } from "./structuredReport/hash";
import type { StructuredReportDocument } from "./structuredReport/types";

export interface RestoreVerificationStep {
  name: string;
  ok: boolean;
  detail: string;
}

export interface RestoreVerificationResult {
  ok: boolean;
  steps: RestoreVerificationStep[];
  throwawayDb: string | null;
  ranAt: string;
  durationMs: number;
}

const CORE_TABLES = [
  "patient_reports",
  "radiology_report_drafts",
  "patient_report_amendments",
  "report_finding_instances",
  "radiology_worklist",
  "audit_logs",
  "radiology_redelivery_obligations",
];

function run(cmd: string, args: string[], opts: { env?: NodeJS.ProcessEnv; stdin?: string } = {}):
  Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env: opts.env ?? process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => { stdout += c; });
    child.stderr.on("data", (c) => { stderr += c; });
    child.on("error", (err) => resolve({ code: 127, stdout, stderr: String(err) }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    if (opts.stdin != null) { child.stdin.write(opts.stdin); }
    child.stdin.end();
  });
}

function dbUrlParts(): { host: string; port: string; user: string; password: string; database: string } {
  const url = new URL(process.env.DATABASE_URL ?? "");
  return {
    host: url.hostname,
    port: url.port || "5432",
    user: url.username,
    password: url.password,
    database: url.pathname.replace(/^\//, ""),
  };
}

async function sha256File(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath);
  return createHash("sha256").update(buf).digest("hex");
}

/** Pure evaluation of the file-level preconditions (unit-tested). */
export function evaluateBackupFile(stats: { exists: boolean; sizeBytes: number }): RestoreVerificationStep[] {
  return [
    {
      name: "backup_file_exists",
      ok: stats.exists,
      detail: stats.exists ? "backup file present" : "backup file MISSING",
    },
    {
      name: "backup_file_nonempty",
      ok: stats.exists && stats.sizeBytes > 0,
      detail: stats.exists ? `${stats.sizeBytes} bytes` : "n/a",
    },
  ];
}

export async function runRestoreVerification(
  opts: { backupPath?: string; ranBy?: string } = {},
): Promise<RestoreVerificationResult> {
  const startedAt = Date.now();
  const steps: RestoreVerificationStep[] = [];
  const parts = dbUrlParts();
  const throwawayDb = `restore_verify_${Date.now()}`;
  const tempFiles: string[] = [];
  let sqlPath: string | null = null;
  let throwawayCreated = false;
  let restoredPool: Pool | null = null;

  const step = (name: string, ok: boolean, detail: string) => {
    steps.push({ name, ok, detail: detail.slice(0, 500) });
    return ok;
  };

  try {
    // 0. Obtain a dump (given path, or a fresh one from the OFFICIAL pg_dump
    // recipe used by the internal-backup endpoint).
    let backupPath = opts.backupPath ?? null;
    if (!backupPath) {
      const fresh = path.join(process.env.BACKUP_TEMP_DIR || os.tmpdir(), `restore_verify_${Date.now()}.sql`);
      const dump = await run("pg_dump", [
        "--host", parts.host, "--port", parts.port, "--username", parts.user,
        "--dbname", parts.database, "--no-owner", "--no-privileges", "--clean", "--if-exists",
        "--file", fresh,
      ], { env: { ...process.env, PGPASSWORD: parts.password } });
      tempFiles.push(fresh);
      if (!step("dump_created", dump.code === 0, dump.code === 0 ? fresh : dump.stderr)) {
        return finish(false);
      }
      backupPath = fresh;
    }

    // 1-2. Exists + non-empty.
    const stat = await fs.stat(backupPath).catch(() => null);
    for (const s of evaluateBackupFile({ exists: !!stat, sizeBytes: stat?.size ?? 0 })) {
      steps.push(s);
      if (!s.ok) return finish(false);
    }

    // 3. Checksum recorded (proof of WHAT was verified).
    step("checksum", true, `sha256:${await sha256File(backupPath)}`);

    // 4. Decrypt / decompress where configured.
    //
    // Delegated to lib/backupCrypto so this proof covers EVERY artifact the
    // product has written. The previous inline openssl call only understood
    // `openssl -aes-256-cbc + BACKUP_PASSPHRASE`, so it could not open the
    // scheduler's own backups (AES-256-GCM keyed on SESSION_SECRET) and would
    // fail the whole verification on a file that was, in fact, a valid backup.
    // decryptBackupToSql tries both passphrases and both container formats.
    sqlPath = backupPath;
    if (!backupPath.endsWith(".gz")) {
      try {
        const dec = await decryptBackupToSql(backupPath, process.env.BACKUP_TEMP_DIR || os.tmpdir());
        if (dec.producedTempFile) tempFiles.push(dec.sqlPath);
        sqlPath = dec.sqlPath;
        step("decrypt", true, dec.format === "plaintext" ? "not encrypted" : `decrypted (${dec.format}, key=${dec.keySource})`);
      } catch (err) {
        return finish(step("decrypt", false, err instanceof Error ? err.message : String(err)) && false);
      }
    }
    if (sqlPath.endsWith(".gz")) {
      const integrity = await run("gzip", ["-t", sqlPath]);
      if (!step("gzip_integrity", integrity.code === 0, integrity.code === 0 ? "gzip -t OK" : integrity.stderr)) return finish(false);
      const out = sqlPath.replace(/\.gz$/, "") + `.${Date.now()}.sql`;
      const gunzip = await run("bash", ["-c", `gunzip -c ${JSON.stringify(sqlPath)} > ${JSON.stringify(out)}`]);
      tempFiles.push(out);
      if (!step("decompress", gunzip.code === 0, gunzip.code === 0 ? "decompressed" : gunzip.stderr)) return finish(false);
      sqlPath = out;
    }

    // 5. Restore into a THROWAWAY database.
    try {
      await db.execute(sql.raw(`CREATE DATABASE ${throwawayDb}`));
      throwawayCreated = true;
      step("throwaway_created", true, throwawayDb);
    } catch (err) {
      return finish(step("throwaway_created", false, `CREATE DATABASE failed (needs CREATEDB): ${err instanceof Error ? err.message : String(err)}`) && false);
    }
    const restore = await run("psql", [
      "--host", parts.host, "--port", parts.port, "--username", parts.user,
      "--dbname", throwawayDb, "--file", sqlPath, "--quiet",
    ], { env: { ...process.env, PGPASSWORD: parts.password } });
    if (!step("psql_restore", restore.code === 0, restore.code === 0 ? "restored" : restore.stderr.slice(-400))) return finish(false);

    // 6+. Checks inside the restored database.
    restoredPool = new Pool({
      host: parts.host, port: Number(parts.port), user: parts.user,
      password: parts.password, database: throwawayDb, max: 2,
    });

    const missing: string[] = [];
    for (const table of CORE_TABLES) {
      const r = await restoredPool.query("SELECT to_regclass($1) AS t", [`public.${table}`]);
      if (!r.rows[0]?.t) missing.push(table);
    }
    if (!step("core_tables_exist", missing.length === 0, missing.length ? `missing: ${missing.join(", ")}` : `${CORE_TABLES.length} tables present`)) return finish(false);

    // Row-count sanity vs the SOURCE database.
    const mismatches: string[] = [];
    for (const table of CORE_TABLES) {
      const src = await db.execute(sql.raw(`SELECT count(*)::int AS c FROM ${table}`));
      const dst = await restoredPool.query(`SELECT count(*)::int AS c FROM ${table}`);
      const srcCount = Number((src.rows[0] as { c: number }).c);
      const dstCount = Number(dst.rows[0].c);
      if (dstCount < srcCount) mismatches.push(`${table}: restored ${dstCount} < source ${srcCount}`);
    }
    if (!step("row_count_sanity", mismatches.length === 0, mismatches.length ? mismatches.join("; ") : "restored counts cover the source")) return finish(false);

    // Signed structured reports: jsonb round-trip + content hash verify.
    const signed = await restoredPool.query(
      "SELECT id, structured_json FROM patient_reports WHERE structured_json IS NOT NULL AND type = 'radiology' ORDER BY id",
    );
    const hashFailures: number[] = [];
    for (const row of signed.rows) {
      try {
        const verdict = verifyContentSha256(row.structured_json as StructuredReportDocument);
        if (!verdict.ok) hashFailures.push(Number(row.id));
      } catch {
        hashFailures.push(Number(row.id));
      }
    }
    if (!step("structured_hashes_verify", hashFailures.length === 0,
      hashFailures.length ? `hash FAILED after restore for reports ${hashFailures.slice(0, 10).join(",")}` : `${signed.rows.length} signed documents verified`)) return finish(false);

    // Amendment chains stay linear (self-cycles / forks / merges / dangling).
    const chainBad = await restoredPool.query(`
      SELECT count(*)::int AS c FROM patient_report_amendments a
      WHERE a.original_report_id = a.amended_report_id
         OR EXISTS (SELECT 1 FROM patient_report_amendments b WHERE b.id <> a.id AND (b.original_report_id = a.original_report_id OR b.amended_report_id = a.amended_report_id))
         OR NOT EXISTS (SELECT 1 FROM patient_reports p WHERE p.id = a.original_report_id)
         OR NOT EXISTS (SELECT 1 FROM patient_reports p WHERE p.id = a.amended_report_id)`);
    if (!step("amendment_chains_valid", Number(chainBad.rows[0].c) === 0,
      Number(chainBad.rows[0].c) === 0 ? "chains linear + endpoints resolve" : `${chainBad.rows[0].c} corrupt linkage rows`)) return finish(false);

    // Audit-chain linkage on the RESTORED data.
    const auditRows = await restoredPool.query("SELECT id, previous_hash, chain_hash FROM audit_logs ORDER BY id ASC");
    const audit = verifyChainRows(auditRows.rows.map((r) => ({ id: Number(r.id), previousHash: r.previous_hash, chainHash: r.chain_hash })));
    if (!step("audit_chain_verifies", audit.ok, audit.ok ? `${audit.checked} rows linked` : `${audit.reason} (first broken id ${audit.firstBrokenId})`)) return finish(false);

    return finish(true);
  } catch (err) {
    step("unexpected_error", false, err instanceof Error ? err.message : String(err));
    return finish(false);
  }

  async function finish(ok: boolean): Promise<RestoreVerificationResult> {
    if (restoredPool) await restoredPool.end().catch(() => undefined);
    if (throwawayCreated) {
      await db.execute(sql.raw(`DROP DATABASE IF EXISTS ${throwawayDb} WITH (FORCE)`)).then(
        () => steps.push({ name: "throwaway_dropped", ok: true, detail: throwawayDb }),
        (err) => steps.push({ name: "throwaway_dropped", ok: false, detail: String(err) }),
      );
    }
    for (const f of tempFiles) await fs.unlink(f).catch(() => undefined);
    const result: RestoreVerificationResult = {
      ok: ok && steps.every((s) => s.ok),
      steps,
      throwawayDb: throwawayCreated ? throwawayDb : null,
      ranAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
    };
    await db.insert(radiologyOpsChecksTable).values({
      checkName: "restore_verification",
      status: result.ok ? "pass" : "fail",
      ranBy: opts.ranBy ?? "system",
      detail: { steps: result.steps, throwawayDb: result.throwawayDb, durationMs: result.durationMs },
    }).catch(() => undefined);
    return result;
  }
}
