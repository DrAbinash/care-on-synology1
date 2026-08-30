import { db } from "@workspace/db";
import { radiologyReportDraftsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { composeStructuredJsonColumn, type CareStructuredFormatState } from "./structuredJsonColumn";

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

/** Persist draft-scoped structured viewer measurements + optional canal provenance. */
export async function persistCareViewerMeasurements(
  draftId: number,
  viewerMeasurements?: unknown,
  canalApProvenance?: unknown,
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
  });

  await db
    .update(radiologyReportDraftsTable)
    .set({ structuredJson: next })
    .where(eq(radiologyReportDraftsTable.id, draftId));
}
