/**
 * operationsContext.ts — builds a real OpsCtx (DB query fn, HTTP probe, resolved
 * Orthanc/OHIF/version/tokens) shared by the admin route and the smoke CLI.
 *
 * Intentionally imports only Node built-ins (no @workspace/db) so the CLI can
 * reuse it with its own pg pool. Callers inject the `query` function.
 */
import { createHash } from "node:crypto";
import { readFileSync, statfsSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_THRESHOLDS, type OpsCtx, type ProbeFn, type ProbeResult, type QueryFn } from "./operationsChecks";
import type { OpsVersionInfo } from "./operationsHealth";

/** version.json (best-effort) merged with env overrides — no secrets. */
export function resolveVersionInfo(env: NodeJS.ProcessEnv = process.env): OpsVersionInfo {
  let vj: { version?: string; buildNumber?: number; releaseName?: string } = {};
  for (const p of [
    resolve(process.cwd(), "version.json"),
    "/app/version.json",
    resolve(process.cwd(), "..", "..", "version.json"),
  ]) {
    try { vj = JSON.parse(readFileSync(p, "utf8")); break; } catch { /* try next path */ }
  }
  return {
    version: env.ERP_VERSION || vj.version || "0.0.0",
    build: env.BUILD_NUMBER || String(vj.buildNumber ?? "0"),
    releaseName: env.RELEASE_NAME || vj.releaseName || null,
    commit: env.GIT_COMMIT || "unknown",
    branch: env.GIT_BRANCH || null,
    buildTime: env.BUILD_DATE || null,
    nodeEnv: env.NODE_ENV || "",
    uptimeSeconds: null,
  };
}

function stripSlash(u: string | null | undefined): string | null {
  return u ? u.replace(/\/+$/, "") : null;
}

function orthancHeaders(env: NodeJS.ProcessEnv): Record<string, string> {
  const u = env.ORTHANC_USERNAME;
  const p = env.ORTHANC_PASSWORD;
  if (!u && !p) return {};
  return { Authorization: "Basic " + Buffer.from(`${u ?? ""}:${p ?? ""}`).toString("base64") };
}

async function readPacsSettings(query: QueryFn): Promise<Record<string, string>> {
  try {
    const rows = await query("SELECT key, value FROM pacs_settings");
    const map: Record<string, string> = {};
    for (const r of rows) map[String(r.key)] = String(r.value ?? "");
    return map;
  } catch {
    return {};
  }
}

/** A fetch-based probe with a hard timeout; never throws — network errors
 *  become { ok:false, status:null }. Redirects are not followed so a reverse
 *  proxy 3xx still reports "reachable". */
export function makeHttpProbe(defaultTimeoutMs = 3000): ProbeFn {
  return async (url, opts = {}): Promise<ProbeResult> => {
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        method: opts.method ?? "GET",
        headers: opts.headers,
        redirect: "manual",
        signal: AbortSignal.timeout(opts.timeoutMs ?? defaultTimeoutMs),
      });
      let json: unknown;
      if (opts.parseJson) { try { json = await res.json(); } catch { /* non-JSON body */ } }
      return { ok: res.status < 500, status: res.status, ms: Date.now() - t0, json };
    } catch (e) {
      return { ok: false, status: null, ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) };
    }
  };
}

export interface BuildCtxInput {
  now: Date;
  mode: "server" | "cli";
  baseUrl: string | null;
  query: QueryFn;
  probe?: ProbeFn;
  env?: NodeJS.ProcessEnv;
  poolStats?: (() => { total: number; idle: number; waiting: number } | null) | null;
  uptimeSeconds?: number | null;
}

export async function buildOpsContext(input: BuildCtxInput): Promise<OpsCtx> {
  const env = input.env ?? process.env;
  const pacs = await readPacsSettings(input.query);

  const orthancBase = stripSlash(env.ORTHANC_INTERNAL_URL || env.ORTHANC_URL || pacs["orthanc_url"]);
  const ohif = stripSlash(env.OHIF_URL || pacs["ohif_base_url"]);
  const ollamaBase = stripSlash(env.OLLAMA_URL || env.OLLAMA_PRIMARY_URL || env.OLLAMA_FALLBACK_URL || pacs["ollama_url"]);
  // Default reporting model — approved set is qwen3:14b (default), gpt-oss:20b, gemma3:12b.
  const ollamaModel = env.OLLAMA_DEFAULT_MODEL || pacs["ollama_model"] || "qwen3:14b";
  const publicBase = stripSlash(env.PUBLIC_BASE_URL || (env.NETWORK_PUBLIC_DOMAIN ? `https://${env.NETWORK_PUBLIC_DOMAIN}` : null));

  const version = resolveVersionInfo(env);
  version.uptimeSeconds = input.uptimeSeconds ?? null;

  // Display token mirrors the queue-display route's own derivation so a probe
  // gets a 200 rather than a 401. Never logged.
  let displayToken = env.DISPLAY_ACCESS_TOKEN || null;
  if (!displayToken) {
    const seed = env.DATABASE_URL || env.PGPASSWORD || "";
    if (seed) displayToken = createHash("sha256").update("display-token:" + seed).digest("hex").slice(0, 32);
  }

  let paymentConfigured: boolean | null = null;
  try {
    const rows = await input.query("SELECT active_payment_gateway FROM clinic_settings LIMIT 1");
    const g = rows[0]?.active_payment_gateway ? String(rows[0].active_payment_gateway) : "";
    paymentConfigured = !!g && g !== "none" && g !== "";
  } catch {
    paymentConfigured = null;
  }

  const storageDir = env.OBJECT_STORAGE_DIR || null;
  const diskFree = storageDir
    ? () => {
        try {
          const s = statfsSync(storageDir);
          return { freeBytes: s.bavail * s.bsize, totalBytes: s.blocks * s.bsize };
        } catch {
          return null;
        }
      }
    : null;

  return {
    now: input.now,
    mode: input.mode,
    baseUrl: input.baseUrl,
    query: input.query,
    probe: input.probe ?? makeHttpProbe(),
    env: (k) => env[k],
    version,
    poolStats: input.poolStats ?? null,
    orthanc: { baseUrl: orthancBase, headers: orthancHeaders(env), configured: !!orthancBase },
    ollama: { baseUrl: ollamaBase, model: ollamaModel, configured: !!ollamaBase },
    ohifUrl: ohif,
    publicBaseUrl: publicBase,
    displayToken,
    n8nUrl: stripSlash(env.N8N_HEALTH_URL || env.N8N_URL),
    evolutionUrl: stripSlash(env.EVOLUTION_API_URL),
    paymentGatewayConfigured: paymentConfigured,
    storageDir,
    diskFree,
    thresholds: DEFAULT_THRESHOLDS,
  };
}
