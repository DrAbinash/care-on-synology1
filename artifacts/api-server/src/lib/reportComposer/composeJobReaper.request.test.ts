/**
 * B5 — a compose job whose worker died between claim and settle must be
 * reaped, not stranded COMPOSING forever.
 *
 * The claim CAS in `processComposeJob` only accepts QUEUED, which is what makes
 * a double model run impossible. The other side of that coin: a worker that
 * crashed (or was killed by a deploy) after flipping QUEUED→COMPOSING but
 * before the settle write leaves a row no door will ever touch again — the
 * queue row's own stale-requeue (10 min) re-enters `processComposeJob`, is told
 * "not claimable (COMPOSING)", and marks the queue row success, so nothing ever
 * retries and the worklist badge says COMPOSING until someone edits the
 * database by hand.
 *
 * The reaper runs at the head of the compose consumer tick: a COMPOSING row
 * whose `startedAt` is older than the lease is a worker that lost its lease,
 * and the honest outcome for the radiologist is the same FAILED badge any other
 * dead run gets, so they can regenerate — which the B6 key fix makes work.
 *
 * These tests run against a real PostgreSQL database (the same fixtures as
 * composeJobClaim.request.test.ts); no model is involved because the reaper
 * only ever writes terminal state.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  aiReportComposeJobsTable,
  patientsTable,
  radiologyReportDraftsTable,
  radiologyStudiesTable,
  radiologyWorklistTable,
} from "@workspace/db/schema";
import { hasDatabaseUrl } from "../../testSupport/apiTestApp";

const here = dirname(fileURLToPath(import.meta.url));
const marker = `vitest-reaper-${randomUUID().slice(0, 8)}`;

describe.skipIf(!hasDatabaseUrl())("stale COMPOSING compose jobs are reaped, not stranded", () => {
  const cleanup = {
    jobIds: [] as number[],
    draftIds: [] as number[],
    worklistIds: [] as number[],
    studyIds: [] as number[],
    patientIds: [] as number[],
  };
  let worklistId = 0;

  beforeAll(async () => {
    const [patient] = await db
      .insert(patientsTable)
      .values({
        patientId: `MRN-${marker}`,
        firstName: "Synthetic",
        lastName: "Reaper",
        dateOfBirth: "1980-01-02",
        gender: "F",
        phone: "0000000000",
      })
      .returning();
    cleanup.patientIds.push(patient.id as number);

    const [study] = await db
      .insert(radiologyStudiesTable)
      .values({
        accessionNumber: `ACC-${marker}`,
        patientId: patient.id,
        testId: 1,
        modality: "MR",
        department: "MRI",
        status: "acquired",
      })
      .returning();
    cleanup.studyIds.push(study.id as number);

    const [wl] = await db
      .insert(radiologyWorklistTable)
      .values({
        patientName: "Synthetic Reaper",
        patientId: patient.id,
        studyId: study.id,
        patientMatchStatus: "MATCHED",
        modality: "MR",
        studyDescription: "MRI BRAIN",
        accessionNumber: `ACC-${marker}`,
        status: "STUDY_RECEIVED",
      })
      .returning();
    worklistId = wl.id as number;
    cleanup.worklistIds.push(worklistId);

    const [draft] = await db
      .insert(radiologyReportDraftsTable)
      .values({
        studyId: worklistId,
        worklistId,
        patientId: patient.id,
        modality: "MR",
        status: "DRAFT",
        rawFindings: "Normal MRI of the brain.",
      })
      .returning();
    cleanup.draftIds.push(draft.id as number);
  });

  afterAll(async () => {
    if (cleanup.jobIds.length) {
      await db.delete(aiReportComposeJobsTable).where(inArray(aiReportComposeJobsTable.id, cleanup.jobIds));
    }
    if (cleanup.draftIds.length) {
      await db.delete(radiologyReportDraftsTable).where(inArray(radiologyReportDraftsTable.id, cleanup.draftIds));
    }
    if (cleanup.worklistIds.length) {
      await db.delete(radiologyWorklistTable).where(inArray(radiologyWorklistTable.id, cleanup.worklistIds));
    }
    if (cleanup.studyIds.length) {
      await db.delete(radiologyStudiesTable).where(inArray(radiologyStudiesTable.id, cleanup.studyIds));
    }
    if (cleanup.patientIds.length) {
      await db.delete(patientsTable).where(inArray(patientsTable.id, cleanup.patientIds));
    }
  });

  /** A compose row in the state a dead worker leaves behind. */
  let seq = 0;
  async function composingJob(startedAt: Date): Promise<number> {
    seq += 1;
    const [job] = await db
      .insert(aiReportComposeJobsTable)
      .values({
        worklistId,
        jobKind: "FULL_REPORT",
        status: "COMPOSING",
        startedAt,
        // Unique per row: ai_report_compose_jobs_idem_uq is partial over
        // (QUEUED, COMPOSING), so two COMPOSING fixtures cannot share a key.
        sourceReportRevision: `r-${seq}`,
        sourceFindingsHash: `f-${seq}`,
        sourceImpressionHash: `i-${seq}`,
        sourceRecommendationHash: `rc-${seq}`,
        inputHash: `in-${seq}`,
        inputSnapshotJson: "{}",
        createdBy: marker,
      })
      .returning();
    cleanup.jobIds.push(job.id as number);
    return job.id as number;
  }

  async function row(jobId: number) {
    const [r] = await db
      .select({
        status: aiReportComposeJobsTable.status,
        safeError: aiReportComposeJobsTable.safeError,
        completedAt: aiReportComposeJobsTable.completedAt,
      })
      .from(aiReportComposeJobsTable)
      .where(eq(aiReportComposeJobsTable.id, jobId));
    return r;
  }

  it("marks a stale COMPOSING row FAILED worker_lost_lease and syncs the worklist badge", async () => {
    const { reapStaleComposingJobs } = await import("./jobService");
    const staleId = await composingJob(new Date(Date.now() - 20 * 60_000));
    await db
      .update(radiologyWorklistTable)
      .set({ aiComposeStatus: "COMPOSING" })
      .where(eq(radiologyWorklistTable.id, worklistId));

    const reaped = await reapStaleComposingJobs(15 * 60_000);
    expect(reaped, "the stale row was reaped").toBeGreaterThanOrEqual(1);

    const after = await row(staleId);
    expect(after.status, "a dead worker's lease is released as a failure, not a hang").toBe("FAILED");
    expect(after.safeError).toBe("worker_lost_lease");
    expect(after.completedAt, "FAILED is terminal and timestamped like every other failure").not.toBeNull();

    const [wl] = await db
      .select({ aiComposeStatus: radiologyWorklistTable.aiComposeStatus })
      .from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.id, worklistId));
    expect(wl.aiComposeStatus, "the worklist badge must stop promising a draft").toBe("FAILED");
  });

  it("leaves a live compose run inside its lease alone", async () => {
    const { reapStaleComposingJobs } = await import("./jobService");
    const freshId = await composingJob(new Date(Date.now() - 60_000));

    await reapStaleComposingJobs(15 * 60_000);
    const after = await row(freshId);
    expect(after.status, "a run still inside its lease is not a dead worker").toBe("COMPOSING");
    expect(after.safeError).toBeNull();
    expect(after.completedAt).toBeNull();
  });

  it("never touches a job that already settled, however old its startedAt", async () => {
    const { reapStaleComposingJobs } = await import("./jobService");
    const readyId = await composingJob(new Date(Date.now() - 60 * 60_000));
    await db
      .update(aiReportComposeJobsTable)
      .set({ status: "READY", completedAt: new Date() })
      .where(eq(aiReportComposeJobsTable.id, readyId));

    await reapStaleComposingJobs(15 * 60_000);
    const after = await row(readyId);
    expect(after.status, "a delivered proposal is the radiologist's to review, not the reaper's").toBe("READY");
    expect(after.safeError).toBeNull();
  });

  it("the compose consumer tick reaps before it claims (cron wiring)", () => {
    // Source-level pin in the preDeploySafety style: the reaper only helps if the
    // compose consumer's own loop calls it, every tick, before claiming.
    const cron = readFileSync(join(here, "../../cron.ts"), "utf8");
    expect(cron).toContain("reapStaleComposingJobs");
  });
});
