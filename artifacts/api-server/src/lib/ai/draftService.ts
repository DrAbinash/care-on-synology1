/**
 * AI draft read + feedback — DB layer (Phase P3 / Gate G11).
 *
 * Shapes the SHADOW draft (P1/P2 tables) for the workspace: grounded findings
 * only, evidence anchors, confidence, and provenance from the immutable manifest.
 * Records Accept/Edit/Ignore/Reject feedback for the learning aggregation. This
 * layer NEVER writes a report and NEVER signs — it is read + feedback only.
 */
import { db } from "@workspace/db";
import { aiShadowDraftsTable, aiProcessingManifestsTable, aiEvidenceTable, aiDraftFeedbackTable } from "@workspace/db/schema";
import { desc, eq } from "drizzle-orm";

export interface WorkspaceDraftFinding {
  key: string;
  text: string;
  laterality?: string;
  evidence: Array<{ evidenceType: string; seriesInstanceUid?: string | null; sopInstanceUid?: string | null; frameNumber?: number | null; measurementRef?: string | null; confidence?: number | null }>;
}

export interface WorkspaceDraft {
  draftId: number;
  studyInstanceUid: string;
  status: "shadow" | "shadow_degraded";
  degraded: boolean;
  qualityScore: number | null;
  findings: WorkspaceDraftFinding[]; // grounded only
  quarantinedCount: number;
  measurements: Array<{ id: string; value: number; unit: string }>;
  impression: string[];
  provenance: {
    modelVersion: string;
    promptVersion: string;
    rulesVersion: string;
    degraded: boolean;
    createdAt: string;
  };
}

/** The latest shadow draft for a study, shaped for the workspace. Grounded
 *  findings only — the quarantined set is summarized as a count, never shown. */
export async function getLatestDraftForStudy(studyInstanceUid: string): Promise<WorkspaceDraft | null> {
  const [draft] = await db
    .select()
    .from(aiShadowDraftsTable)
    .where(eq(aiShadowDraftsTable.studyInstanceUid, studyInstanceUid))
    .orderBy(desc(aiShadowDraftsTable.createdAt))
    .limit(1);
  if (!draft) return null;

  const [manifest] = await db
    .select()
    .from(aiProcessingManifestsTable)
    .where(eq(aiProcessingManifestsTable.id, draft.manifestId))
    .limit(1);

  const evidence = await db.select().from(aiEvidenceTable).where(eq(aiEvidenceTable.draftId, draft.id));
  const evidenceByFinding = new Map<string, WorkspaceDraftFinding["evidence"]>();
  for (const e of evidence) {
    if (!evidenceByFinding.has(e.findingKey)) evidenceByFinding.set(e.findingKey, []);
    evidenceByFinding.get(e.findingKey)!.push({
      evidenceType: e.evidenceType, seriesInstanceUid: e.seriesInstanceUid, sopInstanceUid: e.sopInstanceUid,
      frameNumber: e.frameNumber, measurementRef: e.measurementRef, confidence: e.confidence,
    });
  }

  const dj = (draft.draftJson ?? {}) as {
    findings?: Array<{ key: string; text: string; laterality?: string }>;
    quarantined?: unknown[];
    measurements?: Array<{ id: string; value: number; unit: string }>;
    impression?: string[];
    qualityScore?: number;
  };

  return {
    draftId: draft.id,
    studyInstanceUid: draft.studyInstanceUid,
    status: draft.source === "ai_shadow_degraded" ? "shadow_degraded" : "shadow",
    degraded: draft.source === "ai_shadow_degraded",
    qualityScore: dj.qualityScore ?? null,
    findings: (dj.findings ?? []).map((f) => ({ key: f.key, text: f.text, laterality: f.laterality, evidence: evidenceByFinding.get(f.key) ?? [] })),
    quarantinedCount: Array.isArray(dj.quarantined) ? dj.quarantined.length : 0,
    measurements: dj.measurements ?? [],
    impression: dj.impression ?? [],
    provenance: {
      modelVersion: manifest?.modelVersion ?? "unknown",
      promptVersion: manifest?.promptVersion ?? "unknown",
      rulesVersion: manifest?.rulesVersion ?? "unknown",
      degraded: manifest?.degraded ?? false,
      createdAt: (manifest?.createdAt ?? draft.createdAt)?.toISOString?.() ?? String(draft.createdAt),
    },
  };
}

export async function recordDraftFeedback(input: {
  draftId: number;
  studyInstanceUid: string;
  findingKey?: string | null;
  action: "accept" | "edit" | "ignore" | "reject";
  editedText?: string | null;
  staffId?: number | null;
}): Promise<void> {
  await db.insert(aiDraftFeedbackTable).values({
    draftId: input.draftId,
    studyInstanceUid: input.studyInstanceUid,
    findingKey: input.findingKey ?? null,
    action: input.action,
    editedText: input.editedText ?? null,
    staffId: input.staffId ?? null,
  });
}
