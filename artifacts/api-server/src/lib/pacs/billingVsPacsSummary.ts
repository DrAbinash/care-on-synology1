import { db } from "@workspace/db";
import { radiologyStudiesTable, radiologyWorklistTable, testsTable } from "@workspace/db/schema";
import { and, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import {
  classifyImagingBucket,
  emptyBucketCounts,
  IMAGING_BUCKETS,
  type ImagingBucket,
} from "./imagingModalityBucket";
import { autoLinkBilledStudyForWorklist } from "./worklistBillingLink";

export type BillingVsPacsModalityRow = {
  key: ImagingBucket;
  billed: number;
  pacs: number;
  /** Worklist rows with study_id set (linked to a billed study). */
  linkedPacs: number;
  /** Worklist rows with study_id null — billed may still exist; not yet linked. */
  unlinkedPacs: number;
  /** Billed studies in range with no worklist pointing at them. */
  billedNotInPacs: number;
  gap: number;
  matched: boolean;
  /** Needs attention: count mismatch or unlinked PACS or billed with no PACS. */
  alert: boolean;
};

export type BillingVsPacsSummary = {
  from: string;
  to: string;
  mode: "bill";
  modalities: BillingVsPacsModalityRow[];
  totals: {
    billed: number;
    pacs: number;
    linkedPacs: number;
    unlinkedPacs: number;
    billedNotInPacs: number;
    mismatchCount: number;
  };
};

function bump(target: Record<ImagingBucket, number>, bucket: ImagingBucket) {
  target[bucket] += 1;
}

function pacsDateWindow(from: string, to: string) {
  const fromYmd = from.replace(/-/g, "");
  const toYmd = to.replace(/-/g, "");
  const start = new Date(`${from}T00:00:00+05:30`);
  const end = new Date(`${to}T23:59:59.999+05:30`);
  return {
    fromYmd,
    toYmd,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

function pacsWindowSql(from: string, to: string) {
  const { fromYmd, toYmd, startIso, endIso } = pacsDateWindow(from, to);
  return sql`(
    (${radiologyWorklistTable.createdAt} >= ${startIso}::timestamptz
      AND ${radiologyWorklistTable.createdAt} <= ${endIso}::timestamptz)
    OR (
      ${radiologyWorklistTable.studyDate} IS NOT NULL
      AND ${radiologyWorklistTable.studyDate} >= ${fromYmd}
      AND ${radiologyWorklistTable.studyDate} <= ${toYmd}
    )
  )`;
}

export async function buildBillingVsPacsSummary(from: string, to: string): Promise<BillingVsPacsSummary> {
  const billedCounts = emptyBucketCounts();
  const pacsCounts = emptyBucketCounts();
  const linkedCounts = emptyBucketCounts();
  const unlinkedCounts = emptyBucketCounts();
  const billedNotInPacsCounts = emptyBucketCounts();

  const billedRows = await db
    .select({
      id: radiologyStudiesTable.id,
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

  const pacsRows = await db
    .select({
      modality: radiologyWorklistTable.modality,
      studyDescription: radiologyWorklistTable.studyDescription,
      studyId: radiologyWorklistTable.studyId,
    })
    .from(radiologyWorklistTable)
    .where(pacsWindowSql(from, to));

  for (const row of pacsRows) {
    const bucket = classifyImagingBucket({
      modality: row.modality,
      studyDescription: row.studyDescription,
    });
    if (!bucket) continue;
    bump(pacsCounts, bucket);
    if (row.studyId) bump(linkedCounts, bucket);
    else bump(unlinkedCounts, bucket);
  }

  // Billed studies whose id is not referenced by any worklist (anywhere).
  const billedIds = billedRows.map((r) => r.id);
  const linkedStudyIdSet = new Set<number>();
  if (billedIds.length > 0) {
    const linkedRefs = await db
      .select({ studyId: radiologyWorklistTable.studyId })
      .from(radiologyWorklistTable)
      .where(and(
        sql`${radiologyWorklistTable.studyId} is not null`,
        inArray(radiologyWorklistTable.studyId, billedIds),
      ));
    for (const r of linkedRefs) {
      if (r.studyId != null) linkedStudyIdSet.add(r.studyId);
    }
  }

  for (const row of billedRows) {
    if (linkedStudyIdSet.has(row.id)) continue;
    const bucket = classifyImagingBucket(row);
    if (bucket) bump(billedNotInPacsCounts, bucket);
  }

  const modalities: BillingVsPacsModalityRow[] = IMAGING_BUCKETS.map((key) => {
    const billed = billedCounts[key];
    const pacs = pacsCounts[key];
    const linkedPacs = linkedCounts[key];
    const unlinkedPacs = unlinkedCounts[key];
    const billedNotInPacs = billedNotInPacsCounts[key];
    const gap = pacs - billed;
    const matched = billed === pacs && unlinkedPacs === 0 && billedNotInPacs === 0;
    const alert = unlinkedPacs > 0 || billedNotInPacs > 0 || gap !== 0;
    return {
      key, billed, pacs, linkedPacs, unlinkedPacs, billedNotInPacs, gap, matched, alert,
    };
  });

  return {
    from,
    to,
    mode: "bill",
    modalities,
    totals: {
      billed: modalities.reduce((s, m) => s + m.billed, 0),
      pacs: modalities.reduce((s, m) => s + m.pacs, 0),
      linkedPacs: modalities.reduce((s, m) => s + m.linkedPacs, 0),
      unlinkedPacs: modalities.reduce((s, m) => s + m.unlinkedPacs, 0),
      billedNotInPacs: modalities.reduce((s, m) => s + m.billedNotInPacs, 0),
      mismatchCount: modalities.filter((m) => !m.matched).length,
    },
  };
}

export type VerifyBillingVsPacsResult = {
  from: string;
  to: string;
  attempted: number;
  linked: number;
  alreadyLinked: number;
  failed: number;
  sampleFailures: Array<{ worklistId: number; reason: string }>;
  summary: BillingVsPacsSummary;
};

/**
 * Run auto-link for every unlinked PACS worklist row in the date window,
 * then return a fresh billed-vs-PACS summary.
 */
export async function verifyBillingVsPacsLinks(
  from: string,
  to: string,
  actor = "billing-vs-pacs-verify",
): Promise<VerifyBillingVsPacsResult> {
  const unlinked = await db
    .select({ id: radiologyWorklistTable.id })
    .from(radiologyWorklistTable)
    .where(and(pacsWindowSql(from, to), isNull(radiologyWorklistTable.studyId)));

  let linked = 0;
  let alreadyLinked = 0;
  let failed = 0;
  const sampleFailures: Array<{ worklistId: number; reason: string }> = [];

  for (const row of unlinked) {
    const result = await autoLinkBilledStudyForWorklist(row.id, actor);
    if (result.linked) {
      if (result.reason === "already linked") alreadyLinked += 1;
      else linked += 1;
    } else {
      failed += 1;
      if (sampleFailures.length < 15) {
        sampleFailures.push({
          worklistId: row.id,
          reason: result.reason || "no matching billed study",
        });
      }
    }
  }

  const summary = await buildBillingVsPacsSummary(from, to);
  return {
    from,
    to,
    attempted: unlinked.length,
    linked,
    alreadyLinked,
    failed,
    sampleFailures,
    summary,
  };
}
