/**
 * phase-f-template-consolidation.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * PHASE F (Radiology V2): copy templates from the FOUR legacy template
 * systems into the winner system, radiology_master_templates.
 *
 * ⚠️  DO NOT RUN AUTOMATICALLY. Owner reviews the ASSESS output first.
 *
 * DESIGN (same discipline as the payment-uniqueness migration):
 *   • ADDITIVE ONLY — source tables are NEVER modified or deleted.
 *   • Copied rows land in dedicated groups so rollback is one DELETE:
 *       MIGRATED_REPORT_TEMPLATES        ← report_templates (radiology rows)
 *       MIGRATED_STRUCTURED_TEMPLATES    ← structured_report_templates
 *       MIGRATED_RADIOLOGY_STRUCTURED    ← radiology_structured_templates
 *       MIGRATED_AI_NORMAL_TEMPLATES     ← ai_normal_report_templates
 *   • Duplicate-safe: (group_name, template_name) unique index respected;
 *     existing rows are skipped, re-running is harmless (idempotent).
 *   • No schema change — reuses existing tables and columns only.
 *
 * USAGE — simplest path, run from the Synology (reuses the existing
 * care-migrate container — same DB connection, same rails, no new
 * infrastructure). DATABASE_URL comes from your .env automatically:
 *
 *   ASSESS (read-only, always do this first):
 *     docker compose run --rm care-migrate pnpm --filter @workspace/db run phase-f:assess
 *
 *   EXECUTE (after reviewing the assess output):
 *     docker compose run --rm care-migrate pnpm --filter @workspace/db run phase-f:execute
 *
 *   ROLLBACK (removes ONLY the copied rows; sources untouched):
 *     docker compose run --rm care-migrate pnpm --filter @workspace/db run phase-f:rollback
 *
 * Alternative (same effect, spelled out):
 *   pnpm --filter @workspace/db exec tsx scripts/phase-f-template-consolidation.ts assess|execute|rollback
 */

import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const rootEnv = path.resolve(here, "../../../.env");
if (existsSync(rootEnv)) dotenv.config({ path: rootEnv });

if (!process.env.DATABASE_URL) {
  const user = process.env.DB_USER ?? "erp";
  const pass = process.env.DB_PASSWORD ?? "changeme";
  const host = process.env.DB_HOST ?? "localhost";
  const port = process.env.DB_PORT ?? "5432";
  const db = process.env.DB_NAME ?? "diagnostic_erp";
  process.env.DATABASE_URL = `postgresql://${user}:${pass}@${host}:${port}/${db}`;
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const mode = (process.argv[2] || "assess").toLowerCase();

const GROUPS = [
  "MIGRATED_REPORT_TEMPLATES",
  "MIGRATED_STRUCTURED_TEMPLATES",
  "MIGRATED_RADIOLOGY_STRUCTURED",
  "MIGRATED_AI_NORMAL_TEMPLATES",
];

/** Radiology-ish modalities for filtering the generic report_templates table
 *  (LAB/ECG templates stay where they are — laboratory logic untouched). */
const RADIOLOGY_MODALITIES = `('USG','US','CT','MRI','MR','X-RAY','XRAY','XR','CR','DX','DOPPLER','MAMMOGRAPHY','MG','ECHO','RF')`;

async function q<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const r = await pool.query(sql, params);
  return r.rows as T[];
}

async function tableExists(name: string): Promise<boolean> {
  const r = await q<{ ok: boolean }>(
    `SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${name}`],
  );
  return !!r[0]?.ok;
}

