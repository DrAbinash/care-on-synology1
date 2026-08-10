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
  patientsTable,
  radiologyScheduledProceduresTable,
  radiologyStudiesTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "../logger";
import { isMwlEnabled, writeWorklistFile } from "./mwlWorklistWriter";

function yyyymmdd(d: Date = new Date()): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

function hhmmss(d: Date = new Date()): string {
  return `${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}`;
}

function sexCode(gender: string | null | undefined): string {
  const g = (gender || "").trim().toUpperCase();
  if (g.startsWith("M")) return "M";
  if (g.startsWith("F")) return "F";
  if (g.startsWith("O")) return "O";
  return "";
}

function dobCompact(dob: string | null | undefined): string | null {
  if (!dob) return null;
  const digits = dob.replace(/[^0-9]/g, "");
  if (digits.length >= 8) return digits.slice(0, 8);
  // YYYY-MM-DD
  const m = dob.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}${m[2]}${m[3]}` : null;
}

export type PublishStudyToMwlResult = {
  scheduled: boolean;
  written: boolean;
  accessionNumber: string;
  mwlEnabled: boolean;
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
}): Promise<PublishStudyToMwlResult> {
  const accessionNumber = opts.accessionNumber.trim();
  const empty: PublishStudyToMwlResult = {
    scheduled: false,
    written: false,
    accessionNumber,
    mwlEnabled: isMwlEnabled(),
  };
  if (!accessionNumber) return empty;

  try {
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
            patientSex: sexCode(patient?.gender) || null,
            patientAge,
            patientDob: dobCompact(patient?.dateOfBirth),
            modality: opts.modality || null,
            procedureName: opts.procedureName ?? null,
            studyDescription: opts.studyDescription ?? opts.procedureName ?? null,
            referringDoctor: opts.referringDoctor ?? null,
            scheduledDate: yyyymmdd(),
            scheduledTime: hhmmss(),
            stationAeTitle: opts.stationAeTitle ?? null,
            bodyPartExamined: opts.bodyPart ?? null,
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
            patientSex: sexCode(patient?.gender) || null,
            patientAge,
            patientDob: dobCompact(patient?.dateOfBirth),
            modality: opts.modality || null,
            procedureName: opts.procedureName ?? null,
            studyDescription: opts.studyDescription ?? opts.procedureName ?? null,
            referringDoctor: opts.referringDoctor ?? null,
            scheduledDate: yyyymmdd(),
            scheduledTime: hhmmss(),
            stationAeTitle: opts.stationAeTitle ?? null,
            bodyPartExamined: opts.bodyPart ?? null,
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
    if (isMwlEnabled()) {
      written = await writeWorklistFile({
        accessionNumber: row.accessionNumber,
        patientId: row.patientId,
        patientName: row.patientName,
        patientSex: row.patientSex,
        patientDob: row.patientDob,
        modality: row.modality,
        studyDescription: row.studyDescription || row.procedureName,
        procedureName: row.procedureName,
        referringDoctor: row.referringDoctor,
        scheduledDate: row.scheduledDate,
        scheduledTime: row.scheduledTime,
        stationAeTitle: row.stationAeTitle,
        bodyPartExamined: row.bodyPartExamined,
        sourceBillId: row.sourceBillId ?? String(opts.billId),
        sourceOrderId: row.sourceOrderId ?? String(opts.orderId),
      });
      if (written && (row.status || "").toUpperCase() === "SCHEDULED") {
        await db
          .update(radiologyScheduledProceduresTable)
          .set({ status: "SENT_TO_MWL", updatedAt: new Date() })
          .where(eq(radiologyScheduledProceduresTable.id, row.id));
      }
    }

    logger.info(
      {
        accessionNumber,
        billId: opts.billId,
        orderId: opts.orderId,
        written,
        mwlEnabled: isMwlEnabled(),
        patientName,
      },
      "mwl: published radiology study to modality worklist source",
    );

    return {
      scheduled: true,
      written,
      accessionNumber,
      mwlEnabled: isMwlEnabled(),
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
  });
}
