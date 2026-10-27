/**
 * The pointer the worklist dialog reads is built inside the shadow pipeline, so
 * a named provider failure only reaches the radiologist if it survives that
 * write. This pins the end of the chain: provider provenance -> pointer JSON in
 * radiology_worklist.ai_draft_json -> the sentence the dialog shows.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@workspace/db";
import { radiologyWorklistTable, featureFlagsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { makeAiShadowPipelineHandler } from "./shadowPipeline";
import { invalidateFeatureFlagCache } from "../featureFlags";
import type { ShadowInferenceProvider, ShadowInferenceOutput } from "./shadowInference";
import type { RadiologyJobRow } from "../radiologyJobs";
import { hasDatabaseUrl } from "../../testSupport/apiTestApp";

const SUITE = hasDatabaseUrl() ? describe : describe.skip;

const SERIES = "1.2.840.naming.series.1";
const SOP = "1.2.840.naming.sop.1";
const PIXEL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function makeUid(tag: string) {
  return `1.2.840.naming.${tag}.${Date.now()}`;
}

function providerReturning(uid: string, provenance: ShadowInferenceOutput["provenance"]): ShadowInferenceProvider {
  return {
    name: `naming-${uid}`,
    async infer() {
      return {
        draft: {
          studyContext: { studyInstanceUid: uid, modality: "MR", imageCount: 1 },
          findings: [],
          measurements: [],
          impression: [],
        },
        provenance,
      };
    },
  };
}

function handlerFor(uid: string, provider: ShadowInferenceProvider) {
  return makeAiShadowPipelineHandler({
    listInstances: async () => [
      { seriesUid: SERIES, sopUid: SOP, instanceNumber: 1, seriesNumber: 1 },
    ],
    renderAnchors: async () => [
      { seriesUid: SERIES, sopUid: SOP, frameNumber: 1, imageData: PIXEL },
    ],
    provider,
  });
}

async function runJob(uid: string, provider: ShadowInferenceProvider) {
  const handler = handlerFor(uid, provider);
  return handler({
    id: 999500,
    payload: { studyInstanceUid: uid, modality: "MR", radiologyStudyId: null },
  } as unknown as RadiologyJobRow);
}

async function pointerFor(uid: string) {
  const [row] = await db
    .select({
      aiDraftStatus: radiologyWorklistTable.aiDraftStatus,
      aiDraftJson: radiologyWorklistTable.aiDraftJson,
    })
    .from(radiologyWorklistTable)
    .where(eq(radiologyWorklistTable.studyInstanceUID, uid))
    .limit(1);
  return { status: row?.aiDraftStatus, pointer: JSON.parse(row?.aiDraftJson ?? "{}") as Record<string, unknown> };
}

SUITE("shadow pipeline names the reason a draft is empty", () => {
  const budgetUid = makeUid("budget");
  const unexplainedUid = makeUid("unexplained");

  beforeAll(async () => {
    await db
      .insert(featureFlagsTable)
      .values({ key: "ff_radiology_ai", enabled: true, description: "failure naming" })
      .onConflictDoUpdate({
        target: featureFlagsTable.key,
        set: { enabled: true, updatedAt: new Date() },
      });
    invalidateFeatureFlagCache();

    for (const [uid, name] of [
      [budgetUid, "NAMING^BUDGET"],
      [unexplainedUid, "NAMING^UNEXPLAINED"],
    ] as const) {
      await db.insert(radiologyWorklistTable).values({
        patientName: name,
        modality: "MR",
        studyDescription: "MRI BRAIN PLAIN",
        studyInstanceUID: uid,
        accessionNumber: `ACC-NAMING-${uid}`,
        status: "STUDY_RECEIVED",
        aiDraftStatus: "NONE",
        dicomPatientId: name,
      });
    }
  }, 120_000);

  it("writes the budget cause into the pointer the dialog reads", async () => {
    const result = await runJob(
      budgetUid,
      providerReturning(budgetUid, {
        modelVersion: "qwen3-vl:8b",
        degraded: true,
        detail: "all providers failed/invalid — deterministic-only",
        failureCode: "OUTPUT_BUDGET_EXHAUSTED",
        failureDetail:
          "num_predict budget exhausted with empty content (eval=4096 num_predict=4096 thinkingLen=4090)",
      }),
    );

    expect(result.ok).toBe(true);
    // The job summary the operator reads must stop saying only "shadow OK".
    expect(result.detail).toContain("unusable because OUTPUT_BUDGET_EXHAUSTED");

    const { status, pointer } = await pointerFor(budgetUid);
    expect(status).toBe("EMPTY");
    expect(pointer.providerFailureCode).toBe("OUTPUT_BUDGET_EXHAUSTED");
    expect(String(pointer.providerFailureDetail)).toContain("eval=4096");
    expect(String(pointer.emptyReasonLabel)).toMatch(/entire answer budget/);
    expect(pointer.emptyReason).toBe("degraded_empty");
  }, 120_000);

  it("keeps the old honest sentence when the provider reported no cause", async () => {
    const result = await runJob(
      unexplainedUid,
      providerReturning(unexplainedUid, {
        modelVersion: "shadow-stub-v0",
        degraded: true,
        detail: "stub — no model called",
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.detail).not.toContain("unusable because");

    const { status, pointer } = await pointerFor(unexplainedUid);
    expect(status).toBe("EMPTY");
    expect(pointer.providerFailureCode ?? null).toBeNull();
    expect(String(pointer.emptyReasonLabel)).toMatch(/provider\/parse failure/);
  }, 120_000);
});
