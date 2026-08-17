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
