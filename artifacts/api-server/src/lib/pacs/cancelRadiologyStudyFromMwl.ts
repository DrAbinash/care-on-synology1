/**
 * Cancel / void a radiology study on the Modality Worklist.
 *
 * Billing cancel historically updated bills + order_tests only, leaving
 * radiology_scheduled_procedures active and Orthanc .wl files in place —
 * modalities could still C-FIND cancelled exams. This helper is the single
 * place that:
 *   1. Marks radiology_studies cancelled (when a study row exists)
 *   2. Marks radiology_scheduled_procedures CANCELLED
 *   3. Removes the Orthanc .wl via removeWorklistFile / syncWorklistForStatus
 *
 * Best-effort: never throws into billing. Safe to call repeatedly (idempotent).
 */

import { db } from "@workspace/db";
import {
  radiologyScheduledProceduresTable,
  radiologyStudiesTable,
  testTokensTable,
} from "@workspace/db/schema";
import { and, eq, inArray, ne } from "drizzle-orm";
import { logger } from "../logger";
import { removeWorklistFile, syncWorklistForStatus } from "./mwlWorklistWriter";
import { isCancellableStudyStatus } from "./cancelRadiologyMwlRules";

export { isActiveMwlStatus, isCancellableStudyStatus } from "./cancelRadiologyMwlRules";

const MWL_TERMINAL = new Set(["COMPLETED", "CANCELLED", "CANCELED", "DISCONTINUED"]);

export type CancelMwlResult = {
  accessionNumber: string;
  studyCancelled: boolean;
  procedureCancelled: boolean;
  wlRemoved: boolean;
};

/**
 * Cancel one accession across study row + scheduled procedure + .wl file.
 */
export async function cancelRadiologyMwlByAccession(
  accessionNumber: string,
  reason = "cancelled",
): Promise<CancelMwlResult> {
  const acc = (accessionNumber || "").trim();
  const empty: CancelMwlResult = {
    accessionNumber: acc,
    studyCancelled: false,
    procedureCancelled: false,
    wlRemoved: false,
  };
  if (!acc) return empty;

  try {
    let studyCancelled = false;
    const [study] = await db
      .select({
        id: radiologyStudiesTable.id,
        status: radiologyStudiesTable.status,
        orderTestId: radiologyStudiesTable.orderTestId,
      })
      .from(radiologyStudiesTable)
      .where(eq(radiologyStudiesTable.accessionNumber, acc))
      .limit(1);

    if (study && isCancellableStudyStatus(study.status)) {
      await db
        .update(radiologyStudiesTable)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(radiologyStudiesTable.id, study.id));
      studyCancelled = true;

      // Drop waiting-room / TV queue tokens so USG operator queue has no orphan.
      // Token statuses are waiting|serving|done — mark done (same as intake).
      if (study.orderTestId) {
        try {
          await db
            .update(testTokensTable)
            .set({ status: "done", completedAt: new Date() })
            .where(
              and(
                eq(testTokensTable.orderTestId, study.orderTestId),
                inArray(testTokensTable.status, ["waiting", "serving"]),
              ),
            );
        } catch {
          /* never block cancel on queue token update */
        }
      }
    }

    let procedureCancelled = false;
    const [proc] = await db
      .select({
        id: radiologyScheduledProceduresTable.id,
        status: radiologyScheduledProceduresTable.status,
        accessionNumber: radiologyScheduledProceduresTable.accessionNumber,
        patientId: radiologyScheduledProceduresTable.patientId,
        patientName: radiologyScheduledProceduresTable.patientName,
        patientSex: radiologyScheduledProceduresTable.patientSex,
        patientDob: radiologyScheduledProceduresTable.patientDob,
        modality: radiologyScheduledProceduresTable.modality,
        studyDescription: radiologyScheduledProceduresTable.studyDescription,
        procedureName: radiologyScheduledProceduresTable.procedureName,
        referringDoctor: radiologyScheduledProceduresTable.referringDoctor,
        scheduledDate: radiologyScheduledProceduresTable.scheduledDate,
        scheduledTime: radiologyScheduledProceduresTable.scheduledTime,
        stationAeTitle: radiologyScheduledProceduresTable.stationAeTitle,
        bodyPartExamined: radiologyScheduledProceduresTable.bodyPartExamined,
        sourceBillId: radiologyScheduledProceduresTable.sourceBillId,
        sourceOrderId: radiologyScheduledProceduresTable.sourceOrderId,
      })
      .from(radiologyScheduledProceduresTable)
      .where(eq(radiologyScheduledProceduresTable.accessionNumber, acc))
      .limit(1);

    if (proc) {
      const status = (proc.status || "").toUpperCase();
      if (!MWL_TERMINAL.has(status)) {
        await db
          .update(radiologyScheduledProceduresTable)
          .set({ status: "CANCELLED", updatedAt: new Date() })
          .where(eq(radiologyScheduledProceduresTable.id, proc.id));
        procedureCancelled = true;
      }
      await syncWorklistForStatus(
        {
          accessionNumber: proc.accessionNumber,
          patientId: proc.patientId,
          patientName: proc.patientName,
          patientSex: proc.patientSex,
          patientDob: proc.patientDob,
          modality: proc.modality,
          studyDescription: proc.studyDescription,
          procedureName: proc.procedureName,
          referringDoctor: proc.referringDoctor,
          scheduledDate: proc.scheduledDate,
          scheduledTime: proc.scheduledTime,
          stationAeTitle: proc.stationAeTitle,
          bodyPartExamined: proc.bodyPartExamined,
          sourceBillId: proc.sourceBillId,
          sourceOrderId: proc.sourceOrderId,
        },
        "CANCELLED",
      );
    } else {
      // No scheduled-procedure row — still try to remove a stray .wl by accession.
      await removeWorklistFile(acc);
    }

    logger.info(
      { accessionNumber: acc, studyCancelled, procedureCancelled, reason },
      "mwl: cancelled radiology study from modality worklist",
    );

    return {
      accessionNumber: acc,
      studyCancelled,
      procedureCancelled,
      wlRemoved: true,
    };
  } catch (err) {
    logger.warn({ err, accessionNumber: acc }, "mwl: cancelRadiologyMwlByAccession failed (non-fatal)");
    return empty;
  }
}

