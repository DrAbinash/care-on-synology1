import { db } from "@workspace/db";
import { radiologyReportDraftsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { composeStructuredJsonColumn, type CareAppliedPattern, type CareLinkedStudy, type CareStructuredFormatState } from "./structuredJsonColumn";

export async function persistCareStructuredFormatState(
  draftId: number,
  state: CareStructuredFormatState,
): Promise<void> {
  const [row] = await db
    .select({ structuredJson: radiologyReportDraftsTable.structuredJson })
    .from(radiologyReportDraftsTable)
    .where(eq(radiologyReportDraftsTable.id, draftId))
    .limit(1);

  const next = composeStructuredJsonColumn({
    existing: row?.structuredJson ?? null,
    formatState: state,
  });

  await db
    .update(radiologyReportDraftsTable)
    .set({ structuredJson: next })
    .where(eq(radiologyReportDraftsTable.id, draftId));
}

export async function persistCareObservationLedger(
  draftId: number,
  ledger: unknown,
): Promise<void> {
  const [row] = await db
    .select({ structuredJson: radiologyReportDraftsTable.structuredJson })
    .from(radiologyReportDraftsTable)
    .where(eq(radiologyReportDraftsTable.id, draftId))
    .limit(1);

  const next = composeStructuredJsonColumn({
    existing: row?.structuredJson ?? null,
    observationLedger: ledger,
  });

  await db
    .update(radiologyReportDraftsTable)
    .set({ structuredJson: next })
    .where(eq(radiologyReportDraftsTable.id, draftId));
}

/**
 * Persist draft-scoped structured viewer measurements + optional canal provenance
 * + optional MRI Brain vascular acquisition state. One read-modify-write so an
 * autosave that carries all three still issues one UPDATE.
 */
export async function persistCareViewerMeasurements(
  draftId: number,
  viewerMeasurements?: unknown,
  canalApProvenance?: unknown,
  vascularTechnique?: unknown,
): Promise<void> {
  const [row] = await db
    .select({ structuredJson: radiologyReportDraftsTable.structuredJson })
    .from(radiologyReportDraftsTable)
    .where(eq(radiologyReportDraftsTable.id, draftId))
    .limit(1);

  const next = composeStructuredJsonColumn({
    existing: row?.structuredJson ?? null,
    ...(viewerMeasurements !== undefined ? { viewerMeasurements } : {}),
    ...(canalApProvenance !== undefined ? { canalApProvenance } : {}),
    ...(vascularTechnique !== undefined ? { vascularTechnique } : {}),
  });

  await db
    .update(radiologyReportDraftsTable)
    .set({ structuredJson: next })
    .where(eq(radiologyReportDraftsTable.id, draftId));
}

/** Persist careAppliedPatterns. Empty array clears the markers. */
export async function persistCareAppliedPatterns(
  draftId: number,
  appliedPatterns: CareAppliedPattern[],
): Promise<void> {
  const [row] = await db
    .select({ structuredJson: radiologyReportDraftsTable.structuredJson })
    .from(radiologyReportDraftsTable)
    .where(eq(radiologyReportDraftsTable.id, draftId))
    .limit(1);

  const next = composeStructuredJsonColumn({
    existing: row?.structuredJson ?? null,
    appliedPatterns,
  });

  await db
    .update(radiologyReportDraftsTable)
    .set({ structuredJson: next })
    .where(eq(radiologyReportDraftsTable.id, draftId));
}

/** Persist structuredJson.linkedStudyId for a combined multi-study draft. null clears it. */
export async function persistCareLinkedStudy(
  draftId: number,
  linkedStudy: CareLinkedStudy | null,
): Promise<void> {
  const [row] = await db
    .select({ structuredJson: radiologyReportDraftsTable.structuredJson })
    .from(radiologyReportDraftsTable)
    .where(eq(radiologyReportDraftsTable.id, draftId))
    .limit(1);

  const next = composeStructuredJsonColumn({
    existing: row?.structuredJson ?? null,
    linkedStudy,
  });

  await db
    .update(radiologyReportDraftsTable)
    .set({ structuredJson: next })
    .where(eq(radiologyReportDraftsTable.id, draftId));
}

/**
 * Persist the applied whole-report format identity (baseline banner /
 * re-bootstrap guard) as an additive envelope key. Non-destructive: all other
 * envelope keys (A4 cache, format state, ledger, measurements) are preserved.
 */
export async function persistCareReportFormatIdentity(
  draftId: number,
  reportFormatIdentity: unknown,
): Promise<void> {
  const [row] = await db
    .select({ structuredJson: radiologyReportDraftsTable.structuredJson })
    .from(radiologyReportDraftsTable)
    .where(eq(radiologyReportDraftsTable.id, draftId))
    .limit(1);

  const next = composeStructuredJsonColumn({
    existing: row?.structuredJson ?? null,
    reportFormatIdentity,
  });

  await db
    .update(radiologyReportDraftsTable)
    .set({ structuredJson: next })
    .where(eq(radiologyReportDraftsTable.id, draftId));
}
