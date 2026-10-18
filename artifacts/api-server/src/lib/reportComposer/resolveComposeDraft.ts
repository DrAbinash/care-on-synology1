/**
 * Resolve the authoritative radiology report draft for a compose job.
 * Prefer worklist-linked draft; never invent IDs from client snapshot alone.
 */
import { desc, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { radiologyReportDraftsTable } from "@workspace/db/schema";
import { canalApFromStructuredJson } from "./canonicalCanalAp";
import type { CanalApComposerRecord } from "@workspace/measurements";

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

/**
 * The canal AP diameters of the draft this job is composing for.
 *
 * Same authoritative row the key-image ownership check already resolved — one
 * draft, one read, so the AI cannot be told about a different study than the one
 * the report will print. Returns null when there is no draft row or it cannot be
 * read: a study without canal measurements is the normal case, and an unavailable
 * measurement record must not cost the radiologist a draft. It also must not
 * become a *guessed* one, which is why nothing here falls back to the client.
 *
 * Read-only by construction: this is a SELECT, and the composer has no write path
 * to `structured_json` (owner DECISION 4 — the workspace grid is the only writer).
 */
export async function loadCanonicalCanalApForDraft(
  draftId: number | null | undefined,
): Promise<CanalApComposerRecord | null> {
  if (draftId == null || !Number.isFinite(draftId) || draftId <= 0) return null;
  try {
    const [row] = await db
      .select({ structuredJson: radiologyReportDraftsTable.structuredJson })
      .from(radiologyReportDraftsTable)
      .where(eq(radiologyReportDraftsTable.id, draftId))
      .limit(1);
    if (!row) return null;
    return canalApFromStructuredJson(row.structuredJson);
  } catch {
    return null;
  }
}

/**
 * The same record for a caller that only has the worklist row.
 *
 * The interactive `/draft` path has a worklist, not a compose job, so it goes
 * through the one draft-resolution rule every other reader uses — the
 * worklist-linked draft wins, and a `studyId` that means the billed study is never
 * guessed at.
 */
export async function loadCanonicalCanalApForWorklist(
  worklistId: number | null | undefined,
): Promise<CanalApComposerRecord | null> {
  if (worklistId == null || !Number.isFinite(worklistId) || worklistId <= 0) return null;
  // Guarded as a whole, not just the row read: the draft resolution is on the same
  // path, and a measurement record that cannot be reached must cost the canal data
  // and nothing else — never the draft the radiologist asked for.
  try {
    const draft = await resolveAuthoritativeComposeDraft({ worklistId });
    return await loadCanonicalCanalApForDraft(draft?.draftId ?? null);
  } catch {
    return null;
  }
}
