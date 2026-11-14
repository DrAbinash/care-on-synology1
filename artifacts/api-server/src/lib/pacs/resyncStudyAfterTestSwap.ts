/**
 * Keep the RIS/PACS side honest when the billing desk replaces a test on an
 * existing bill (`POST /api/bills/:id/swap-test`).
 *
 * The swap route rewrites `order_tests.test_id`, recalculates the money and
 * audits the price, and used to stop there. `radiology_studies` keeps its own
 * `test_id`, `modality`, `department`, `room_number`, `study_description` and
 * `scheduled_station_ae_title`, and `generateStudiesForOrder` — the only code
 * that writes those — skips any order test that already has a study
 * (`radiology_studies_order_test_uq`), so re-running it after a swap is a
 * no-op. A patient billed for an X-Ray therefore stayed on the worklist as an
 * ultrasound: sent to the US machine, queued in the US room, and reported under
 * the examination nobody bought.
 *
 * Two decisions here, both deliberate:
 *
 *  • An examination that has already been performed is NEVER rewritten. The
 *    study row is the record of what was acquired, and a clerk correcting an
 *    invoice must not be able to turn a signed CT into a booked X-Ray. Those
 *    swaps are refused before the money moves (see `studySwapSyncBlock`, which
 *    the route calls inside its transaction).
 *  • A description someone typed is not overwritten. The study's
 *    `study_description` is either the billed test's own name (derived by the
 *    fan-out) or the clerk's string; only the first is replaced. Same rule the
 *    fan-out uses to decide whether a bill-level description may be stamped on
 *    a study at all.
 *
 *  • Imaging corrected into a NON-imaging test is reported, not cancelled.
 *    Cancelling a study belongs to `cancel-test`, which also retires the token
 *    and the refund; a swap that cancelled behind the desk's back would leave a
 *    terminal row that the next swap then refuses to move. The response says
 *    `booking_stale` so the desk can finish the correction it started.
 */
