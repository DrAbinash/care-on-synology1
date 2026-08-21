/**
 * Pure classification helpers used by claim + UI — no DB.
 * Ensures every consumer can share the same held/eligible decision boundary.
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_OVERNIGHT_OPS,
  isJobHeldByLegacyBacklog,
  parseOvernightOpsJson,
  resolveLegacyHoldClaimFilter,
  serializeOvernightOps,
} from "./overnightOpsControls";

describe("overnight queue classification contract", () => {
  const cutover = "2026-08-21T14:00:00.000Z";

  it("every hold-count consumer sees identical held vs eligible boundary", () => {
    const ops = parseOvernightOpsJson({
      ...DEFAULT_OVERNIGHT_OPS,
      legacyHoldBefore: cutover,
      legacyBacklogHold: true,
      legacyHoldExplicitlyReleased: false,
    });
    const filter = resolveLegacyHoldClaimFilter(ops);
    expect(ops.legacyBacklogHold).toBe(true);
    expect(filter?.holdBefore).toBe(cutover);

    const samples = [
      { id: 4376, createdAt: "2026-08-20T00:00:00.000Z", expectHeld: true },
      { id: 5000, createdAt: cutover, expectHeld: false },
      { id: 5001, createdAt: "2026-08-21T15:00:00.000Z", expectHeld: false },
    ];
    for (const s of samples) {
      expect(isJobHeldByLegacyBacklog(ops, s)).toBe(s.expectHeld);
    }
  });

  it("RELEASED only when explicitly released — not when boolean wiped", () => {
    const wiped = parseOvernightOpsJson({
      legacyHoldBefore: cutover,
      legacyBacklogHold: false,
    });
    expect(wiped.legacyBacklogHold).toBe(true);
    expect(resolveLegacyHoldClaimFilter(wiped)).not.toBeNull();

    const explicit = parseOvernightOpsJson({
      legacyHoldBefore: cutover,
      legacyBacklogHold: false,
      legacyHoldExplicitlyReleased: true,
    });
    expect(explicit.legacyBacklogHold).toBe(false);
    expect(resolveLegacyHoldClaimFilter(explicit)).toBeNull();
  });

  it("serialize/parse keeps explicit release marker", () => {
    const ops = parseOvernightOpsJson({
      legacyHoldBefore: cutover,
      legacyHoldExplicitlyReleased: true,
    });
    const round = parseOvernightOpsJson(serializeOvernightOps(ops));
    expect(round.legacyHoldExplicitlyReleased).toBe(true);
    expect(round.legacyBacklogHold).toBe(false);
  });
});
