/**
 * operationsChecks.ts — the concrete deployment smoke-test checks (categories
 * A–H of the operations spec) on top of the pure runner in operationsHealth.ts.
 *
 * Every capability a check needs (DB query, HTTP probe, env, resolved
 * Orthanc/OHIF config, version) is INJECTED via OpsCtx, so this module never
 * imports @workspace/db and stays unit-testable with fakes. The admin route and
 * the `smoke:production` CLI each build a real OpsCtx and call
 * buildOperationsReport().
 */

import {
  runAllChecks, aggregateOverall, summarize,
  type OpsCheck, type OpsCheckDef, type OpsHealthReport, type OpsVersionInfo, type OpsRunTrigger,
} from "./operationsHealth";

export interface ProbeResult {
  /** true when a response arrived with status < 500 (reachable, not erroring). */
  ok: boolean;
  /** HTTP status, or null on a network-level error / timeout. */
  status: number | null;
  ms: number;
  json?: unknown;
  error?: string;
}

export interface OpsThresholds {
  /** "no DICOM in N minutes" only WARNs, and only if a study was ever received. */
  dicomStaleMinutes: number;
  syncStaleMinutes: number;
  backupMaxAgeHours: number;
  pendingStudiesWarn: number;
  syncWorkerStaleMinutes: number;
  diskWarnFreePercent: number;
}

export const DEFAULT_THRESHOLDS: OpsThresholds = {
  dicomStaleMinutes: 180,
  syncStaleMinutes: 60,
  backupMaxAgeHours: 48,
  pendingStudiesWarn: 25,
  syncWorkerStaleMinutes: 30,
  diskWarnFreePercent: 10,
};

/** One row set from a read-only query (array of plain objects). */
export type QueryFn = (text: string, params?: unknown[]) => Promise<Array<Record<string, unknown>>>;
export type ProbeFn = (url: string, opts?: { headers?: Record<string, string>; parseJson?: boolean; method?: string; timeoutMs?: number }) => Promise<ProbeResult>;

export interface OpsCtx {
  now: Date;
  mode: "server" | "cli";
  /** Base URL of the running API for CLI self-probes (null in server mode). */
  baseUrl: string | null;
  query: QueryFn;
  probe: ProbeFn;
  env: (key: string) => string | undefined;
  version: OpsVersionInfo;
  /** Live pool stats, server mode only. */
  poolStats: (() => { total: number; idle: number; waiting: number } | null) | null;
  orthanc: { baseUrl: string | null; headers: Record<string, string>; configured: boolean };
  /** On-prem Ollama LLM endpoint + the configured/default reporting model. */
  ollama: { baseUrl: string | null; model: string; configured: boolean };
  ohifUrl: string | null;
  publicBaseUrl: string | null;
  displayToken: string | null;
  n8nUrl: string | null;
  evolutionUrl: string | null;
  paymentGatewayConfigured: boolean | null; // null = couldn't determine
  storageDir: string | null;
  diskFree: (() => { freeBytes: number; totalBytes: number } | null) | null;
  thresholds: OpsThresholds;
}

// ── small helpers ────────────────────────────────────────────────────────────
async function countRows(ctx: OpsCtx, table: string): Promise<number> {
  // `table` is always a fixed string literal from CHECK defs — never user input.
  const rows = await ctx.query(`SELECT count(*)::int AS c FROM ${table}`);
  return Number(rows[0]?.c ?? 0);
}

function minutesSince(now: Date, iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((now.getTime() - t) / 60000));
}