import { db } from "@workspace/db";
import {
  modalitiesTable,
  radiologyAuditLogTable,
  radiologyScheduledProceduresTable,
  radiologyStudiesTable,
  testsTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { RADIOLOGY_MODALITY_MAP, radiologyFamilyForOrderTest } from "../radiologyDepartments";
import { republishWorklistForAccession } from "./publishRadiologyStudyToMwl";
import { resolveScheduledStationAeTitle } from "./resolveScheduledStationAeTitle";
import {
  studyDescriptionIsDerived,
  studySwapSyncBlock,
  type StudySwapBlockReason,
} from "./studyTestSwapRules";
import { logger } from "../logger";

export type { StudySwapBlockReason } from "./studyTestSwapRules";

export type StudySwapSync =
  | { status: "no_study" }
  | { status: "not_radiology" }
  | {
      /** Imaging corrected into a non-imaging test: the booking is left for `cancel-test`. */
      status: "booking_stale";
      accessionNumber: string;
      bookedAs: string | null;
    }
  | { status: "blocked"; reason: StudySwapBlockReason; accessionNumber: string }
  | {
      status: "synced";
      accessionNumber: string;
      modality: string;
      department: string;
      changed: string[];
      studyDescriptionOutcome: "synced" | "kept_manual";
      mwl: Awaited<ReturnType<typeof republishWorklistForAccession>>;
    };

/**
 * Move the booked examination onto the test the patient is actually billed for.
 * Reads, writes and re-publishes; returns the verdict so the desk can be told
 * what happened to the study rather than only to the invoice.
 */
export async function resyncStudyAfterTestSwap(opts: {
  orderTestId: number;
  newTestId: number;
  actor: string;
  reason: string;
}): Promise<StudySwapSync> {
  const [newTest] = await db
    .select({
      id: testsTable.id,
      name: testsTable.name,
      department: testsTable.department,
      roomNumber: testsTable.roomNumber,
      deviceName: modalitiesTable.name,
    })
    .from(testsTable)
    .leftJoin(modalitiesTable, eq(modalitiesTable.id, testsTable.modalityId))
    .where(eq(testsTable.id, opts.newTestId))
    .limit(1);
  if (!newTest) return { status: "not_radiology" };

  // The same predicate the fan-out and the reconciliation sweep use, so a test
  // this function turns into a study is a test the fan-out would have issued.
  const department = radiologyFamilyForOrderTest({
    department: newTest.department,
    deviceName: newTest.deviceName,
  });

  const [study] = await db
    .select({
      id: radiologyStudiesTable.id,
      accessionNumber: radiologyStudiesTable.accessionNumber,
      testId: radiologyStudiesTable.testId,
      status: radiologyStudiesTable.status,
      modality: radiologyStudiesTable.modality,
      department: radiologyStudiesTable.department,
      roomNumber: radiologyStudiesTable.roomNumber,
      studyDescription: radiologyStudiesTable.studyDescription,
      scheduledStationAETitle: radiologyStudiesTable.scheduledStationAETitle,
      startedAt: radiologyStudiesTable.startedAt,
      acquiredAt: radiologyStudiesTable.acquiredAt,
      deliveredAt: radiologyStudiesTable.deliveredAt,
      studyInstanceUid: radiologyStudiesTable.studyInstanceUid,
      numImages: radiologyStudiesTable.numImages,
      oldTestName: testsTable.name,
    })
    .from(radiologyStudiesTable)
    .leftJoin(testsTable, eq(testsTable.id, radiologyStudiesTable.testId))
    .where(eq(radiologyStudiesTable.orderTestId, opts.orderTestId))
    .limit(1);

  if (!department) {
    if (!study) return { status: "not_radiology" };
    // Imaging corrected INTO a lab test. The booking is now stale, and this
    // module does not cancel it: cancellation is `cancel-test`'s job, with its
    // own token and refund rules, and a swap that quietly cancelled a study
    // would leave the line unswappable (the row below it turns terminal). The
    // desk is told, in the response, that the machine is still scheduled.
    return {
      status: "booking_stale",
      accessionNumber: study.accessionNumber,
      bookedAs: study.oldTestName ?? study.studyDescription ?? null,
    };
  }
  if (!study) return { status: "no_study" };
  const modality = RADIOLOGY_MODALITY_MAP[department] ?? "OT";

  const block = studySwapSyncBlock(study);
  if (block) {
    logger.warn(
      { orderTestId: opts.orderTestId, accessionNumber: study.accessionNumber, reason: block },
      "billed test swapped but the booked study was left alone — it is already an acquisition",
    );
    return { status: "blocked", reason: block, accessionNumber: study.accessionNumber };
  }

  const derived = studyDescriptionIsDerived(study.studyDescription, study.oldTestName);
  const studyDescription = derived ? newTest.name : study.studyDescription;

  // A different machine performs a different examination, so the station the
  // modality polls must follow. Resolution is best-effort everywhere else in
  // the pipeline; here a null for a moved modality must CLEAR the old AE title
  // rather than leave the previous machine scheduled.
  let stationAeTitle = study.scheduledStationAETitle;
  try {
    const resolved = await resolveScheduledStationAeTitle({ modality, testId: newTest.id });
    if (resolved.aeTitle) stationAeTitle = resolved.aeTitle;
    else if (resolvedStationImpliesClear(study.modality, modality)) stationAeTitle = null;
  } catch (err) {
    logger.warn({ err, orderTestId: opts.orderTestId }, "swap sync could not resolve the station AE title");
  }

  const changed: string[] = [];
  const patch: Partial<typeof radiologyStudiesTable.$inferInsert> = { testId: newTest.id };
  if (study.modality !== modality) { patch.modality = modality; changed.push("modality"); }
  if (study.department !== department) { patch.department = department; changed.push("department"); }
  if ((study.roomNumber ?? "") !== (newTest.roomNumber ?? "")) {
    patch.roomNumber = newTest.roomNumber ?? "";
    changed.push("roomNumber");
  }
  if (derived && (study.studyDescription ?? "") !== newTest.name) {
    patch.studyDescription = newTest.name;
    changed.push("studyDescription");
  }
  if ((study.scheduledStationAETitle ?? null) !== (stationAeTitle ?? null)) {
    patch.scheduledStationAETitle = stationAeTitle ?? null;
    changed.push("scheduledStationAETitle");
  }
  if (study.testId !== newTest.id) changed.unshift("testId");

  if (changed.length > 0) {
    await db.update(radiologyStudiesTable).set(patch).where(eq(radiologyStudiesTable.id, study.id));

    // The row the `.wl` file is built from. Updated in the same breath as the
    // study so the console cannot read one while the screen reads the other.
    await db
      .update(radiologyScheduledProceduresTable)
      .set({
        modality,
        procedureName: newTest.name,
        studyDescription: derived ? newTest.name : study.studyDescription ?? null,
        stationAeTitle: stationAeTitle ?? null,
        updatedAt: new Date(),
      })
      .where(eq(radiologyScheduledProceduresTable.accessionNumber, study.accessionNumber));

    await db.insert(radiologyAuditLogTable).values({
      accessionNumber: study.accessionNumber,
      action: "BILLED_TEST_SWAPPED",
      actor: opts.actor,
      details: JSON.stringify({
        reason: opts.reason,
        orderTestId: opts.orderTestId,
        from: {
          testId: study.testId,
          testName: study.oldTestName ?? null,
          modality: study.modality,
          department: study.department,
          roomNumber: study.roomNumber,
          studyDescription: study.studyDescription ?? null,
          stationAeTitle: study.scheduledStationAETitle ?? null,
        },
        to: {
          testId: newTest.id,
          testName: newTest.name,
          modality,
          department,
          roomNumber: newTest.roomNumber ?? "",
          studyDescription: studyDescription ?? null,
          stationAeTitle: stationAeTitle ?? null,
        },
        changed,
      }),
    });
  }

  const mwl = await republishWorklistForAccession(study.accessionNumber);

  return {
    status: "synced",
    accessionNumber: study.accessionNumber,
    modality,
    department,
    changed,
    studyDescriptionOutcome: derived ? "synced" : "kept_manual",
    mwl,
  };
}

/**
 * Whether a failed station resolution must blank the scheduled machine.
 *
 * Only when the modality actually moved: staying on the same machine with a
 * transiently unresolvable AE title must not delete a working schedule.
 */
function resolvedStationImpliesClear(oldModality: string, newModality: string): boolean {
  return (oldModality ?? "").toUpperCase() !== (newModality ?? "").toUpperCase();
}
