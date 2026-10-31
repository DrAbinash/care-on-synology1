/**
 * dicomPatientCreator.ts — resolve a DICOM study to an EXISTING CARE patient.
 *
 * Despite the name, this module no longer creates patients. It used to, and the
 * name+DOB merge below could never stop it: intake passes the caret-stripped
 * display name, so parseDicomName yields an empty firstName and that branch is
 * skipped, and the DICOM payload carries no PatientBirthDate to fall back on.
 * Every unseen modality PatientID therefore inserted a placeholder patient
 * (UHID copied from the scanner, first_name "Unknown", phone "0000000000", DOB
 * "1900-01-01"), which was then bound to a study by name alone while the same
 * intake pass scored that study RED for unresolved identity. Intake now links
 * or leaves the study unlinked; creation belongs to Bill Desk, where a human
 * and a price exist.
 */
import { db } from "@workspace/db";
import { patientsTable } from "@workspace/db/schema";
import { eq, ilike, and, inArray } from "drizzle-orm";
import { pickUhidMatchedPatient, uhidLookupCandidates } from "./dicomPatientCreatorPure";

export type DicomDemographics = {
  patientId?: string;       // DICOM PatientID (0010,0020)
  patientName?: string;     // DICOM PatientName (0010,0010) — "Last^First^Middle"
  sex?: string;             // DICOM PatientSex (0010,0040) — M/F/O
  age?: string;             // DICOM PatientAge (0010,1010) — "034Y"
  dateOfBirth?: string;     // DICOM PatientBirthDate (0010,0030) — "YYYYMMDD"
  referringPhysician?: string; // DICOM ReferringPhysicianName (0008,0090)
  studyDate?: string;       // DICOM StudyDate (0008,0020)
  modality?: string;      // DICOM Modality (0008,0060)
};

function parseDicomName(raw?: string): { firstName: string; lastName: string } {
  if (!raw) return { firstName: "Unknown", lastName: "" };
  // DICOM PatientName format: "LastName^FirstName^MiddleName"
  const parts = raw.split("^").map((s) => s.trim());
  return {
    lastName: parts[0] || "",
    firstName: parts[1] || "",
  };
}

function parseDicomDate(raw?: string): string {
  if (!raw || raw.length !== 8) return "";
  // "YYYYMMDD" → "YYYY-MM-DD"
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

function parseDicomSex(raw?: string): string {
  const map: Record<string, string> = { M: "male", F: "female", O: "other" };
  return map[raw?.toUpperCase() ?? ""] || "other";
}

/**
 * Search for an existing patient using merge-safety heuristics.
 * Returns the matching patient row or null.
 */
export async function findExistingPatient(
  demo: DicomDemographics,
): Promise<typeof patientsTable.$inferSelect | null> {
  // 1. Scanner PatientID → our UHID, tolerating the "P-" and zero-padding a
  //    console drops. The scan's own name must corroborate the number: see
  //    pickUhidMatchedPatient for what happened when it did not.
  if (demo.patientId) {
    const candidates = uhidLookupCandidates(demo.patientId);
    if (candidates.length) {
      const rows = await db
        .select()
        .from(patientsTable)
        .where(inArray(patientsTable.patientId, candidates))
        .limit(2);
      const matched = pickUhidMatchedPatient(rows, demo.patientName);
      if (matched) return matched;
    }
  }

  // 2. Name + DOB match (high confidence). Never merge on name alone —
  // two real patients can share a name. Ambiguous name+DOB stays unmatched
  // so Match Center can resolve it; a new intake row is created instead.
  const { firstName, lastName } = parseDicomName(demo.patientName);
  const dob = parseDicomDate(demo.dateOfBirth);
  if (firstName && lastName && dob) {
    const byNameDob = await db
      .select()
      .from(patientsTable)
      .where(
        and(
          ilike(patientsTable.firstName, firstName),
          ilike(patientsTable.lastName, lastName),
          eq(patientsTable.dateOfBirth, dob),
        ),
      );
    if (byNameDob.length === 1) {
      const row = byNameDob[0]!;
      const dicomSex = parseDicomSex(demo.sex);
      if (demo.sex && row.gender && dicomSex !== "other" && row.gender !== dicomSex) {
        return null;
      }
      return row;
    }
  }

  return null;
}