// ── The four source → master mappings (pure SELECTs, reused by both modes) ──
// Every SELECT produces: template_name, modality, study_type, body_part,
// findings, impression, recommendations, tags(jsonb), created_by
const SOURCES: Array<{ group: string; table: string; select: string }> = [
  {
    group: "MIGRATED_REPORT_TEMPLATES",
    table: "report_templates",
    select: `
      SELECT
        name                                        AS template_name,
        COALESCE(NULLIF(UPPER(modality), ''), 'OT') AS modality,
        NULL                                        AS study_type,
        NULL                                        AS body_part,
        content                                     AS findings,
        ''                                          AS impression,
        NULL                                        AS recommendations,
        CASE WHEN tags IS NULL OR tags = '' THEN '[]'::jsonb
             ELSE to_jsonb(string_to_array(tags, ',')) END AS tags,
        'phase-f-migration'                         AS created_by
      FROM report_templates
      WHERE UPPER(COALESCE(modality, '')) IN ${RADIOLOGY_MODALITIES}`,
  },
  {
    group: "MIGRATED_STRUCTURED_TEMPLATES",
    table: "structured_report_templates",
    select: `
      SELECT
        template_name,
        UPPER(modality)                              AS modality,
        study_type,
        body_part,
        COALESCE(default_findings,
                 COALESCE(sections_json, ''))        AS findings,
        COALESCE(default_impression, '')             AS impression,
        NULL                                         AS recommendations,
        '[]'::jsonb                                  AS tags,
        'phase-f-migration'                          AS created_by
      FROM structured_report_templates`,
  },
  {
    group: "MIGRATED_RADIOLOGY_STRUCTURED",
    table: "radiology_structured_templates",
    select: `
      SELECT
        name                                         AS template_name,
        UPPER(modality)                              AS modality,
        NULL                                         AS study_type,
        body_part,
        template                                     AS findings,
        COALESCE(description, '')                    AS impression,
        NULL                                         AS recommendations,
        '[]'::jsonb                                  AS tags,
        'phase-f-migration'                          AS created_by
      FROM radiology_structured_templates
      WHERE is_active = true`,
  },
  {
    group: "MIGRATED_AI_NORMAL_TEMPLATES",
    table: "ai_normal_report_templates",
    select: `
      SELECT
        name                                         AS template_name,
        UPPER(modality)                              AS modality,
        NULL                                         AS study_type,
        body_part,
        findings,
        impression,
        NULL                                         AS recommendations,
        to_jsonb(ARRAY[category])                    AS tags,
        'phase-f-migration'                          AS created_by
      FROM ai_normal_report_templates`,
  },
];

async function assess() {
  console.log("════════ PHASE F — TEMPLATE CONSOLIDATION: ASSESS (read-only) ════════\n");
  const master = await q<{ n: string }>(`SELECT COUNT(*) AS n FROM radiology_master_templates`);
  console.log(`radiology_master_templates (winner) currently: ${master[0].n} rows\n`);

  let total = 0;
  for (const src of SOURCES) {
    if (!(await tableExists(src.table))) {
      console.log(`• ${src.table}: TABLE NOT FOUND — will be skipped`);
      continue;
    }
    const rows = await q(`SELECT COUNT(*) AS n FROM (${src.select}) x`);
    const dupes = await q(
      `SELECT COUNT(*) AS n FROM (${src.select}) x
       WHERE EXISTS (SELECT 1 FROM radiology_master_templates m
                     WHERE m.group_name = $1 AND m.template_name = x.template_name)`,
      [src.group],
    );
    const already = await q(
      `SELECT COUNT(*) AS n FROM radiology_master_templates WHERE group_name = $1`,
      [src.group],
    );
    console.log(
      `• ${src.table} → group ${src.group}\n` +
      `    source rows to copy: ${rows[0].n}` +
      ` | already migrated: ${already[0].n}` +
      ` | would skip as duplicate: ${dupes[0].n}`,
    );
    total += Number(rows[0].n);
  }
  console.log(`\nTOTAL candidate rows: ${total}`);
  console.log("\nNothing was written. If this looks right, owner may approve:");
  console.log("  ... phase-f-template-consolidation.ts execute\n");
}

async function execute() {
  console.log("════════ PHASE F — EXECUTE (additive copy; sources untouched) ════════\n");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const src of SOURCES) {
      if (!(await tableExists(src.table))) {
        console.log(`• ${src.table}: not found — skipped`);
        continue;
      }
      const r = await client.query(
        `INSERT INTO radiology_master_templates
           (group_name, template_name, modality, study_type, body_part,
            findings, impression, recommendations, tags, version,
            is_locked, is_active, created_by)
         SELECT $1, x.template_name, x.modality, x.study_type, x.body_part,
                COALESCE(NULLIF(x.findings, ''), '(empty — review after migration)'),
                COALESCE(x.impression, ''),
                x.recommendations, x.tags, 1,
                false, true, x.created_by
         FROM (${src.select}) x
         ON CONFLICT (group_name, template_name) DO NOTHING`,
        [src.group],
      );
      console.log(`• ${src.table} → ${src.group}: copied ${r.rowCount} rows (duplicates skipped)`);
    }
    await client.query("COMMIT");
    console.log("\n✅ Done. Source tables are UNCHANGED. Rollback: run with 'rollback'.\n");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("❌ Failed — transaction rolled back, nothing written:", e);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

async function rollback() {
  console.log("════════ PHASE F — ROLLBACK (removes ONLY migrated copies) ════════\n");
  const r = await pool.query(
    `DELETE FROM radiology_master_templates WHERE group_name = ANY($1::text[])`,
    [GROUPS],
  );
  console.log(`Removed ${r.rowCount} migrated rows. Source tables were never touched.\n`);
}

(async () => {
  try {
    if (mode === "assess") await assess();
    else if (mode === "execute") await execute();
    else if (mode === "rollback") await rollback();
    else {
      console.error(`Unknown mode '${mode}'. Use: assess | execute | rollback`);
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
})();
