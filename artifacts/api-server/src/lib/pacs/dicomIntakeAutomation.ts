/**
 * Post-DICOM intake automation — wires Orthanc arrival (#2) to queue + display (#3).
 *
 * When a study lands via POST /api/internal/radiology/studies and matches a
 * billed radiology_studies row (or a same-day USG token matched by patient name):
 *   • MWL scheduled procedure → COMPLETED + remove .wl from Orthanc folder
 *   • Patient queue token (test_tokens) → done + SSE push to waiting-room TVs
 *   • Radiology worklist UI → SSE push for instant refresh
 */

import { db } from "@workspace/db";
import {
  radiologyScheduledProceduresTable,
  testTokensTable,
  billsTable,
  queueDisplaySettingsTable,
  patientsTable,
} from "@workspace/db/schema";
import { and, eq, inArray, asc } from "drizzle-orm";
import { logger } from "../logger";
import { removeWorklistFile } from "./mwlWorklistWriter";
import { queueBroadcaster } from "../queueBroadcast";
import { radiologyBroadcaster } from "../radiologyBroadcast";
import { isUltrasoundModality } from "../usgModality";
import { resolveQueueDisplayDepartments } from "../queueDisplayDepartments";
import { pickTokenCandidateByDicomName } from "./dicomIntakeQueueMatch";

export type { QueueTokenCandidate } from "./dicomIntakeQueueMatch";
export { pickTokenCandidateByDicomName, QUEUE_TOKEN_NAME_MATCH_THRESHOLD } from "./dicomIntakeQueueMatch";

export type DicomIntakeAutomationInput = {
  worklistId: number;
  accessionNumber?: string | null;
  orderTestId?: number | null;
  billId?: number | null;
  department?: string | null;
  patientId?: number | null;
  patientName?: string | null;
  modality?: string | null;
  previousStudyStatus?: string | null;
};

function todayTokenDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

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
 * Whether any queue-display room that shows `department` has auto-complete enabled.
 * USG defaults ON when no matching room row exists (the common USG-TV hack).
 */
export async function isAutoCompleteQueueEnabledForDepartment(department: string): Promise<boolean> {
  const dept = (department ?? "").trim();
  if (!dept) return false;

  try {
    const rows = await db
      .select({
        roomKey: queueDisplaySettingsTable.roomKey,
        departments: queueDisplaySettingsTable.departments,
        autoCompleteTokenOnDicom: queueDisplaySettingsTable.autoCompleteTokenOnDicom,
      })
      .from(queueDisplaySettingsTable);

    const matching = rows.filter((r) =>
      resolveQueueDisplayDepartments(r.roomKey, r.departments).includes(dept),
    );
    if (matching.length === 0) return dept === "USG";
    return matching.some((r) => r.autoCompleteTokenOnDicom);
  } catch (err) {
    logger.warn({ err, department: dept }, "dicom-intake: auto-complete setting lookup failed — default USG on");
    return dept === "USG";
  }
}

/**
 * Auto-complete the billing desk queue token when the scan arrives in PACS.
 * Only transitions waiting/serving → done (never re-opens a done token).
 */
export async function advanceQueueTokenOnIntake(opts: {
  orderTestId?: number | null;
  billId?: number | null;
  patientId?: number | null;
  patientName?: string | null;
  department?: string | null;
}): Promise<{ tokenId?: number; ledgerId?: number }> {
  const { orderTestId, billId, patientId, patientName, department } = opts;
  const dept = (department ?? "").trim();
  const dicomName = (patientName ?? "").trim();

  if (!orderTestId && !billId && !(dicomName && dept) && !(patientId && dept)) return {};

  if (dept && !(await isAutoCompleteQueueEnabledForDepartment(dept))) {
    logger.info({ department: dept }, "dicom-intake: auto-complete queue disabled for department");
    return {};
  }

  try {
    const activeStatus = inArray(testTokensTable.status, ["waiting", "serving"]);
    const tokenDate = todayTokenDate();

    let token:
      | {
          id: number;
          status: string;
          ledgerId: number | null;
          department: string;
          tokenNo: number;
        }
      | undefined;

    if (orderTestId) {
      [token] = await db
        .select({
          id: testTokensTable.id,
          status: testTokensTable.status,
          ledgerId: testTokensTable.ledgerId,
          department: testTokensTable.department,
          tokenNo: testTokensTable.tokenNo,
        })
        .from(testTokensTable)
        .where(and(eq(testTokensTable.orderTestId, orderTestId), activeStatus))
        .limit(1);
    }

    if (!token && billId) {
      [token] = await db
        .select({
          id: testTokensTable.id,
          status: testTokensTable.status,
          ledgerId: testTokensTable.ledgerId,
          department: testTokensTable.department,
          tokenNo: testTokensTable.tokenNo,
        })
        .from(testTokensTable)
        .where(and(eq(testTokensTable.billId, billId), activeStatus))
        .limit(1);
    }

    // USG hack: MWL / patient IDs often mismatch — match today's token by patient name.
    if (!token && dicomName && dept) {
      const candidates = await db
        .select({
          id: testTokensTable.id,
          status: testTokensTable.status,
          ledgerId: testTokensTable.ledgerId,
          department: testTokensTable.department,
          tokenNo: testTokensTable.tokenNo,
          patientFirstName: patientsTable.firstName,
          patientLastName: patientsTable.lastName,
        })
        .from(testTokensTable)
        .innerJoin(patientsTable, eq(patientsTable.id, testTokensTable.patientId))
        .where(
          and(
            eq(testTokensTable.department, dept),
            eq(testTokensTable.tokenDate, tokenDate),
            activeStatus,
          ),
        );

      const picked = pickTokenCandidateByDicomName(dicomName, candidates);
      if (picked) {
        token = picked;
        logger.info(
          { tokenId: picked.id, tokenNo: picked.tokenNo, department: dept },
          "dicom-intake: queue token matched by patient name",
        );
      }
    }

    // Last resort: numeric patient id (when DICOM and billing share the same ERP row).
    if (!token && patientId && dept) {
      [token] = await db
        .select({
          id: testTokensTable.id,
          status: testTokensTable.status,
          ledgerId: testTokensTable.ledgerId,
          department: testTokensTable.department,
          tokenNo: testTokensTable.tokenNo,
        })
        .from(testTokensTable)
        .where(
          and(
            eq(testTokensTable.patientId, patientId),
            eq(testTokensTable.department, dept),
            eq(testTokensTable.tokenDate, tokenDate),
            activeStatus,
          ),
        )
        .orderBy(asc(testTokensTable.tokenNo))
        .limit(1);
    }

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
    logger.warn({ err, orderTestId, billId, patientId, patientName, department }, "dicom-intake: advanceQueueTokenOnIntake failed (non-fatal)");
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
  const {
    worklistId,
    accessionNumber,
    orderTestId,
    billId,
    department,
    patientId,
    modality,
    previousStudyStatus,
    patientName,
  } = input;

  await completeMwlOnIntake(accessionNumber);

  const tokenDepartment =
    (department ?? "").trim() || (isUltrasoundModality(modality) ? "USG" : "");

  const tokenResult = await advanceQueueTokenOnIntake({
    orderTestId,
    billId,
    patientId,
    patientName,
    department: tokenDepartment || undefined,
  });
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
