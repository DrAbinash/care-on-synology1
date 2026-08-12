/**
 * Seed / refresh the radiologist working draft (radiology_report_drafts) from an
 * AI shadow draft so morning review sees findings patient-wise + worklist-wise.
 * Never overwrites a human-edited draft that already has findings text.
 */
import { db } from "@workspace/db";
import { radiologyWorklistTable, radiologyReportDraftsTable } from "@workspace/db/schema";
import { and, desc, eq } from "drizzle-orm";

export async function seedReportDraftFromAi(opts: {
  studyInstanceUid: string;
  findingsText: string;
  impressionLines: string[];
  modality?: string | null;
  studyDescription?: string | null;
  sourceDraftId: number;
}): Promise<{ draftId: number | null; created: boolean; skipped?: string }> {
  const findings = opts.findingsText.trim();
  const impression = opts.impressionLines.map((l) => l.trim()).filter(Boolean);
  if (!findings && impression.length === 0) {
    return { draftId: null, created: false, skipped: "empty ai draft" };
  }

  const [wl] = await db
    .select({
      id: radiologyWorklistTable.id,
      studyId: radiologyWorklistTable.studyId,
      patientId: radiologyWorklistTable.patientId,
      modality: radiologyWorklistTable.modality,
      studyDescription: radiologyWorklistTable.studyDescription,
    })
    .from(radiologyWorklistTable)
    .where(eq(radiologyWorklistTable.studyInstanceUID, opts.studyInstanceUid))
    .limit(1);

  if (!wl) return { draftId: null, created: false, skipped: "no worklist row" };

  const [existing] = await db
    .select()
    .from(radiologyReportDraftsTable)
    .where(and(
      eq(radiologyReportDraftsTable.worklistId, wl.id),
      eq(radiologyReportDraftsTable.status, "DRAFT"),
    ))
    .orderBy(desc(radiologyReportDraftsTable.updatedAt))
    .limit(1);

  const impressionJson = JSON.stringify(impression);
  const metaNote = `\n\n[AI draft #${opts.sourceDraftId} — review before signing]`;

  if (existing) {
    const hasHuman = Boolean((existing.rawFindings ?? "").trim());
    if (hasHuman) return { draftId: existing.id, created: false, skipped: "human draft present" };
    await db
      .update(radiologyReportDraftsTable)
      .set({
        rawFindings: findings + metaNote,
        impression: impressionJson,
        modality: opts.modality ?? existing.modality ?? wl.modality,
        studyName: opts.studyDescription ?? existing.studyName ?? wl.studyDescription,
        patientId: existing.patientId ?? wl.patientId,
        studyId: existing.studyId ?? wl.studyId,
        updatedAt: new Date(),
      })
      .where(eq(radiologyReportDraftsTable.id, existing.id));
    return { draftId: existing.id, created: false };
  }

  const [inserted] = await db
    .insert(radiologyReportDraftsTable)
    .values({
      worklistId: wl.id,
      studyId: wl.studyId,
      patientId: wl.patientId,
      modality: opts.modality ?? wl.modality,
      studyName: opts.studyDescription ?? wl.studyDescription,
      rawFindings: findings + metaNote,
      impression: impressionJson,
      status: "DRAFT",
      createdBy: "ai_shadow",
    })
    .returning({ id: radiologyReportDraftsTable.id });

  return { draftId: inserted?.id ?? null, created: true };
}
