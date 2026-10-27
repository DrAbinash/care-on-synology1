/**
 * PHI-safe Ollama runner / GPU residency diagnostics.
 *
 * Used by the AI pipeline self-test to explain anomalous patterns such as
 * num_ctx=8192 CUDA OOM followed by num_ctx=16384 PASS — typically multiple
 * runners / KV caches still resident under default keep_alive.
 *
 * Never logs prompts, images, or patient identifiers.
 */

import { hardenedLocalRequest } from "@workspace/ai-providers";

export interface OllamaRunnerSnapshot {
  model: string;
  sizeBytes: number | null;
  sizeVramBytes: number | null;
  /** Context length reported for this runner, when present. */
  contextLength: number | null;
  expiresAt: string | null;
  done: boolean | null;
  /**
   * Accelerator this runner sits on, ONLY when the server reports one.
   * Ollama 0.35.0's GET /api/ps does not (verified against the v0.35.0
   * ProcessModelResponse fields: name/model/size/digest/details/expires_at/
   * size_vram/context_length), so on the clinic's 2× RTX 3050 host this is
   * normally null and the VRAM figures below cannot be attributed per card.
   * Read-if-present — never inferred.
   */
  device?: string | null;
}

export interface OllamaPsSnapshot {
  capturedAt: string;
  ok: boolean;
  httpStatus: number | null;
  runnerCount: number;
  runners: OllamaRunnerSnapshot[];
  totalSizeVramBytes: number | null;
  error?: string;
}

type PsModel = {
  name?: string;
  model?: string;
  size?: number;
  size_vram?: number;
  expires_at?: string;
  done?: boolean;
  details?: { family?: string };
  /** Some Ollama builds nest context under model_info / options. */
  context_length?: number;
  options?: { num_ctx?: number };
  model_info?: Record<string, unknown>;
  /** Read only if a future server reports it; absent on 0.35.0. */
  device?: string;
  devices?: string[];
};

function pickDevice(m: PsModel): string | null {
  const single = typeof m.device === "string" ? m.device.trim() : "";
  if (single) return single.slice(0, 60);
  if (Array.isArray(m.devices)) {
    const joined = m.devices.map((d) => String(d ?? "").trim()).filter(Boolean).join("+");
    if (joined) return joined.slice(0, 60);
  }
  return null;
}

function pickContextLength(m: PsModel): number | null {
  if (typeof m.context_length === "number" && Number.isFinite(m.context_length)) {
    return Math.floor(m.context_length);
  }
  if (typeof m.options?.num_ctx === "number" && Number.isFinite(m.options.num_ctx)) {
    return Math.floor(m.options.num_ctx);
  }
  const info = m.model_info ?? {};
  for (const [k, v] of Object.entries(info)) {
    if (/context_length|num_ctx/i.test(k) && typeof v === "number" && Number.isFinite(v)) {
      return Math.floor(v);
    }
  }
  return null;
}

/** GET /api/ps — currently loaded models / runners (PHI-safe). */
export async function fetchOllamaPs(
  endpointUrl: string,
  timeoutMs = 5000,
): Promise<OllamaPsSnapshot> {
  const capturedAt = new Date().toISOString();
  const base = endpointUrl.replace(/\/$/, "");
  try {
    // SECURITY: Bind to validated IP and reject redirects for Ollama diagnostics.
    const { response: resp } = await hardenedLocalRequest(`${base}/api/ps`, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) {
      return {
        capturedAt,
        ok: false,
        httpStatus: resp.status,
        runnerCount: 0,
        runners: [],
        totalSizeVramBytes: null,
        error: `GET /api/ps HTTP ${resp.status}`,
      };
    }
    const data = (await resp.json().catch(() => ({}))) as { models?: PsModel[] };
    const models = Array.isArray(data.models) ? data.models : [];
    const runners: OllamaRunnerSnapshot[] = models.map((m) => ({
      model: String(m.name || m.model || "unknown").slice(0, 120),
      sizeBytes: typeof m.size === "number" ? m.size : null,
      sizeVramBytes: typeof m.size_vram === "number" ? m.size_vram : null,
      contextLength: pickContextLength(m),
      expiresAt: typeof m.expires_at === "string" ? m.expires_at : null,
      done: typeof m.done === "boolean" ? m.done : null,
      device: pickDevice(m),
    }));
    const vramSum = runners.reduce((s, r) => s + (r.sizeVramBytes ?? 0), 0);
    return {
      capturedAt,
      ok: true,
      httpStatus: 200,
      runnerCount: runners.length,
      runners,
      totalSizeVramBytes: runners.some((r) => r.sizeVramBytes != null) ? vramSum : null,
    };
  } catch (err) {
    return {
      capturedAt,
      ok: false,
      httpStatus: null,
      runnerCount: 0,
      runners: [],
      totalSizeVramBytes: null,
      error: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
    };
  }
}

/**
 * Best-effort unload: POST /api/generate with keep_alive=0 so the next probe
 * does not stack a second KV cache on residual VRAM. Diagnostic-only —
 * never call from production draft / overnight paths without an explicit policy.
 */