/** Cancel all radiology MWL entries for a billed order (full bill void). */
export async function cancelRadiologyMwlForBill(billId: number): Promise<{ cancelled: number }> {
  if (!Number.isFinite(billId) || billId < 1) return { cancelled: 0 };
  try {
    const studies = await db
      .select({
        accessionNumber: radiologyStudiesTable.accessionNumber,
        status: radiologyStudiesTable.status,
      })
      .from(radiologyStudiesTable)
      .where(
        and(
          eq(radiologyStudiesTable.billId, billId),
          ne(radiologyStudiesTable.status, "cancelled"),
        ),
      );

    // Also catch scheduled procedures linked by sourceBillId with no study row.
    const procs = await db
      .select({ accessionNumber: radiologyScheduledProceduresTable.accessionNumber })
      .from(radiologyScheduledProceduresTable)
      .where(eq(radiologyScheduledProceduresTable.sourceBillId, String(billId)));

    const accessions = new Set<string>();
    for (const s of studies) {
      if (s.accessionNumber) accessions.add(s.accessionNumber);
    }
    for (const p of procs) {
      if (p.accessionNumber) accessions.add(p.accessionNumber);
    }

    let cancelled = 0;
    for (const acc of accessions) {
      const r = await cancelRadiologyMwlByAccession(acc, `bill ${billId} cancelled`);
      if (r.studyCancelled || r.procedureCancelled || r.wlRemoved) cancelled += 1;
    }
    return { cancelled };
  } catch (err) {
    logger.warn({ err, billId }, "mwl: cancelRadiologyMwlForBill failed (non-fatal)");
    return { cancelled: 0 };
  }
}

/** Cancel MWL for one order_test (partial bill cancel). */
export async function cancelRadiologyMwlForOrderTest(orderTestId: number): Promise<CancelMwlResult | null> {
  if (!Number.isFinite(orderTestId) || orderTestId < 1) return null;
  try {
    const [study] = await db
      .select({ accessionNumber: radiologyStudiesTable.accessionNumber })
      .from(radiologyStudiesTable)
      .where(eq(radiologyStudiesTable.orderTestId, orderTestId))
      .limit(1);
    if (!study?.accessionNumber) return null;
    return cancelRadiologyMwlByAccession(study.accessionNumber, `order_test ${orderTestId} cancelled`);
  } catch (err) {
    logger.warn({ err, orderTestId }, "mwl: cancelRadiologyMwlForOrderTest failed (non-fatal)");
    return null;
  }
}
