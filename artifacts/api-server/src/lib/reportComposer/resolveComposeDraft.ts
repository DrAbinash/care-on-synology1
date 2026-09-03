/**
 * Resolve the authoritative radiology report draft for a compose job.
 * Prefer worklist-linked draft; never invent IDs from client snapshot alone.
 */
import { desc, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { radiologyReportDraftsTable } from "@workspace/db/schema";

export type ResolvedComposeDraft = {
  draftId: number;
  studyId: number | null;
  worklistId: number | null;
  patientId: number | null;
};

export async function resolveAuthoritativeComposeDraft(opts: {
  worklistId?: number | null;
  studyId?: number | null;
  /** Optional client hint — verified against DB; never trusted alone. */
  hintDraftId?: number | null;
}): Promise<ResolvedComposeDraft | null> {
  if (opts.hintDraftId != null && Number.isFinite(opts.hintDraftId) && opts.hintDraftId > 0) {
    const [byHint] = await db
      .select({
        draftId: radiologyReportDraftsTable.id,
        studyId: radiologyReportDraftsTable.studyId,
        worklistId: radiologyReportDraftsTable.worklistId,
        patientId: radiologyReportDraftsTable.patientId,
      })
      .from(radiologyReportDraftsTable)
      .where(eq(radiologyReportDraftsTable.id, opts.hintDraftId))
      .limit(1);
    if (byHint) {
      if (opts.worklistId != null && byHint.worklistId != null && byHint.worklistId !== opts.worklistId) {
        return null;
      }
      if (opts.studyId != null && byHint.studyId != null && byHint.studyId !== opts.studyId) {
        return null;
      }
      return byHint;
    }
  }

  if (opts.worklistId != null) {
    const [byWl] = await db
      .select({
        draftId: radiologyReportDraftsTable.id,
        studyId: radiologyReportDraftsTable.studyId,
        worklistId: radiologyReportDraftsTable.worklistId,
        patientId: radiologyReportDraftsTable.patientId,
      })
      .from(radiologyReportDraftsTable)
      .where(eq(radiologyReportDraftsTable.worklistId, opts.worklistId))
      .orderBy(desc(radiologyReportDraftsTable.updatedAt), desc(radiologyReportDraftsTable.id))
      .limit(1);
    if (byWl) return byWl;
  }

  if (opts.studyId != null) {
    const [byStudy] = await db
      .select({
        draftId: radiologyReportDraftsTable.id,
        studyId: radiologyReportDraftsTable.studyId,
        worklistId: radiologyReportDraftsTable.worklistId,
        patientId: radiologyReportDraftsTable.patientId,
      })
      .from(radiologyReportDraftsTable)
      .where(eq(radiologyReportDraftsTable.studyId, opts.studyId))
      .orderBy(desc(radiologyReportDraftsTable.updatedAt), desc(radiologyReportDraftsTable.id))
      .limit(1);
    if (byStudy) return byStudy;
  }

  return null;
}
