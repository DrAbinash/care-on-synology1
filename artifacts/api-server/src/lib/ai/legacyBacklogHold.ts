/**
 * Legacy backlog hold — query helpers over dicom_retry_queue.
 * Hold state lives in overnight_ops_json; this module never deletes rows.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  resolveLegacyHoldClaimFilter,
  type OvernightOpsControls,
} from "./overnightOpsControls";

const AI_SHADOW_PIPELINE_JOB = "ai_shadow_pipeline";

function executeRows<T>(res: unknown): T[] {
  const withRows = res as { rows?: T[] };
  if (Array.isArray(withRows.rows)) return withRows.rows;
  return Array.isArray(res) ? (res as T[]) : [];
}

export interface LegacyBacklogCounts {
  held: boolean;
  holdBefore: string | null;
  heldPending: number;
  heldRetrying: number;
  newEligible: number;
  releasedAllowlistSize: number;
}

export async function countLegacyBacklogHold(
  ops: OvernightOpsControls,
): Promise<LegacyBacklogCounts> {
  const filter = resolveLegacyHoldClaimFilter(ops);
  if (!filter) {
    // Hold off: everything pending/retrying due is "new eligible" for display.
    const res = await db.execute(sql`
      SELECT
        count(*) FILTER (
          WHERE status = 'pending'
            AND (next_retry_at IS NULL OR next_retry_at <= NOW())
        )::int AS pending_due,
        count(*) FILTER (
          WHERE status = 'retrying'
            AND (next_retry_at IS NULL OR next_retry_at <= NOW())
        )::int AS retrying_due
      FROM dicom_retry_queue
      WHERE operation_type = ${AI_SHADOW_PIPELINE_JOB}
        AND status IN ('pending', 'retrying')
    `);
    const row = executeRows<{ pending_due: number; retrying_due: number }>(res)[0];
    return {
      held: false,
      holdBefore: ops.legacyHoldBefore,
      heldPending: 0,
      heldRetrying: 0,
      newEligible: (row?.pending_due ?? 0) + (row?.retrying_due ?? 0),
      releasedAllowlistSize: ops.legacyReleasedJobIds.length,
    };
  }

  const holdBefore = new Date(filter.holdBefore);
  const released = filter.releasedJobIds;
  const releasedSql =
    released.length === 0
      ? sql`false`
      : sql`id IN (${sql.join(
          released.map((id) => sql`${id}`),
          sql`, `,
        )})`;

  const res = await db.execute(sql`
    SELECT
      count(*) FILTER (
        WHERE status = 'pending'
          AND created_at < ${holdBefore}
          AND NOT (${releasedSql})
      )::int AS held_pending,
      count(*) FILTER (
        WHERE status = 'retrying'
          AND created_at < ${holdBefore}
          AND NOT (${releasedSql})
      )::int AS held_retrying,
      count(*) FILTER (
        WHERE status IN ('pending', 'retrying')
          AND (next_retry_at IS NULL OR next_retry_at <= NOW())
          AND (created_at >= ${holdBefore} OR (${releasedSql}))
      )::int AS new_eligible
    FROM dicom_retry_queue
    WHERE operation_type = ${AI_SHADOW_PIPELINE_JOB}
      AND status IN ('pending', 'retrying')
  `);
  const row = executeRows<{
    held_pending: number;
    held_retrying: number;
    new_eligible: number;
  }>(res)[0];
  return {
    held: true,
    holdBefore: filter.holdBefore,
    heldPending: row?.held_pending ?? 0,
    heldRetrying: row?.held_retrying ?? 0,
    newEligible: row?.new_eligible ?? 0,
    releasedAllowlistSize: released.length,
  };
}

/** Newest held shadow jobs (pending/retrying, pre-cutover, not allowlisted). */
export async function listNewestHeldLegacyShadowJobIds(
  ops: OvernightOpsControls,
  limit: number,
): Promise<number[]> {
  const filter = resolveLegacyHoldClaimFilter(ops);
  if (!filter || limit <= 0) return [];
  const holdBefore = new Date(filter.holdBefore);
  const released = filter.releasedJobIds;
  const releasedSql =
    released.length === 0
      ? sql`false`
      : sql`id IN (${sql.join(
          released.map((id) => sql`${id}`),
          sql`, `,
        )})`;
  const res = await db.execute(sql`
    SELECT id FROM dicom_retry_queue
    WHERE operation_type = ${AI_SHADOW_PIPELINE_JOB}
      AND status IN ('pending', 'retrying')
      AND created_at < ${holdBefore}
      AND NOT (${releasedSql})
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit}
  `);
  return executeRows<{ id: number }>(res).map((r) => r.id);
}
