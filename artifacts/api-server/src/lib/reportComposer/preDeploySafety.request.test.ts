/**
 * DB-backed pre-deploy safety contracts (8, 9, 12, 15).
 * Inserts compose rows directly — avoids dicom_retry_queue idempotency index
 * gaps on db:push-only dev databases.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@workspace/db";
import {
  aiReportComposeJobsTable,
  radiologyWorklistTable,
} from "@workspace/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { hasDatabaseUrl } from "../../testSupport/apiTestApp";
import {
  evaluateJobFreshness,
  getLatestComposeJob,
  markComposeApplied,
} from "./jobService";
import { computeSnapshotHashes, hashText } from "./snapshot";
import { parseComposerSnapshot } from "./types";

function worklistSeed(marker: string, label: "A" | "B") {
  const uid = `1.2.840.vitest.compose.${marker}.${label}`;
  return {
    patientName: `Patient ${label} ${marker}`,
    modality: "MR",
    studyDescription: `MRI LS Spine ${label}`,
    studyInstanceUID: uid,
    accessionNumber: `ACC-COMP-${marker}-${label}`,
    status: "STUDY_RECEIVED" as const,
    aiDraftStatus: "NONE" as const,
    aiComposeStatus: "NONE" as const,
    dicomPatientId: `PDC-${marker}-${label}`,
  };
}

describe.skipIf(!hasDatabaseUrl())("pre-deploy safety contracts — DB", () => {
  const marker = `vitest-pdc-${randomUUID().slice(0, 8)}`;
  let worklistA = 0;
  let worklistB = 0;
  const jobIds: number[] = [];

  beforeAll(async () => {
    const [a] = await db
      .insert(radiologyWorklistTable)
      .values(worklistSeed(marker, "A"))
      .returning();
    const [b] = await db
      .insert(radiologyWorklistTable)
      .values(worklistSeed(marker, "B"))
      .returning();
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
    findings: string;
    status?: string;
    trackedChangesJson?: string;
  }) {
    const snapshot = parseComposerSnapshot({
      worklistId: opts.worklistId,
      findings: opts.findings,
      impression: "",
      recommendation: "",
      observations: [],
    });
    const hashes = computeSnapshotHashes(snapshot);
    const [row] = await db
      .insert(aiReportComposeJobsTable)
      .values({
        worklistId: opts.worklistId,
        jobKind: "FULL_REPORT",
        status: (opts.status ?? "READY") as "READY",
        sourceReportRevision: hashes.reportRevision,
        sourceFindingsHash: hashes.findingsHash,
        sourceImpressionHash: hashes.impressionHash,
        sourceRecommendationHash: hashes.recommendationHash,
        inputHash: hashes.inputHash,
        inputSnapshotJson: JSON.stringify(snapshot),
        trackedChangesJson: opts.trackedChangesJson ?? "[]",
        proposedFindings: opts.findings,
        priority: 40,
      })
      .returning();
    jobIds.push(row.id);
    return { row, hashes };
  }

  it("8. Study A compose job is scoped to worklist A (never Study B)", async () => {
    await seedJob({ worklistId: worklistA, findings: "Study A only." });
    const latestA = await getLatestComposeJob(worklistA);
    const latestB = await getLatestComposeJob(worklistB);
    expect(latestA?.worklistId).toBe(worklistA);
    expect(latestB).toBeNull();
  });

  it("9. reopen/refresh Study A recovers its latest READY job", async () => {
    const { row } = await seedJob({ worklistId: worklistA, findings: "Recover on reopen." });
    const latest = await getLatestComposeJob(worklistA);
    expect(latest?.id).toBe(row.id);
    expect(latest?.status).toBe("READY");
  });

  it("15. duplicate active identical jobs blocked by partial unique index", async () => {
    const findings = "Dedupe probe findings.";
    const snapshot = parseComposerSnapshot({ worklistId: worklistA, findings, impression: "", recommendation: "", observations: [] });
    const hashes = computeSnapshotHashes(snapshot);
    const base = {
      worklistId: worklistA,
      jobKind: "FULL_REPORT" as const,
      status: "QUEUED" as const,
      sourceReportRevision: hashes.reportRevision,
      sourceFindingsHash: hashes.findingsHash,
      sourceImpressionHash: hashes.impressionHash,
      sourceRecommendationHash: hashes.recommendationHash,
      inputHash: hashes.inputHash,
      inputSnapshotJson: JSON.stringify(snapshot),
      priority: 40,
    };
    const [first] = await db.insert(aiReportComposeJobsTable).values(base).returning();
    jobIds.push(first.id);
    await expect(db.insert(aiReportComposeJobsTable).values(base)).rejects.toThrow();

    const active = await db
      .select({ id: aiReportComposeJobsTable.id })
      .from(aiReportComposeJobsTable)
      .where(
        and(
          eq(aiReportComposeJobsTable.worklistId, worklistA),
          eq(aiReportComposeJobsTable.inputHash, hashes.inputHash),
          eq(aiReportComposeJobsTable.status, "QUEUED"),
        ),
      );
    expect(active.filter((r) => r.id === first.id)).toHaveLength(1);
  });

  it("12. STALE_READY server rejects /applied confirmation", async () => {
    const { row } = await seedJob({
      worklistId: worklistB,
      findings: "Initial B findings.",
      status: "STALE_READY",
      trackedChangesJson: JSON.stringify([
        {
          id: "c1",
          source: "AI_COMPOSER",
          changeType: "REPLACE",
          field: "FINDINGS",
          originalText: "Initial B findings.",
          proposedText: "Stale proposed",
          reviewState: "ACCEPTED",
          clinicalSignificance: false,
          clinicalSignificanceReasons: [],
          createdAt: new Date().toISOString(),
        },
      ]),
    });
    const applied = await markComposeApplied({ jobId: row.id, acceptedChangeIds: ["c1"] });
    expect(applied.ok).toBe(false);
    expect(applied.error).toBe("stale_ready");
  });

  it("freshness flips READY → STALE_READY when editor revision changes", async () => {
    const findings = "Freshness probe findings.";
    const { row, hashes } = await seedJob({ worklistId: worklistB, findings, status: "READY" });
    const changedFindingsHash = hashText("Edited after compose.");
    const changedRevision = hashText(`${changedFindingsHash}:${hashes.impressionHash}:${hashes.recommendationHash}:`);
    const fr = await evaluateJobFreshness(row.id, {
      findingsHash: changedFindingsHash,
      impressionHash: hashes.impressionHash,
      recommendationHash: hashes.recommendationHash,
      reportRevision: changedRevision,
    });
    expect(fr.stale).toBe(true);
    expect(fr.status).toBe("STALE_READY");
  });
});
