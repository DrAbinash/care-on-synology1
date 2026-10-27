/**
 * STAGE 1 PR-A2 ruling 8, at the seam where it actually bites: the compose worker.
 *
 * "Clinical mode enforces the approved cloud-image audit policy" and "do not block
 * local inference because of audit failures" are two halves of one rule, and both
 * are decided here — after the model has answered, before the draft is handed to
 * the radiologist. Nothing else in the repo can prove this pairing: the policy unit
 * suite has no worker, the engine suite has no database, and `imageSendAudit.request`
 * has no job. A regression here would look like a normal evening — a cloud draft
 * with no audit row, accepted because every unit test still passes.
 *
 * Only the generation step is fabricated (which sentences a model produced is not
 * the subject). The job row, the draft row, the worklist row, the ownership and
 * identity resolution, the mode→flag derivation and the endpoint-derived locality
 * classification are all the real ones.
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
import type { ComposeRunResult } from "./composeEngine";
import type { ComposerDraftOutput } from "./types";
import { flagsForMode, type AiSecurityMode } from "../ai/aiSecurityPolicy";

const h = vi.hoisted(() => ({
  runReportComposer: vi.fn(),
  recordImageSendAudit: vi.fn(),
  resolveAiSecurityPolicy: vi.fn(),
}));

vi.mock("./composeEngine", async () => {
  const actual = await vi.importActual<typeof import("./composeEngine")>("./composeEngine");
  return { ...actual, runReportComposer: h.runReportComposer };
});
vi.mock("../ai/imageSendAudit", async () => {
  const actual = await vi.importActual<typeof import("../ai/imageSendAudit")>("../ai/imageSendAudit");
  return { ...actual, recordImageSendAudit: h.recordImageSendAudit };
});
vi.mock("../ai/aiSecurityPolicy", async () => {
  const actual = await vi.importActual<typeof import("../ai/aiSecurityPolicy")>("../ai/aiSecurityPolicy");
  return { ...actual, resolveAiSecurityPolicy: h.resolveAiSecurityPolicy };
});

const marker = `vitest-a2audit-${randomUUID().slice(0, 8)}`;

const LOCAL_ENDPOINT = "http://127.0.0.1:11434/api/generate";
const CLOUD_ENDPOINT = "https://api.deepseek.com/v1/chat/completions";

const FINDINGS = "Loss of normal lumbar lordosis.";

/** The draft the model "produced" — faithful, so validation is never the reason it lands. */
function draft(): ComposerDraftOutput {
  return {
    findings: FINDINGS,
    impression: "Loss of normal lumbar lordosis.",
    recommendation: "",
    unresolvedQuestions: [],
    warnings: [],
  };
}

/**
 * The engine's answer for a given send. `locality` is expressed the way the real
 * adapters express it — as the endpoint they addressed and, when known, what the
 * transport said — because the worker classifies from those, not from a label.
 */
function answeredRun(opts: {
  provider: string;
  endpoint: string | null;
  executedLocality?: "local" | "cloud" | null;
  imagesLoaded: number;
}): ComposeRunResult {
  return {
    ok: true,
    draft: draft(),
    model: opts.provider === "ollama" ? "gemma3:12b" : "deepseek-chat",
    provider: opts.provider as never,
    fallbackUsed: false,
    latencyMs: 42,
    usage: null,
    provenance: {
      aiMode: opts.imagesLoaded > 0 ? "SELECTED_IMAGES" : "TEXT_ONLY",
      provider: opts.provider,
      model: "the-model",
      imagesLoaded: opts.imagesLoaded,
      imageSourceTypes: opts.imagesLoaded > 0 ? ["DICOM"] : undefined,
      executedLocality: opts.executedLocality ?? null,
      resolvedEndpoint: opts.endpoint,
      selectedKeyImageIds: [],
      linkedObservationIds: [],
      personaVersion: null,
      fallbackUsed: false,
      degradedReason: null,
    },
  };
}

function refusedRun(safeError: string, provider: string): ComposeRunResult {
  return {
    ok: false,
    safeError,
    provider: provider as never,
    model: "gemma3:12b",
    latencyMs: 5,
    provenance: {
      aiMode: "SELECTED_IMAGES",
      provider,
      imagesLoaded: 0,
      resolvedEndpoint: CLOUD_ENDPOINT,
      executedLocality: null,
      degradedReason: null,
    },
  };
}

