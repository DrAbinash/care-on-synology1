/**
 * Bounds post-commit billing fan-out (studies / tokens / vouchers) so a burst
 * of Save & Print cannot exhaust the pg pool (max ~25). Without this, each
 * save fires several fire-and-forget DB consumers on top of the request path.
 */
const MAX_CONCURRENT = Math.max(
  1,
  Math.min(32, Number(process.env.BILLING_FANOUT_CONCURRENCY ?? 4) || 4),
);

let active = 0;
const waiters: Array<() => void> = [];

function release(): void {
  active = Math.max(0, active - 1);
  const next = waiters.shift();
  if (next) next();
}

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    waiters.push(() => {
      active += 1;
      resolve();
    });
  });
}

/** Run fn under the billing fan-out concurrency gate. */
export async function runBillingFanout<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}

/** Fire-and-forget with the same gate (errors stay inside fn / .catch). */
export function enqueueBillingFanout(fn: () => Promise<unknown>): void {
  void runBillingFanout(fn);
}

/** Test helpers */
export function __billingFanoutStatsForTests(): { active: number; waiting: number; max: number } {
  return { active, waiting: waiters.length, max: MAX_CONCURRENT };
}

export function __resetBillingFanoutForTests(): void {
  active = 0;
  waiters.length = 0;
}
