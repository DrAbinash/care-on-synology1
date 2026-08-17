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
});
