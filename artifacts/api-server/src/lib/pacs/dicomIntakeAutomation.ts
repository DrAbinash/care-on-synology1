/**
 * Post-DICOM intake automation — wires Orthanc arrival (#2) to queue + display (#3).
 *
 * When a study lands via POST /api/internal/radiology/studies and matches a
 * billed radiology_studies row:
 *   • MWL scheduled procedure → COMPLETED + remove .wl from Orthanc folder
 *   • Patient queue token (test_tokens) → done + SSE push to waiting-room TVs
 *   • Radiology worklist UI → SSE push for instant refresh
 */

import { db } from "@workspace/db";
import {
  radiologyScheduledProceduresTable,
  testTokensTable,
  billsTable,
} from "@workspace/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { logger } from "../logger";
import { removeWorklistFile } from "./mwlWorklistWriter";
import { queueBroadcaster } from "../queueBroadcast";
import { radiologyBroadcaster } from "../radiologyBroadcast";

export type DicomIntakeAutomationInput = {
  worklistId: number;
  accessionNumber?: string | null;
  orderTestId?: number | null;
  billId?: number | null;
  department?: string | null;
  previousStudyStatus?: string | null;
};

/** Mark MWL row complete and drop the Orthanc worklist file so the modality stops showing it. */
export async function completeMwlOnIntake(accessionNumber: string | null | undefined): Promise<void> {
  const acc = (accessionNumber ?? "").trim();
  if (!acc) return;

  try {
    const [row] = await db
      .select({ id: radiologyScheduledProceduresTable.id, status: radiologyScheduledProceduresTable.status })
      .from(radiologyScheduledProceduresTable)
      .where(eq(radiologyScheduledProceduresTable.accessionNumber, acc))
      .limit(1);

    if (!row) return;

    const terminal = new Set(["COMPLETED", "CANCELLED", "CANCELED", "DISCONTINUED"]);
    if (!terminal.has((row.status || "").toUpperCase())) {
      await db
        .update(radiologyScheduledProceduresTable)
        .set({ status: "COMPLETED", updatedAt: new Date() })
        .where(eq(radiologyScheduledProceduresTable.id, row.id));
    }

    await removeWorklistFile(acc);
    logger.info({ accessionNumber: acc }, "dicom-intake: MWL completed and worklist file removed");
  } catch (err) {
    logger.warn({ err, accessionNumber: acc }, "dicom-intake: completeMwlOnIntake failed (non-fatal)");
  }
}

/**
 * Auto-complete the billing desk queue token when the scan arrives in PACS.
 * Only transitions waiting/serving → done (never re-opens a done token).
 */
export async function advanceQueueTokenOnIntake(opts: {
  orderTestId?: number | null;
  billId?: number | null;
}): Promise<{ tokenId?: number; ledgerId?: number }> {
  const { orderTestId, billId } = opts;
  if (!orderTestId && !billId) return {};

  try {
    const cond = orderTestId
      ? eq(testTokensTable.orderTestId, orderTestId)
      : eq(testTokensTable.billId, billId!);

    const [token] = await db
      .select({
        id: testTokensTable.id,
        status: testTokensTable.status,
        ledgerId: testTokensTable.ledgerId,
        department: testTokensTable.department,
        tokenNo: testTokensTable.tokenNo,
      })
      .from(testTokensTable)
      .where(and(cond, inArray(testTokensTable.status, ["waiting", "serving"])))
      .limit(1);

    if (!token) return {};

    const [updated] = await db
      .update(testTokensTable)
      .set({ status: "done", completedAt: new Date() })
      .where(eq(testTokensTable.id, token.id))
      .returning({ id: testTokensTable.id, ledgerId: testTokensTable.ledgerId });

    if (!updated) return {};

    const ledgerId = updated.ledgerId ?? 1;
    queueBroadcaster.broadcast(ledgerId);
    logger.info(
      { tokenId: updated.id, ledgerId, department: token.department, tokenNo: token.tokenNo },
      "dicom-intake: queue token auto-completed after PACS arrival",
    );
    return { tokenId: updated.id, ledgerId };
  } catch (err) {
    logger.warn({ err, orderTestId, billId }, "dicom-intake: advanceQueueTokenOnIntake failed (non-fatal)");
    return {};
  }
}

/** Resolve ledger id from bill when token lookup needs broadcast scope. */
async function ledgerIdFromBill(billId: number | null | undefined): Promise<number> {
  if (!billId) return 1;
  try {
    const [bill] = await db
      .select({ ledgerId: billsTable.ledgerId })
      .from(billsTable)
      .where(eq(billsTable.id, billId))
      .limit(1);
    return bill?.ledgerId ?? 1;
  } catch {
    return 1;
  }
}

/**
 * Run all post-intake automations (best-effort, never throws).
 * Call after worklist row is created/updated and radiology_studies is linked.
 */
export async function runDicomIntakeAutomation(input: DicomIntakeAutomationInput): Promise<void> {
  const { worklistId, accessionNumber, orderTestId, billId, previousStudyStatus } = input;

  await completeMwlOnIntake(accessionNumber);

  const tokenResult = await advanceQueueTokenOnIntake({ orderTestId, billId });
  if (!tokenResult.ledgerId && billId) {
    const ledgerId = await ledgerIdFromBill(billId);
    queueBroadcaster.broadcast(ledgerId);
  }

  radiologyBroadcaster.broadcast(worklistId);

  if (previousStudyStatus && previousStudyStatus !== "acquired") {
    logger.info(
      { worklistId, accessionNumber, from: previousStudyStatus, to: "acquired" },
      "dicom-intake: radiology study auto-progressed to acquired",
    );
  }
}
