/**
 * One compose job, one answer, one owner.
 *
 * Measured on 2026-10-27 in a real browser against a real API and PostgreSQL: the
 * workspace's `process-now` and the background tick both handed the SAME job to the
 * model. The first answer reached the radiologist, who accepted and applied it
 * (`applied_at` 08:44:03.251). Ten seconds later the second answer finished and the
 * unconditional completion write put the job back to READY with brand-new PENDING
 * changes (`completed_at` 08:44:13.676). The unreviewed-AI finalize guard then counted
 * that resurrected change, so the reviewed report could not be signed — and because
 * `/latest` returns the newest job (the one the refine had discarded), the AI panel
 * showed "AI Discarded" with nothing to review, so the refusal's own instruction
 * ("Review them … or Reject the remaining ones") could not be followed.
 *
 * These tests run the real worker with only the model fabricated: a job may be
 * started once, a delivered job may not be re-run underneath the review, and an
 * answer that arrives after the job was resolved is dropped instead of written.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
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
import { parseComposerSnapshot, type ComposerInputSnapshot } from "./types";

const { resolveComposerRuntime, resolveComposerProvider, composeMock, resolveTaskRoute } =
  vi.hoisted(() => ({
    resolveComposerRuntime: vi.fn(),
    resolveComposerProvider: vi.fn(),
    composeMock: vi.fn(),
    resolveTaskRoute: vi.fn(),
  }));

vi.mock("../voiceReportComposer/runtimeConfig", () => ({ resolveComposerRuntime }));
vi.mock("../ssrf/ollamaUrlGuard", () => ({
  validateOllamaUrl: vi.fn(() => ({ ok: true as const })),
}));
vi.mock("./resolveSelectedKeyImages", () => ({
  resolveSelectedKeyImagesForCompose: vi.fn(async () => ({ ok: false, safeError: "unused" })),
}));
vi.mock("./visionCapability", () => ({
  assertVisionCapableModel: vi.fn(async () => ({ ok: true as const })),
  __resetVisionCapabilityCacheForTests: vi.fn(),
}));
vi.mock("@workspace/ai-providers", async () => {
  const actual = await vi.importActual<typeof import("@workspace/ai-providers")>(
    "@workspace/ai-providers",
  );
  return { ...actual, resolveTaskRoute };
});
vi.mock("./providers", async () => {
  const actual = await vi.importActual<typeof import("./providers")>("./providers");
  return {
    ...actual,
    resolveComposerProvider,
    assertComposerProviderPolicy: vi.fn(() => ({ ok: true as const })),
  };
});

const marker = `vitest-claim-${randomUUID().slice(0, 8)}`;

function modelDraft(findings: string) {
  return {
    ok: true,
    text: JSON.stringify({ findings, impression: "Impression.", recommendation: "", warnings: [] }),
    provider: "ollama",
    model: "qwen3:14b",
    latencyMs: 10,
    execution: "LOCAL",
  } as never;
}

/** A model answer the test releases by hand, so "in flight" is a state we control. */
function deferredDraft(findings: string) {
  let release!: (v: unknown) => void;
  const promise = new Promise((res) => {
    release = res;
  });
  return { promise, release: () => release(modelDraft(findings)) };
}

