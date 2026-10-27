/**
 * Eviction telemetry for the Smart Dictation composer.
 *
 * `keep_alive:"30m"` keeps the composer model resident, but the pin dies the
 * moment another model (vision, medgemma) claims the GPU — the next dictation
 * then pays the model reload on top of compose time (measured 19.4 s reload,
 * 55.7 s total vs ~35 s warm). The radiologist sees a one-off slowdown; this
 * module names it in the logs the moment it happens so the operator knows the
 * cause (model reload after another workload) and the non-fix (the composer
 * is healthy — expect this whenever vision runs on the same GPU).
 *
 * Deliberately conservative: needs a warm baseline (>= 5 prior samples), a
 * stable median (<= 40 s), and a current latency at least 20 s AND 1.6x above
 * that median. Warm-run jitter can never trip it.
 */
import { logger } from "../logger";

/** In-process rolling window of recent compose latencies, per model. */
const windows = new Map<string, number[]>();

const WINDOW_SIZE = 20;
const MIN_SAMPLES = 5;
/** Above this median the model is not "warm-fast" — a slow baseline is not an eviction signature. */
const MAX_WARM_MEDIAN_MS = 40_000;
/** The measured reload penalty is ~19.4 s; require at least +20 s. */
const MIN_JUMP_MS = 20_000;
/** And multiplicatively: current >= 1.6x median. */
const JUMP_FACTOR = 1.6;

export function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export type EvictionVerdict = {
  suspected: boolean;
  median: number;
  samples: number;
};

/** Pure — no state, no logging; the unit under test. */
export function evictionHeuristic(recentLatenciesMs: number[], currentLatencyMs: number): EvictionVerdict {
  const median = medianOf(recentLatenciesMs);
  const samples = recentLatenciesMs.length;
  if (samples < MIN_SAMPLES) return { suspected: false, median, samples };
  if (median > MAX_WARM_MEDIAN_MS) return { suspected: false, median, samples };
  const suspected =
    currentLatencyMs >= median + MIN_JUMP_MS && currentLatencyMs >= median * JUMP_FACTOR;
  return { suspected, median, samples };
}

/**
 * Record one successful compose latency and warn when the signature matches a
 * model eviction. PHI-safe by construction: model name, latency numbers and a
 * request id only — never the transcript, prompt or response.
 */
export function recordComposeLatency(model: string, latencyMs: number, requestId: string): EvictionVerdict {
  const window = windows.get(model) ?? [];
  const verdict = evictionHeuristic(window, latencyMs);
  window.push(latencyMs);
  if (window.length > WINDOW_SIZE) window.splice(0, window.length - WINDOW_SIZE);
  windows.set(model, window);
  if (verdict.suspected) {
    logger.warn(
      {
        requestId,
        model,
        latencyMs,
        warmMedianMs: verdict.median,
        samples: verdict.samples,
        heuristic: "possible_model_eviction",
        note: "Latency jumped far above the warm baseline — the keep_alive pin dies when another model (vision) claims the GPU; the next compose pays the reload. Expect this after vision workloads; the composer itself is healthy.",
      },
      "voiceReportComposer: possible model eviction detected",
    );
  }
  return verdict;
}

/** Test helper — forget the rolling windows. */
export function resetComposerTelemetry(): void {
  windows.clear();
}