describe.skipIf(!hasDatabaseUrl())(
  "the compose worker enforces the audit policy only where the pixels left",
  () => {
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
          lastName: "Auditworker",
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
          studyInstanceUid: `1.2.826.vitest.a2audit.${marker}`,
        })
        .returning();
      cleanup.studyIds.push(study.id as number);

      const [wl] = await db
        .insert(radiologyWorklistTable)
        .values({
          patientName: "Synthetic Auditworker",
          patientId: patient.id,
          studyId: study.id,
          patientMatchStatus: "MATCHED",
          modality: "MR",
          studyDescription: "MRI LS SPINE",
          studyInstanceUID: `1.2.826.vitest.a2audit.${marker}`,
          accessionNumber: `ACC-${marker}`,
          status: "STUDY_RECEIVED",
        })
        .returning();
      worklistId = wl.id as number;
      cleanup.worklistIds.push(worklistId);

      const [draftRow] = await db
        .insert(radiologyReportDraftsTable)
        .values({
          studyId: worklistId,
          worklistId,
          patientId: patient.id,
          modality: "MR",
          status: "DRAFT",
          rawFindings: FINDINGS,
        })
        .returning();
      cleanup.draftIds.push(draftRow.id as number);
    });

    afterAll(async () => {
      if (cleanup.jobIds.length) {
        await db
          .delete(aiReportComposeJobsTable)
          .where(inArray(aiReportComposeJobsTable.id, cleanup.jobIds));
      }
      if (cleanup.draftIds.length) {
        await db
          .delete(radiologyReportDraftsTable)
          .where(inArray(radiologyReportDraftsTable.id, cleanup.draftIds));
      }
      if (cleanup.worklistIds.length) {
        await db
          .delete(radiologyWorklistTable)
          .where(inArray(radiologyWorklistTable.id, cleanup.worklistIds));
      }
      if (cleanup.studyIds.length) {
        await db
          .delete(radiologyStudiesTable)
          .where(inArray(radiologyStudiesTable.id, cleanup.studyIds));
      }
      if (cleanup.patientIds.length) {
        await db.delete(patientsTable).where(inArray(patientsTable.id, cleanup.patientIds));
      }
    });

    beforeEach(() => {
      vi.clearAllMocks();
      h.recordImageSendAudit.mockResolvedValue({ filed: true });
    });

    /**
     * One worker pass. `mode` is the only security input a clinic admin can set, so
     * the test says "clinical"/"development" and lets production code derive the
     * rest — a test that hand-set `strictAudit` would pass even if the derivation
     * were deleted.
     */
    async function runCase(opts: {
      mode: AiSecurityMode;
      cloudVisionAllowed?: boolean;
      run: ComposeRunResult;
      auditFiled?: boolean;
    }) {
      h.resolveAiSecurityPolicy.mockResolvedValue({
        mode: opts.mode,
        cloudVisionAllowed: opts.cloudVisionAllowed ?? true,
        ...flagsForMode(opts.mode),
      });
      h.recordImageSendAudit.mockResolvedValue({ filed: opts.auditFiled ?? true });
      h.runReportComposer.mockResolvedValue(opts.run);

      const snapshot: ComposerInputSnapshot = parseComposerSnapshot({
        worklistId,
        modality: "MR",
        region: "LS Spine",
        regions: ["LS Spine"],
        spineSegment: "lumbar",
        studyType: "MRI LS SPINE",
        reportTitle: "MRI LS SPINE",
        technique: "Multiplanar MRI lumbar spine.",
        findings: FINDINGS,
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

      const { processComposeJob } = await import("./jobService");
      const result = await processComposeJob(job.id as number);
      const [row] = await db
        .select({
          status: aiReportComposeJobsTable.status,
          safeError: aiReportComposeJobsTable.safeError,
          proposedFindings: aiReportComposeJobsTable.proposedFindings,
        })
        .from(aiReportComposeJobsTable)
        .where(eq(aiReportComposeJobsTable.id, job.id));
      const [wl] = await db
        .select({ aiComposeStatus: radiologyWorklistTable.aiComposeStatus })
        .from(radiologyWorklistTable)
        .where(eq(radiologyWorklistTable.id, worklistId));

      return { jobId: job.id as number, result, row, worklistStatus: wl?.aiComposeStatus };
    }

    it("refuses a cloud image draft whose audit row could not be written", async () => {
      const c = await runCase({
        mode: "clinical",
        auditFiled: false,
        run: answeredRun({
          provider: "deepseek",
          endpoint: CLOUD_ENDPOINT,
          executedLocality: "cloud",
          imagesLoaded: 2,
        }),
      });
      expect(c.result).toMatchObject({ ok: true, detail: "cloud_image_audit_unfiled" });
      expect(c.row?.status).toBe("FAILED");
      expect(String(c.row?.safeError)).toBe("cloud_image_audit_unfiled");
      // Not delivered: a FAILED job must carry no proposal the workspace could apply.
      expect(c.row?.proposedFindings).toBeNull();
      expect(c.worklistStatus).toBe("FAILED");
    });

    it("delivers the identical draft when the audit row WAS written", async () => {
      const c = await runCase({
        mode: "clinical",
        auditFiled: true,
        run: answeredRun({
          provider: "deepseek",
          endpoint: CLOUD_ENDPOINT,
          executedLocality: "cloud",
          imagesLoaded: 2,
        }),
      });
      expect(c.row?.status).toBe("READY");
      expect(c.row?.proposedFindings).toBe(FINDINGS);
    });

    it("never blocks a LOCAL send over an audit failure", async () => {
      // Ruling 8 verbatim: "Do not block local inference because of audit failures."
      // Same mode, same unfiled audit, same number of images — only the endpoint
      // differs, because that is what the clinic actually controls.
      const c = await runCase({
        mode: "clinical",
        auditFiled: false,
        run: answeredRun({
          provider: "ollama",
          endpoint: LOCAL_ENDPOINT,
          executedLocality: "local",
          imagesLoaded: 2,
        }),
      });
      expect(c.row?.status).toBe("READY");
      expect(c.row?.proposedFindings).toBe(FINDINGS);
    });

    it("treats an Ollama-LABELLED run aimed at a cloud endpoint as the cloud send it was", async () => {
      // Locality comes from the endpoint, so a provider name cannot talk its way out
      // of enforcement.
      const c = await runCase({
        mode: "clinical",
        auditFiled: false,
        run: answeredRun({ provider: "ollama", endpoint: CLOUD_ENDPOINT, imagesLoaded: 1 }),
      });
      expect(String(c.row?.safeError)).toBe("cloud_image_audit_unfiled");
      expect(c.row?.proposedFindings).toBeNull();
    });

    it("does not enforce auditability in DEVELOPMENT mode", async () => {
      // Same run, same unfiled audit as the first case: the mode is the only variable.
      const c = await runCase({
        mode: "development",
        auditFiled: false,
        run: answeredRun({
          provider: "deepseek",
          endpoint: CLOUD_ENDPOINT,
          executedLocality: "cloud",
          imagesLoaded: 2,
        }),
      });
      expect(c.row?.status).toBe("READY");
    });

    it("files nothing for a text-only run, so nothing can block it", async () => {
      const c = await runCase({
        mode: "clinical",
        auditFiled: false,
        run: answeredRun({ provider: "ollama", endpoint: LOCAL_ENDPOINT, imagesLoaded: 0 }),
      });
      expect(h.recordImageSendAudit).not.toHaveBeenCalled();
      expect(c.row?.status).toBe("READY");
    });

    it("keeps a policy refusal its own reason instead of relabelling it an audit failure", async () => {
      const c = await runCase({
        mode: "clinical",
        auditFiled: false,
        run: refusedRun("cloud_image_attestation_required", "deepseek"),
      });
      expect(String(c.row?.safeError)).toBe("cloud_image_attestation_required");
      expect(c.row?.status).toBe("FAILED");
      // The refusal is itself evidence, so it is filed — and filing is attempted
      // before enforcement reads `filed`, which is why the refusal still wins.
      expect(h.recordImageSendAudit).toHaveBeenCalledTimes(1);
    });

    it("passes the resolved mode into the engine, both terms, on every kind of run", async () => {
      await runCase({
        mode: "development",
        run: answeredRun({ provider: "deepseek", endpoint: CLOUD_ENDPOINT, imagesLoaded: 0 }),
      });
      expect(h.runReportComposer.mock.calls[0]?.[0]).toMatchObject({
        cloudVisionAllowed: true,
        requireAttestation: false,
      });

      await runCase({
        mode: "clinical",
        cloudVisionAllowed: false,
        run: refusedRun("cloud_image_not_allowed", "deepseek"),
      });
      expect(h.runReportComposer.mock.calls[1]?.[0]).toMatchObject({
        cloudVisionAllowed: false,
        requireAttestation: true,
      });
    });

    it("quots the job reference and the image count into the audit row it enforces", async () => {
      const c = await runCase({
        mode: "clinical",
        auditFiled: false,
        run: answeredRun({
          provider: "deepseek",
          endpoint: CLOUD_ENDPOINT,
          executedLocality: "cloud",
          imagesLoaded: 3,
        }),
      });
      expect(h.recordImageSendAudit).toHaveBeenCalledTimes(1);
      const values = h.recordImageSendAudit.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(values).toMatchObject({
        jobReference: `compose_job:${c.jobId}`,
        numImages: 3,
        provider: "deepseek",
        resolvedUrl: CLOUD_ENDPOINT,
        executedLocality: "cloud",
        success: true,
      });
      // The DICOM identity is read from the worklist row, not from the snapshot the
      // browser sent, or the audit would be quoting a client's claim about a patient.
      expect(String(values.studyInstanceUID)).toContain("vitest.a2audit.");
    });
  },
);