describe.skipIf(!hasDatabaseUrl())("a compose job is claimed once and answered once", () => {
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
        lastName: "Claim",
        dateOfBirth: "1972-03-04",
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
        patientName: "Synthetic Claim",
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

  beforeEach(() => {
    vi.clearAllMocks();
    resolveComposerRuntime.mockResolvedValue({
      enabled: true,
      model: "qwen3:14b",
      url: "http://127.0.0.1:11434",
      endpoint: "http://127.0.0.1:11434/api/generate",
      numCtx: 8192,
      localOnly: true,
      fallbackModel: null,
    } as never);
    resolveTaskRoute.mockResolvedValue(null as never);
    resolveComposerProvider.mockReturnValue({ name: "ollama", compose: composeMock } as never);
    composeMock.mockReset();
  });

  async function queuedJob(): Promise<number> {
    const snapshot: ComposerInputSnapshot = parseComposerSnapshot({
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
    const [job] = await db
      .insert(aiReportComposeJobsTable)
      .values({
        worklistId,
        jobKind: "FULL_REPORT",
        status: "QUEUED",
        sourceReportRevision: "r1",
        sourceFindingsHash: "f1",
        sourceImpressionHash: "i1",
        sourceRecommendationHash: "rc1",
        inputHash: "in1",
        inputSnapshotJson: JSON.stringify(snapshot),
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
        trackedChangesJson: aiReportComposeJobsTable.trackedChangesJson,
        completedAt: aiReportComposeJobsTable.completedAt,
        startedAt: aiReportComposeJobsTable.startedAt,
      })
      .from(aiReportComposeJobsTable)
      .where(eq(aiReportComposeJobsTable.id, jobId));
    return r;
  }

  function changeIds(json: string | null): string[] {
    try {
      const parsed: unknown = JSON.parse(json ?? "[]");
      return Array.isArray(parsed) ? parsed.map((c) => String((c as { id?: unknown }).id ?? "")) : [];
    } catch {
      return [];
    }
  }

  it("does not start a second run of a job that is already being composed", async () => {
    const jobId = await queuedJob();
    const run = deferredDraft("Brain: the second answer.");
    composeMock.mockReturnValue(run.promise);
    const { processComposeJob } = await import("./jobService");

    const first = processComposeJob(jobId);
    // Give the first call time to claim the row, then ask for the same job again —
    // this is the background tick arriving while the browser's process-now runs.
    await new Promise((r) => setTimeout(r, 150));
    const second = await processComposeJob(jobId);

    expect(second.ok, "a refused claim is still a success for the queue: there is nothing to do").toBe(true);
    expect(second.detail, `second door was told: ${second.detail}`).toMatch(/not claimable \(COMPOSING\)/);

    run.release();
    await first;

    expect(composeMock.mock.calls.length, "one job must cost exactly one model call").toBe(1);
    const after = await row(jobId);
    expect(after.status).toBe("READY");
    expect(changeIds(after.trackedChangesJson).length, "one delivered proposal set").toBeGreaterThan(0);
  });

  it("will not re-run a job whose answer the radiologist is already reviewing", async () => {
    const jobId = await queuedJob();
    composeMock.mockResolvedValue(modelDraft("Brain: the delivered answer."));
    const { processComposeJob } = await import("./jobService");
    await processComposeJob(jobId);
    const delivered = await row(jobId);
    expect(delivered.status).toBe("READY");
    const deliveredIds = changeIds(delivered.trackedChangesJson);

    // The client's process-now on a job that already answered. Before the claim this
    // re-ran the model and rewrote tracked_changes_json with NEW change ids, which is
    // how an applied review came back as an unreviewed suggestion.
    composeMock.mockResolvedValue(modelDraft("Brain: a second, different answer."));
    const again = await processComposeJob(jobId);
    expect(again.detail).toMatch(/not claimable \(READY\)/);
    expect(composeMock.mock.calls.length, "no second model call for a delivered job").toBe(1);

    const after = await row(jobId);
    expect(after.status).toBe("READY");
    expect(changeIds(after.trackedChangesJson), "the proposal set the review is working on is unchanged").toEqual(deliveredIds);
  });

  it("drops an answer that arrives after the job was resolved elsewhere", async () => {
    const jobId = await queuedJob();
    const run = deferredDraft("Brain: an answer that arrived too late.");
    composeMock.mockReturnValue(run.promise);
    const { processComposeJob } = await import("./jobService");
    const first = processComposeJob(jobId);
    await new Promise((r) => setTimeout(r, 150));

    // Another door settled this job while the model was thinking — a report signed
    // on a second workstation retires its draft as OBSOLETE.
    await db
      .update(aiReportComposeJobsTable)
      .set({ status: "OBSOLETE", updatedAt: new Date() })
      .where(eq(aiReportComposeJobsTable.id, jobId));
    await db
      .update(radiologyWorklistTable)
      .set({ aiComposeStatus: "OBSOLETE" })
      .where(eq(radiologyWorklistTable.id, worklistId));

    run.release();
    const result = await first;

    expect(result.detail, `late answer reported: ${result.detail}`).toMatch(/superseded/);
    const after = await row(jobId);
    expect(after.status, "a resolved job is not re-opened by a late answer").toBe("OBSOLETE");
    expect(after.completedAt, "the late run wrote nothing").toBeNull();
    const [wl] = await db
      .select({ aiComposeStatus: radiologyWorklistTable.aiComposeStatus })
      .from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.id, worklistId));
    expect(wl.aiComposeStatus, "the worklist badge still says what the other door decided").toBe("OBSOLETE");
  });
});
