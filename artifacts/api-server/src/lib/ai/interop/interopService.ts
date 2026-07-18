/**
 * Enterprise interop service — Phase P4 (Gates G12–G22), DB layer.
 *
 * The ONE place P4's interop features touch the database. It reuses everything:
 *   - the AI provisional store (ai_shadow_drafts / ai_processing_manifests /
 *     ai_evidence) as the structured content source,
 *   - the canonical study crosswalk + radiology_studies for identity,
 *   - the EXISTING dicom_sr_export_queue (smartRadiology.ts) as the DIMSE
 *     hand-off — no new queue/worker,
 * and delegates all shaping to the PURE modules (srContentModel / fhirMapping /
 * aiComparison / aiTimelineShaping / feedbackDataset / viewerDeepLinks).
 *
 * Everything here is ADDITIVE: SR / PDF / FHIR are extra exports linked to the
 * report — none of it writes patient_reports, signs, or mutates a draft.
 */
import { db } from "@workspace/db";
import {
  aiShadowDraftsTable, aiProcessingManifestsTable, aiEvidenceTable, aiDraftFeedbackTable,
  canonicalStudyTable, radiologyStudiesTable,
  dicomSrDocumentsTable, fhirExportLogTable, mppsEventsTable, storageCommitmentsTable,
  encapsulatedPdfExportsTable, dicomSrExportQueueTable,
} from "@workspace/db/schema";
import { and, desc, eq } from "drizzle-orm";
import type { InteropReport, InteropFinding } from "./interopTypes";
import { buildSrContentTree } from "./srContentModel";
import { toFhirBundle } from "./fhirMapping";
import { compareAiVersions, type ComparableVersion } from "./aiComparison";
import { buildAiTimeline } from "./aiTimelineShaping";
import { buildFeedbackDataset } from "./feedbackDataset";

// ── Build the canonical InteropReport for a study from the latest provisional ─
// version + its evidence anchors + study identity. Returns null when there is
// no validated provisional report for the study.
export async function buildInteropReport(studyInstanceUid: string, version?: number): Promise<InteropReport | null> {
  const draftRows = await db
    .select()
    .from(aiShadowDraftsTable)
    .where(
      version
        ? and(eq(aiShadowDraftsTable.studyInstanceUid, studyInstanceUid), eq(aiShadowDraftsTable.version, version))
        : eq(aiShadowDraftsTable.studyInstanceUid, studyInstanceUid),
    )
    .orderBy(desc(aiShadowDraftsTable.version))
    .limit(1);
  const draft = draftRows[0];
  if (!draft) return null;

  const evidence = await db.select().from(aiEvidenceTable).where(eq(aiEvidenceTable.draftId, draft.id));
  const evidenceByFinding = new Map<string, InteropFinding["evidence"]>();
  for (const e of evidence) {
    if (!evidenceByFinding.has(e.findingKey)) evidenceByFinding.set(e.findingKey, []);
    evidenceByFinding.get(e.findingKey)!.push({
      seriesInstanceUid: e.seriesInstanceUid, sopInstanceUid: e.sopInstanceUid,
      frameNumber: e.frameNumber, measurementRef: e.measurementRef, confidence: e.confidence,
    });
  }

  const dj = (draft.draftJson ?? {}) as {
    findings?: Array<{ key: string; text: string; laterality?: string }>;
    measurements?: Array<{ id: string; value: number; unit: string }>;
    impression?: string[];
  };

  // Study identity (best-effort) via the canonical crosswalk → radiology_studies.
  let accessionNumber: string | undefined;
  let patientId: string | undefined;
  let modality: string | undefined;
  const rsId = draft.radiologyStudyId ?? null;
  const [rs] = rsId
    ? await db.select().from(radiologyStudiesTable).where(eq(radiologyStudiesTable.id, rsId)).limit(1)
    : await db
        .select()
        .from(radiologyStudiesTable)
        .where(eq(radiologyStudiesTable.studyInstanceUid, studyInstanceUid))
        .limit(1);
  if (rs) {
    accessionNumber = rs.accessionNumber ?? undefined;
    patientId = rs.patientId != null ? String(rs.patientId) : undefined;
    modality = rs.modality ?? undefined;
  }

  return {
    studyInstanceUid,
    accessionNumber,
    patientId,
    modality,
    reportId: undefined,
    findings: (dj.findings ?? []).map((f) => ({
      key: f.key, text: f.text, laterality: f.laterality, evidence: evidenceByFinding.get(f.key) ?? [],
    })),
    measurements: dj.measurements ?? [],
    impression: dj.impression ?? [],
  };
}

