/**
 * AI Shadow Pipeline — the one AI execution pipeline (Phase P1 / Gates G4/G5/G6).
 *
 * Runs as a handler on the EXISTING radiology job engine (radiologyJobs.ts over
 * dicom_retry_queue) — no new scheduler, no new worker, no new queue. It is
 * SHADOW-ONLY: it stores snapshot + manifest + evidence + structured draft, and
 * never touches reports, the reporting UI, or anything a radiologist sees.
 *
 * Stages: snapshot → structured image selection → immutable manifest →
 * shadow inference (STUB seam for the P2 AI Gateway) → evidence grounding →
 * persist (shadow). See P1_IMPLEMENTATION_REPORT.md.
 */
import { db } from "@workspace/db";
import {
  studySnapshotsTable, aiProcessingManifestsTable, aiShadowDraftsTable, aiEvidenceTable,
} from "@workspace/db/schema";
import { and, desc, eq } from "drizzle-orm";
import type { RadiologyJobHandler } from "../radiologyJobs";
import { enqueueRadiologyJob } from "../radiologyJobs";
import { buildSnapshotManifest, decideRevision, type InstanceRef } from "./studySnapshot";
import { computeInputHash } from "./processingManifest";
import { validateEvidenceAnchor, type EvidenceAnchor } from "./evidence";
import { selectImageAnchors, type ImageAnchor, type SelectedImage } from "./studyImageSelection";
import { listStudyInstances, renderAnchors } from "./studyImageFetch";
import { shadowStubProvider, type ShadowInferenceProvider } from "./shadowInference";

export const AI_SHADOW_PIPELINE_JOB = "ai_shadow_pipeline";

// Placeholder version strings recorded IMMUTABLY now; the P2 Capability/Prompt
// registries will supply real values. The manifest schema is already complete.
const P1_VERSIONS = {
  modelVersion: shadowStubProvider.name, // "shadow-stub-v0" — no real model in P1
  promptVersion: "none-p1",
  knowledgePackVersion: "unversioned-p1",
  rulesVersion: "unversioned-p1",
  measurementEngineVersion: "lib-measurements-p1",
};

export interface ShadowJobPayload {
  studyInstanceUid: string;
  radiologyStudyId?: number | null;
  modality?: string | null;
}

/** Injectable side-effect deps so the pipeline is testable without Orthanc. */
export interface ShadowPipelineDeps {
  listInstances: (uid: string) => Promise<InstanceRef[]>;
  renderAnchors: (uid: string, anchors: ImageAnchor[]) => Promise<SelectedImage[]>;
  provider: ShadowInferenceProvider;
}
const defaultDeps: ShadowPipelineDeps = {
  listInstances: listStudyInstances,
  renderAnchors,
  provider: shadowStubProvider,
};

/**
 * Enqueue a shadow-pipeline job onto the existing job engine. Idempotency keys
 * on the arrival signature, so an unchanged study dedups while a changed
 * instance set (late series) enqueues a fresh run.
 */
export async function enqueueAiShadowJob(
  p: ShadowJobPayload & { arrivalSignature?: string },
): Promise<{ id: number; created: boolean }> {
  const sig = p.arrivalSignature ?? "auto";
  return enqueueRadiologyJob({
    operationType: AI_SHADOW_PIPELINE_JOB,
    entityType: "study",
    entityId: p.radiologyStudyId ?? null,
    payload: {
      studyInstanceUid: p.studyInstanceUid,
      radiologyStudyId: p.radiologyStudyId ?? null,
      modality: p.modality ?? null,
    },
    idempotencyKey: `ai:shadow:${p.studyInstanceUid}:${sig}`,
  });
}