function humanAge(mins: number): string {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

const CRITICAL_TABLES = [
  "users", "portal_sessions", "patients", "bills",
  "radiology_worklist", "radiology_report_drafts", "patient_reports",
];

// ── the checks ───────────────────────────────────────────────────────────────
export const CHECK_DEFS: Array<OpsCheckDef<OpsCtx>> = [
  // ── A. APPLICATION ─────────────────────────────────────────────────────────
  {
    id: "app.responding", name: "API Health", category: "application", required: true,
    run: async (ctx) => {
      if (ctx.mode === "server") {
        return { status: "PASS", message: `API process responding (uptime ${Math.round(ctx.version.uptimeSeconds ?? 0)}s)` };
      }
      if (!ctx.baseUrl) return { status: "UNKNOWN", message: "no --base-url provided for the API liveness probe" };
      const r = await ctx.probe(`${ctx.baseUrl}/health`, { parseJson: true });
      if (!r.ok) {
        return {
          status: "FAIL",
          message: r.status == null ? `API unreachable at ${ctx.baseUrl}/health` : `API /health returned ${r.status}`,
          recommendedAction: "Check the care-api container is running and healthy in Container Manager.",
        };
      }
      const j = (r.json ?? {}) as { version?: string; commit?: string; build?: string };
      return { status: "PASS", message: `API responding (${r.ms}ms)`, metadata: { version: j.version, commit: j.commit, build: j.build } };
    },
  },
  {
    id: "app.version", name: "Version / Git commit", category: "application", required: false,
    run: async (ctx) => {
      const v = ctx.version;
      const commitKnown = v.commit && v.commit !== "unknown";
      return {
        status: commitKnown ? "PASS" : "WARNING",
        message: `v${v.version} build ${v.build}${v.releaseName ? ` "${v.releaseName}"` : ""} · commit ${v.commit}${v.buildTime ? ` · built ${v.buildTime}` : ""}`,
        metadata: { version: v.version, build: v.build, releaseName: v.releaseName, commit: v.commit, branch: v.branch, buildTime: v.buildTime },
        recommendedAction: commitKnown ? undefined : "Set GIT_COMMIT / BUILD_DATE at image build time so deployments are traceable.",
      };
    },
  },
  {
    id: "app.production_mode", name: "Production mode", category: "application", required: false,
    run: async (ctx) => {
      const env = ctx.version.nodeEnv;
      return env === "production"
        ? { status: "PASS", message: "NODE_ENV=production" }
        : { status: "WARNING", message: `NODE_ENV=${env || "(unset)"} — not running in production mode`, metadata: { nodeEnv: env } };
    },
  },
  {
    id: "app.config", name: "Required configuration", category: "application", required: true,
    run: async (ctx) => {
      // Presence only — values are NEVER read into the message/metadata.
      const required = ["DATABASE_URL", "JWT_SECRET", "SESSION_SECRET"];
      const missing = required.filter((k) => !ctx.env(k));
      return missing.length === 0
        ? { status: "PASS", message: `all ${required.length} required config values present`, metadata: { present: required } }
        : {
            status: "FAIL",
            message: `missing required config: ${missing.join(", ")}`,
            metadata: { missing },
            recommendedAction: "Set the missing environment variables in the Container Manager environment for care-api and redeploy.",
          };
    },
  },

  // ── B. DATABASE ────────────────────────────────────────────────────────────
  {
    id: "db.connect", name: "PostgreSQL connection", category: "database", required: true,
    run: async (ctx) => {
      const t0 = Date.now();
      await ctx.query("SELECT 1 AS ok");
      return { status: "PASS", message: `connection succeeded (${Date.now() - t0}ms)` };
    },
  },
  {
    id: "db.read", name: "Read-only query", category: "database", required: true,
    run: async (ctx) => {
      const rows = await ctx.query("SELECT count(*)::int AS c FROM users");
      return { status: "PASS", message: `read query succeeded (users rows: ${rows[0]?.c ?? 0})` };
    },
  },
  {
    id: "db.critical_tables", name: "Critical tables present", category: "database", required: true,
    run: async (ctx) => {
      const rows = await ctx.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1)",
        [CRITICAL_TABLES],
      );
      const found = new Set(rows.map((r) => String(r.table_name)));
      const missing = CRITICAL_TABLES.filter((t) => !found.has(t));
      return missing.length === 0
        ? { status: "PASS", message: `all ${CRITICAL_TABLES.length} critical tables exist` }
        : { status: "FAIL", message: `missing tables: ${missing.join(", ")}`, metadata: { missing }, recommendedAction: "Re-run the care-db-patch-v2 migration container." };
    },
  },
  {
    id: "db.schema_verify", name: "Schema verification state", category: "database", required: false,
    run: async (ctx) => {
      let rows: Array<Record<string, unknown>>;
      try {
        rows = await ctx.query("SELECT key, value FROM public.schema_deploy_state");
      } catch {
        return { status: "UNKNOWN", message: "schema_deploy_state not present (container migration pipeline not used in this environment)" };
      }
      const state: Record<string, string> = {};
      for (const r of rows) state[String(r.key)] = String(r.value);
      const patchOk = state["db_patch_ok"] === "true";
      const verify = state["schema_verify_status"];
      if (!patchOk) return { status: "FAIL", message: "db-patch-v2 did not complete (db_patch_ok≠true)", recommendedAction: "Inspect the care-db-patch-v2 container logs from the last deploy." };
      // "full_fail" is the legacy value; "failed" is the current one (see
      // classifySchemaStatus in scripts/db-schema-verify.cjs) — both accepted
      // so an already-persisted legacy value isn't misreported as UNKNOWN.
      if (verify === "failed" || verify === "full_fail") return { status: "WARNING", message: `schema_verify_status=${verify} — schema drift detected`, metadata: { verify } };
      if (verify === "sql_pass" || verify === "full_pass") return { status: "PASS", message: `db_patch_ok=true, schema_verify_status=${verify}` };
      if (verify === "pass_with_warnings") return { status: "WARNING", message: "db_patch_ok=true, schema_verify_status=pass_with_warnings — non-blocking schema drift, startup is safe", metadata: { verify } };
      return { status: "UNKNOWN", message: `db_patch_ok=true, schema_verify_status=${verify ?? "missing"}` };
    },
  },
  {
    id: "db.pool", name: "Connection pool", category: "database", required: false, optional: true,
    run: async (ctx) => {
      if (ctx.mode !== "server" || !ctx.poolStats) return { status: "SKIPPED", message: "pool stats only available in-process (server mode)" };
      const s = ctx.poolStats();
      if (!s) return { status: "UNKNOWN", message: "pool stats unavailable" };
      const status = s.waiting > 5 ? "WARNING" : "PASS";
      return { status, message: `pool total=${s.total} idle=${s.idle} waiting=${s.waiting}`, metadata: s };
    },
  },

  // ── C. AUTHENTICATION ──────────────────────────────────────────────────────
  {
    id: "auth.tables", name: "Auth service readiness", category: "authentication", required: true,
    run: async (ctx) => {
      const rows = await ctx.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1)",
        [["users", "portal_sessions"]],
      );
      const found = new Set(rows.map((r) => String(r.table_name)));
      const missing = ["users", "portal_sessions"].filter((t) => !found.has(t));
      return missing.length === 0
        ? { status: "PASS", message: "auth tables (users, portal_sessions) present and readable" }
        : { status: "FAIL", message: `auth tables missing: ${missing.join(", ")}` };
    },
  },
  {
    id: "auth.admin_guard", name: "Admin endpoint rejects anon", category: "authentication", required: true,
    run: async (ctx) => {
      // Probes the admin health endpoint with NO auth header (works from the
      // CLI and from the server itself over loopback) — expects a 401/403.
      if (!ctx.baseUrl) {
        return { status: "SKIPPED", message: "no base URL available to probe the admin guard" };
      }
      const r = await ctx.probe(`${ctx.baseUrl}/api/admin/operations/health`, { parseJson: false });
      if (r.status === 401 || r.status === 403) return { status: "PASS", message: `admin health endpoint correctly rejects anonymous access (${r.status})` };
      if (r.status === 200) return { status: "FAIL", message: "admin health endpoint returned 200 WITHOUT auth — it is not protected!", recommendedAction: "The admin operations endpoint must be behind requireStaffAuth + requireAdminRole." };
      if (r.status == null) return { status: "UNKNOWN", message: `could not reach ${ctx.baseUrl} to verify the admin guard` };
      return { status: "WARNING", message: `admin endpoint returned unexpected ${r.status} for an anonymous request` };
    },
  },

  // ── D. CORE ERP (read-only service probes) ─────────────────────────────────
  {
    id: "erp.patient_search", name: "Patient service", category: "core_erp", required: true,
    run: async (ctx) => ({ status: "PASS", message: `patient service callable (patients: ${await countRows(ctx, "patients")})` }),
  },
  {
    id: "erp.billing", name: "Billing service", category: "core_erp", required: true,
    run: async (ctx) => ({ status: "PASS", message: `billing service callable (bills: ${await countRows(ctx, "bills")})` }),
  },
  {
    id: "erp.worklist", name: "Radiology worklist", category: "core_erp", required: true,
    run: async (ctx) => ({ status: "PASS", message: `worklist service callable (entries: ${await countRows(ctx, "radiology_worklist")})` }),
  },
  {
    id: "erp.draft", name: "Report draft service", category: "core_erp", required: true,
    run: async (ctx) => ({ status: "PASS", message: `draft service callable (drafts: ${await countRows(ctx, "radiology_report_drafts")})` }),
  },
  {
    id: "erp.finalized", name: "Finalized report service", category: "core_erp", required: true,
    run: async (ctx) => ({ status: "PASS", message: `finalized-report service callable (reports: ${await countRows(ctx, "patient_reports")})` }),
  },

  // ── E. RADIOLOGY / ORTHANC ─────────────────────────────────────────────────
  {
    id: "orthanc.reachable", name: "Orthanc connectivity", category: "radiology_pacs", required: true,
    run: async (ctx) => {
      if (!ctx.orthanc.configured || !ctx.orthanc.baseUrl) {
        return { status: "SKIPPED", message: "Orthanc not configured (ORTHANC_URL / pacs_settings orthanc_url unset)" };
      }
      const r = await ctx.probe(`${ctx.orthanc.baseUrl}/system`, { headers: ctx.orthanc.headers, parseJson: true });
      if (r.status == null) return { status: "FAIL", message: "Orthanc unavailable — no response (network/DNS/container down)", recommendedAction: "Check the care-orthanc container and ORTHANC_INTERNAL_URL." };
      if (r.status === 401 || r.status === 403) return { status: "FAIL", message: `Orthanc reachable but authentication failed (${r.status})`, recommendedAction: "Verify ORTHANC_USERNAME / ORTHANC_PASSWORD." };
      if (r.status >= 500) return { status: "FAIL", message: `Orthanc reachable but returned ${r.status}` };
      if (!r.ok) return { status: "WARNING", message: `Orthanc returned ${r.status} for /system` };
      const version = (r.json as { Version?: string } | undefined)?.Version ?? "unknown";
      return { status: "PASS", message: `Orthanc reachable, version ${version} (${r.ms}ms)`, metadata: { version } };
    },
  },
  {
    id: "orthanc.sync_fresh", name: "Orthanc → ERP sync freshness", category: "radiology_pacs", required: false,
    run: async (ctx) => {
      const rows = await ctx.query("SELECT max(last_sync_at) AS m, count(*)::int AS n FROM radiology_studies WHERE sync_status = 'synced'");
      const n = Number(rows[0]?.n ?? 0);
      const m = rows[0]?.m ? new Date(rows[0].m as string).toISOString() : null;
      if (n === 0 || !m) return { status: "SKIPPED", message: "no successfully-synced studies yet (nothing to measure)" };
      const age = minutesSince(ctx.now, m)!;
      return age > ctx.thresholds.syncStaleMinutes
        ? { status: "WARNING", message: `last successful sync was ${humanAge(age)} ago`, metadata: { lastSyncAt: m, ageMinutes: age } }
        : { status: "PASS", message: `last sync ${humanAge(age)} ago`, metadata: { lastSyncAt: m, ageMinutes: age } };
    },
  },
  {
    id: "radiology.last_dicom", name: "Last DICOM received", category: "radiology_pacs", required: false,
    run: async (ctx) => {
      const rows = await ctx.query("SELECT max(study_received_at) AS m FROM radiology_studies");
      let m = rows[0]?.m ? new Date(rows[0].m as string).toISOString() : null;
      if (!m) {
        const wl = await ctx.query("SELECT max(created_at) AS m FROM radiology_worklist");
        m = wl[0]?.m ? new Date(wl[0].m as string).toISOString() : null;
      }
      if (!m) return { status: "SKIPPED", message: "no study received yet (nothing has been sent)" };
      const age = minutesSince(ctx.now, m)!;
      // "no recent study" is NEVER a failure — only a WARNING past the threshold.
      return age > ctx.thresholds.dicomStaleMinutes
        ? { status: "WARNING", message: `last DICOM received ${humanAge(age)} ago (> ${ctx.thresholds.dicomStaleMinutes}m threshold)`, metadata: { lastReceivedAt: m, ageMinutes: age } }
        : { status: "PASS", message: `last DICOM received ${humanAge(age)} ago`, metadata: { lastReceivedAt: m, ageMinutes: age } };
    },
  },
  {
    id: "radiology.pending_studies", name: "Pending / unmatched studies", category: "radiology_pacs", required: false,
    run: async (ctx) => {
      const rows = await ctx.query("SELECT count(*)::int AS c FROM radiology_worklist WHERE patient_id IS NULL");
      const c = Number(rows[0]?.c ?? 0);
      return c > ctx.thresholds.pendingStudiesWarn
        ? { status: "WARNING", message: `${c} unmatched studies awaiting patient match (> ${ctx.thresholds.pendingStudiesWarn})`, metadata: { unmatched: c } }
        : { status: "PASS", message: `${c} unmatched studies`, metadata: { unmatched: c } };
    },
  },
  {
    id: "radiology.sync_failures", name: "Recent sync failures", category: "radiology_pacs", required: false,
    run: async (ctx) => {
      const rows = await ctx.query("SELECT count(*)::int AS c FROM radiology_studies WHERE sync_status = 'failed'");
      const c = Number(rows[0]?.c ?? 0);
      return c > 0
        ? { status: "WARNING", message: `${c} studies in sync_status=failed`, metadata: { failed: c }, recommendedAction: "Review pacs_logs (log_type=sync) for the failing studies." }
        : { status: "PASS", message: "no studies in a failed sync state" };
    },
  },
  {
    id: "radiology.sync_worker", name: "Sync worker activity", category: "radiology_pacs", required: false,
    run: async (ctx) => {
      const pollerOn = (ctx.env("PACS_PROVIDER") ?? "").toLowerCase() === "orthanc" && !!ctx.env("INTERNAL_API_KEY") && ctx.env("ORTHANC_CHANGES_POLLER") !== "false";
      if (!pollerOn) return { status: "SKIPPED", message: "Orthanc changes-poller not enabled (PACS_PROVIDER≠orthanc or INTERNAL_API_KEY unset)" };
      let m: string | null = null;
      try {
        const rows = await ctx.query("SELECT max(created_at) AS m FROM pacs_logs WHERE log_type = 'sync'");
        m = rows[0]?.m ? new Date(rows[0].m as string).toISOString() : null;
      } catch {
        return { status: "UNKNOWN", message: "pacs_logs not queryable" };
      }
      if (!m) return { status: "UNKNOWN", message: "poller enabled but no sync activity recorded yet" };
      const age = minutesSince(ctx.now, m)!;
      return age > ctx.thresholds.syncWorkerStaleMinutes
        ? { status: "WARNING", message: `poller last logged activity ${humanAge(age)} ago`, metadata: { lastActivityAt: m, ageMinutes: age } }
        : { status: "PASS", message: `poller active (last log ${humanAge(age)} ago)`, metadata: { lastActivityAt: m, ageMinutes: age } };
    },
  },
  {
    id: "ohif.reachable", name: "OHIF viewer", category: "radiology_pacs", required: false,
    run: async (ctx) => {
      if (!ctx.ohifUrl) return { status: "SKIPPED", message: "OHIF not configured" };
      const r = await ctx.probe(ctx.ohifUrl, { parseJson: false });
      return r.ok
        ? { status: "PASS", message: `OHIF reachable (${r.ms}ms)` }
        : { status: "WARNING", message: r.status == null ? "OHIF unreachable" : `OHIF returned ${r.status}`, recommendedAction: "Check the OHIF container; reporting can continue via Weasis/other viewers." };
    },
  },
  {
    id: "radiology.workspace", name: "Radiology workspace API", category: "radiology_pacs", required: false,
    run: async (ctx) => {
      if (!ctx.baseUrl) return { status: "SKIPPED", message: "no base URL available to probe" };
      // Any non-5xx (200 or an auth 401) proves the radiology router is mounted.
      const r = await ctx.probe(`${ctx.baseUrl}/api/radiology-ops/health`, { parseJson: false });
      if (r.status == null) return { status: "WARNING", message: "radiology API unreachable" };
      return r.status < 500
        ? { status: "PASS", message: `radiology API mounted (${r.status})` }
        : { status: "WARNING", message: `radiology API returned ${r.status}` };
    },
  },

  // ── E2. AI (Ollama / CARE AI Gateway) + radiology operational queues ────────
  {
    id: "ai.ollama", name: "Ollama AI endpoint + model", category: "radiology_pacs", required: false, optional: true,
    run: async (ctx) => {
      if (!ctx.ollama.configured || !ctx.ollama.baseUrl) return { status: "SKIPPED", message: "Ollama not configured (OLLAMA_URL unset) — AI reporting off, manual reporting unaffected" };
      const r = await ctx.probe(`${ctx.ollama.baseUrl}/api/tags`, { parseJson: true });
      if (r.status == null) return { status: "WARNING", message: "Ollama unreachable — AI controls show unavailable; manual reporting continues", recommendedAction: "Check the Ollama host is up and LAN-reachable (ALLOW_PRIVATE_IPS=true)." };
      if (!r.ok) return { status: "WARNING", message: `Ollama returned ${r.status}` };
      const models = ((r.json as { models?: Array<{ name?: string; model?: string }> } | undefined)?.models ?? []).map((m) => m.name || m.model || "");
      const has = models.some((n) => n === ctx.ollama.model || n.startsWith(ctx.ollama.model));
      return has
        ? { status: "PASS", message: `Ollama reachable; configured model ${ctx.ollama.model} available (${models.length} model(s))`, metadata: { model: ctx.ollama.model, modelCount: models.length } }
        : { status: "WARNING", message: `Ollama reachable but configured model ${ctx.ollama.model} is NOT pulled`, recommendedAction: `On the Ollama host run: ollama pull ${ctx.ollama.model}`, metadata: { model: ctx.ollama.model, available: models.slice(0, 5) } };
    },
  },
  {
    id: "ai.job_queue", name: "AI job queue", category: "radiology_pacs", required: false,
    run: async (ctx) => {
      let rows: Array<Record<string, unknown>>;
      try { rows = await ctx.query("SELECT count(*)::int AS n FROM ai_job_queue WHERE status IN ('failed','error') AND retry_count >= COALESCE(max_retries, 3)"); }
      catch { return { status: "UNKNOWN", message: "ai_job_queue not present" }; }
      const n = Number(rows[0]?.n ?? 0);
      return n > 0
        ? { status: "WARNING", message: `${n} permanently-failed AI job(s)`, recommendedAction: "Review Admin → AI jobs; re-queue after fixing the provider.", metadata: { failed: n } }
        : { status: "PASS", message: "no permanently-failed AI jobs" };
    },
  },
  {
    id: "radiology.pacs_return", name: "PACS-return (SR) queue", category: "radiology_pacs", required: false,
    run: async (ctx) => {
      let rows: Array<Record<string, unknown>>;
      try { rows = await ctx.query("SELECT count(*)::int AS n FROM dicom_sr_export_queue WHERE export_status IN ('failed','error')"); }
      catch { return { status: "UNKNOWN", message: "dicom_sr_export_queue not present" }; }
      const n = Number(rows[0]?.n ?? 0);
      return n > 0
        ? { status: "WARNING", message: `${n} failed PACS-return export(s) — finalized reports are safe; retry from Admin`, recommendedAction: "Fix the PACS destination, then retry the export queue from Admin.", metadata: { failed: n } }
        : { status: "PASS", message: "no failed PACS-return exports" };
    },
  },
  {
    id: "radiology.study_locks", name: "Stale study locks", category: "radiology_pacs", required: false,
    run: async (ctx) => {
      let rows: Array<Record<string, unknown>>;
      try { rows = await ctx.query("SELECT count(*)::int AS n FROM radiology_study_locks WHERE COALESCE(last_activity_at, lock_time) < now() - interval '2 hours'"); }
      catch { return { status: "UNKNOWN", message: "radiology_study_locks not present" }; }
      const n = Number(rows[0]?.n ?? 0);
      return n > 0
        ? { status: "WARNING", message: `${n} study lock(s) idle >2h — may block reporting`, recommendedAction: "Clear stale locks from Admin (study locks) once confirmed idle.", metadata: { stale: n } }
        : { status: "PASS", message: "no stale study locks" };
    },
  },

  // ── F. QUEUE DISPLAYS ──────────────────────────────────────────────────────
  ...(["usg", "mri", "ct"] as const).map((room): OpsCheckDef<OpsCtx> => ({
    id: `queue.${room}`, name: `Queue ${room.toUpperCase()}`, category: "queue_displays", required: false,
    run: async (ctx) => {
      if (!ctx.baseUrl) return { status: "SKIPPED", message: "no base URL available to probe" };
      const tokenQ = ctx.displayToken ? `?displayToken=${encodeURIComponent(ctx.displayToken)}` : "";
      const r = await ctx.probe(`${ctx.baseUrl}/api/settings/queue-display/${room}${tokenQ}`, { parseJson: false });
      if (r.status == null) return { status: "WARNING", message: `queue/${room} route unreachable` };
      if (r.status >= 500) return { status: "WARNING", message: `queue/${room} returned ${r.status}`, recommendedAction: "Check the queue-display settings route and DB." };
      // 200 = fully working; 401/403 = mounted but token rejected (still "responds").
      return { status: "PASS", message: `queue/${room} responds (${r.status})` };
    },
  })),

  // ── G. OPTIONAL INTEGRATIONS (SKIPPED unless configured) ───────────────────
  {
    id: "integ.n8n", name: "n8n", category: "integrations", required: false, optional: true,
    run: async (ctx) => {
      if (!ctx.n8nUrl) return { status: "SKIPPED", message: "n8n not configured (set N8N_HEALTH_URL to enable this check)" };
      const r = await ctx.probe(ctx.n8nUrl, { parseJson: false });
      return r.ok ? { status: "PASS", message: `n8n reachable (${r.ms}ms)` } : { status: "WARNING", message: r.status == null ? "n8n unreachable" : `n8n returned ${r.status}` };
    },
  },
  {
    // DEPRECATED: Evolution API is not, and was never, a supported CARE
    // WhatsApp provider (it has no adapter in
    // services/whatsapp/WhatsAppProviderFactory.ts's registry). This is a
    // bare reachability probe kept only for deployments that still run a
    // standalone Evolution instance for unrelated reasons; it has no bearing
    // on CARE's actual WhatsApp send/receive path, which is the Meta Cloud
    // API (see integ.whatsapp / /api/internal/automations/whatsapp/health).
    id: "integ.evolution", name: "Evolution API (deprecated, unrelated to WhatsApp)", category: "integrations", required: false, optional: true,
    run: async (ctx) => {
      if (!ctx.evolutionUrl) return { status: "SKIPPED", message: "Evolution API not configured (deprecated legacy probe — safe to leave unset)" };
      const r = await ctx.probe(ctx.evolutionUrl, { parseJson: false });
      return r.ok ? { status: "PASS", message: `Evolution API reachable (${r.ms}ms)` } : { status: "WARNING", message: r.status == null ? "Evolution API unreachable" : `Evolution API returned ${r.status}` };
    },
  },
  {
    id: "integ.payment", name: "Payment gateway config", category: "integrations", required: false, optional: true,
    run: async (ctx) => {
      if (ctx.paymentGatewayConfigured == null) return { status: "SKIPPED", message: "payment gateway status not determinable" };
      return ctx.paymentGatewayConfigured
        ? { status: "PASS", message: "an active payment gateway is configured" }
        : { status: "SKIPPED", message: "no payment gateway configured (optional)" };
    },
  },
  {
    id: "integ.public_site", name: "Public website / reverse proxy", category: "integrations", required: false, optional: true,
    run: async (ctx) => {
      if (!ctx.publicBaseUrl) return { status: "SKIPPED", message: "public base URL not configured" };
      const r = await ctx.probe(ctx.publicBaseUrl, { parseJson: false });
      return r.ok ? { status: "PASS", message: `public site reachable (${r.ms}ms)` } : { status: "WARNING", message: r.status == null ? "public site unreachable from the API host" : `public site returned ${r.status}` };
    },
  },

  // ── H. STORAGE & BACKUP ────────────────────────────────────────────────────
  {
    id: "storage.dir", name: "Object storage path", category: "storage_backup", required: false,
    run: async (ctx) => {
      if (!ctx.storageDir || !ctx.diskFree) return { status: "SKIPPED", message: "storage path / disk stats not available in this environment" };
      const d = ctx.diskFree();
      if (!d) return { status: "WARNING", message: `object storage path not accessible: ${ctx.storageDir}`, recommendedAction: "Verify the object_storage volume is mounted." };
      const freePct = d.totalBytes > 0 ? Math.round((d.freeBytes / d.totalBytes) * 100) : 0;
      const status = freePct < ctx.thresholds.diskWarnFreePercent ? "WARNING" : "PASS";
      return { status, message: `storage accessible, ${freePct}% free`, metadata: { freePercent: freePct, freeBytes: d.freeBytes, totalBytes: d.totalBytes } };
    },
  },
  {
    id: "backup.age", name: "Latest backup", category: "storage_backup", required: false,
    run: async (ctx) => {
      let rows: Array<Record<string, unknown>>;
      try {
        rows = await ctx.query("SELECT created_at, size_bytes FROM backup_job_logs WHERE status = 'success' ORDER BY id DESC LIMIT 1");
      } catch {
        return { status: "UNKNOWN", message: "backup_job_logs not present" };
      }
      const latest = rows[0];
      if (!latest?.created_at) return { status: "UNKNOWN", message: "no successful backup recorded in backup_job_logs (the Synology pull path may record elsewhere)" };
      const iso = new Date(latest.created_at as string).toISOString();
      const ageHours = Math.round((ctx.now.getTime() - new Date(iso).getTime()) / 3600000);
      const sizeBytes = Number(latest.size_bytes ?? 0);
      if (sizeBytes <= 0) return { status: "WARNING", message: `latest backup ${ageHours}h ago but reported 0 bytes`, metadata: { ageHours, sizeBytes } };
      return ageHours > ctx.thresholds.backupMaxAgeHours
        ? { status: "WARNING", message: `latest successful backup was ${ageHours}h ago (> ${ctx.thresholds.backupMaxAgeHours}h)`, metadata: { ageHours, sizeBytes } }
        : { status: "PASS", message: `latest backup ${ageHours}h ago (${sizeBytes} bytes)`, metadata: { ageHours, sizeBytes } };
    },
  },
];

export interface BuildReportOptions {
  includeOptional: boolean;
  timeoutMs: number;
  trigger: OpsRunTrigger;
}

/** Run every check against the injected context and roll up to one report. */
export async function buildOperationsReport(ctx: OpsCtx, opts: BuildReportOptions): Promise<OpsHealthReport> {
  const started = Date.now();
  const checks: OpsCheck[] = await runAllChecks(CHECK_DEFS, ctx, {
    includeOptional: opts.includeOptional, timeoutMs: opts.timeoutMs, now: ctx.now,
  });
  return {
    overall: aggregateOverall(checks),
    generatedAt: ctx.now.toISOString(),
    durationMs: Date.now() - started,
    trigger: opts.trigger,
    version: ctx.version,
    checks,
    summary: summarize(checks),
  };
}
