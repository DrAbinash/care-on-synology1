import { describe, expect, test, beforeEach } from "vitest";
import {
  runBillingFanout,
  __billingFanoutStatsForTests,
  __resetBillingFanoutForTests,
} from "./billingFanoutGate";

describe("billingFanoutGate", () => {
  beforeEach(() => {
    __resetBillingFanoutForTests();
  });

  test("runs work and releases the slot", async () => {
    let ran = false;
    await runBillingFanout(async () => {
      ran = true;
      expect(__billingFanoutStatsForTests().active).toBe(1);
    });
    expect(ran).toBe(true);
    expect(__billingFanoutStatsForTests().active).toBe(0);
  });

  test("queues when at concurrency ceiling", async () => {
    const max = __billingFanoutStatsForTests().max;
    let released = false;
    const blockers: Array<() => void> = [];
    const hold = () =>
      runBillingFanout(
        () =>
          new Promise<void>((resolve) => {
            blockers.push(resolve);
          }),
      );

    const held = Array.from({ length: max }, () => hold());
    // Give microtasks a tick so acquires settle
    await Promise.resolve();
    expect(__billingFanoutStatsForTests().active).toBe(max);

    const gated = runBillingFanout(async () => {
      released = true;
    });
    await Promise.resolve();
    expect(released).toBe(false);
    expect(__billingFanoutStatsForTests().waiting).toBeGreaterThanOrEqual(1);

    blockers.forEach((r) => r());
    await Promise.all(held);
    await gated;
    expect(released).toBe(true);
    expect(__billingFanoutStatsForTests().active).toBe(0);
  });
});