// ── G12: build + persist the SR content tree and enqueue DIMSE export ────────
export async function exportStructuredReport(
  studyInstanceUid: string,
  actor?: { id?: number | null; name?: string | null },
): Promise<{ ok: boolean; srDocumentId?: number; queueId?: number; detail: string }> {
  const report = await buildInteropReport(studyInstanceUid);
  if (!report) return { ok: false, detail: "no validated provisional report for study" };

  const tree = buildSrContentTree(report);
  const [srDoc] = await db
    .insert(dicomSrDocumentsTable)
    .values({
      reportId: report.reportId ?? null,
      studyInstanceUid,
      templateId: "TID1500",
      contentJson: tree as unknown as Record<string, unknown>,
      status: "pending",
    })
    .returning({ id: dicomSrDocumentsTable.id });

  // Hand off to the EXISTING DICOM SR export queue (the DIMSE worker) — reuse,
  // do not create a parallel queue. Best-effort: the queue needs a numeric
  // study id; use the linked radiology study when available.
  let queueId: number | undefined;
  const [rs] = await db
    .select({ id: radiologyStudiesTable.id })
    .from(radiologyStudiesTable)
    .where(eq(radiologyStudiesTable.studyInstanceUid, studyInstanceUid))
    .limit(1);
  if (rs) {
    const [q] = await db
      .insert(dicomSrExportQueueTable)
      .values({
        studyId: rs.id,
        measurementsJson: JSON.stringify(tree),
        exportStatus: "pending",
        requestedById: actor?.id ?? null,
        requestedByName: actor?.name ?? null,
      })
      .returning({ id: dicomSrExportQueueTable.id });
    queueId = q?.id;
  }

  return {
    ok: true,
    srDocumentId: srDoc.id,
    queueId,
    detail: queueId
      ? `SR content persisted (#${srDoc.id}) and enqueued for DIMSE export (#${queueId})`
      : `SR content persisted (#${srDoc.id}); no linked radiology study to enqueue DIMSE export`,
  };
}

// ── G17: build + persist FHIR resources (no external send) ───────────────────
export async function exportFhir(studyInstanceUid: string): Promise<{ ok: boolean; count: number; detail: string }> {
  const report = await buildInteropReport(studyInstanceUid);
  if (!report) return { ok: false, count: 0, detail: "no validated provisional report for study" };
  const bundle = toFhirBundle(report);
  const rows = bundle.map((b) => ({
    resourceType: b.resourceType,
    reportId: report.reportId ?? null,
    studyInstanceUid,
    resourceJson: b.resource as Record<string, unknown>,
  }));
  if (rows.length > 0) await db.insert(fhirExportLogTable).values(rows);
  return { ok: true, count: rows.length, detail: `logged ${rows.length} FHIR resources` };
}

// ── G19: immutable AI timeline ───────────────────────────────────────────────
export async function getStudyTimeline(studyInstanceUid: string) {
  const drafts = await db
    .select()
    .from(aiShadowDraftsTable)
    .where(eq(aiShadowDraftsTable.studyInstanceUid, studyInstanceUid))
    .orderBy(aiShadowDraftsTable.version);
  const feedback = await db
    .select()
    .from(aiDraftFeedbackTable)
    .where(eq(aiDraftFeedbackTable.studyInstanceUid, studyInstanceUid));

  const dcount = (j: unknown): number => {
    const f = (j as { findings?: unknown[] })?.findings;
    return Array.isArray(f) ? f.length : 0;
  };
  const qscore = (j: unknown): number | null => {
    const q = (j as { qualityScore?: number })?.qualityScore;
    return typeof q === "number" ? q : null;
  };

  return buildAiTimeline({
    studyInstanceUid,
    drafts: drafts.map((d) => ({
      version: d.version,
      createdAtMs: (d.createdAt as Date)?.getTime?.() ?? 0,
      snapshotRevision: d.snapshotRevision,
      modelDigest: d.modelDigest,
      promptVersion: d.promptVersion,
      findingCount: d.findingCount || dcount(d.draftJson),
      qualityScore: qscore(d.draftJson),
      degraded: d.source === "ai_shadow_degraded",
      source: d.source,
    })),
    feedback: feedback.map((f) => ({
      createdAtMs: (f.createdAt as Date)?.getTime?.() ?? 0,
      action: f.action,
      findingKey: f.findingKey,
      staffId: f.staffId,
    })),
  });
}

