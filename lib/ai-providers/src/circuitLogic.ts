/**
 * Circuit-breaker + timeout — pure logic (Phase P2 / Gate G7).
 * No DB. Unit-tested directly. The DB wrappers live in circuitBreaker.ts.
 */
export type CircuitState = "closed" | "open";

export interface CircuitOptions {
  /** consecutive failures (most-recent-first) that trip the breaker */
  threshold?: number;
  /** how many recent probes to consider */
  window?: number;
}

/** Decide the circuit state from recent probes (most-recent-first). */
export function computeCircuitState(
  recentProbes: Array<{ isSuccess: boolean }>,
  opts: CircuitOptions = {},
): CircuitState {
  const threshold = opts.threshold ?? 3;
  const window = opts.window ?? Math.max(threshold, 5);
  const probes = recentProbes.slice(0, window);
  if (probes.length < threshold) return "closed"; // not enough signal to trip
  let consecutiveFailures = 0;
  for (const p of probes) {
    if (p.isSuccess) break;
    consecutiveFailures++;
  }
  return consecutiveFailures >= threshold ? "open" : "closed";
}

/** Run a promise with a timeout, rejecting if it overruns. */
export async function withTimeout<T>(p: Promise<T>, ms: number, label = "operation"): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}
