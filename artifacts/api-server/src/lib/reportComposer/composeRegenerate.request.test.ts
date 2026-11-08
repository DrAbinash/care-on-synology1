/**
 * B6 — regenerating a compose job with unchanged input must actually run.
 *
 * `dicom_retry_queue.idempotency_key` is unique whatever the row's status, so
 * when a compose job settled (READY — the radiologist reviewed the draft) and
 * the same input was queued again, `enqueueRadiologyJob`'s onConflictDoNothing
 * silently landed the NEW compose row against the FIRST job's already-terminal
 * queue row. Nothing ever claimed the new job: the compose row sat QUEUED and
 * the worklist badge said QUEUED forever, and the only way out was a hand-edited
 * database row.
 *
 * The compose-level dedupe (QUEUED/COMPOSING, backed by the partial unique
 * index ai_report_compose_jobs_idem_uq) already decides when an identical
 * request is a double-submit; once the earlier job is terminal, a re-queue is a
 * deliberate regenerate and must get a queue row of its own.
 *
 * These tests run against a real PostgreSQL database with the model taken out
 * of the picture entirely: the first job is settled by direct row writes, which
 * reproduce the terminal state a delivered-and-reviewed draft reaches.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  aiReportComposeJobsTable,
  dicomRetryQueueTable,
  patientsTable,
  radiologyReportDraftsTable,
  radiologyStudiesTable,
  radiologyWorklistTable,
} from "@workspace/db/schema";
import { hasDatabaseUrl } from "../../testSupport/apiTestApp";
import { getRadiologyJobById } from "../radiologyJobs";
import { parseComposerSnapshot, type ComposerInputSnapshot } from "./types";

const marker = `vitest-regen-${randomUUID().slice(0, 8)}`;

describe.skipIf(!hasDatabaseUrl())("regenerating with unchanged input gets a runnable queue row", () => {
  const cleanup = {
    jobIds: [] as number[],
    queueJobIds: [] as number[],
    draftIds: [] as number[],
    worklistIds: [] as number[],
    studyIds: [] as number[],
    patientIds: [] as number[],
  };
  let worklistId = 0;
  let snapshot: ComposerInputSnapshot;

  beforeAll(async () => {
    const [patient] = await db
      .insert(patientsTable)
      .values({
        patientId: `MRN-${marker}`,
        firstName: "Synthetic",
        lastName: "Regen",
        dateOfBirth: "1975-06-07",
        gender: "M",
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
        patientName: "Synthetic Regen",
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

    snapshot = parseComposerSnapshot({
      worklistId,
      modality: "MR",
      region: "Brain",
      regions: ["Brain"],
      studyType: "MRI BRAIN",
      reportTitle: "MRI BRAIN",
      technique: "Multiplanar MRI brain.",
      findings: "Normal MRI of the brain.",
      impression: "",
      recommendation: "",
      observations: [],
      jobKindHint: "FULL_REPORT",
    });
  });

  afterAll(async () => {
    // Queue rows are deleted first and by id: nothing cascades from the compose
    // rows that reference them, and a leaked pending row would keep claiming.
    if (cleanup.queueJobIds.length) {
      await db.delete(dicomRetryQueueTable).where(inArray(dicomRetryQueueTable.id, cleanup.queueJobIds));
    }
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

  async function composeRow(jobId: number) {
    const [r] = await db
      .select({
        status: aiReportComposeJobsTable.status,
        queueJobId: aiReportComposeJobsTable.queueJobId,
      })
      .from(aiReportComposeJobsTable)
      .where(eq(aiReportComposeJobsTable.id, jobId));
    return r;
  }

  it("a regenerate after the first job settled is queued on its own runnable row", async () => {
    const { enqueueComposeJob } = await import("./jobService");

    // First run: enqueued…
    const first = await enqueueComposeJob({ snapshot, jobKind: "FULL_REPORT", createdBy: marker });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    cleanup.jobIds.push(first.jobId);
    const firstRow = await composeRow(first.jobId);
    expect(firstRow.queueJobId, "the first job owns a queue row").not.toBeNull();
    const firstQueueId = firstRow.queueJobId as number;
    cleanup.queueJobIds.push(firstQueueId);
    const firstQueue = await getRadiologyJobById(firstQueueId);
    expect(["pending", "retrying", "running"], `first job's queue row is live (${firstQueue?.status})`).toContain(
      firstQueue?.status,
    );

    // …then a worker ran it and delivered. The compose row becomes READY and its
    // queue row completes — the terminal pair a delivered draft leaves behind.
    await db
      .update(aiReportComposeJobsTable)
      .set({ status: "READY", completedAt: new Date() })
      .where(eq(aiReportComposeJobsTable.id, first.jobId));
    await db
      .update(dicomRetryQueueTable)
      .set({ status: "success", completedAt: new Date(), resolvedAt: new Date(), lockedBy: null, lockedAt: null })
      .where(eq(dicomRetryQueueTable.id, firstQueueId));

    // The radiologist regenerates with the SAME unchanged input.
    const second = await enqueueComposeJob({ snapshot, jobKind: "FULL_REPORT", createdBy: marker });
    expect(second.ok, `regenerate refused: ${second.ok ? "" : JSON.stringify(second)}`).toBe(true);
    if (!second.ok) return;
    cleanup.jobIds.push(second.jobId);
    expect(second.jobId, "a regenerate is a new job, not the settled one").not.toBe(first.jobId);
    expect(second.deduped).toBe(false);

    const secondRow = await composeRow(second.jobId);
    expect(secondRow.status).toBe("QUEUED");
    expect(secondRow.queueJobId, "the regenerate must have a queue row of its own").not.toBeNull();
    if (secondRow.queueJobId == null) return;
    if (secondRow.queueJobId !== firstQueueId) cleanup.queueJobIds.push(secondRow.queueJobId);

    const secondQueue = await getRadiologyJobById(secondRow.queueJobId);
    expect(
      ["pending", "retrying"],
      `B6: the regenerate's queue row is runnable, not the first job's terminal row (${secondQueue?.status})`,
    ).toContain(secondQueue?.status);
  });

  it("an identical request while the first job is still active is still deduped", async () => {
    const { enqueueComposeJob } = await import("./jobService");
    const active = await enqueueComposeJob({ snapshot, jobKind: "IMPRESSION", createdBy: marker });
    expect(active.ok).toBe(true);
    if (!active.ok) return;
    cleanup.jobIds.push(active.jobId);
    const activeRow = await composeRow(active.jobId);
    if (activeRow.queueJobId != null) cleanup.queueJobIds.push(activeRow.queueJobId);

    const doubleSubmit = await enqueueComposeJob({ snapshot, jobKind: "IMPRESSION", createdBy: marker });
    expect(doubleSubmit.ok).toBe(true);
    if (!doubleSubmit.ok) return;
    expect(doubleSubmit.deduped, "a double-submit against a live identical job is still the dedupe's job").toBe(true);
    expect(doubleSubmit.jobId).toBe(active.jobId);
  });
});
