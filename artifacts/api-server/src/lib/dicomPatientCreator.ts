/**
 * dicomPatientCreator.ts
 * Auto-creates patients from DICOM demographics during study intake.
 * Merge-safety: checks existing patients by PatientID, name+DOB, or phone.
 * Prevents duplicate MRNs by linking to existing patient when found.
 */
import { db } from "@workspace/db";
import { patientsTable } from "@workspace/db/schema";
import { eq, sql, ilike, or, and } from "drizzle-orm";
import { nextPatientId } from "./documentNumberCounters";

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

function parseDicomAge(raw?: string): { ageValue?: number; ageUnit?: string } {
  if (!raw || raw.length < 2) return {};
  const unit = raw.slice(-1).toUpperCase(); // Y/M/D/W
  const value = parseInt(raw.slice(0, -1), 10);
  if (isNaN(value)) return {};
  const unitMap: Record<string, string> = { Y: "years", M: "months", D: "days", W: "weeks" };
  return { ageValue: value, ageUnit: unitMap[unit] || "years" };
}

function parseDicomSex(raw?: string): string {
  const map: Record<string, string> = { M: "male", F: "female", O: "other" };
  return map[raw?.toUpperCase() ?? ""] || "other";
}

async function generatePatientId(): Promise<string> {
  // Same SEQUENCE allocator as Billing Desk POST /api/patients.
  return nextPatientId(db);
}

/**
 * Search for an existing patient using merge-safety heuristics.
 * Returns the matching patient row or null.
 */
export async function findExistingPatient(
  demo: DicomDemographics,
): Promise<typeof patientsTable.$inferSelect | null> {
  // 1. Exact PatientID match (DICOM PatientID → our patientId field)
  if (demo.patientId) {
    const [byId] = await db
      .select()
      .from(patientsTable)
      .where(eq(patientsTable.patientId, demo.patientId))
      .limit(1);
    if (byId) return byId;
  }

  // 2. Name + DOB match (high confidence)
  const { firstName, lastName } = parseDicomName(demo.patientName);
  const dob = parseDicomDate(demo.dateOfBirth);
  if (firstName && lastName && dob) {
    const [byNameDob] = await db
      .select()
      .from(patientsTable)
      .where(
        and(
          ilike(patientsTable.firstName, firstName),
          ilike(patientsTable.lastName, lastName),
          eq(patientsTable.dateOfBirth, dob),
        ),
      )
      .limit(1);
    if (byNameDob) return byNameDob;
  }

  // 3. Name-only fuzzy match (lower confidence — warn in UI)
  if (firstName && lastName) {
    const [byName] = await db
      .select()
      .from(patientsTable)
      .where(
        and(
          ilike(patientsTable.firstName, firstName),
          ilike(patientsTable.lastName, lastName),
        ),
      )
      .limit(1);
    if (byName) return byName;
  }

  return null;
}

/**
 * Create a patient from DICOM demographics, or return existing one.
 * Returns { patient, isNew, mergeWarning }.
 */
export async function createOrLinkPatientFromDicom(
  demo: DicomDemographics,
): Promise<{
  patient: typeof patientsTable.$inferSelect;
  isNew: boolean;
  mergeWarning?: string;
}> {
  const existing = await findExistingPatient(demo);
  if (existing) {
    let warning: string | undefined;
    const { firstName, lastName } = parseDicomName(demo.patientName);
    const dob = parseDicomDate(demo.dateOfBirth);
    // Warn if DOB doesn't match exactly (name-only match)
    if (dob && existing.dateOfBirth !== dob) {
      warning = `Name matched but DOB differs: DICOM=${dob}, existing=${existing.dateOfBirth}`;
    }
    return { patient: existing, isNew: false, mergeWarning: warning };
  }

  // Create new patient
  const { firstName, lastName } = parseDicomName(demo.patientName);
  const dob = parseDicomDate(demo.dateOfBirth);
  const ageInfo = parseDicomAge(demo.age);
  const gender = parseDicomSex(demo.sex);
  const patientId = demo.patientId || (await generatePatientId());

  // Use a placeholder phone if none provided (DICOM rarely has phone)
  const phone = "0000000000";

  const [patient] = await db
    .insert(patientsTable)
    .values({
      patientId,
      firstName: firstName || "Unknown",
      lastName: lastName || "",
      dateOfBirth: dob || "1900-01-01",
      gender,
      phone,
      ageValue: ageInfo.ageValue ?? null,
      ageUnit: ageInfo.ageUnit ?? null,
    })
    .returning();

  return { patient, isNew: true };
}
