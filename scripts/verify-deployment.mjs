#!/usr/bin/env node
/**
 * verify-deployment.mjs — CARE ERP one-command deployment verifier (§7)
 * ==========================================================================
 * Production-safe health/readiness sweep across the whole CARE ERP stack.
 * Run it after a deploy, from a cron, or from the Admin Operational Health
 * dashboard (via --json). It NEVER mutates anything and NEVER prints secrets.
 *
 *   pnpm operations:verify-deployment            # human-readable report
 *   pnpm operations:verify-deployment --json     # machine-readable (Admin UI)
 *   VERIFY_SKIP_API=1 pnpm operations:verify-deployment   # DB/config only
 *
 * STATUS VOCABULARY
 *   PASS      check succeeded
 *   FAIL      check failed — see `blocking` to know if it blocks a deploy
 *   WARNING   degraded but not deployment-blocking (stale backup, failed jobs…)
 *   SKIPPED — NOT CONFIGURED   the feature/service has no config, nothing to check
 *
 * EXIT CODE
 *   non-zero  ONLY if a genuinely deployment-blocking check FAILED
 *             (database down, core schema missing, migrations not applied, API
 *             not serving). Degraded external services never fail the exit code.
 *
 * CONFIG (all from the same env the API/compose already use)
 *   DATABASE_URL | DB_HOST/DB_USER/DB_PASSWORD/DB_NAME/DB_HOST_PORT
 *   VERIFY_API_URL (default http://localhost:8080)  VERIFY_WEB_URL (default http://localhost:${HOST_PORT:-8888})
 *   ORTHANC_INTERNAL_URL|ORTHANC_URL   OHIF_INTERNAL_URL|OHIF_URL
 *   OLLAMA_URL|OLLAMA_PRIMARY_URL|OLLAMA_FALLBACK_URL   OLLAMA_DEFAULT_MODEL (default qwen3:14b)
 *   AI_GATEWAY_URL   ICICI_SECRET_KEY/ICICI_MERCHANT_ID   N8N_URL
 *   VERIFY_SKIP_API=1  → downgrade API/web probes to SKIPPED (DB/config-only run)
 */

import pg from "pg";
import { statfsSync, existsSync } from "node:fs";