// ── list versions (metadata only) ───────────────────────────────────────────
export async function listVersions(studyInstanceUid: string) {
  const rows = await db
    .select()
    .from(aiShadowDraftsTable)
    .where(eq(aiShadowDraftsTable.studyInstanceUid, studyInstanceUid))
    .orderBy(desc(aiShadowDraftsTable.version));
  return rows.map((d) => ({
    draftId: d.id,
    version: d.version,
    snapshotRevision: d.snapshotRevision,
    modelDigest: d.modelDigest,
    promptVersion: d.promptVersion,
    findingCount: d.findingCount,
    source: d.source,
    createdAt: (d.createdAt as Date)?.toISOString?.() ?? String(d.createdAt),
  }));
}

// ── G20: compare two AI versions ─────────────────────────────────────────────
export async function compareVersions(studyInstanceUid: string, fromVersion: number, toVersion: number) {
  const load = async (v: number): Promise<ComparableVersion | null> => {
    const [d] = await db
      .select()
      .from(aiShadowDraftsTable)
      .where(and(eq(aiShadowDraftsTable.studyInstanceUid, studyInstanceUid), eq(aiShadowDraftsTable.version, v)))
      .limit(1);
    if (!d) return null;
    return {
      version: d.version,
      modelDigest: d.modelDigest,
      promptVersion: d.promptVersion,
      draft: (d.draftJson ?? {}) as ComparableVersion["draft"],
    };
  };
  const [from, to] = await Promise.all([load(fromVersion), load(toVersion)]);
  if (!from || !to) return null;
  return compareAiVersions(from, to);
}

// ── G21: human feedback dataset (analytics/export only; no retraining) ───────
export async function getFeedbackDataset(filter?: { studyInstanceUid?: string; action?: string }) {
  const conds = [];
  if (filter?.studyInstanceUid) conds.push(eq(aiDraftFeedbackTable.studyInstanceUid, filter.studyInstanceUid));
  if (filter?.action) conds.push(eq(aiDraftFeedbackTable.action, filter.action));
  const rows = await db
    .select()
    .from(aiDraftFeedbackTable)
    .where(conds.length ? and(...conds) : undefined);
  return buildFeedbackDataset(
    rows.map((r) => ({
      action: r.action,
      findingKey: r.findingKey,
      studyInstanceUid: r.studyInstanceUid,
      laterality: r.laterality,
      measurementRef: r.measurementRef,
      confidence: r.confidence,
      promptVersion: r.promptVersion,
      modelVersion: r.modelVersion,
      editedText: r.editedText,
      reason: r.reason,
    })),
  );
}

// ── interop status summary (SR/PDF/MPPS/storage-commitment) ──────────────────
export async function getInteropStatus(studyInstanceUid: string) {
  const [sr, pdf, mpps, commits] = await Promise.all([
    db.select().from(dicomSrDocumentsTable).where(eq(dicomSrDocumentsTable.studyInstanceUid, studyInstanceUid)),
    db.select().from(encapsulatedPdfExportsTable).where(eq(encapsulatedPdfExportsTable.studyInstanceUid, studyInstanceUid)),
    db.select().from(mppsEventsTable).where(eq(mppsEventsTable.studyInstanceUid, studyInstanceUid)),
    db.select().from(storageCommitmentsTable).where(eq(storageCommitmentsTable.studyInstanceUid, studyInstanceUid)),
  ]);
  return {
    studyInstanceUid,
    structuredReports: sr.map((r) => ({ id: r.id, status: r.status, srSopInstanceUid: r.srSopInstanceUid })),
    pdfExports: pdf.map((r) => ({ id: r.id, version: r.version, status: r.status, sopInstanceUid: r.sopInstanceUid })),
    mppsEvents: mpps.map((r) => ({ id: r.id, status: r.status, mppsSopInstanceUid: r.mppsSopInstanceUid })),
    storageCommitments: commits.map((r) => ({ id: r.id, status: r.status, transactionUid: r.transactionUid })),
  };
}

/** Get the evidence anchors for a study's latest provisional (for viewer sync). */
export async function getStudyEvidenceAnchors(studyInstanceUid: string) {
  const [draft] = await db
    .select({ id: aiShadowDraftsTable.id })
    .from(aiShadowDraftsTable)
    .where(eq(aiShadowDraftsTable.studyInstanceUid, studyInstanceUid))
    .orderBy(desc(aiShadowDraftsTable.version))
    .limit(1);
  if (!draft) return [];
  const evidence = await db.select().from(aiEvidenceTable).where(eq(aiEvidenceTable.draftId, draft.id));
  return evidence.map((e) => ({
    key: e.findingKey,
    studyInstanceUid,
    seriesInstanceUid: e.seriesInstanceUid,
    sopInstanceUid: e.sopInstanceUid,
    frameNumber: e.frameNumber,
  }));
}
