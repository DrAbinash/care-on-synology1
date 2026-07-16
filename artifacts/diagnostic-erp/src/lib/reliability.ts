/**
 * reliability.ts — small, pure reliability helpers for the reporting workspace
 * (MRI PR 5, "Reliability Hardening").
 *
 * The workspace already has robust data-loss protection (useLocalDraftBackup
 * autosave + 30-snapshot history, dirty/beforeunload/guardedLeave, optimistic
 * study locks, and the advisory finalize-safety gate). What was missing:
 *   - a bounded retry for transient network failures on save, so a momentary
 *     blip doesn't turn into a spurious "Save Failed" + a lost save;
 *   - an explicit offline check so Save/Finalize fail *clearly* (with the work
 *     preserved locally) instead of confusingly.
 *
 * This module is the pure logic behind both; the workspace wires it to the
 * existing saveRadiologyDraft call and the existing useOnlineStatus hook.
 * Pure and alias-free (root-testable).
 */

/** Exponential backoff delays (ms) for `retries` retry attempts. */
export function backoffDelays(retries: number, baseMs = 300, factor = 2, maxMs = 4000): number[] {
  const out: number[] = [];
  for (let i = 0; i < Math.max(0, retries); i++) {
    out.push(Math.min(maxMs, Math.round(baseMs * factor ** i)));
  }
  return out;
}

/**
 * Is this error worth retrying? Default-deny: only clearly-transient transport
 * failures retry. Validation / auth / conflict (4xx) errors never do — retrying
 * them just delays an unavoidable, honest failure.
 */
export function isTransientError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  return /failed to fetch|networkerror|network error|timeout|timed out|connection|econnreset|econnrefused|socket hang up|\b50[234]\b|bad gateway|gateway timeout|temporarily unavailable|load failed/.test(msg);
}

export interface RetryOptions {
  /** Retry attempts AFTER the first try (default 2 → up to 3 total). */
  retries?: number;
  baseDelayMs?: number;
  factor?: number;
  maxDelayMs?: number;
  /** Which errors to retry (default: isTransientError). */
  shouldRetry?: (err: unknown) => boolean;
  /** Injectable sleep so tests stay deterministic (default: setTimeout). */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Run `fn`, retrying transient failures with exponential backoff. The last
 * error is re-thrown when retries are exhausted or the error isn't retryable —
 * the caller's existing error handling then runs exactly as before.
 */
export async function retryWithBackoff<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 2;
  const shouldRetry = opts.shouldRetry ?? isTransientError;
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const delays = backoffDelays(retries, opts.baseDelayMs ?? 300, opts.factor ?? 2, opts.maxDelayMs ?? 4000);
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !shouldRetry(err)) throw err;
      await sleep(delays[attempt] ?? 0);
    }
  }
  throw lastErr;
}

/**
 * The message to show (and reason to abort) when a network action is attempted
 * offline — null when online (proceed normally). Reassures that nothing is lost.
 */
export function offlineBlockMessage(isOnline: boolean, action: "save" | "finalize"): string | null {
  if (isOnline) return null;
  return action === "finalize"
    ? "You appear to be offline — reconnect before finalizing. Your draft is preserved locally."
    : "You appear to be offline — reconnect to save to the server. Your work is preserved locally in the meantime.";
}
