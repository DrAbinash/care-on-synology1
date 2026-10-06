/**
 * Real-database proof that the guard is scoped to the study it is asked about.
 * Case F of the brief: an AI job belonging to ANOTHER study must never block
 * this one — that failure mode would strand the whole worklist.
 *
 * Skipped when no DATABASE_URL is configured (same convention as
 * preDeploySafety.request.test.ts).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@workspace/db";
import { aiReportComposeJobsTable, radiologyWorklistTable } from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { hasDatabaseUrl } from "../../testSupport/apiTestApp";
import { findUnreviewedAiDraft } from "./unreviewedAiGuard";
import { updateTrackedChangeState } from "./jobService";
import { computeSnapshotHashes } from "./snapshot";
import { parseComposerSnapshot, type TrackedChange } from "./types";

function change(reviewState: TrackedChange["reviewState"], clinical = false): TrackedChange {
  return {
    id: `c-${reviewState}-${randomUUID().slice(0, 6)}`,
    source: "AI_COMPOSER",
    changeType: "REPLACE",
    field: "FINDINGS",
    originalText: "original",
    proposedText: "proposed",
    reviewState,
    clinicalSignificance: clinical,
    clinicalSignificanceReasons: [],
    createdAt: new Date().toISOString(),
  };
}

function worklistSeed(label: string) {
  const marker = MARKER;
  return {
    patientName: `Patient ${label} ${marker}`,
    modality: "MR",
    studyDescription: `MRI LS Spine ${label}`,
    studyInstanceUID: `1.2.840.vitest.aigate.${marker}.${label}`,
    accessionNumber: `ACC-AIG-${marker}-${label}`,
    status: "STUDY_RECEIVED" as const,
    aiDraftStatus: "NONE" as const,
    aiComposeStatus: "NONE" as const,
    dicomPatientId: `PDG-${marker}-${label}`,
  };
}

const MARKER = randomUUID().slice(0, 8);

describe.skipIf(!hasDatabaseUrl())("unreviewed-AI finalize guard — DB scoping", () => {
  let worklistA = 0;
  let worklistB = 0;
  let seq = 0;
  const jobIds: number[] = [];

  beforeAll(async () => {
    const [a] = await db.insert(radiologyWorklistTable).values(worklistSeed("A")).returning();
    const [b] = await db.insert(radiologyWorklistTable).values(worklistSeed("B")).returning();
    worklistA = a.id;
    worklistB = b.id;
  });

  afterAll(async () => {
    if (jobIds.length) {
      await db.delete(aiReportComposeJobsTable).where(inArray(aiReportComposeJobsTable.id, jobIds));
    }
    if (worklistA) await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, worklistA));
    if (worklistB) await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, worklistB));
  });

  async function seedJob(opts: {
    worklistId: number;
    status: string;
    changes: TrackedChange[];
    reportId?: number | null;
    studyId?: number | null;
    updatedAt?: Date;
  }) {
    // The snapshot text varies per call so two ACTIVE rows never collide with
    // the composer's idempotency index.
    seq += 1;
    const snapshot = parseComposerSnapshot({
      worklistId: opts.worklistId,
      findings: `Scoped guard findings ${seq}.`,
      impression: "",
      recommendation: "",
      observations: [],
    });
    const hashes = computeSnapshotHashes(snapshot);
    const [row] = await db
      .insert(aiReportComposeJobsTable)
      .values({
        worklistId: opts.worklistId,
        studyId: opts.studyId ?? null,
        reportId: opts.reportId ?? null,
        jobKind: "FULL_REPORT",
        status: opts.status as never,
        sourceReportRevision: hashes.reportRevision,
        sourceFindingsHash: hashes.findingsHash,
        sourceImpressionHash: hashes.impressionHash,
        sourceRecommendationHash: hashes.recommendationHash,
        inputHash: hashes.inputHash,
        inputSnapshotJson: JSON.stringify(snapshot),
        trackedChangesJson: JSON.stringify(opts.changes),
        proposedFindings: "Scoped guard draft.",
        priority: 40,
        ...(opts.updatedAt ? { updatedAt: opts.updatedAt } : {}),
      })
      .returning();
    jobIds.push(row.id);
    return row;
  }

  async function clearJobs() {
    if (!jobIds.length) return;
    await db.delete(aiReportComposeJobsTable).where(inArray(aiReportComposeJobsTable.id, jobIds));
    jobIds.length = 0;
  }

  it("A. a study with no composer job at all is untouched", async () => {
    await clearJobs();
    expect(await findUnreviewedAiDraft({ worklistId: worklistA })).toBeNull();
  });

  it("B. READY + PENDING blocks its own study, with the count", async () => {
    await clearJobs();
    await seedJob({ worklistId: worklistA, status: "READY", changes: [change("PENDING")] });
    const hit = await findUnreviewedAiDraft({ worklistId: worklistA });
    expect(hit?.pendingChangeCount).toBe(1);
    expect(hit?.status).toBe("READY");
  });

  it("F. another study's AI job never blocks this study", async () => {
    await clearJobs();
    await seedJob({ worklistId: worklistA, status: "READY", changes: [change("PENDING")] });
    expect(await findUnreviewedAiDraft({ worklistId: worklistB })).toBeNull();
  });

  it("C. STALE_READY + PENDING blocks too", async () => {
    await clearJobs();
    await seedJob({
      worklistId: worklistB,
      status: "STALE_READY",
      changes: [change("PENDING"), change("PENDING"), change("ACCEPTED")],
    });
    const hit = await findUnreviewedAiDraft({ worklistId: worklistB });
    expect(hit?.pendingChangeCount).toBe(2);
  });

  it("D. a fully reviewed READY job does not block", async () => {
    await clearJobs();
    await seedJob({
      worklistId: worklistA,
      status: "READY",
      changes: [change("ACCEPTED"), change("EDITED"), change("REJECTED")],
    });
    expect(await findUnreviewedAiDraft({ worklistId: worklistA })).toBeNull();
  });

  it("「Reject remaining and continue」 still works — rejecting unblocks the same study", async () => {
    await clearJobs();
    const pending = [change("PENDING"), change("PENDING", true)];
    const row = await seedJob({ worklistId: worklistA, status: "READY", changes: pending });
    expect(await findUnreviewedAiDraft({ worklistId: worklistA })).not.toBeNull();

    // Exactly what the client button does before retrying finalize: reject every
    // pending change through the existing review endpoint's service function.
    for (const c of pending) {
      const res = await updateTrackedChangeState(row.id, c.id, "REJECTED");
      expect(res.ok).toBe(true);
    }
    expect(await findUnreviewedAiDraft({ worklistId: worklistA })).toBeNull();
  });

  it("E. an APPLIED job is history and does not block", async () => {
    await clearJobs();
    await seedJob({ worklistId: worklistA, status: "APPLIED", changes: [change("PENDING")] });
    expect(await findUnreviewedAiDraft({ worklistId: worklistA })).toBeNull();
  });

  it("a job scoped by study_id or report_id is still found for that study", async () => {
    await clearJobs();
    const row = await seedJob({
      worklistId: null as never,
      studyId: 900_001,
      reportId: 900_002,
      status: "READY",
      changes: [change("PENDING")],
    });
    expect((await findUnreviewedAiDraft({ studyId: row.studyId }))?.jobId).toBe(row.id);
    expect((await findUnreviewedAiDraft({ reportId: row.reportId }))?.jobId).toBe(row.id);
    expect(await findUnreviewedAiDraft({ studyId: 900_003, reportId: 900_004 })).toBeNull();
  });

  it("QUEUED / FAILED / DISCARDED drafts are not actionable and never block", async () => {
    await clearJobs();
    for (const status of ["QUEUED", "COMPOSING", "FAILED", "DISCARDED", "OBSOLETE"]) {
      await seedJob({ worklistId: worklistA, status, changes: [change("PENDING")] });
    }
    expect(await findUnreviewedAiDraft({ worklistId: worklistA })).toBeNull();
  });

  it("G. twenty fully-reviewed drafts cannot bury an older unreviewed one", async () => {
    await clearJobs();
    // The read is capped, so the cap has to apply to jobs that could still be
    // unreviewed — not to whatever was touched most recently. Without that,
    // re-composing a study twenty times would silently disarm the guard.
    const base = Date.now();
    const stalePending = await seedJob({
      worklistId: worklistA,
      status: "READY",
      changes: [change("PENDING", true)],
      updatedAt: new Date(base - 60 * 60 * 1000),
    });
    for (let i = 0; i < 25; i += 1) {
      await seedJob({
        worklistId: worklistA,
        status: "READY",
        changes: [change("ACCEPTED"), change("REJECTED")],
        updatedAt: new Date(base + i * 60 * 1000),
      });
    }
    const hit = await findUnreviewedAiDraft({ worklistId: worklistA });
    expect(hit?.jobId).toBe(stalePending.id);
    expect(hit?.pendingChangeCount).toBe(1);
  });
});
