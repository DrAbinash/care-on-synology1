import { describe, it, expect } from "vitest";
import { computeCircuitState, withTimeout } from "./circuitLogic";

const fail = { isSuccess: false };
const ok = { isSuccess: true };

describe("circuit breaker logic (G7)", () => {
  it("stays closed without enough signal", () => {
    expect(computeCircuitState([fail, fail], { threshold: 3 })).toBe("closed");
  });

  it("opens after N consecutive recent failures", () => {
    expect(computeCircuitState([fail, fail, fail], { threshold: 3 })).toBe("open");
  });

  it("stays closed when a recent success breaks the failure streak", () => {
    expect(computeCircuitState([ok, fail, fail, fail], { threshold: 3 })).toBe("closed");
  });

  it("counts from the most-recent probe only", () => {
    expect(computeCircuitState([fail, fail, fail, ok, ok], { threshold: 3 })).toBe("open");
  });
});

describe("withTimeout (G7)", () => {
  it("resolves a fast promise", async () => {
    await expect(withTimeout(Promise.resolve(42), 1000)).resolves.toBe(42);
  });

  it("rejects when the promise overruns", async () => {
    const slow = new Promise((res) => setTimeout(res, 50));
    await expect(withTimeout(slow, 5, "slow-op")).rejects.toThrow(/timed out/);
  });
});
