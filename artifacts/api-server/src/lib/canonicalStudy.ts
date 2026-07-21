/**
 * Canonical Study resolution — Phase P0 / Gate G3.
 *
 * The ONE place study identity is resolved server-side. A client-supplied
 * integer study id is NEVER trusted verbatim: it must resolve to an existing
 * radiology_studies row, and the preferred input is the canonical
 * `studyInstanceUID` (DICOM imaging identity). See
 * docs/architecture/radiology-ai/V1.1_IMPLEMENTATION_CONSTITUTION.md §4.
 */
import { db } from "@workspace/db";
import { radiologyStudiesTable, canonicalStudyTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

/**
 * Resolve a canonical study identity to the `radiology_studies.id` surrogate.
 * Prefers `studyInstanceUid` (canonical); falls back to validating a candidate
 * `studyId` actually exists. Returns `null` when nothing resolves — callers
 * MUST treat that as "study not found" and never insert an unresolved id.
 */
export async function resolveRadiologyStudyId(input: {
  studyInstanceUid?: string | null;
  studyId?: number | null;
}): Promise<number | null> {
  const uid = input.studyInstanceUid?.trim();
  if (uid) {
    // Prefer the crosswalk; fall back to radiology_studies directly (covers
    // studies acquired before the crosswalk was backfilled).
    const [x] = await db
      .select({ id: canonicalStudyTable.radiologyStudyId })
      .from(canonicalStudyTable)
      .where(eq(canonicalStudyTable.studyInstanceUid, uid))
      .limit(1);
    if (x?.id != null) return x.id;

    const [s] = await db
      .select({ id: radiologyStudiesTable.id })
      .from(radiologyStudiesTable)
      .where(eq(radiologyStudiesTable.studyInstanceUid, uid))
      .limit(1);
    return s?.id ?? null;
  }

  if (input.studyId != null) {
    const [s] = await db
      .select({ id: radiologyStudiesTable.id })
      .from(radiologyStudiesTable)
      .where(eq(radiologyStudiesTable.id, input.studyId))
      .limit(1);
    return s?.id ?? null;
  }

  return null;
}

/**
 * Ensure a `canonical_study` crosswalk row exists for a resolved study.
 * Idempotent — safe to call on every resolution.
 */
export async function ensureCanonicalStudy(
  studyInstanceUid: string,
  radiologyStudyId: number,
): Promise<void> {
  const uid = studyInstanceUid.trim();
  if (!uid) return;
  await db
    .insert(canonicalStudyTable)
    .values({ studyInstanceUid: uid, radiologyStudyId })
    .onConflictDoNothing({ target: canonicalStudyTable.studyInstanceUid });
}
