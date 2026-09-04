/**
 * Constrained USG aggregate lookups for pacs-worklist list rows.
 * Aggregates ONLY over the returned worklist IDs — never GROUP BY the
 * full usg_* tables on every poll.
 */
import { db } from "@workspace/db";
import {
  usgKeyImagesTable,
  usgMeasurementsTable,
  usgReportDraftsTable,
} from "@workspace/db/schema";
import { inArray, sql } from "drizzle-orm";

export type UsgWorklistAggregates = {
  usgMeasurementCount: number;
  usgKeyImageCount: number;
  usgReportStatus: string | null;
};

const EMPTY: UsgWorklistAggregates = {
  usgMeasurementCount: 0,
  usgKeyImageCount: 0,
  usgReportStatus: null,
};

export async function fetchUsgAggregatesByWorklistIds(
  worklistIds: number[],
): Promise<Map<number, UsgWorklistAggregates>> {
  const out = new Map<number, UsgWorklistAggregates>();
  if (worklistIds.length === 0) return out;
  for (const id of worklistIds) out.set(id, { ...EMPTY });

  const [measRows, imgRows, draftRows] = await Promise.all([
    db
      .select({
        worklistId: usgMeasurementsTable.worklistId,
        cnt: sql<number>`COUNT(*)::int`.mapWith(Number),
      })
      .from(usgMeasurementsTable)
      .where(inArray(usgMeasurementsTable.worklistId, worklistIds))
      .groupBy(usgMeasurementsTable.worklistId),
    db
      .select({
        worklistId: usgKeyImagesTable.worklistId,
        cnt: sql<number>`COUNT(*)::int`.mapWith(Number),
      })
      .from(usgKeyImagesTable)
      .where(inArray(usgKeyImagesTable.worklistId, worklistIds))
      .groupBy(usgKeyImagesTable.worklistId),
    db.execute<{ worklist_id: number; status: string }>(sql`
      SELECT DISTINCT ON (worklist_id) worklist_id, status
      FROM ${usgReportDraftsTable}
      WHERE ${usgReportDraftsTable.worklistId} IN (${sql.join(
        worklistIds.map((id) => sql`${id}`),
        sql`, `,
      )})
      ORDER BY ${usgReportDraftsTable.worklistId}, ${usgReportDraftsTable.updatedAt} DESC
    `),
  ]);

  for (const r of measRows) {
    if (r.worklistId == null) continue;
    const cur = out.get(r.worklistId) ?? { ...EMPTY };
    cur.usgMeasurementCount = r.cnt;
    out.set(r.worklistId, cur);
  }
  for (const r of imgRows) {
    if (r.worklistId == null) continue;
    const cur = out.get(r.worklistId) ?? { ...EMPTY };
    cur.usgKeyImageCount = r.cnt;
    out.set(r.worklistId, cur);
  }
  const draftList = (draftRows as unknown as { rows?: Array<{ worklist_id: number; status: string }> }).rows
    ?? (Array.isArray(draftRows) ? draftRows as Array<{ worklist_id: number; status: string }> : []);
  for (const r of draftList) {
    const id = Number(r.worklist_id);
    if (!Number.isFinite(id)) continue;
    const cur = out.get(id) ?? { ...EMPTY };
    cur.usgReportStatus = r.status ?? null;
    out.set(id, cur);
  }
  return out;
}

export function mergeUsgAggregatesIntoRows<T extends { id: number }>(
  rows: T[],
  aggs: Map<number, UsgWorklistAggregates>,
): Array<T & UsgWorklistAggregates> {
  return rows.map((r) => {
    const a = aggs.get(r.id) ?? EMPTY;
    return {
      ...r,
      usgMeasurementCount: a.usgMeasurementCount,
      usgKeyImageCount: a.usgKeyImageCount,
      usgReportStatus: a.usgReportStatus,
    };
  });
}
