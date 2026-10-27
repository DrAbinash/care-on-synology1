/**
 * The worker path, end to end: a compose job for a study whose canal record
 * exists only in the measurement grid.
 *
 * What is under test is what CARE shows the model and what CARE refuses, not what
 * sentences a model produces — so only the generation step is fabricated, and the
 * job, the draft row, the worklist row and the validation are all real. The unit
 * suites prove the projection and the rules; this proves the wiring, which nothing
 * else can: if `jobService` stopped passing the record, every unit test would stay
 * green while the clinic went back to an AI that had never seen the numbers.
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
import { STRUCTURED_JSON_ENVELOPE_KIND } from "../structuredJsonColumn";
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

const marker = `vitest-canal-worker-${randomUUID().slice(0, 8)}`;

function modelDraft(findings: string) {
  return {
    ok: true,
    text: JSON.stringify({ findings, impression: "Impression.", recommendation: "", warnings: [] }),
    provider: "ollama",
    model: "gemma3:12b",
    latencyMs: 10,
    execution: "LOCAL",
  } as never;
}

describe.skipIf(!hasDatabaseUrl())("the compose worker is shown the canonical canal record", () => {
  const cleanup = { jobIds: [] as number[], draftIds: [] as number[], worklistIds: [] as number[], studyIds: [] as number[], patientIds: [] as number[] };
  let worklistId = 0;

  beforeAll(async () => {
    const [patient] = await db
      .insert(patientsTable)
      .values({
        patientId: `MRN-${marker}`,
        firstName: "Synthetic",
        lastName: "Worker",
        dateOfBirth: "1970-01-01",
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
        studyInstanceUid: `1.2.826.vitest.canalworker.${marker}`,
      })
      .returning();
    cleanup.studyIds.push(study.id as number);

    const [wl] = await db
      .insert(radiologyWorklistTable)
      .values({
        patientName: "Synthetic Worker",
        patientId: patient.id,
        studyId: study.id,
        patientMatchStatus: "MATCHED",
        modality: "MR",
        studyDescription: "MRI LS SPINE",
        studyInstanceUID: `1.2.826.vitest.canalworker.${marker}`,
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
        // Only the grid holds these. The Findings sentence below names no number,
        // which is the case the prose scrape could never see.
        structuredJson: {
          kind: STRUCTURED_JSON_ENVELOPE_KIND,
          careCanalApProvenance: {
            "L1-L2": { viewerValue: 12.6 },
            "L4-L5": { viewerValue: 9.4, reportValue: 6.4, manualOverride: true },
          },
        },
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
      model: "gemma3:12b",
      url: "http://127.0.0.1:11434",
      endpoint: "http://127.0.0.1:11434/api/generate",
      numCtx: 8192,
      localOnly: true,
      fallbackModel: null,
    } as never);
    resolveTaskRoute.mockResolvedValue(null as never);
    resolveComposerProvider.mockReturnValue({ name: "ollama", compose: composeMock } as never);
  });

  async function runWorker(modelFindings: string): Promise<{ jobId: number; userPrompt: string }> {
    const snapshot: ComposerInputSnapshot = parseComposerSnapshot({
      worklistId,
      modality: "MR",
      region: "LS Spine",
      regions: ["LS Spine"],
      spineSegment: "lumbar",
      studyType: "MRI LS SPINE",
      reportTitle: "MRI LS SPINE",
      technique: "Multiplanar MRI lumbar spine.",
      findings: "Loss of normal lumbar lordosis.",
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

    composeMock.mockResolvedValue(modelDraft(modelFindings));
    const { processComposeJob } = await import("./jobService");
    await processComposeJob(job.id as number);

    const call = composeMock.mock.calls[0]?.[0] as { userPrompt: string } | undefined;
    return { jobId: job.id as number, userPrompt: call?.userPrompt ?? "" };
  }

  async function jobState(jobId: number) {
    const [row] = await db
      .select({
        status: aiReportComposeJobsTable.status,
        safeError: aiReportComposeJobsTable.safeError,
        validationJson: aiReportComposeJobsTable.validationJson,
      })
      .from(aiReportComposeJobsTable)
      .where(eq(aiReportComposeJobsTable.id, jobId));
    return row;
  }

  it("puts the record in front of the model, at the level it belongs to", async () => {
    const { userPrompt } = await runWorker("Loss of lordosis. The AP canal diameter at L4-L5 is 6.4 mm.");
    expect(userPrompt).toContain("CANAL AP DIAMETERS (mm)");
    expect(userPrompt).toContain("- L1-L2: 12.6 mm");
    expect(userPrompt).toContain("- L4-L5: 6.4 mm (radiologist's recorded value)");
    // The radiologist's override replaces the caliper reading; the superseded
    // number must not be an option the model can copy.
    expect(userPrompt).not.toContain("9.4");
  });

  it("refuses a draft that changes a canonical diameter, before it can reach READY", async () => {
    const { jobId } = await runWorker("The AP canal diameter at L4-L5 is 9.4 mm.");
    const state = await jobState(jobId);
    expect(state?.status).toBe("FAILED");
    expect(String(state?.safeError)).toContain("canal_measurement_mutation");
  });

  it("lets a faithful draft through, with the unmentioned diameters reported", async () => {
    const { jobId } = await runWorker("The AP canal diameter at L4-L5 is 6.4 mm.");
    const state = await jobState(jobId);
    expect(state?.status).toBe("READY");
    const stored = state?.validationJson as unknown;
    const validation = (typeof stored === "string" ? JSON.parse(stored) : stored ?? {}) as {
      errors?: string[];
      warnings?: string[];
    };
    expect(validation.errors ?? []).not.toContain("canal_measurement_mutation");
    const warnings = (validation.warnings ?? []).join(" | ");
    // L1-L2 12.6 mm is in the report's table and not in this draft. Advisory —
    // the prompt tells the model not to restate every level — but now visible,
    // which is the half of "checked independently of prose" that used to be missing.
    expect(warnings).toContain("L1-L2");
  });
});
