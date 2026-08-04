import { db } from "@workspace/db";
import { radiologyStudiesTable, radiologyWorklistTable, testsTable } from "@workspace/db/schema";
import { and, gte, lte, ne, sql } from "drizzle-orm";
import {
  classifyImagingBucket,
  emptyBucketCounts,
  IMAGING_BUCKETS,
  type ImagingBucket,
} from "./imagingModalityBucket";

export type BillingVsPacsModalityRow = {
  key: ImagingBucket;
  billed: number;
  pacs: number;
  gap: number;
  unlinkedPacs: number;
  matched: boolean;
  /** PACS > billed — likely scan without billing */
  alert: boolean;
};

export type BillingVsPacsSummary = {
  from: string;
  to: string;
  modalities: BillingVsPacsModalityRow[];
  totals: {
    billed: number;
    pacs: number;
    unlinkedPacs: number;
    mismatchCount: number;
  };
};

function bump(target: Record<ImagingBucket, number>, bucket: ImagingBucket) {
  target[bucket] += 1;
}

export async function buildBillingVsPacsSummary(from: string, to: string): Promise<BillingVsPacsSummary> {
  const billedCounts = emptyBucketCounts();
  const pacsCounts = emptyBucketCounts();
  const unlinkedCounts = emptyBucketCounts();

  const billedRows = await db
    .select({
      modality: radiologyStudiesTable.modality,
      department: radiologyStudiesTable.department,
      studyDescription: radiologyStudiesTable.studyDescription,
      testName: testsTable.name,
    })
    .from(radiologyStudiesTable)
    .leftJoin(testsTable, sql`${testsTable.id} = ${radiologyStudiesTable.testId}`)
    .where(and(
      gte(radiologyStudiesTable.studyDate, from),
      lte(radiologyStudiesTable.studyDate, to),
      ne(radiologyStudiesTable.status, "cancelled"),
    ));

  for (const row of billedRows) {
    const bucket = classifyImagingBucket(row);
    if (bucket) bump(billedCounts, bucket);
  }

  const fromYmd = from.replace(/-/g, "");
  const toYmd = to.replace(/-/g, "");
  const { start, end } = {
    start: new Date(`${from}T00:00:00+05:30`),
    end: new Date(`${to}T23:59:59.999+05:30`),
  };

  const pacsRows = await db
    .select({
      modality: radiologyWorklistTable.modality,
      studyDescription: radiologyWorklistTable.studyDescription,
      studyId: radiologyWorklistTable.studyId,
    })
    .from(radiologyWorklistTable)
    .where(sql`(
      (${radiologyWorklistTable.createdAt} >= ${start.toISOString()}::timestamptz
        AND ${radiologyWorklistTable.createdAt} <= ${end.toISOString()}::timestamptz)
      OR (
        ${radiologyWorklistTable.studyDate} IS NOT NULL
        AND ${radiologyWorklistTable.studyDate} >= ${fromYmd}
        AND ${radiologyWorklistTable.studyDate} <= ${toYmd}
      )
    )`);

  for (const row of pacsRows) {
    const bucket = classifyImagingBucket({
      modality: row.modality,
      studyDescription: row.studyDescription,
    });
    if (!bucket) continue;
    bump(pacsCounts, bucket);
    if (!row.studyId) bump(unlinkedCounts, bucket);
  }

  const modalities: BillingVsPacsModalityRow[] = IMAGING_BUCKETS.map((key) => {
    const billed = billedCounts[key];
    const pacs = pacsCounts[key];
    const gap = pacs - billed;
    const unlinkedPacs = unlinkedCounts[key];
    const matched = billed === pacs && unlinkedPacs === 0;
    const alert = gap > 0 || unlinkedPacs > 0;
    return { key, billed, pacs, gap, unlinkedPacs, matched, alert };
  });

  return {
    from,
    to,
    modalities,
    totals: {
      billed: modalities.reduce((s, m) => s + m.billed, 0),
      pacs: modalities.reduce((s, m) => s + m.pacs, 0),
      unlinkedPacs: modalities.reduce((s, m) => s + m.unlinkedPacs, 0),
      mismatchCount: modalities.filter((m) => !m.matched).length,
    },
  };
}