const JSON_OUT = process.argv.includes("--json");
const SKIP_API = process.env.VERIFY_SKIP_API === "1";
const C = JSON_OUT
  ? { g: "", r: "", y: "", b: "", d: "", n: "" }
  : { g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", b: "\x1b[34m", d: "\x1b[2m", n: "\x1b[0m" };

const P = "PASS", F = "FAIL", W = "WARNING", S = "SKIPPED — NOT CONFIGURED";
const results = [];
function add(group, name, status, detail, opts = {}) {
  results.push({ group, name, status, detail: detail || "", blocking: !!opts.blocking, remediation: opts.remediation || "" });
}

// ── config resolution ────────────────────────────────────────────────────────
function dbUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (process.env.DB_HOST) {
    const u = process.env.DB_USER || "erp", p = process.env.DB_PASSWORD || "changeme";
    const h = process.env.DB_HOST, port = process.env.DB_HOST_PORT || "5432", n = process.env.DB_NAME || "diagnostic_erp";
    return `postgresql://${u}:${p}@${h}:${port}/${n}`;
  }
  return null;
}
const CFG = {
  db: dbUrl(),
  api: process.env.VERIFY_API_URL || `http://localhost:${process.env.PORT || 8080}`,
  web: process.env.VERIFY_WEB_URL || `http://localhost:${process.env.HOST_PORT || 8888}`,
  orthanc: process.env.ORTHANC_INTERNAL_URL || process.env.ORTHANC_URL || "",
  ohif: process.env.OHIF_INTERNAL_URL || process.env.OHIF_URL || "",
  ollama: process.env.OLLAMA_URL || process.env.OLLAMA_PRIMARY_URL || process.env.OLLAMA_BASE_URL || process.env.OLLAMA_FALLBACK_URL || "http://172.16.1.140:11434",
  ollamaModel: process.env.OLLAMA_DEFAULT_MODEL || process.env.AI_MODEL_VISION || process.env.AI_MODEL_STANDARD || "qwen3-vl:8b",
  aiGateway: process.env.AI_GATEWAY_URL || "",
  iciciSecret: process.env.ICICI_SECRET_KEY || "",
  iciciMerchant: process.env.ICICI_MERCHANT_ID || "",
  n8n: process.env.N8N_URL || "",
};

async function httpProbe(url, { path = "", ms = 5000, expectJson = false } = {}) {
  const full = url.replace(/\/$/, "") + path;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(full, { signal: ctl.signal, redirect: "manual" });
    const body = expectJson ? await res.json().catch(() => null) : await res.text().catch(() => "");
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    return { ok: false, status: 0, error: String(e.name === "AbortError" ? `timeout after ${ms}ms` : e.message) };
  } finally { clearTimeout(t); }
}

async function main() {
  // ── DATABASE ───────────────────────────────────────────────────────────────
  let client = null;
  if (!CFG.db) {
    add("Database", "connectivity", F, "no DATABASE_URL / DB_* configured", { blocking: true, remediation: "Set DATABASE_URL in .env" });
  } else {
    client = new pg.Client({ connectionString: CFG.db });
    try {
      await client.connect();
      await client.query("SELECT 1");
      add("Database", "connectivity", P, "connected");
    } catch (e) {
      add("Database", "connectivity", F, String(e.message).split("\n")[0], { blocking: true, remediation: "Check care-db is healthy and DATABASE_URL/DB_HOST are correct" });
      client = null;
    }
  }

  const q = async (sql, params) => (client ? (await client.query(sql, params)).rows : null);
  const tableExists = async (t) => {
    const r = await q(`SELECT to_regclass($1) IS NOT NULL AS e`, [`public.${t}`]);
    return r && r[0].e;
  };

  if (client) {
    // core tables
    const core = ["users","clinic_settings","patients","bills","payments","orders","order_tests","diagnostic_tests","doctors","ledgers","radiology_worklist","feature_flags"];
    const missing = [];
    for (const t of core) if (!(await tableExists(t))) missing.push(t);
    if (missing.length) add("Database", "core tables", F, `missing: ${missing.join(", ")}`, { blocking: true, remediation: "Run care-db-patch-v2 migrations (docker compose up recreates it) or `pnpm db:smoke` to diagnose" });
    else add("Database", "core tables", P, `${core.length} core tables present`);

    // ── SCHEMA / MIGRATIONS ────────────────────────────────────────────────
    if (await tableExists("schema_deploy_state")) {
      const rows = await q(`SELECT key, value FROM schema_deploy_state`);
      const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
      if (map.db_patch_ok === "true") add("Schema", "migration state", P, `db_patch_ok=true, ${map.total_migrations || "?"} migrations, v${map.erp_version || "?"} build ${map.build_number || "?"}`);
      else add("Schema", "migration state", F, `db_patch_ok=${map.db_patch_ok}`, { blocking: true, remediation: "care-db-patch-v2 did not complete — inspect its container logs" });
      if (map.git_commit && map.git_commit !== "unknown") add("Schema", "deployed version", P, `commit ${String(map.git_commit).slice(0,12)} branch ${map.git_branch || "?"} @ ${map.build_date || "?"}`);
    } else {
      // schema_deploy_state is stamped as the FINAL step of a successful migration
      // by care-db-patch-v2 (and now care-migrate). Its absence CANNOT hide a
      // failed migration: care-db-patch-v2 runs under `set -e` and only writes
      // db_patch_ok=true at the very end, so a failure exits non-zero (care-api
      // never starts) with the stamp absent — absence is the signal, not a
      // cover-up — and the API's /api/health/schema probe independently 503s
      // while it is missing. So distinguish two benign cases:
      const migrated = await tableExists("users"); // proxy: has the schema been built at all?
      if (migrated) {
        add("Schema", "migration state", W, "core tables present but schema_deploy_state absent — this DB was migrated by a non-standard path (manual psql / an older care-migrate), not care-db-patch-v2. /api/health/schema will 503 until it is stamped.", { remediation: "Re-run the standard path: `docker compose up -d --build` (care-db-patch-v2), or `docker compose run --rm care-migrate` (now stamps schema_deploy_state itself)." });
      } else {
        add("Schema", "migration state", S, "no schema_deploy_state and no core tables — a genuinely empty database (nothing deployed yet)");
      }
    }
    const migLogExists = await tableExists("schema_migrations_log");
    if (migLogExists) {
      const n = (await q(`SELECT count(*)::int c FROM schema_migrations_log`))[0].c;
      add("Schema", "migrations applied", n > 0 ? P : W, `${n} tracked migrations`);
    }
    // stale migration lock
    if (await tableExists("schema_migration_lock")) {
      const lk = await q(`SELECT locked, locked_by, locked_at, (locked AND locked_at < now() - interval '10 minutes') AS stale FROM schema_migration_lock WHERE id=1`);
      if (lk && lk[0] && lk[0].locked) {
        if (lk[0].stale) add("Operational", "migration lock", W, `stale lock held by ${lk[0].locked_by} since ${lk[0].locked_at}`, { remediation: "If no migration is running: UPDATE schema_migration_lock SET locked=false WHERE id=1;" });
        else add("Operational", "migration lock", W, `lock currently held by ${lk[0].locked_by} (a migration may be in progress)`);
      } else add("Operational", "migration lock", P, "not locked");
    }
  }

  // ── API ────────────────────────────────────────────────────────────────────
  if (SKIP_API) {
    add("API", "liveness /health", S, "VERIFY_SKIP_API=1");
    add("API", "readiness /api/health/schema", S, "VERIFY_SKIP_API=1");
    add("API", "feature-flags endpoint", S, "VERIFY_SKIP_API=1");
    add("API", "auth endpoint", S, "VERIFY_SKIP_API=1");
    add("API", "radiology worklist endpoint", S, "VERIFY_SKIP_API=1");
  } else {
    const h = await httpProbe(CFG.api, { path: "/health", expectJson: true });
    if (h.ok) add("API", "liveness /health", P, `200 ${h.body && h.body.ok ? "ok:true" : ""}`);
    else add("API", "liveness /health", F, h.error || `HTTP ${h.status}`, { blocking: true, remediation: "care-api not serving — check `docker logs care-api`" });

    const sch = await httpProbe(CFG.api, { path: "/api/health/schema" });
    if (sch.status === 200) add("API", "readiness /api/health/schema", P, "schema ready");
    else if (sch.status === 0) add("API", "readiness /api/health/schema", F, sch.error, { blocking: true, remediation: "API unreachable" });
    else add("API", "readiness /api/health/schema", F, `HTTP ${sch.status}`, { blocking: true, remediation: "Schema not ready — care-db-patch-v2/care-schema-verify may have failed" });

    // feature-flags endpoint present (200 public read)
    const ff = await httpProbe(CFG.api, { path: "/api/feature-flags" });
    add("API", "feature-flags endpoint", ff.status && ff.status !== 404 ? P : F, ff.status ? `HTTP ${ff.status}` : ff.error, ff.status === 404 || !ff.status ? { remediation: "Feature-flag endpoint missing — check featureFlagsRouter mount" } : {});

    // auth endpoint mounted (expect a 4xx, not 404/connection error)
    const auth = await httpProbe(CFG.api, { path: "/api/auth/me" });
    if (auth.status && auth.status !== 404) add("API", "auth endpoint", P, `mounted (HTTP ${auth.status})`);
    else if (!auth.status) add("API", "auth endpoint", F, auth.error, { blocking: true });
    else add("API", "auth endpoint", W, "HTTP 404 at /api/auth/me — auth path may differ", {});

    // worklist endpoint mounted (auth-guarded → expect 401)
    const wl = await httpProbe(CFG.api, { path: "/api/radiology-worklist" });
    add("API", "radiology worklist endpoint", wl.status && wl.status !== 404 ? P : W, wl.status ? `HTTP ${wl.status}` : wl.error);
  }

  // ── FRONTEND / WEB ───────────────────────────────────────────────────────────
  if (SKIP_API) {
    add("Frontend", "web root", S, "VERIFY_SKIP_API=1");
    add("Frontend", "USG demo route", S, "VERIFY_SKIP_API=1");
    add("Frontend", "USG rollout route", S, "VERIFY_SKIP_API=1");
    add("Frontend", "canonical reporting route", S, "VERIFY_SKIP_API=1");
    add("Frontend", "queue display route", S, "VERIFY_SKIP_API=1");
  } else {
    const root = await httpProbe(CFG.web, { path: "/nginx-health" });
    add("Frontend", "web root", root.status === 200 ? P : F, root.status ? `HTTP ${root.status}` : root.error, root.status === 200 ? {} : { blocking: true, remediation: "care-web/nginx not serving — check `docker logs care-web`" });
    // SPA routes all return the index HTML (200) — probe a few key ones
    for (const [name, path] of [["USG demo route","/radiology/usg-demo"],["USG rollout route","/radiology/usg-rollout"],["canonical reporting route","/radiology/reporting"],["queue display route","/display"]]) {
      const r = await httpProbe(CFG.web, { path });
      add("Frontend", name, r.status === 200 ? P : W, r.status ? `HTTP ${r.status}` : r.error);
    }
  }

  // ── PACS: Orthanc + OHIF ─────────────────────────────────────────────────────
  if (!CFG.orthanc) add("PACS", "Orthanc", S, "ORTHANC_URL not set");
  else {
    const o = await httpProbe(CFG.orthanc, { path: "/system", expectJson: true, ms: 6000 });
    if (o.ok) add("PACS", "Orthanc", P, `${CFG.orthanc.replace(/\/\/[^@]*@/, "//")} → ${o.body && o.body.Version ? "v" + o.body.Version : "200"}`);
    else add("PACS", "Orthanc", W, `${o.error || "HTTP " + o.status} — reporting still works; Open Viewer will show unavailable`, { remediation: "Check the Orthanc container/host and ORTHANC_URL; ALLOW_PRIVATE_IPS=true for LAN IPs" });
  }
  if (!CFG.ohif) add("PACS", "OHIF viewer", S, "OHIF_URL not set");
  else {
    const v = await httpProbe(CFG.ohif, { ms: 6000 });
    add("PACS", "OHIF viewer", v.status ? (v.status < 500 ? P : W) : W, v.status ? `HTTP ${v.status}` : `${v.error} — report editor still usable`);
  }
  if (client && await tableExists("dicom_sr_export_queue")) {
    const failed = (await q(`SELECT count(*)::int c FROM dicom_sr_export_queue WHERE export_status IN ('failed','error')`))[0].c;
    add("PACS", "SR/PACS-return queue", failed > 0 ? W : P, failed > 0 ? `${failed} failed PACS-return export(s) — retryable from Admin` : "no failed exports");
  }
  if (client && await tableExists("dicom_failed_retrieval_queue")) {
    const openf = (await q(`SELECT count(*)::int c FROM dicom_failed_retrieval_queue WHERE status NOT IN ('resolved','done')`))[0].c;
    add("PACS", "DICOM retrieval failures", openf > 0 ? W : P, openf > 0 ? `${openf} unresolved retrieval failure(s)` : "none");
  }

  // ── AI: Ollama + CARE AI Gateway ─────────────────────────────────────────────
  if (!CFG.ollama) add("AI", "Ollama", S, "OLLAMA_URL not set — AI reporting disabled, normal reporting unaffected");
  else {
    const tags = await httpProbe(CFG.ollama, { path: "/api/tags", expectJson: true, ms: 6000 });
    if (tags.ok && tags.body && Array.isArray(tags.body.models)) {
      const names = tags.body.models.map((m) => m.name || m.model);
      const has = names.some((n) => n === CFG.ollamaModel || n.startsWith(CFG.ollamaModel));
      add("AI", "Ollama", P, `reachable, ${names.length} model(s)`);
      add("AI", "configured Ollama model", has ? P : W, has ? `${CFG.ollamaModel} present` : `${CFG.ollamaModel} NOT pulled (have: ${names.slice(0,4).join(", ")}${names.length>4?"…":""})`, has ? {} : { remediation: `On the Ollama host run: ollama pull ${CFG.ollamaModel}` });
    } else add("AI", "Ollama", W, `${tags.error || "HTTP " + tags.status} — AI controls will show unavailable`, { remediation: "Check the Ollama endpoint (default http://172.16.1.140:11434) is up and LAN-reachable" });
  }
  if (!CFG.aiGateway) add("AI", "CARE AI Gateway", S, "AI_GATEWAY_URL not set");
  else {
    const g = await httpProbe(CFG.aiGateway, { path: "/health", ms: 6000 });
    add("AI", "CARE AI Gateway", g.ok ? P : W, g.ok ? "reachable" : `${g.error || "HTTP " + g.status}`);
  }
  if (client && await tableExists("ai_job_queue")) {
    const failed = (await q(`SELECT count(*)::int c FROM ai_job_queue WHERE status IN ('failed','error') AND retry_count >= COALESCE(max_retries,3)`))[0].c;
    add("AI", "AI job queue", failed > 0 ? W : P, failed > 0 ? `${failed} permanently-failed AI job(s)` : "no failed jobs");
  }

  // ── PAYMENTS: ICICI ──────────────────────────────────────────────────────────
  if (CFG.iciciSecret && CFG.iciciMerchant) add("Payments", "ICICI config", P, `merchant ${CFG.iciciMerchant} configured (secret present, not shown)`);
  else if (CFG.iciciMerchant || CFG.iciciSecret) add("Payments", "ICICI config", W, "partial ICICI config — merchant or secret missing", { remediation: "Set both ICICI_MERCHANT_ID and ICICI_SECRET_KEY" });
  else add("Payments", "ICICI config", S, "ICICI_SECRET_KEY not set");

  // ── MESSAGING: n8n ────────────────────────────────────────────────────────────
  // WhatsApp itself (Meta Cloud API) is checked via
  // GET /api/internal/automations/whatsapp/health (bearer-authed with
  // WHATSAPP_AUTOMATION_SECRET), not from this script — see
  // docs/WHATSAPP_CLOUD_API_SETUP.md.
  if (!CFG.n8n) add("Messaging", "n8n", S, "N8N_URL not set");
  else { const n = await httpProbe(CFG.n8n, { path: "/healthz", ms: 5000 }); add("Messaging", "n8n", n.ok ? P : W, n.ok ? "healthy" : `${n.error || "HTTP " + n.status}`); }

  // ── OPERATIONAL: backups, disk, locks ────────────────────────────────────────
  if (client && (await tableExists("backup_logs") || await tableExists("backup_jobs"))) {
    let latest = null;
    if (await tableExists("backup_logs")) {
      const r = await q(`SELECT max(created_at) m FROM backup_logs WHERE status IN ('success','completed','ok')`);
      latest = r && r[0].m;
    }
    if (!latest && await tableExists("backup_jobs")) {
      const r = await q(`SELECT max(last_run_at) m FROM backup_jobs WHERE last_status IN ('success','completed','ok')`);
      latest = r && r[0].m;
    }
    if (!latest) add("Operational", "backup recency", W, "no successful backup recorded", { remediation: "Configure and run a backup job (Admin → Backups)" });
    else {
      const ageH = (Date.now() - new Date(latest).getTime()) / 3.6e6;
      add("Operational", "backup recency", ageH <= 26 ? P : W, `last successful backup ${ageH.toFixed(1)}h ago`, ageH <= 26 ? {} : { remediation: "Backups are stale (>26h) — check the backup job" });
    }
  } else add("Operational", "backup recency", S, "no backup tables");

  if (client && await tableExists("radiology_study_locks")) {
    const stale = (await q(`SELECT count(*)::int c FROM radiology_study_locks WHERE COALESCE(last_activity_at, lock_time) < now() - interval '2 hours'`))[0].c;
    add("Operational", "stale study locks", stale > 0 ? W : P, stale > 0 ? `${stale} study lock(s) idle >2h — may block reporting` : "none stale", stale > 0 ? { remediation: "Clear from Admin → study locks, or DELETE FROM radiology_study_locks WHERE last_activity_at < now()-interval '2 hours'" } : {});
  }

  // disk space (best-effort via statfs)
  try {
    const target = process.env.OBJECT_STORAGE_DIR && existsSync(process.env.OBJECT_STORAGE_DIR) ? process.env.OBJECT_STORAGE_DIR : ".";
    const st = statfsSync(target);
    const freePct = (Number(st.bavail) / Number(st.blocks)) * 100;
    add("Operational", "disk space", freePct >= 10 ? P : W, `${freePct.toFixed(1)}% free on ${target}`, freePct >= 10 ? {} : { remediation: "Low disk — delete old uploads/backups/build artifacts; deletes still succeed when writes fail" });
  } catch { add("Operational", "disk space", S, "statfs unavailable on this platform"); }

  if (client) await client.end().catch(() => {});

  // ── OUTPUT ───────────────────────────────────────────────────────────────────
  const counts = results.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {});
  const blockingFails = results.filter((r) => r.status === F && r.blocking);
  const summary = {
    ok: blockingFails.length === 0,
    generatedAt: new Date().toISOString(),
    counts,
    blockingFailures: blockingFails.map((r) => `${r.group}/${r.name}: ${r.detail}`),
    checks: results,
  };

  if (JSON_OUT) {
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
  } else {
    console.log("\n" + "=".repeat(70));
    console.log("  CARE ERP — Deployment Verification");
    console.log("  " + summary.generatedAt);
    console.log("=".repeat(70));
    let lastGroup = "";
    const icon = (s) => s === P ? `${C.g}PASS${C.n}   ` : s === F ? `${C.r}FAIL${C.n}   ` : s === W ? `${C.y}WARN${C.n}   ` : `${C.d}SKIP${C.n}   `;
    for (const r of results) {
      if (r.group !== lastGroup) { console.log(`\n${C.b}▸ ${r.group}${C.n}`); lastGroup = r.group; }
      console.log(`  ${icon(r.status)} ${r.name.padEnd(34)} ${C.d}${r.detail}${C.n}`);
      if ((r.status === F || r.status === W) && r.remediation) console.log(`       ${C.d}↳ ${r.remediation}${C.n}`);
    }
    console.log("\n" + "-".repeat(70));
    console.log(`  ${C.g}${counts[P]||0} pass${C.n}  ${C.r}${counts[F]||0} fail${C.n}  ${C.y}${counts[W]||0} warn${C.n}  ${C.d}${counts[S]||0} skipped${C.n}`);
    if (blockingFails.length) {
      console.log(`  ${C.r}✗ ${blockingFails.length} DEPLOYMENT-BLOCKING failure(s):${C.n}`);
      for (const r of blockingFails) console.log(`     ${C.r}· ${r.group}/${r.name}${C.n}`);
    } else {
      console.log(`  ${C.g}✓ No deployment-blocking failures.${C.n}`);
    }
    console.log("=".repeat(70) + "\n");
  }
  process.exit(summary.ok ? 0 : 1);
}

main().catch((e) => { console.error("verify-deployment crashed:", e); process.exit(1); });
