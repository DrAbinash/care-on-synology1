/**
 * AI Shadow Pipeline — the one AI execution pipeline (P1 G4/G5/G6; P2 G7/G9).
 *
 * Runs as a handler on the EXISTING radiology job engine (radiologyJobs.ts) —
 * no new scheduler/worker/queue. SHADOW-ONLY: stores snapshot + manifest +
 * evidence + structured draft; never touches reports or the reporting UI.
 *
 * P2 fills the inference seam with the AI Gateway and adds the trust layer:
 *   snapshot → structured image selection → immutable manifest →
 *   AI Gateway inference (routing/resilience/contract) →
 *   deterministic Quality Engine (rules before AI) →
 *   trust gauntlet (grounding/laterality/negation/contradiction; det. overrides) →
 *   persist (valid + quarantined, shadow). Degrades to deterministic-only on failure.
 */
import { db } from "@workspace/db";
import {
  studySnapshotsTable, aiProcessingManifestsTable, aiShadowDraftsTable, aiEvidenceTable, canonicalStudyTable,
} from "@workspace/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { getNextProvisionalVersion } from "./provisionalVersioning";
import type { RadiologyJobHandler } from "../radiologyJobs";
import { enqueueRadiologyJob } from "../radiologyJobs";
import { buildSnapshotManifest, decideRevision, type InstanceRef } from "./studySnapshot";
import { computeInputHash } from "./processingManifest";
import { selectImageAnchors, type ImageAnchor, type SelectedImage } from "./studyImageSelection";
import { listStudyInstances, renderAnchors } from "./studyImageFetch";
import { shadowStubProvider, type ShadowInferenceProvider } from "./shadowInference";
import { runDeterministicQuality } from "./rulesBeforeAi";
import { applyTrustGauntlet, type GauntletFinding } from "./findingValidation";

export const AI_SHADOW_PIPELINE_JOB = "ai_shadow_pipeline";

// Stable pipeline versions. The MODEL that answers is recorded per-run from the
// gateway's provenance; the inputHash uses a stable model-POLICY version so
// dedup is invariant across provider fallback (audit: modelVersion is not part
// of the idempotency key).
const P2_META = {
  modelPolicyVersion: "ai-gateway-p2", // for inputHash only (stable)
  promptVersion: "radiology-draft-p2-v1",
  knowledgePackVersion: "unversioned-p2",
  rulesVersion: "report-quality",
  measurementEngineVersion: "lib-measurements-p2",
};

export interface ShadowJobPayload {
  studyInstanceUid: string;
  radiologyStudyId?: number | null;
  modality?: string | null;
}

export interface ShadowPipelineDeps {
  listInstances: (uid: string) => Promise<InstanceRef[]>;
  renderAnchors: (uid: string, anchors: ImageAnchor[]) => Promise<SelectedImage[]>;
  provider: ShadowInferenceProvider;
}
const defaultDeps: ShadowPipelineDeps = {
  listInstances: listStudyInstances,
  renderAnchors,
  provider: shadowStubProvider, // default is the stub; the registered handler injects the gateway
};

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

