import { describe, it, expect } from "vitest";
import {
  DEFAULT_OVERNIGHT_OPS,
  addLegacyReleasedJobIds,
  initializeLegacyBacklogCutover,
  isJobHeldByLegacyBacklog,
  parseOvernightOpsJson,
  releaseAllLegacyBacklog,
  resolveLegacyHoldClaimFilter,
  serializeOvernightOps,
  shouldBypassLegacyHoldForClaim,
  type OvernightOpsControls,
} from "./overnightOpsControls";

describe("legacy backlog hold", () => {
  const cutover = new Date("2026-08-21T10:00:00.000Z");

  it("auto-initializes cutover once and enables hold", () => {
    const first = initializeLegacyBacklogCutover({ ...DEFAULT_OVERNIGHT_OPS }, cutover);
    expect(first.initialized).toBe(true);
    expect(first.ops.legacyBacklogHold).toBe(true);
    expect(first.ops.legacyHoldBefore).toBe(cutover.toISOString());

    const second = initializeLegacyBacklogCutover(first.ops, new Date("2026-08-22T00:00:00Z"));
    expect(second.initialized).toBe(false);
    expect(second.ops.legacyHoldBefore).toBe(cutover.toISOString());
  });

  it("restart round-trip preserves cutover and hold state", () => {
    const ops = {
      ...DEFAULT_OVERNIGHT_OPS,
      legacyBacklogHold: true,
      legacyHoldBefore: cutover.toISOString(),
      legacyReleasedJobIds: [42, 99],
    };
    const again = parseOvernightOpsJson(serializeOvernightOps(ops));
    expect(again.legacyBacklogHold).toBe(true);
    expect(again.legacyHoldBefore).toBe(cutover.toISOString());
    expect(again.legacyReleasedJobIds).toEqual([42, 99]);
  });

  it("holds pre-cutover pending/retrying; post-cutover is eligible", () => {
    const ops = {
      ...DEFAULT_OVERNIGHT_OPS,
      legacyBacklogHold: true,
      legacyHoldBefore: cutover.toISOString(),
    };
    expect(
      isJobHeldByLegacyBacklog(ops, {
        id: 1,
        createdAt: new Date("2026-08-20T12:00:00Z"),
      }),
    ).toBe(true);
    expect(
      isJobHeldByLegacyBacklog(ops, {
        id: 2,
        createdAt: new Date("2026-08-21T11:00:00Z"),
      }),
    ).toBe(false);
  });

  it("released job id bypasses hold without deleting", () => {
    let ops: OvernightOpsControls = {
      ...DEFAULT_OVERNIGHT_OPS,
      legacyBacklogHold: true,
      legacyHoldBefore: cutover.toISOString(),
    };
    ops = addLegacyReleasedJobIds(ops, [7]);
    expect(isJobHeldByLegacyBacklog(ops, { id: 7, createdAt: new Date("2026-08-01T00:00:00Z") })).toBe(false);
    expect(isJobHeldByLegacyBacklog(ops, { id: 8, createdAt: new Date("2026-08-01T00:00:00Z") })).toBe(true);
    expect(ops.legacyReleasedJobIds).toEqual([7]);
  });

  it("release selected only adds those ids", () => {
    const ops = addLegacyReleasedJobIds(
      {
        ...DEFAULT_OVERNIGHT_OPS,
        legacyBacklogHold: true,
        legacyHoldBefore: cutover.toISOString(),
        legacyReleasedJobIds: [1],
      },
      [2, 2, 3],
    );
    expect(ops.legacyReleasedJobIds).toEqual([1, 2, 3]);
  });

  it("release all turns hold off but keeps cutover marker", () => {
    const next = releaseAllLegacyBacklog({
      ...DEFAULT_OVERNIGHT_OPS,
      legacyBacklogHold: true,
      legacyHoldBefore: cutover.toISOString(),
      legacyReleasedJobIds: [1],
    });
    expect(next.legacyBacklogHold).toBe(false);
    expect(next.legacyHoldBefore).toBe(cutover.toISOString());
    expect(resolveLegacyHoldClaimFilter(next)).toBeNull();
  });

  it("explicit canary jobId bypasses hold filter", () => {
    expect(shouldBypassLegacyHoldForClaim({ jobId: 123 })).toBe(true);
    expect(shouldBypassLegacyHoldForClaim({})).toBe(false);
    expect(shouldBypassLegacyHoldForClaim({ jobId: null })).toBe(false);
  });

  it("parse defaults keep legacy hold off until cutover init", () => {
    expect(parseOvernightOpsJson("{}").legacyBacklogHold).toBe(false);
    expect(parseOvernightOpsJson("{}").legacyHoldBefore).toBeNull();
    expect(DEFAULT_OVERNIGHT_OPS.legacyReleasedJobIds).toEqual([]);
  });
});