export async function unloadOllamaModel(opts: {
  endpointUrl: string;
  model: string;
  timeoutMs?: number;
}): Promise<{ ok: boolean; elapsedMs: number; detail: string; psAfter: OllamaPsSnapshot }> {
  const t0 = Date.now();
  const base = opts.endpointUrl.replace(/\/$/, "");
  try {
    // SECURITY: Bind to validated IP and reject redirects for Ollama unload.
    const { response: resp } = await hardenedLocalRequest(`${base}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts.model,
        prompt: "",
        keep_alive: 0,
        stream: false,
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
    });
    const detail = resp.ok
      ? "unload requested (keep_alive=0)"
      : `unload HTTP ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 120)}`;
    // Brief settle so VRAM can free before next allocation.
    await new Promise((r) => setTimeout(r, 750));
    const psAfter = await fetchOllamaPs(opts.endpointUrl);
    return { ok: resp.ok, elapsedMs: Date.now() - t0, detail, psAfter };
  } catch (err) {
    const psAfter = await fetchOllamaPs(opts.endpointUrl);
    return {
      ok: false,
      elapsedMs: Date.now() - t0,
      detail: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
      psAfter,
    };
  }
}

function modelNameMatches(runnerName: string, target: string): boolean {
  const a = runnerName.toLowerCase();
  const b = target.toLowerCase();
  return a === b || a.startsWith(`${b}:`) || b.startsWith(`${a}:`) || a.includes(b) || b.includes(a);
}

/** True when /api/ps shows no runner for the target model (or zero runners). */
export function isModelAbsentFromPs(ps: OllamaPsSnapshot, model: string): boolean {
  if (!ps.ok) return false;
  if (ps.runnerCount === 0) return true;
  return !ps.runners.some((r) => modelNameMatches(r.model, model));
}

/**
 * Poll GET /api/ps until the model is absent (or timeout).
 * Used by GPU/context clean-runner probes after unload.
 */
export async function waitUntilModelAbsent(opts: {
  endpointUrl: string;
  model: string;
  timeoutMs?: number;
  pollMs?: number;
}): Promise<{
  absent: boolean;
  attempts: number;
  elapsedMs: number;
  lastPs: OllamaPsSnapshot;
}> {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const pollMs = opts.pollMs ?? 500;
  const t0 = Date.now();
  let attempts = 0;
  let lastPs = await fetchOllamaPs(opts.endpointUrl);
  attempts += 1;
  while (!isModelAbsentFromPs(lastPs, opts.model) && Date.now() - t0 < timeoutMs) {
    await new Promise((r) => setTimeout(r, pollMs));
    lastPs = await fetchOllamaPs(opts.endpointUrl);
    attempts += 1;
  }
  return {
    absent: isModelAbsentFromPs(lastPs, opts.model),
    attempts,
    elapsedMs: Date.now() - t0,
    lastPs,
  };
}

/** Unload then wait until /api/ps confirms the runner is gone. */
export async function unloadAndWaitUntilAbsent(opts: {
  endpointUrl: string;
  model: string;
  unloadTimeoutMs?: number;
  waitTimeoutMs?: number;
}): Promise<{
  ok: boolean;
  unload: Awaited<ReturnType<typeof unloadOllamaModel>>;
  wait: Awaited<ReturnType<typeof waitUntilModelAbsent>>;
  detail: string;
}> {
  const unload = await unloadOllamaModel({
    endpointUrl: opts.endpointUrl,
    model: opts.model,
    timeoutMs: opts.unloadTimeoutMs,
  });
  const wait = await waitUntilModelAbsent({
    endpointUrl: opts.endpointUrl,
    model: opts.model,
    timeoutMs: opts.waitTimeoutMs,
  });
  const ok = wait.absent;
  return {
    ok,
    unload,
    wait,
    detail: ok
      ? `unload+absent ok (${wait.elapsedMs}ms, ${wait.attempts} polls) · ${formatPsSummary(wait.lastPs)}`
      : `unload ok=${unload.ok} but runner still present after ${wait.elapsedMs}ms · ${formatPsSummary(wait.lastPs)}`,
  };
}

/** Compact one-line summary for step details / reports. */
export function formatPsSummary(ps: OllamaPsSnapshot): string {
  if (!ps.ok) return `ps=FAIL(${ps.error ?? "unknown"})`;
  if (ps.runnerCount === 0) return "ps=0 runners";
  const anyDevice = ps.runners.some((r) => r.device);
  const parts = ps.runners.map((r) => {
    const vram =
      r.sizeVramBytes != null ? `${Math.round(r.sizeVramBytes / (1024 * 1024))}MiB` : "?MiB";
    const ctx = r.contextLength != null ? `ctx=${r.contextLength}` : "ctx=?";
    const dev = r.device ? `@${r.device}` : "";
    return `${r.model}[${vram},${ctx}${dev}]`;
  });
  const total =
    ps.totalSizeVramBytes != null
      ? ` sumVramAcrossRunners=${Math.round(ps.totalSizeVramBytes / (1024 * 1024))}MiB`
      : "";
  // Ollama gives no per-accumulator breakdown, so a two-card host must not read
  // this total as one card's usage.
  const splitNote =
    ps.runners.length > 1 && !anyDevice
      ? " (sum spans all runners; this server reports no per-GPU split)"
      : "";
  return `ps=${ps.runnerCount} ${parts.join(" | ")}${total}${splitNote}`;
}
