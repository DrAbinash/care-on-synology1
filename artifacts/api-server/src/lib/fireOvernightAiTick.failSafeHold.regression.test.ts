/**
 * Regression: getOvernightOpsControls() catch → failSafeHeldOps() must keep
 * fireOvernightAiTick() fail-closed for ordinary claims.
 *
 * Proves the interaction between clinicalConfigService's unreadable-ops
 * fallback and cron's hold filter (not a redesign — current contract only).
 */
import { afterAll, afterEach, describe, expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { hasDatabaseUrl } from "../testSupport/apiTestApp";
import { failSafeHeldOps, resolveLegacyHoldClaimFilter } from "./ai/overnightOpsControls";

const dbAvailable = hasDatabaseUrl();

describe.skipIf(!dbAvailable)("fireOvernightAiTick × failSafeHeldOps (unreadable overnight ops)", () => {
  const marker = `vitest-failsafe-${randomUUID().slice(0, 8)}`;
  const ids: number[] = [];
  const cutover = new Date("2026-08-21T14:00:00.000Z");

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (!dbAvailable) return;
    const { db } = await import("@workspace/db");
    const { dicomRetryQueueTable } = await import("@workspace/db/schema");
    if (ids.length > 0) {
      const { inArray } = await import("drizzle-orm");
      await db.delete(dicomRetryQueueTable).where(inArray(dicomRetryQueueTable.id, ids));
    }
  }, 30_000);

  test("failSafeHeldOps fallback: ordinary tick cannot claim pre-cutover job; canary-by-jobId still can", async () => {
    const { db } = await import("@workspace/db");
    const { dicomRetryQueueTable } = await import("@workspace/db/schema");
    const { AI_SHADOW_PIPELINE_JOB } = await import("./ai/shadowPipeline");
    const clinical = await import("./ai/clinicalConfigService");
    const visionCfg = await import("./ai/overnightVisionConfig");
    const peak = await import("./clinicPeakHours");
    const handlers = await import("./radiologyJobHandlers");
    const { fireOvernightAiTick } = await import("../cron");

    // Simulate getOvernightOpsControls() catch path: return fail-safe HOLD, do not throw.
    const failSafe = failSafeHeldOps(cutover, "fail-safe-hold-unreadable");
    expect(resolveLegacyHoldClaimFilter(failSafe)).toEqual({
      holdBefore: cutover.toISOString(),
      releasedJobIds: [],
    });
    expect(failSafe.legacyBacklogHold).toBe(true);
    expect(failSafe.legacyHoldExplicitlyReleased).toBe(false);

    vi.spyOn(clinical, "getOvernightOpsControls").mockResolvedValue(failSafe);
    vi.spyOn(clinical, "getSchedulerConfig").mockResolvedValue({
      ...clinical.DEFAULT_SCHEDULER,
      maxConcurrentJobs: 1,
    });
    vi.spyOn(peak, "isClinicPeakHours").mockReturnValue(false);
    vi.spyOn(visionCfg, "getOvernightVisionInferenceOptions").mockResolvedValue({
      model: "qwen3-vl:8b",
      endpointUrl: "http://127.0.0.1:11434",
      numCtx: 8192,
      think: false,
      temperature: 0.1,
      concurrency: 1,
      runtime: {} as never,
      ops: failSafe,
      policy: {
        model: "qwen3-vl:8b",
        endpointUrl: "http://127.0.0.1:11434",
        numCtx: 8192,
        numCtxSource: "test",
        configuredNumCtx: 8192,
        think: false,
        temperature: 0.1,
        concurrency: 1,
        maxImages: 1,
        imageCapReason: "test",
        safeMode: false,
        overnightPaused: false,
        pauseReason: null,
        maxTokens: 4096,
        timeoutMs: 600_000,
        ops: failSafe,
        reason: "test",
      },
    });

    const originalHandler = handlers.RADIOLOGY_JOB_HANDLERS[AI_SHADOW_PIPELINE_JOB];
    handlers.RADIOLOGY_JOB_HANDLERS[AI_SHADOW_PIPELINE_JOB] = async () => ({
      ok: true,
      detail: "vitest-failsafe-handler",
    });

    try {
      const uid = `1.2.840.vitest.failsafe.${marker}`;
      const [row] = await db
        .insert(dicomRetryQueueTable)
        .values({
          operationType: AI_SHADOW_PIPELINE_JOB,
          entityType: "study",
          payload: { studyInstanceUid: uid, modality: "MR", marker },
          idempotencyKey: `ai:shadow:${uid}:vitest-failsafe`,
          status: "pending",
          nextRetryAt: new Date(),
          maxRetries: 5,
          // Pre-cutover relative to failSafeHeldOps cutover — ordinary auto-claim must not take it.
          createdAt: new Date("2026-08-20T08:00:00.000Z"),
        })
        .returning({ id: dicomRetryQueueTable.id });
      ids.push(row.id);

      // Ordinary overnight drain — hold filter from failSafeHeldOps must remain restrictive.
      const ordinary = await fireOvernightAiTick();
      expect(ordinary.skipped).not.toBe("ops_unreadable_fail_closed"); // ops readable via fail-safe return
      expect(ordinary.skipped).not.toBe("overnight_paused");
      expect(ordinary.ran.map((r) => r.id)).not.toContain(row.id);

      const [stillPending] = await db
        .select({ status: dicomRetryQueueTable.status })
        .from(dicomRetryQueueTable)
        .where(eq(dicomRetryQueueTable.id, row.id));
      expect(stillPending.status).toBe("pending");

      // Explicit canary-by-jobId remains intentionally designed to bypass hold.
      const canary = await fireOvernightAiTick({ canary: true, jobId: row.id });
      expect(canary.skipped).toBeUndefined();
      expect(canary.ran.length).toBe(1);
      expect(canary.ran[0]?.id).toBe(row.id);

      const [afterCanary] = await db
        .select({ status: dicomRetryQueueTable.status })
        .from(dicomRetryQueueTable)
        .where(eq(dicomRetryQueueTable.id, row.id));
      expect(afterCanary.status).not.toBe("pending");
      expect(afterCanary.status).not.toBe("running");
    } finally {
      handlers.RADIOLOGY_JOB_HANDLERS[AI_SHADOW_PIPELINE_JOB] = originalHandler;
    }
  }, 60_000);
});
