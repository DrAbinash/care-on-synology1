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
 *   4. On unlink failure, enqueues durable mwl_wl_cleanup retry (never blocks billing)
 *
 * Best-effort filesystem: never throws into billing. Safe to call repeatedly.
 */

import { db } from "@workspace/db";
import {
  radiologyScheduledProceduresTable,
  radiologyStudiesTable,
  testTokensTable,
} from "@workspace/db/schema";
import { and, eq, inArray, ne } from "drizzle-orm";
import { logger } from "../logger";
import {
  isRemoveWorklistSuccess,
  removeWorklistFile,
  syncWorklistForStatus,
  type RemoveWorklistResult,
} from "./mwlWorklistWriter";
import { isCancellableStudyStatus } from "./cancelRadiologyMwlRules";
import { afterCancelEnsureWlRemoved } from "./mwlWlCleanup";

export { isActiveMwlStatus, isCancellableStudyStatus } from "./cancelRadiologyMwlRules";

const MWL_TERMINAL = new Set(["COMPLETED", "CANCELLED", "CANCELED", "DISCONTINUED"]);

export type CancelMwlResult = {
  accessionNumber: string;
  studyCancelled: boolean;
  procedureCancelled: boolean;
  /** Accurate: true only when .wl removed, already absent, or MWL disabled. */
  wlRemoved: boolean;
  /** True when unlink failed and a durable cleanup job was enqueued. */
  cleanupPending: boolean;
  removeOutcome?: RemoveWorklistResult["outcome"];
};

export type CancelBillMwlResult = {
  /** Accessions touched this call. */
  processed: number;
  /** Accessions where study and/or scheduled procedure reached terminal cancel. */
  cancelled: number;
  /** Accessions whose .wl is confirmed clean. */
  wlCleaned: number;
  /** Accessions with durable cleanup retry pending. */
  cleanupPending: number;
  /** Alias of cleanupPending (unlink failed). */
  cleanupFailed: number;
};

/**
 * Cancel one accession across study row + scheduled procedure + .wl file.
 */
export async function cancelRadiologyMwlByAccession(
  accessionNumber: string,
  reason = "cancelled",
  context: {
    billId?: number | null;
    orderId?: number | null;
    orderTestId?: number | null;
    studyId?: number | null;
  } = {},
): Promise<CancelMwlResult> {
  const acc = (accessionNumber || "").trim();
  const empty: CancelMwlResult = {
    accessionNumber: acc,
    studyCancelled: false,
    procedureCancelled: false,
    wlRemoved: false,
    cleanupPending: false,
  };
  if (!acc) return empty;

  try {
    let studyCancelled = false;
    let studyId = context.studyId ?? null;
    let orderTestId = context.orderTestId ?? null;
    let billId = context.billId ?? null;
    let orderId = context.orderId ?? null;

    const [study] = await db
      .select({
        id: radiologyStudiesTable.id,
        status: radiologyStudiesTable.status,
        orderTestId: radiologyStudiesTable.orderTestId,
        billId: radiologyStudiesTable.billId,
        orderId: radiologyStudiesTable.orderId,
      })
      .from(radiologyStudiesTable)
      .where(eq(radiologyStudiesTable.accessionNumber, acc))
      .limit(1);

    if (study) {
      studyId = study.id;
      orderTestId = orderTestId ?? study.orderTestId;
      billId = billId ?? study.billId;
      orderId = orderId ?? study.orderId;

      if (isCancellableStudyStatus(study.status)) {
        await db
          .update(radiologyStudiesTable)
          .set({ status: "cancelled", updatedAt: new Date() })
          .where(eq(radiologyStudiesTable.id, study.id));
        studyCancelled = true;

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
    }

    let procedureCancelled = false;
    let removeResult: RemoveWorklistResult;

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
      if (proc.sourceBillId && billId == null) {
        const n = Number(proc.sourceBillId);
        if (Number.isFinite(n)) billId = n;
      }
      if (proc.sourceOrderId && orderId == null) {
        const n = Number(proc.sourceOrderId);
        if (Number.isFinite(n)) orderId = n;
      }

      const sync = await syncWorklistForStatus(
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
      removeResult = sync.remove ?? { outcome: "failed", error: "sync did not return remove result" };
    } else {
      removeResult = await removeWorklistFile(acc);
    }

    const cleanup = await afterCancelEnsureWlRemoved(acc, removeResult, {
      billId,
      orderId,
      orderTestId,
      studyId,
      reason,
    });

    logger.info(
      {
        accessionNumber: acc,
        studyCancelled,
        procedureCancelled,
        wlRemoved: cleanup.wlRemoved,
        cleanupPending: cleanup.cleanupPending,
        removeOutcome: removeResult.outcome,
        reason,
      },
      "mwl: cancelled radiology study from modality worklist",
    );

    return {
      accessionNumber: acc,
      studyCancelled,
      procedureCancelled,
      wlRemoved: cleanup.wlRemoved,
      cleanupPending: cleanup.cleanupPending,
      removeOutcome: removeResult.outcome,
    };
  } catch (err) {
    logger.warn({ err, accessionNumber: acc }, "mwl: cancelRadiologyMwlByAccession failed (non-fatal)");
    // DB may have partially updated — never claim wlRemoved on unexpected throw.
    return empty;
  }
}

/** Cancel all radiology MWL entries for a billed order (full bill void). */
export async function cancelRadiologyMwlForBill(billId: number): Promise<CancelBillMwlResult> {
  const empty: CancelBillMwlResult = {
    processed: 0,
    cancelled: 0,
    wlCleaned: 0,
    cleanupPending: 0,
    cleanupFailed: 0,
  };
  if (!Number.isFinite(billId) || billId < 1) return empty;
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

    const out: CancelBillMwlResult = { ...empty };
    for (const acc of accessions) {
      const r = await cancelRadiologyMwlByAccession(acc, `bill ${billId} cancelled`, { billId });
      out.processed += 1;
      if (r.studyCancelled || r.procedureCancelled) out.cancelled += 1;
      if (r.wlRemoved) out.wlCleaned += 1;
      if (r.cleanupPending) {
        out.cleanupPending += 1;
        out.cleanupFailed += 1;
      }
    }
    return out;
  } catch (err) {
    logger.warn({ err, billId }, "mwl: cancelRadiologyMwlForBill failed (non-fatal)");
    return empty;
  }
}

/** Cancel MWL for one order_test (partial bill cancel). */
export async function cancelRadiologyMwlForOrderTest(orderTestId: number): Promise<CancelMwlResult | null> {
  if (!Number.isFinite(orderTestId) || orderTestId < 1) return null;
  try {
    const [study] = await db
      .select({
        accessionNumber: radiologyStudiesTable.accessionNumber,
        id: radiologyStudiesTable.id,
        billId: radiologyStudiesTable.billId,
        orderId: radiologyStudiesTable.orderId,
      })
      .from(radiologyStudiesTable)
      .where(eq(radiologyStudiesTable.orderTestId, orderTestId))
      .limit(1);
    if (!study?.accessionNumber) return null;
    return cancelRadiologyMwlByAccession(study.accessionNumber, `order_test ${orderTestId} cancelled`, {
      orderTestId,
      studyId: study.id,
      billId: study.billId,
      orderId: study.orderId,
    });
  } catch (err) {
    logger.warn({ err, orderTestId }, "mwl: cancelRadiologyMwlForOrderTest failed (non-fatal)");
    return null;
  }
}

/** Exported for tests — re-export success helper. */
export { isRemoveWorklistSuccess };
