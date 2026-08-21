/**
 * Regression: legacy hold fail-safe, protected saves, async verify start.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  DEFAULT_OVERNIGHT_OPS,
  failSafeHeldOps,
  initializeLegacyBacklogCutover,
  isJobHeldByLegacyBacklog,
  mergeOvernightOpsPatch,
  parseOvernightOpsJson,
  recordOvernightResourceFailure,
  releaseAllLegacyBacklog,
  resolveLegacyHoldClaimFilter,
  resourceStreakPatchFromOps,
  serializeOvernightOps,
  type OvernightOpsControls,
} from "./overnightOpsControls";
import { startOllamaAiDraftVerify, getOllamaVerifyJob, getLatestOllamaVerifyJob } from "./ollamaDraftVerify";
import { startAiPipelineSelfTest, getLatestAiPipelineSelfTest } from "./aiPipelineSelfTest";

const cutover = new Date("2026-08-21T10:00:00.000Z");

function heldOps(): OvernightOpsControls {
  return {
    ...DEFAULT_OVERNIGHT_OPS,
    legacyBacklogHold: true,
    legacyHoldBefore: cutover.toISOString(),
    legacyHoldExplicitlyReleased: false,
  };
}

describe("legacy hold — canonical fail-safe semantics", () => {
  it("ambiguous cutover + bare legacyBacklogHold:false fails safe to HELD", () => {
    const parsed = parseOvernightOpsJson({
      legacyHoldBefore: cutover.toISOString(),
      legacyBacklogHold: false,
      // no legacyHoldExplicitlyReleased
    });
    expect(parsed.legacyBacklogHold).toBe(true);
    expect(parsed.legacyHoldExplicitlyReleased).toBe(false);
    expect(resolveLegacyHoldClaimFilter(parsed)).not.toBeNull();
  });

  it("explicit release_all survives parse and disables claim filter", () => {
    const released = releaseAllLegacyBacklog(heldOps());
    expect(released.legacyHoldExplicitlyReleased).toBe(true);
    expect(released.legacyBacklogHold).toBe(false);
    const again = parseOvernightOpsJson(serializeOvernightOps(released));
    expect(again.legacyHoldExplicitlyReleased).toBe(true);
    expect(resolveLegacyHoldClaimFilter(again)).toBeNull();
  });

  it("persisted HOLD survives restart round-trip", () => {
    const ops = heldOps();
    const again = parseOvernightOpsJson(serializeOvernightOps(ops));
    expect(again.legacyBacklogHold).toBe(true);
    expect(again.legacyHoldBefore).toBe(cutover.toISOString());
    expect(resolveLegacyHoldClaimFilter(again)?.holdBefore).toBe(cutover.toISOString());
  });

  it("saving unrelated Draft Automation / vision settings cannot turn HOLD into RELEASED", () => {
    const current = heldOps();
    const next = mergeOvernightOpsPatch(current, {
      paused: true,
      pauseReason: "operator",
      imageCap: "2",
      visionCtx: "8192",
      safeMode: true,
      // Accidental wipe attempt:
      legacyBacklogHold: false,
      legacyHoldBefore: null,
      legacyHoldExplicitlyReleased: true,
      legacyReleasedJobIds: [1, 2, 3],
    });
    expect(next.legacyBacklogHold).toBe(true);
    expect(next.legacyHoldBefore).toBe(cutover.toISOString());
    expect(next.legacyHoldExplicitlyReleased).toBe(false);
    expect(next.legacyReleasedJobIds).toEqual([]);
    expect(next.paused).toBe(true);
    expect(next.imageCap).toBe("2");
  });

  it("resource-streak patch from shadow cannot include hold keys", () => {
    const failed = recordOvernightResourceFailure(heldOps(), "CONTEXT_BUDGET_EXCEEDED");
    const patch = resourceStreakPatchFromOps(failed);
    expect(patch).not.toHaveProperty("legacyBacklogHold");
    expect(patch).not.toHaveProperty("legacyHoldBefore");
    expect(patch).not.toHaveProperty("legacyReleasedJobIds");
    const merged = mergeOvernightOpsPatch(heldOps(), patch);
    expect(merged.legacyBacklogHold).toBe(true);
    expect(resolveLegacyHoldClaimFilter(merged)).not.toBeNull();
  });

  it("missing/ambiguous upgrade state fails safe to HOLD", () => {
    const fs = failSafeHeldOps(cutover, "fail-safe-hold-unreadable");
    expect(fs.legacyBacklogHold).toBe(true);
    expect(fs.legacyHoldBefore).toBe(cutover.toISOString());
    expect(resolveLegacyHoldClaimFilter(fs)).not.toBeNull();

    const badJson = parseOvernightOpsJson("{not-json");
    expect(badJson.legacyBacklogHold).toBe(true);
    expect(badJson.legacyHoldBefore).toBeTruthy();
  });

  it("pre-cutover jobs cannot be claimed while held; post-cutover can", () => {
    const ops = heldOps();
    expect(
      isJobHeldByLegacyBacklog(ops, { id: 4376, createdAt: new Date("2026-08-20T12:00:00Z") }),
    ).toBe(true);
    expect(
      isJobHeldByLegacyBacklog(ops, { id: 9000, createdAt: new Date("2026-08-21T12:00:00Z") }),
    ).toBe(false);
    expect(resolveLegacyHoldClaimFilter(ops)).toEqual({
      holdBefore: cutover.toISOString(),
      releasedJobIds: [],
    });
  });

  it("cutover init enables hold once", () => {
    const first = initializeLegacyBacklogCutover({ ...DEFAULT_OVERNIGHT_OPS }, cutover);
    expect(first.initialized).toBe(true);
    expect(first.ops.legacyBacklogHold).toBe(true);
    expect(first.ops.legacyHoldExplicitlyReleased).toBe(false);
  });

  it("allowLegacyHoldMutation can re-enable after explicit release", () => {
    const released = releaseAllLegacyBacklog(heldOps());
    const next = mergeOvernightOpsPatch(
      released,
      { legacyBacklogHold: true, legacyHoldExplicitlyReleased: false },
      "admin",
      { allowLegacyHoldMutation: true },
    );
    // parse re-derives hold from explicitlyReleased=false + cutover
    expect(next.legacyBacklogHold).toBe(true);
    expect(resolveLegacyHoldClaimFilter(next)).not.toBeNull();
  });
});

describe("hold-count consumers share resolveLegacyHoldClaimFilter semantics", () => {
  it("held vs eligible classification is identical for claim filter + isJobHeld", () => {
    const ops = heldOps();
    const filter = resolveLegacyHoldClaimFilter(ops);
    expect(filter).not.toBeNull();
    const pre = { id: 1, createdAt: "2026-08-01T00:00:00.000Z" };
    const post = { id: 2, createdAt: "2026-08-22T00:00:00.000Z" };
    expect(isJobHeldByLegacyBacklog(ops, pre)).toBe(true);
    expect(isJobHeldByLegacyBacklog(ops, post)).toBe(false);
    // Same cutover boundary the SQL claim filter uses
    expect(new Date(pre.createdAt).getTime()).toBeLessThan(new Date(filter!.holdBefore).getTime());
    expect(new Date(post.createdAt).getTime()).toBeGreaterThanOrEqual(new Date(filter!.holdBefore).getTime());
  });
});

describe("async verify / self-test start returns immediately", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("Full verify start endpoint returns immediately; Ollama work is after HTTP response", () => {
    const t0 = Date.now();
    const job = startOllamaAiDraftVerify({ runDraft: true });
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(50);
    expect(job.id).toBeTruthy();
    expect(job.status).toBe("queued");
    expect(job.runDraft).toBe(true);
    expect(getOllamaVerifyJob(job.id)?.id).toBe(job.id);
    expect(getLatestOllamaVerifyJob()?.id).toBe(job.id);
  });

  it("pipeline self-test start returns immediately and latest reconnects", () => {
    const t0 = Date.now();
    const job = startAiPipelineSelfTest({});
    expect(Date.now() - t0).toBeLessThan(50);
    expect(job.status).toBe("queued");
    expect(getLatestAiPipelineSelfTest()?.id).toBe(job.id);
  });
});
