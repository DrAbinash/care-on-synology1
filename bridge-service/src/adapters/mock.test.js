import { describe, it, expect } from "vitest";
import mock from "./mock.js";
import { validateAdapter } from "./index.js";

describe("mock fingerprint adapter", () => {
  it("satisfies the adapter contract", () => {
    expect(() => validateAdapter(mock, "mock")).not.toThrow();
    expect(typeof mock.threshold).toBe("number");
  });

  it("captures a deterministic template and matches itself (identity → 100)", async () => {
    const a = await mock.capture();
    const b = await mock.capture();
    expect(typeof a.template).toBe("string");
    expect(a.template).toBe(b.template); // same mock finger → same template
    expect(await mock.match(a.template, b.template)).toBe(100);
  });

  it("does not match a different template (→ 0, below threshold)", async () => {
    const a = await mock.capture();
    const score = await mock.match(a.template, "some-other-template");
    expect(score).toBe(0);
    expect(score).toBeLessThan(mock.threshold);
  });

  it("reports the device as connected", async () => {
    const s = await mock.status();
    expect(s.deviceConnected).toBe(true);
  });
});

describe("adapter contract validation", () => {
  it("rejects an adapter missing a required method", () => {
    expect(() => validateAdapter({ status() {}, capture() {}, threshold: 50 }, "broken")).toThrow(/match/);
  });

  it("rejects an adapter without a numeric threshold", () => {
    expect(() => validateAdapter({ status() {}, capture() {}, match() {} }, "broken")).toThrow(/threshold/);
  });
});
