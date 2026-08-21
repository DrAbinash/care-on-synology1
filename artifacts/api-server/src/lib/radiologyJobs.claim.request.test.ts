/**
 * Claim path for dicom_retry_queue — the overnight AI drain uses this
 * runner. A grep that scheduleRadiologyJobs exists cannot catch
 * FOR UPDATE SKIP LOCKED / due-at SQL that returns no rows.
 *
 * Uses a dedicated operation_type so we never claim live ai_shadow_pipeline
 * rows. Skipped when DATABASE_URL is unset.
 */
import { describe, expect, test, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { hasDatabaseUrl } from "../testSupport/apiTestApp";

const dbAvailable = hasDatabaseUrl();

describe.skipIf(!dbAvailable)("radiology job claim (FOR UPDATE SKIP LOCKED)", () => {
  const marker = `vitest-claim-${randomUUID().slice(0, 8)}`;
  const op = `vitest_overnight_claim`;
  const ids: number[] = [];

  afterAll(async () => {
    if (!dbAvailable) return;
    const { db } = await import("@workspace/db");
    const { dicomRetryQueueTable } = await import("@workspace/db/schema");
    if (ids.length > 0) {
      const { inArray } = await import("drizzle-orm");
      await db.delete(dicomRetryQueueTable).where(inArray(dicomRetryQueueTable.id, ids));
    }
    await db.delete(dicomRetryQueueTable).where(eq(dicomRetryQueueTable.operationType, op));
  }, 30_000);

  test("claims a due pending row and runs the handler", async () => {
    const { db } = await import("@workspace/db");
    const { dicomRetryQueueTable } = await import("@workspace/db/schema");
    const { runRadiologyJobTick, countDueJobs } = await import("./radiologyJobs");

    const [row] = await db
      .insert(dicomRetryQueueTable)
      .values({
        operationType: op,
        entityType: "study",
        entityId: null,
        payload: { marker },
        idempotencyKey: `vitest:${marker}`,
        status: "pending",
        nextRetryAt: new Date(),
        maxRetries: 3,
      })
      .returning({ id: dicomRetryQueueTable.id });
    ids.push(row.id);

    expect(await countDueJobs(op)).toBeGreaterThanOrEqual(1);

    const result = await runRadiologyJobTick(
      {
        [op]: async () => ({ ok: true, detail: "vitest-claim-ok" }),
      },
      { maxJobs: 1, workerId: `vitest-${marker}` },
    );

    expect(result.ran).toEqual([
      expect.objectContaining({ id: row.id, operationType: op, outcome: "success" }),
    ]);

    const [after] = await db
      .select({ status: dicomRetryQueueTable.status })
      .from(dicomRetryQueueTable)
      .where(eq(dicomRetryQueueTable.id, row.id));
    expect(after.status).toBe("success");
  });

  test("concurrency 0 does not claim that type (peak hold)", async () => {
    const { db } = await import("@workspace/db");
    const { dicomRetryQueueTable } = await import("@workspace/db/schema");
    const { runRadiologyJobTick } = await import("./radiologyJobs");

    const [row] = await db
      .insert(dicomRetryQueueTable)
      .values({
        operationType: op,
        entityType: "study",
        entityId: null,
        payload: { marker: `${marker}-peak` },
        idempotencyKey: `vitest:${marker}-peak`,
        status: "pending",
        nextRetryAt: new Date(),
        maxRetries: 3,
      })
      .returning({ id: dicomRetryQueueTable.id });
    ids.push(row.id);

    const result = await runRadiologyJobTick(
      { [op]: async () => ({ ok: true }) },
      { maxJobs: 5, concurrencyByType: { [op]: 0 }, workerId: `vitest-${marker}-peak` },
    );
    expect(result.ran).toEqual([]);

    const [after] = await db
      .select({ status: dicomRetryQueueTable.status })
      .from(dicomRetryQueueTable)
      .where(eq(dicomRetryQueueTable.id, row.id));
    expect(after.status).toBe("pending");
  });

  test("overnight_ai claim skips superseded duplicates and prefers a fresh job", async () => {
    const { db } = await import("@workspace/db");
    const { dicomRetryQueueTable } = await import("@workspace/db/schema");
    const { runRadiologyJobTick } = await import("./radiologyJobs");
    const uid = `1.2.vitest.${marker}`;
    const old = await db.insert(dicomRetryQueueTable).values({
      operationType: op,
      entityType: "study",
      payload: { studyInstanceUid: uid, modality: "MR", marker: `${marker}-old` },
      idempotencyKey: `vitest:${marker}-dup-old`,
      status: "pending",
      retryCount: 2,
      nextRetryAt: new Date(),
      maxRetries: 5,
    }).returning({ id: dicomRetryQueueTable.id });
    const fresh = await db.insert(dicomRetryQueueTable).values({
      operationType: op,
      entityType: "study",
      payload: { studyInstanceUid: `${uid}.fresh`, modality: "MR", marker: `${marker}-fresh` },
      idempotencyKey: `vitest:${marker}-fresh`,
      status: "pending",
      retryCount: 0,
      nextRetryAt: new Date(),
      maxRetries: 5,
    }).returning({ id: dicomRetryQueueTable.id });
    ids.push(old[0].id, fresh[0].id);

    const result = await runRadiologyJobTick(
      { [op]: async () => ({ ok: true, detail: "fresh-ok" }) },
      {
        maxJobs: 1,
        claimStrategy: "overnight_ai",
        preferNewest: true,
        workerId: `vitest-${marker}-fresh`,
      },
    );
    expect(result.ran[0]?.id).toBe(fresh[0].id);
    const [oldAfter] = await db.select({ status: dicomRetryQueueTable.status }).from(dicomRetryQueueTable).where(eq(dicomRetryQueueTable.id, old[0].id));
    expect(oldAfter.status).toBe("pending");
  });

  test("explicit jobId canary claims that row even if a lower id is due", async () => {
    const { db } = await import("@workspace/db");
    const { dicomRetryQueueTable } = await import("@workspace/db/schema");
    const { runRadiologyJobTick } = await import("./radiologyJobs");
    const first = await db.insert(dicomRetryQueueTable).values({
      operationType: op,
      entityType: "study",
      payload: { marker: `${marker}-first` },
      idempotencyKey: `vitest:${marker}-first`,
      status: "pending",
      nextRetryAt: new Date(),
      maxRetries: 3,
    }).returning({ id: dicomRetryQueueTable.id });
    const target = await db.insert(dicomRetryQueueTable).values({
      operationType: op,
      entityType: "study",
      payload: { marker: `${marker}-target` },
      idempotencyKey: `vitest:${marker}-target`,
      status: "pending",
      nextRetryAt: new Date(),
      maxRetries: 3,
    }).returning({ id: dicomRetryQueueTable.id });
    ids.push(first[0].id, target[0].id);

    const result = await runRadiologyJobTick(
      { [op]: async () => ({ ok: true, detail: "canary-ok" }) },
      { maxJobs: 1, jobId: target[0].id, workerId: `vitest-${marker}-canary` },
    );
    expect(result.ran).toEqual([
      expect.objectContaining({ id: target[0].id, outcome: "success" }),
    ]);
    const [firstAfter] = await db.select({ status: dicomRetryQueueTable.status }).from(dicomRetryQueueTable).where(eq(dicomRetryQueueTable.id, first[0].id));
    expect(firstAfter.status).toBe("pending");
  });

  test("overnight AI canary tick claims one ai_shadow_pipeline job and leaves a terminal/retry state", async () => {
    const { db } = await import("@workspace/db");
    const { dicomRetryQueueTable } = await import("@workspace/db/schema");
    const { AI_SHADOW_PIPELINE_JOB } = await import("./ai/shadowPipeline");
    const { fireOvernightAiTick } = await import("../cron");
    const uid = `1.2.840.vitest.${marker}`;
    const [row] = await db.insert(dicomRetryQueueTable).values({
      operationType: AI_SHADOW_PIPELINE_JOB,
      entityType: "study",
      payload: { studyInstanceUid: uid, modality: "MR" },
      idempotencyKey: `ai:shadow:${uid}:vitest-canary`,
      status: "pending",
      nextRetryAt: new Date(),
      maxRetries: 5,
    }).returning({ id: dicomRetryQueueTable.id });
    ids.push(row.id);

    const result = await fireOvernightAiTick({ canary: true, jobId: row.id });
    expect(result.skipped).not.toBe("in_flight");
    expect(result.ran.length).toBe(1);
    expect(result.ran[0].id).toBe(row.id);

    const [after] = await db
      .select({ status: dicomRetryQueueTable.status, failureReason: dicomRetryQueueTable.failureReason })
      .from(dicomRetryQueueTable)
      .where(eq(dicomRetryQueueTable.id, row.id));
    expect(["retrying", "abandoned", "success"]).toContain(after.status);
    expect(after.status).not.toBe("pending");
    expect(after.status).not.toBe("running");
  }, 60_000);

  test("legacy hold: pre-cutover pending/retrying not claimed; post-cutover claimed; canary bypass; selective release; no delete", async () => {
    const { db } = await import("@workspace/db");
    const { dicomRetryQueueTable } = await import("@workspace/db/schema");
    const { runRadiologyJobTick } = await import("./radiologyJobs");
    const { sql, eq: eqCol } = await import("drizzle-orm");
    const holdOp = `vitest_legacy_hold_${marker.slice(-8)}`;
    const holdBefore = new Date("2026-08-21T10:00:00.000Z");
    const oldPending = await db.insert(dicomRetryQueueTable).values({
      operationType: holdOp,
      entityType: "study",
      payload: { marker: `${marker}-legacy-pending` },
      idempotencyKey: `vitest:${marker}-legacy-pending`,
      status: "pending",
      nextRetryAt: new Date(),
      maxRetries: 3,
      createdAt: new Date("2026-08-20T08:00:00.000Z"),
    }).returning({ id: dicomRetryQueueTable.id });
    const oldRetrying = await db.insert(dicomRetryQueueTable).values({
      operationType: holdOp,
      entityType: "study",
      payload: { marker: `${marker}-legacy-retrying` },
      idempotencyKey: `vitest:${marker}-legacy-retrying`,
      status: "retrying",
      retryCount: 1,
      nextRetryAt: new Date(),
      maxRetries: 5,
      createdAt: new Date("2026-08-20T09:00:00.000Z"),
    }).returning({ id: dicomRetryQueueTable.id });
    const fresh = await db.insert(dicomRetryQueueTable).values({
      operationType: holdOp,
      entityType: "study",
      payload: { marker: `${marker}-post-cutover` },
      idempotencyKey: `vitest:${marker}-post-cutover`,
      status: "pending",
      nextRetryAt: new Date(),
      maxRetries: 3,
      createdAt: new Date("2026-08-21T12:00:00.000Z"),
    }).returning({ id: dicomRetryQueueTable.id });
    ids.push(oldPending[0].id, oldRetrying[0].id, fresh[0].id);

    const hold = { holdBefore: holdBefore.toISOString(), releasedJobIds: [] as number[] };

    const blocked = await runRadiologyJobTick(
      { [holdOp]: async () => ({ ok: true }) },
      {
        maxJobs: 5,
        claimStrategy: "overnight_ai",
        legacyHold: hold,
        workerId: `vitest-${marker}-hold-block`,
      },
    );
    // Only post-cutover should run among the three.
    expect(blocked.ran.map((r) => r.id)).toEqual([fresh[0].id]);

    const [pendingStill] = await db
      .select({ status: dicomRetryQueueTable.status })
      .from(dicomRetryQueueTable)
      .where(eqCol(dicomRetryQueueTable.id, oldPending[0].id));
    const [retryingStill] = await db
      .select({ status: dicomRetryQueueTable.status })
      .from(dicomRetryQueueTable)
      .where(eqCol(dicomRetryQueueTable.id, oldRetrying[0].id));
    expect(pendingStill.status).toBe("pending");
    expect(retryingStill.status).toBe("retrying");

    // Explicit canary jobId bypasses hold.
    const canary = await runRadiologyJobTick(
      { [holdOp]: async () => ({ ok: true, detail: "canary-legacy" }) },
      {
        maxJobs: 1,
        jobId: oldPending[0].id,
        legacyHold: hold,
        workerId: `vitest-${marker}-hold-canary`,
      },
    );
    expect(canary.ran[0]?.id).toBe(oldPending[0].id);

    // Selective release: only allowlisted legacy retrying becomes claimable.
    const releasedHold = {
      holdBefore: holdBefore.toISOString(),
      releasedJobIds: [oldRetrying[0].id],
    };
    const afterRelease = await runRadiologyJobTick(
      { [holdOp]: async () => ({ ok: true }) },
      {
        maxJobs: 1,
        claimStrategy: "overnight_ai",
        legacyHold: releasedHold,
        workerId: `vitest-${marker}-hold-release`,
      },
    );
    expect(afterRelease.ran[0]?.id).toBe(oldRetrying[0].id);

    // No row deletion — all three ids still exist.
    const remaining = await db.execute(sql`
      SELECT count(*)::int AS n FROM dicom_retry_queue
      WHERE id IN (${oldPending[0].id}, ${oldRetrying[0].id}, ${fresh[0].id})
    `);
    const remainingRows = remaining as unknown as { rows?: Array<{ n: number }> } | Array<{ n: number }>;
    const n = Array.isArray(remainingRows)
      ? remainingRows[0]?.n
      : remainingRows.rows?.[0]?.n;
    expect(n).toBe(3);

    await db.delete(dicomRetryQueueTable).where(eqCol(dicomRetryQueueTable.operationType, holdOp));
  });
});
