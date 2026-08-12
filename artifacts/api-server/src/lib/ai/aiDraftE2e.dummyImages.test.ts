/**
 * End-to-end: dummy DICOM instances → shadow pipeline → worklist READY + patient draft.
 * Uses injected listInstances / provider — no Orthanc required.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@workspace/db";
import {
  radiologyWorklistTable,
  radiologyReportDraftsTable,
  aiShadowDraftsTable,
  featureFlagsTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { makeAiShadowPipelineHandler } from "./shadowPipeline";
import { invalidateFeatureFlagCache } from "../featureFlags";
import type { ShadowInferenceProvider } from "./shadowInference";
import type { RadiologyJobRow } from "../radiologyJobs";

const UID = `1.2.840.dummy.ai.e2e.${Date.now()}`;
const SERIES = "1.2.840.dummy.series.1";
const SOP = "1.2.840.dummy.sop.1";

const dummyProvider: ShadowInferenceProvider = {
  name: "e2e-dummy-vision",
  async infer(input) {
    return {
      draft: {
        studyContext: {
          studyInstanceUid: input.studyInstanceUid,
          modality: input.modality,
          imageCount: input.imageAnchors.length,
        },
        findings: [
          {
            key: "f0",
            text: "Brain parenchyma demonstrates normal signal intensity. Ventricles are normal in size.",
            laterality: "none",
            evidence: [
              {
                findingKey: "f0",
                evidenceType: "image",
                seriesInstanceUid: SERIES,
                sopInstanceUid: SOP,
                confidence: 90,
              },
            ],
          },
        ],
        measurements: [],
        impression: ["Normal MRI brain study."],
      },
      provenance: {
        modelVersion: "e2e-dummy-v1",
        degraded: false,
        detail: "dummy images — no live Ollama",
      },
    };
  },
};

describe("AI draft E2E with dummy images", () => {
  let worklistId: number;

  beforeAll(async () => {
    await db
      .insert(featureFlagsTable)
      .values({ key: "ff_radiology_ai", enabled: true, description: "e2e" })
      .onConflictDoUpdate({
        target: featureFlagsTable.key,
        set: { enabled: true, updatedAt: new Date() },
      });
    invalidateFeatureFlagCache();

    const [row] = await db
      .insert(radiologyWorklistTable)
      .values({
        patientName: "E2E^AI^DRAFT",
        modality: "MR",
        studyDescription: "MRI BRAIN PLAIN",
        studyInstanceUID: UID,
        accessionNumber: `ACC-AI-${Date.now()}`,
        status: "STUDY_RECEIVED",
        aiDraftStatus: "NONE",
        dicomPatientId: "E2E-AI-001",
      })
      .returning({ id: radiologyWorklistTable.id });
    worklistId = row.id;
  }, 60_000);

  it("runs shadow pipeline on dummy instances and seeds worklist + patient draft", async () => {
    const handler = makeAiShadowPipelineHandler({
      listInstances: async () => [
        { seriesUid: SERIES, sopUid: SOP, instanceNumber: 1, seriesNumber: 1 },
      ],
      renderAnchors: async () => [
        {
          seriesUid: SERIES,
          sopUid: SOP,
          frameNumber: 1,
          imageData: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        },
      ],
      provider: dummyProvider,
    });

    const job = {
      id: 999001,
      payload: { studyInstanceUid: UID, modality: "MR", radiologyStudyId: null },
    } as unknown as RadiologyJobRow;

    const result = await handler(job);
    expect(result.ok).toBe(true);
    expect(result.detail).toMatch(/shadow OK/);

    const [wl] = await db
      .select({
        aiDraftStatus: radiologyWorklistTable.aiDraftStatus,
        aiDraftJson: radiologyWorklistTable.aiDraftJson,
      })
      .from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.id, worklistId))
      .limit(1);
    expect(wl.aiDraftStatus).toBe("READY");
    expect(wl.aiDraftJson).toContain("ai_shadow");
    expect(wl.aiDraftJson).toContain("Brain parenchyma");

    const [shadow] = await db
      .select({ id: aiShadowDraftsTable.id })
      .from(aiShadowDraftsTable)
      .where(eq(aiShadowDraftsTable.studyInstanceUid, UID))
      .limit(1);
    expect(shadow?.id).toBeTruthy();

    const [reportDraft] = await db
      .select({
        id: radiologyReportDraftsTable.id,
        rawFindings: radiologyReportDraftsTable.rawFindings,
        worklistId: radiologyReportDraftsTable.worklistId,
        status: radiologyReportDraftsTable.status,
      })
      .from(radiologyReportDraftsTable)
      .where(eq(radiologyReportDraftsTable.worklistId, worklistId))
      .limit(1);
    expect(reportDraft).toBeTruthy();
    expect(reportDraft.status).toBe("DRAFT");
    expect(reportDraft.rawFindings ?? "").toContain("Brain parenchyma");
    expect(reportDraft.worklistId).toBe(worklistId);
  }, 60_000);
});
