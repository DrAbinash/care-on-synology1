// shouldEscalate is pure but lives in a module that imports `db` at top level;
// set a dummy DATABASE_URL and dynamic-import so lib/db's guard passes without a
// real database (the pg Pool is created lazily and never queried here).
import { describe, it, expect, beforeAll } from "vitest";

process.env.DATABASE_URL ||= "postgres://test:test@localhost:5432/test_integration";

let shouldEscalate: typeof import("./criticalEscalation").shouldEscalate;
beforeAll(async () => { shouldEscalate = (await import("./criticalEscalation")).shouldEscalate; });

const WINDOW = 30 * 60 * 1000; // 30 min
const finalisedAt = new Date("2026-07-22T10:00:00Z");

describe("shouldEscalate (critical-result re-notification decision)", () => {
  it("does NOT escalate a result already acknowledged", () => {
    expect(shouldEscalate({
      criticalAckStatus: "acknowledged", finalisedAt, lastEscalatedAt: null,
      escalationAttempts: 0, now: new Date(finalisedAt.getTime() + 10 * WINDOW),
    })).toBe(false);
  });

  it("does NOT escalate a result already marked escalated (final)", () => {
    expect(shouldEscalate({
      criticalAckStatus: "escalated", finalisedAt, lastEscalatedAt: finalisedAt,
      escalationAttempts: 3, now: new Date(finalisedAt.getTime() + 10 * WINDOW),
    })).toBe(false);
  });

  it("does NOT escalate before the window elapses (measured from finalisation)", () => {
    expect(shouldEscalate({
      criticalAckStatus: "pending", finalisedAt, lastEscalatedAt: null,
      escalationAttempts: 0, now: new Date(finalisedAt.getTime() + WINDOW - 1),
    })).toBe(false);
  });

  it("escalates once the window has elapsed since finalisation (first attempt)", () => {
    expect(shouldEscalate({
      criticalAckStatus: "pending", finalisedAt, lastEscalatedAt: null,
      escalationAttempts: 0, now: new Date(finalisedAt.getTime() + WINDOW),
    })).toBe(true);
  });

  it("measures the window from the LAST escalation, not finalisation", () => {
    const lastEscalatedAt = new Date(finalisedAt.getTime() + WINDOW);
    // Only 1ms after the last escalation → too soon.
    expect(shouldEscalate({
      criticalAckStatus: "pending", finalisedAt, lastEscalatedAt,
      escalationAttempts: 1, now: new Date(lastEscalatedAt.getTime() + 1),
    })).toBe(false);
    // A full window after the last escalation → escalate again.
    expect(shouldEscalate({
      criticalAckStatus: "pending", finalisedAt, lastEscalatedAt,
      escalationAttempts: 1, now: new Date(lastEscalatedAt.getTime() + WINDOW),
    })).toBe(true);
  });

  it("caps escalation at maxAttempts (no infinite paging)", () => {
    expect(shouldEscalate({
      criticalAckStatus: "pending", finalisedAt, lastEscalatedAt: finalisedAt,
      escalationAttempts: 3, now: new Date(finalisedAt.getTime() + 100 * WINDOW), maxAttempts: 3,
    })).toBe(false);
  });

  it("respects a custom shorter window", () => {
    expect(shouldEscalate({
      criticalAckStatus: "pending", finalisedAt, lastEscalatedAt: null,
      escalationAttempts: 0, now: new Date(finalisedAt.getTime() + 60_000), windowMs: 60_000,
    })).toBe(true);
  });

  it("never escalates without an anchor time (no finalisedAt, no lastEscalatedAt)", () => {
    expect(shouldEscalate({
      criticalAckStatus: "pending", finalisedAt: null, lastEscalatedAt: null,
      escalationAttempts: 0, now: new Date(),
    })).toBe(false);
  });
});
