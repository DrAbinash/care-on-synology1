// clock.ts — monotonic time source for engine runtime measurement.
// Uses performance.now() when available (browser + Node), else Date.now().
export function nowMs(): number {
  const perf = (globalThis as { performance?: { now?: () => number } }).performance;
  return typeof perf?.now === "function" ? perf.now() : Date.now();
}
