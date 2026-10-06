import { db } from "@workspace/db";
import { radiologyReportDraftsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import {
  composeStructuredJsonColumn,
  type StructuredJsonPatch,
} from "./structuredJsonColumn";

/**
 * Writes one save-draft request's envelope keys into
 * radiology_report_drafts.structured_json as a SINGLE read-modify-write under a
 * row lock.
 *
 * This replaces six per-key writers (format state, observation ledger, viewer
 * measurements, applied patterns, linked study, report format identity), each of
 * which did its own `SELECT structured_json` → compose → `UPDATE structured_json`
 * against the same column. Sequentially within one request that was correct,
 * because each read saw the previous write. Across two overlapping requests it
 * was a lost update: both read the same snapshot, both composed against it, and
 * the second write silently discarded every key the first had added — because
 * composeStructuredJsonColumn merges into the `existing` value it was handed, and
 * that value was already stale.
 *
 * Overlapping requests are not hypothetical here. useDraftPersistence has a
 * first-save mutex (ensureDraftOnce) but saveDraft itself has none, so the 30s
 * autosave and a save-on-leave can both be in flight; two browser tabs on the
 * same study do it too.
 *
 * `SELECT … FOR UPDATE` inside the transaction is what actually serializes them —
 * a bare transaction would not be enough under READ COMMITTED, since both
 * transactions could still read the pre-write value. Same idiom as
 * lib/studyLocks.ts's claimStudy.
 */
export async function persistCareStructuredJsonPatch(
  draftId: number,
  patch: StructuredJsonPatch,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ structuredJson: radiologyReportDraftsTable.structuredJson })
      .from(radiologyReportDraftsTable)
      .where(eq(radiologyReportDraftsTable.id, draftId))
      .for("update")
      .limit(1);

    const next = composeStructuredJsonColumn({
      existing: row?.structuredJson ?? null,
      ...patch,
    });

    await tx
      .update(radiologyReportDraftsTable)
      .set({ structuredJson: next })
      .where(eq(radiologyReportDraftsTable.id, draftId));
  });
}
