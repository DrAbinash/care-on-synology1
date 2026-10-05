/**
 * operationsContext.ts — builds a real OpsCtx (DB query fn, HTTP probe, resolved
 * Orthanc/OHIF/version/tokens) shared by the admin route and the smoke CLI.
 *
 * Intentionally imports only Node built-ins (no @workspace/db) so the CLI can
 * reuse it with its own pg pool. Callers inject the `query` function.
 * The one non-builtin import is @workspace/ai-providers/canonical — a leaf
 * module with no imports of its own, so it still pulls in no database pool.
 */
import { createHash } from "node:crypto";
import { readFileSync, statfsSync } from "node:fs";
import { resolve } from "node:path";
import {
  CANONICAL_LOCAL_CHAT_VISION_MODEL,
  CANONICAL_OLLAMA_ENDPOINT,
} from "@workspace/ai-providers/canonical";
import { DEFAULT_THRESHOLDS, type OpsCtx, type ProbeFn, type ProbeResult, type QueryFn } from "./operationsChecks";
import type { OpsVersionInfo } from "./operationsHealth";

/** version.json (best-effort) merged with env overrides — no secrets.
 *
 * Dockerfile/compose defaults (`unknown`, `0`, `dev`, `0.0.0`) MUST NOT drown
 * a stamped version.json when the image was rebuilt without deploy-synology
 * build-args. Treat those placeholders as unset so the baked version.json can
 * still surface ERP version / build / release name. Git SHA still requires a
 * real build-arg (or version.json.gitCommit) — we never invent one.
 */
export function resolveVersionInfo(env: NodeJS.ProcessEnv = process.env): OpsVersionInfo {
  let vj: {
    version?: string;
    buildNumber?: number;
    releaseName?: string;
    gitCommit?: string;
    gitBranch?: string;
    buildDate?: string;
  } = {};
  for (const p of [
    resolve(process.cwd(), "version.json"),
    "/app/version.json",
    resolve(process.cwd(), "..", "..", "version.json"),
  ]) {
    try { vj = JSON.parse(readFileSync(p, "utf8")); break; } catch { /* try next path */ }
  }
  const unset = (v: string | undefined | null, placeholders: string[]) => {
    const t = (v ?? "").trim();
    if (!t || placeholders.includes(t)) return undefined;
    return t;
  };
  return {
    version: unset(env.ERP_VERSION, ["0.0.0"]) || vj.version || "0.0.0",
    build: unset(env.BUILD_NUMBER, ["0"]) || (vj.buildNumber != null ? String(vj.buildNumber) : "0"),
    releaseName: unset(env.RELEASE_NAME, ["dev"]) || vj.releaseName || null,
    commit: unset(env.GIT_COMMIT, ["unknown"]) || unset(vj.gitCommit, ["unknown"]) || "unknown",
    branch: unset(env.GIT_BRANCH, ["unknown"]) || unset(vj.gitBranch, ["unknown"]) || null,
    buildTime: unset(env.BUILD_DATE, ["unknown"]) || unset(vj.buildDate, ["unknown"]) || null,
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
  const ollamaBase = stripSlash(
    env.OLLAMA_URL ||
      env.OLLAMA_PRIMARY_URL ||
      env.OLLAMA_BASE_URL ||
      env.OLLAMA_FALLBACK_URL ||
      pacs["ollama_url"] ||
      CANONICAL_OLLAMA_ENDPOINT,
  );
  // Canonical local chat/vision model (embeddings remain nomic-embed-text separately).
  const ollamaModel =
    env.OLLAMA_DEFAULT_MODEL ||
    env.AI_MODEL_VISION ||
    env.AI_MODEL_STANDARD ||
    pacs["ollama_model"] ||
    CANONICAL_LOCAL_CHAT_VISION_MODEL;

  // Vendor-neutral local OpenAI-compatible server, if the clinic saved one. Its
  // saved endpoint is the versioned base (…/v1); inference supplies the saved
  // key, while ops probes GET /models without one.
  let localOpenAiBase: string | null = null;
  let localOpenAiModel: string | null = null;
  let localOpenAiEnabled = true;
  try {
    const rows = await input.query(
      "SELECT endpoint_url, default_model, is_enabled FROM ai_provider_settings WHERE provider = 'local_openai_compatible' LIMIT 1",
    );
    const row = rows[0];
    if (row) {
      localOpenAiEnabled = row.is_enabled !== false;
      localOpenAiBase = stripSlash(row.endpoint_url ? String(row.endpoint_url) : null);
      localOpenAiModel = row.default_model ? String(row.default_model).trim() : null;
    }
  } catch {
    // Table absent / not queryable in tests — treated as not configured.
    localOpenAiBase = null;
    localOpenAiModel = null;
  }
  const envOpenAiBase = stripSlash(env.LOCAL_OPENAI_COMPATIBLE_BASE_URL);
  if (!localOpenAiBase) localOpenAiBase = envOpenAiBase;
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
    localOpenAi: {
      baseUrl: localOpenAiBase,
      model: localOpenAiModel,
      configured: !!localOpenAiBase,
      enabled: localOpenAiEnabled,
    },
    ohifUrl: ohif,
    publicBaseUrl: publicBase,
    displayToken,
    n8nUrl: stripSlash(env.N8N_HEALTH_URL || env.N8N_URL),
    paymentGatewayConfigured: paymentConfigured,
    storageDir,
    diskFree,
    thresholds: DEFAULT_THRESHOLDS,
  };
}
