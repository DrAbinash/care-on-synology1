/**
 * Bill → Modality Worklist (Antigravity plan):
 *   Bill generated → radiology_studies (accession = work id)
 *                 → radiology_scheduled_procedures (ERP patient + doctor names)
 *                 → Orthanc .wl file (when ORTHANC_WORKLIST_DIR is set)
 *
 * The modality C-FINDs the worklist, copies ERP names + accession onto the
 * study, and Orthanc pushes back. Return matching uses that accession
 * (work id) — not fuzzy name repair.
 *
 * Best-effort: never throws into billing. Idempotent on accession.
 */

import { db } from "@workspace/db";
import {
  doctorsTable,
  ordersTable,
  patientsTable,
  radiologyScheduledProceduresTable,
  radiologyStudiesTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { genderToDicomSex } from "@workspace/pathology";
import { logger } from "../logger";
import { isMwlEnabled, writeWorklistFile, removeWorklistFile, syncWorklistForStatus } from "./mwlWorklistWriter";
import { resolveScheduledStationAeTitle, resolveMwlTestBodyPart } from "./resolveScheduledStationAeTitle";
import {
  isMwlPublicationSuppressedFor,
  loadMwlSuppressedTestIds,
  suppressedSiblingSuffix,
} from "./mwlPublicationControls";
import { formatReferringDoctorDisplay } from "./dicomNameNormalize";

function yyyymmdd(d: Date = new Date()): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

function hhmmss(d: Date = new Date()): string {
  return `${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}`;
}

function dobCompact(dob: string | null | undefined): string | null {
  if (!dob) return null;
  const digits = dob.replace(/[^0-9]/g, "");
  if (digits.length >= 8) return digits.slice(0, 8);
  // YYYY-MM-DD
  const m = dob.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}${m[2]}${m[3]}` : null;
}

/**
 * Referring doctor for the worklist item.
 *
 * The clinic's real referral record is `orders.doctor_id` → the Settings →
 * Doctors master — the same row commission is calculated on and the same one
 * the report header prints as REF. BY. The billing desk's optional DICOM
 * prompts (`dicomFields.referringDoctor`) are only sent when all four are
 * filled, so in practice they are empty and every item used to reach the
 * modality with no referrer. Order of preference: what the desk typed, then
 * the doctor master, then nothing (never a placeholder).
 */
async function resolveReferringDoctor(
  orderId: number,
  explicit: string | null | undefined,
): Promise<{ name: string | null; id: string | null }> {
  const typed = (explicit ?? "").trim();
  if (typed) return { name: typed, id: null };
  try {
    const [row] = await db
      .select({
        id: doctorsTable.id,
        name: doctorsTable.name,
        degree: doctorsTable.degree,
      })
      .from(ordersTable)
      .innerJoin(doctorsTable, eq(ordersTable.doctorId, doctorsTable.id))
      .where(eq(ordersTable.id, orderId))
      .limit(1);
    if (!row?.name) return { name: null, id: null };
    const display = formatReferringDoctorDisplay(
      row.degree ? `${row.name}, ${row.degree}` : row.name,
    );
    return { name: display || null, id: display ? String(row.id) : null };
  } catch (err) {
    logger.warn({ err, orderId }, "mwl: referring doctor lookup from orders.doctor_id failed");
    return { name: null, id: null };
  }
}

export type PublishStudyToMwlResult = {  scheduled: boolean;
  written: boolean;
  accessionNumber: string;
  mwlEnabled: boolean;
  /** True when this test is on the "does not go to the machine" list. */
  suppressed: boolean;
};

/**
 * Publish one radiology study to the MWL source table (+ Orthanc .wl when configured).
 * Uses ERP patient name / UHID / referring doctor — the names the modality should copy.
 */
export async function publishRadiologyStudyToMwl(opts: {
  accessionNumber: string;
  patientId: number;
  billId: number;
  orderId: number;
  modality: string;
  procedureName?: string | null;
  studyDescription?: string | null;
  referringDoctor?: string | null;
  bodyPart?: string | null;
  stationAeTitle?: string | null;
  /** Optional catalog test id — used for per-test station AE defaults. */
  testId?: number | null;
}): Promise<PublishStudyToMwlResult> {
  const accessionNumber = opts.accessionNumber.trim();
  const empty: PublishStudyToMwlResult = {
    scheduled: false,
    written: false,
    accessionNumber,
    mwlEnabled: isMwlEnabled(),
    suppressed: false,
  };
  if (!accessionNumber) return empty;

  try {
    const stationResolved = await resolveScheduledStationAeTitle({
      modality: opts.modality,
      explicitAeTitle: opts.stationAeTitle,
      testId: opts.testId,
    });
    const stationAeTitle = stationResolved.aeTitle;
    const referring = await resolveReferringDoctor(opts.orderId, opts.referringDoctor);

    // Which machine gets this line, and whether it gets it at all. See
    // mwlPublicationControls for why a booked contrast is not an examination a
    // scanner should be handed twice.
    const suppressedTestIds = await loadMwlSuppressedTestIds();
    const publicationSuppressed = isMwlPublicationSuppressedFor(opts.testId, suppressedTestIds);
    const bodyPart =
      (opts.bodyPart ?? "").trim() || (await resolveMwlTestBodyPart(opts.testId));
    const baseDescription = (opts.studyDescription ?? opts.procedureName ?? "").trim();
    const description = publicationSuppressed
      ? baseDescription
      : `${baseDescription}${await suppressedSiblingSuffix(
          opts.orderId,
          opts.testId,
          baseDescription,
          suppressedTestIds,
        )}`;

    const [patient] = await db
      .select({
        uhid: patientsTable.patientId,
        firstName: patientsTable.firstName,
        lastName: patientsTable.lastName,
        gender: patientsTable.gender,
        dateOfBirth: patientsTable.dateOfBirth,
        ageValue: patientsTable.ageValue,
        ageUnit: patientsTable.ageUnit,
      })
      .from(patientsTable)
      .where(eq(patientsTable.id, opts.patientId))
      .limit(1);

    const patientName = patient
      ? `${patient.firstName || ""} ${patient.lastName || ""}`.replace(/\s+/g, " ").trim()
      : "";
    const patientAge = patient?.ageValue != null
      ? `${patient.ageValue}${patient.ageUnit ? ` ${patient.ageUnit}` : ""}`.trim()
      : null;

    // Upsert by accession — re-billing / reconciliation must not duplicate MWL rows.
    const [existing] = await db
      .select({ id: radiologyScheduledProceduresTable.id, status: radiologyScheduledProceduresTable.status })
      .from(radiologyScheduledProceduresTable)
      .where(eq(radiologyScheduledProceduresTable.accessionNumber, accessionNumber))
      .limit(1);

    let row = existing
      ? (await db
          .update(radiologyScheduledProceduresTable)
          .set({
            patientId: patient?.uhid ?? String(opts.patientId),
            patientName: patientName || null,
            patientSex: genderToDicomSex(patient?.gender) || null,
            patientAge,
            patientDob: dobCompact(patient?.dateOfBirth),
            modality: opts.modality || null,
            procedureName: opts.procedureName ?? null,
            studyDescription: description || null,
            referringDoctor: referring.name,
            referringDoctorId: referring.id,
            scheduledDate: yyyymmdd(),
            scheduledTime: hhmmss(),
            stationAeTitle,
            bodyPartExamined: bodyPart,
            sourceBillId: String(opts.billId),
            sourceOrderId: String(opts.orderId),
            // Keep terminal statuses terminal; otherwise ensure SCHEDULED/SENT.
            status: ["COMPLETED", "CANCELLED", "CANCELED", "DISCONTINUED"].includes(
              (existing.status || "").toUpperCase(),
            )
              ? existing.status
              : existing.status || "SCHEDULED",
            updatedAt: new Date(),
          })
          .where(eq(radiologyScheduledProceduresTable.id, existing.id))
          .returning())[0]
      : (await db
          .insert(radiologyScheduledProceduresTable)
          .values({
            accessionNumber,
            patientId: patient?.uhid ?? String(opts.patientId),
            patientName: patientName || null,
            patientSex: genderToDicomSex(patient?.gender) || null,
            patientAge,
            patientDob: dobCompact(patient?.dateOfBirth),
            modality: opts.modality || null,
            procedureName: opts.procedureName ?? null,
            studyDescription: description || null,
            referringDoctor: referring.name,
            referringDoctorId: referring.id,
            scheduledDate: yyyymmdd(),
            scheduledTime: hhmmss(),
            stationAeTitle,
            bodyPartExamined: bodyPart,
            sourceBillId: String(opts.billId),
            sourceOrderId: String(opts.orderId),
            status: "SCHEDULED",
          })
          .onConflictDoNothing()
          .returning())[0];

    if (!row) {
      // Race: another writer inserted between select and insert.
      const [again] = await db
        .select()
        .from(radiologyScheduledProceduresTable)
        .where(eq(radiologyScheduledProceduresTable.accessionNumber, accessionNumber))
        .limit(1);
      row = again;
    }

    if (!row) return empty;

    let written = false;
    const statusUpper = (row.status || "").toUpperCase();
    const isTerminal = ["COMPLETED", "CANCELLED", "CANCELED", "DISCONTINUED"].includes(statusUpper);

    if (isMwlEnabled()) {
      if (publicationSuppressed) {
        // Booked on the bill, but not an examination a scanner should be handed:
        // no .wl file, and no SENT_TO_MWL. Any file written before this test was
        // added to the list is removed, so ticking the box takes effect on the
        // next re-publish instead of leaving a stale entry on the machine.
        await removeWorklistFile(row.accessionNumber);
      } else if (isTerminal) {
        // Never re-publish a cancelled/completed accession — remove any stale .wl.
        // Do NOT set SENT_TO_MWL. Do NOT call writeWorklistFile.
        const removed = await removeWorklistFile(row.accessionNumber);
        if (removed.outcome === "failed") {
          try {
            const { afterCancelEnsureWlRemoved } = await import("./mwlWlCleanup");
            await afterCancelEnsureWlRemoved(row.accessionNumber, removed, {
              billId: opts.billId,
              orderId: opts.orderId,
              reason: "terminal republish guard — stale .wl remove failed",
            });
          } catch {
            /* never block publish path */
          }
        }
      } else {
        written = await writeWorklistFile({
          accessionNumber: row.accessionNumber,
          patientId: row.patientId,
          patientName: row.patientName,
          patientSex: row.patientSex,
          patientDob: row.patientDob,
          patientAge: row.patientAge,
          modality: row.modality,
          studyDescription: row.studyDescription || row.procedureName,
          procedureName: row.procedureName,
          referringDoctor: row.referringDoctor,
          scheduledDate: row.scheduledDate,
          scheduledTime: row.scheduledTime,
          stationAeTitle: row.stationAeTitle ?? stationAeTitle,
          bodyPartExamined: row.bodyPartExamined,
          sourceBillId: row.sourceBillId ?? String(opts.billId),
          sourceOrderId: row.sourceOrderId ?? String(opts.orderId),
        });
        if (written && statusUpper === "SCHEDULED") {
          await db
            .update(radiologyScheduledProceduresTable)
            .set({ status: "SENT_TO_MWL", updatedAt: new Date() })
            .where(eq(radiologyScheduledProceduresTable.id, row.id));
        }
      }
    }

    logger.info(
      {
        accessionNumber,
        billId: opts.billId,
        orderId: opts.orderId,
        written,
        suppressed: publicationSuppressed,
        mwlEnabled: isMwlEnabled(),
        patientName,
        stationAeTitle,
        stationAeSource: stationResolved.source,
        stationAeReason: stationResolved.reason,
        referringDoctor: referring.name,
        referringDoctorId: referring.id,
        bodyPartExamined: bodyPart,
      },
      publicationSuppressed
        ? "mwl: booked line withheld from the modality worklist"
        : "mwl: published radiology study to modality worklist source",
    );

    return {
      scheduled: true,
      written,
      accessionNumber,
      mwlEnabled: isMwlEnabled(),
      suppressed: publicationSuppressed,
    };
  } catch (err) {
    logger.warn({ err, accessionNumber: opts.accessionNumber }, "mwl: publishRadiologyStudyToMwl failed (non-fatal)");
    return empty;
  }
}

/** Convenience: publish from a freshly inserted radiology_studies row. */
export async function publishStudyRowToMwl(studyId: number): Promise<PublishStudyToMwlResult | null> {
  const [study] = await db
    .select({
      id: radiologyStudiesTable.id,
      accessionNumber: radiologyStudiesTable.accessionNumber,
      patientId: radiologyStudiesTable.patientId,
      billId: radiologyStudiesTable.billId,
      orderId: radiologyStudiesTable.orderId,
      modality: radiologyStudiesTable.modality,
      studyDescription: radiologyStudiesTable.studyDescription,
      referringDoctor: radiologyStudiesTable.referringDoctor,
      bodyPart: radiologyStudiesTable.bodyPart,
      stationAeTitle: radiologyStudiesTable.scheduledStationAETitle,
      testId: radiologyStudiesTable.testId,
    })
    .from(radiologyStudiesTable)
    .where(eq(radiologyStudiesTable.id, studyId))
    .limit(1);

  if (!study?.accessionNumber || study.billId == null || study.orderId == null) return null;

  return publishRadiologyStudyToMwl({
    accessionNumber: study.accessionNumber,
    patientId: study.patientId,
    billId: study.billId,
    orderId: study.orderId,
    modality: study.modality,
    studyDescription: study.studyDescription,
    referringDoctor: study.referringDoctor,
    bodyPart: study.bodyPart,
    stationAeTitle: study.stationAeTitle,
    testId: study.testId,
  });
}

/**
 * Re-write one accession's worklist file from its stored procedure row, after a
 * field the modality displays was corrected post-billing (today: the referring
 * doctor from the Reporting Workspace). Terminal procedures are removed rather
 * than re-published, so this can never put a scanned or cancelled patient back
 * on the console. Best-effort — never throws into the caller's response.
 */
export async function republishWorklistForAccession(
  accessionNumber: string | null | undefined,
): Promise<{ attempted: boolean; action: string }> {
  const acc = (accessionNumber ?? "").trim();
  if (!acc || !isMwlEnabled()) return { attempted: false, action: "skipped" };
  try {
    const [row] = await db
      .select()
      .from(radiologyScheduledProceduresTable)
      .where(eq(radiologyScheduledProceduresTable.accessionNumber, acc))
      .limit(1);
    if (!row) return { attempted: false, action: "no_procedure_row" };
    const result = await syncWorklistForStatus(row, row.status);
    logger.info({ accessionNumber: acc, action: result.action }, "mwl: worklist item republished");
    return { attempted: true, action: result.action };
  } catch (err) {
    logger.warn({ err, accessionNumber: acc }, "mwl: republishWorklistForAccession failed (non-fatal)");
    return { attempted: false, action: "failed" };
  }
}