export function makeAiShadowPipelineHandler(deps: ShadowPipelineDeps = defaultDeps): RadiologyJobHandler {
  return async (job) => {
    const payload = (job.payload ?? {}) as ShadowJobPayload;
    const uid = payload.studyInstanceUid;
    if (!uid) return { ok: false, detail: "invalid payload: studyInstanceUid required" };

    // 1. Snapshot — immutable; a changed instance set creates a NEW revision.
    const instances = await deps.listInstances(uid);
    if (instances.length === 0) {
      return { ok: false, detail: "no DICOM instances found for study (not yet arrived / not stable)" };
    }
    const manifest = buildSnapshotManifest(uid, instances);
    const [prev] = await db
      .select({
        contentHash: studySnapshotsTable.contentHash,
        revision: studySnapshotsTable.revision,
        instanceCount: studySnapshotsTable.instanceCount,
      })
      .from(studySnapshotsTable)
      .where(eq(studySnapshotsTable.studyInstanceUid, uid))
      .orderBy(desc(studySnapshotsTable.revision))
      .limit(1);
    const decision = decideRevision(prev ?? null, manifest);

    let snapshotId: number;
    let snapshotRevision: number;
    if (decision.kind === "unchanged") {
      const [existing] = await db
        .select({ id: studySnapshotsTable.id, revision: studySnapshotsTable.revision })
        .from(studySnapshotsTable)
        .where(and(eq(studySnapshotsTable.studyInstanceUid, uid), eq(studySnapshotsTable.contentHash, manifest.contentHash)))
        .limit(1);
      snapshotId = existing.id;
      snapshotRevision = existing.revision;
    } else {
      const revision = decision.kind === "new" ? 1 : decision.revision;
      if (decision.kind === "revision") {
        // Supersede — never overwrite — the previous current snapshot.
        await db
          .update(studySnapshotsTable)
          .set({ isCurrent: false, supersededAt: new Date() })
          .where(and(eq(studySnapshotsTable.studyInstanceUid, uid), eq(studySnapshotsTable.isCurrent, true)));
      }
      const inserted = await db
        .insert(studySnapshotsTable)
        .values({
          studyInstanceUid: uid,
          radiologyStudyId: payload.radiologyStudyId ?? null,
          revision,
          contentHash: manifest.contentHash,
          seriesCount: manifest.seriesCount,
          instanceCount: manifest.instanceCount,
          instancesJson: manifest.instances,
          isCurrent: true,
        })
        .onConflictDoNothing({ target: [studySnapshotsTable.studyInstanceUid, studySnapshotsTable.contentHash] })
        .returning({ id: studySnapshotsTable.id, revision: studySnapshotsTable.revision });
      if (inserted.length > 0) {
        snapshotId = inserted[0].id;
        snapshotRevision = inserted[0].revision;
      } else {
        const [existing] = await db
          .select({ id: studySnapshotsTable.id, revision: studySnapshotsTable.revision })
          .from(studySnapshotsTable)
          .where(and(eq(studySnapshotsTable.studyInstanceUid, uid), eq(studySnapshotsTable.contentHash, manifest.contentHash)))
          .limit(1);
        snapshotId = existing.id;
        snapshotRevision = existing.revision;
      }
    }

    // 2. Structured, modality-aware image selection (UID + frame provenance).
    const modality = payload.modality ?? instances.find((i) => i.modality)?.modality ?? undefined;
    const anchors = selectImageAnchors(instances, { strategy: "modality-aware", modality: modality ?? undefined, maxImages: 20 });

    // 3. Immutable processing manifest — idempotent on inputHash.
    const inputHash = computeInputHash({
      snapshotContentHash: manifest.contentHash,
      ...P1_VERSIONS,
      imageSelection: anchors.map((a) => ({ seriesUid: a.seriesUid, sopUid: a.sopUid, frameNumber: a.frameNumber })),
    });
    const existingManifest = await db
      .select({ id: aiProcessingManifestsTable.id })
      .from(aiProcessingManifestsTable)
      .where(eq(aiProcessingManifestsTable.inputHash, inputHash))
      .limit(1);
    if (existingManifest.length > 0) {
      return { ok: true, detail: `shadow no-op — manifest ${existingManifest[0].id} already exists for inputHash (snapshot rev ${snapshotRevision})` };
    }

    const startedAt = new Date();
    const rendered = await deps.renderAnchors(uid, anchors);

    // 4. Shadow inference — STUB seam (no model / no gateway in P1).
    const draft = await deps.provider.infer({ studyInstanceUid: uid, modality: modality ?? undefined, imageAnchors: anchors });

    // 5. Evidence grounding — validate each anchor against the snapshot.
    const snapInsts = manifest.instances.map((i) => ({ seriesUid: i.seriesUid, sopUid: i.sopUid }));
    const validEvidence: EvidenceAnchor[] = [];
    for (const f of draft.findings) {
      for (const ev of f.evidence) {
        const anchor: EvidenceAnchor = { ...ev, findingKey: ev.findingKey || f.key };
        if (validateEvidenceAnchor(anchor, snapInsts).ok) validEvidence.push(anchor);
      }
    }

    // 6. Persist manifest + shadow draft + evidence (shadow only).
    const [manifestRow] = await db
      .insert(aiProcessingManifestsTable)
      .values({
        studySnapshotId: snapshotId,
        studyInstanceUid: uid,
        snapshotContentHash: manifest.contentHash,
        ...P1_VERSIONS,
        imageSelectionJson: anchors,
        inputHash,
        degraded: false,
        startedAt,
        completedAt: new Date(),
      })
      .returning({ id: aiProcessingManifestsTable.id });

    const [draftRow] = await db
      .insert(aiShadowDraftsTable)
      .values({
        manifestId: manifestRow.id,
        studySnapshotId: snapshotId,
        studyInstanceUid: uid,
        radiologyStudyId: payload.radiologyStudyId ?? null,
        source: "ai_shadow",
        draftJson: draft,
        findingCount: draft.findings.length,
      })
      .returning({ id: aiShadowDraftsTable.id });

    if (validEvidence.length > 0) {
      await db.insert(aiEvidenceTable).values(
        validEvidence.map((e) => ({
          draftId: draftRow.id,
          manifestId: manifestRow.id,
          findingKey: e.findingKey,
          evidenceType: e.evidenceType,
          seriesInstanceUid: e.seriesInstanceUid ?? null,
          sopInstanceUid: e.sopInstanceUid ?? null,
          frameNumber: e.frameNumber ?? null,
          measurementRef: e.measurementRef ?? null,
          confidence: e.confidence ?? null,
        })),
      );
    }

    return {
      ok: true,
      detail: `shadow OK — snapshot rev ${snapshotRevision}, manifest ${manifestRow.id}, draft ${draftRow.id}, findings ${draft.findings.length}, evidence ${validEvidence.length}, images ${rendered.length}`,
    };
  };
}

export const aiShadowPipelineHandler = makeAiShadowPipelineHandler();