export function makeAiShadowPipelineHandler(overrides: Partial<ShadowPipelineDeps> = {}): RadiologyJobHandler {
  const deps: ShadowPipelineDeps = { ...defaultDeps, ...overrides };
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

    // 3. Manifest idempotency — inputHash on STABLE inputs (not the resolved model).
    const inputHash = computeInputHash({
      snapshotContentHash: manifest.contentHash,
      modelVersion: P2_META.modelPolicyVersion,
      promptVersion: P2_META.promptVersion,
      knowledgePackVersion: P2_META.knowledgePackVersion,
      rulesVersion: P2_META.rulesVersion,
      measurementEngineVersion: P2_META.measurementEngineVersion,
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

    // 4. Inference via the AI Gateway seam (P2 / G7). Still shadow.
    const { draft, provenance } = await deps.provider.infer({
      studyInstanceUid: uid,
      modality: modality ?? undefined,
      imageAnchors: anchors,
      images: rendered,
    });

    // 5. Rules before AI (G9) — the deterministic Quality Engine over the draft.
    const quality = runDeterministicQuality(draft);

    // 6. Trust gauntlet (G9) — grounding + laterality + negation + contradiction;
    //    deterministic findings override AI; invalid findings are QUARANTINED.
    const snapInsts = manifest.instances.map((i) => ({ seriesUid: i.seriesUid, sopUid: i.sopUid }));
    const aiFindings: GauntletFinding[] = draft.findings.map((f) => ({
      key: f.key, text: f.text, laterality: f.laterality, negated: f.negated, evidence: f.evidence,
    }));
    const gauntlet = applyTrustGauntlet(aiFindings, snapInsts, draft.impression, []);
    const degraded = provenance.degraded || quality.degradeRecommended;

    // 7. Persist manifest (immutable) — records the REAL model version/digest.
    // inputHash is UNIQUE: if a concurrent job (that passed the pre-check above
    // before either inserted) already persisted this manifest, onConflictDoNothing
    // makes this run a clean no-op instead of duplicating the manifest + draft.
    const modelVersion = provenance.modelDigest ? `${provenance.modelVersion}@${provenance.modelDigest}` : provenance.modelVersion;
    const insertedManifest = await db
      .insert(aiProcessingManifestsTable)
      .values({
        studySnapshotId: snapshotId,
        studyInstanceUid: uid,
        snapshotContentHash: manifest.contentHash,
        modelVersion,
        promptVersion: P2_META.promptVersion,
        knowledgePackVersion: P2_META.knowledgePackVersion,
        rulesVersion: quality.report.ruleVersion || P2_META.rulesVersion,
        measurementEngineVersion: P2_META.measurementEngineVersion,
        imageSelectionJson: anchors,
        inputHash,
        degraded,
        startedAt,
        completedAt: new Date(),
      })
      // No-target ON CONFLICT DO NOTHING: catches the input_hash unique
      // violation when the index exists, and stays safe (plain insert) on a
      // legacy DB where the duplicate-guarded migration skipped creating it —
      // never a runtime "no matching ON CONFLICT constraint" error.
      .onConflictDoNothing()
      .returning({ id: aiProcessingManifestsTable.id });
    if (insertedManifest.length === 0) {
      return { ok: true, detail: `shadow no-op — concurrent job already persisted the manifest for this inputHash (snapshot rev ${snapshotRevision})` };
    }
    const manifestRow = insertedManifest[0];

    // 8. Persist shadow draft — valid + quarantined findings (nothing exposed).
    const shadowDraftJson = {
      studyContext: draft.studyContext,
      findings: gauntlet.valid,
      quarantined: gauntlet.quarantined,
      measurements: draft.measurements,
      impression: draft.impression,
      qualityScore: quality.report.score,
      degraded,
    };
    // Immutable, versioned provisional report: regeneration inserts a NEW
    // version; the DB trigger forbids overwriting an old one. (study_uid, version)
    // is UNIQUE — if a concurrent job grabbed the same version number, retry with
    // the next one instead of silently creating a duplicate "v2" (P5 fix).
    const [csRow] = await db.select({ id: canonicalStudyTable.id }).from(canonicalStudyTable).where(eq(canonicalStudyTable.studyInstanceUid, uid)).limit(1);
    let draftRow: { id: number } | undefined;
    let version = 0;
    for (let attempt = 0; attempt < 6 && !draftRow; attempt++) {
      version = await getNextProvisionalVersion(uid);
      const insertedDraft = await db
        .insert(aiShadowDraftsTable)
        .values({
          version,
          manifestId: manifestRow.id,
          studySnapshotId: snapshotId,
          studyInstanceUid: uid,
          radiologyStudyId: payload.radiologyStudyId ?? null,
          canonicalStudyId: csRow?.id ?? null,
          snapshotRevision,
          aiJobId: job.id,
          modelDigest: provenance.modelDigest ?? null,
          promptVersion: P2_META.promptVersion,
          validated: true,
          source: degraded ? "ai_shadow_degraded" : "ai_shadow",
          draftJson: shadowDraftJson,
          findingCount: gauntlet.valid.length,
        })
        // No-target (see manifest insert): safe whether or not the unique
        // (study_instance_uid, version) index exists on this DB.
        .onConflictDoNothing()
        .returning({ id: aiShadowDraftsTable.id });
      draftRow = insertedDraft[0];
    }
    if (!draftRow) {
      return { ok: false, detail: `could not allocate a unique provisional version for ${uid} after retries (concurrent contention)` };
    }

    // 9. Persist evidence — from VALID findings only (grounded anchors).
    const evidenceRows = gauntlet.valid.flatMap((f) =>
      f.evidence.map((e) => ({
        draftId: draftRow.id,
        manifestId: manifestRow.id,
        findingKey: e.findingKey || f.key,
        evidenceType: e.evidenceType,
        seriesInstanceUid: e.seriesInstanceUid ?? null,
        sopInstanceUid: e.sopInstanceUid ?? null,
        frameNumber: e.frameNumber ?? null,
        measurementRef: e.measurementRef ?? null,
        confidence: e.confidence ?? null,
      })),
    );
    if (evidenceRows.length > 0) await db.insert(aiEvidenceTable).values(evidenceRows);

    return {
      ok: true,
      detail: `shadow OK — rev ${snapshotRevision}, draft v${version} (#${draftRow.id}), manifest ${manifestRow.id}, valid ${gauntlet.valid.length}, quarantined ${gauntlet.quarantined.length}, degraded ${degraded}, images ${rendered.length}, model ${provenance.modelVersion}`,
    };
  };
}

export const aiShadowPipelineHandler = makeAiShadowPipelineHandler();
