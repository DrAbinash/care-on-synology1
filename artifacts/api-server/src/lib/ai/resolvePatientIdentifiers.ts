/**
 * resolvePatientIdentifiers.ts — who the image must NOT show.
 *
 * The de-identification gate asks whether a raster displays this patient's own
 * name, date of birth, MRN or accession. That question is unanswerable without
 * knowing the patient, and the answer must come from the database, not from the
 * browser: a client-supplied identity would let a caller declare any patient's
 * name to be "not this patient's" and sail the check through.
 *
 * WHY AN UNRESOLVED PATIENT IS A REFUSAL, NOT AN EMPTY LIST
 * This is the fail-open this module exists to prevent. Returning
 * `{ patientName: null, dateOfBirth: null, … }` would leave the matcher with
 * nothing to look for, so every image would come back `clean` and egress — a
 * control that is silently always-yes. A study with no matched patient row
 * (the worklist allows `patientId` to be null) therefore produces no proof, and
 * the gate turns that into a refusal.
 *
 * `nameVariants` is deliberate: a burned-in overlay may carry the surname only,
 * or "Singh A", or the full name, and the matcher needs all of them to be
 * forbidden. The phone number is included because a phone in an overlay is an
 * identifier even though the generic detector may not catch a local format.
 */
import { eq } from "drizzle-orm";
import { db, patientsTable, radiologyWorklistTable } from "@workspace/db";
import type { PatientIdentifiers } from "./imageDeidentification";

export type ResolvedEgressIdentity =
  | { ok: true; identifiers: PatientIdentifiers; resolvedFrom: "patient_row" }
  | { ok: false; reason: string };

export function identifiersFromPatientRow(row: {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  patientId: string;
  phone?: string | null;
}): PatientIdentifiers {
  const first = (row.firstName ?? "").trim();
  const last = (row.lastName ?? "").trim();
  const full = [first, last].filter(Boolean).join(" ");
  return {
    // The overlay may render any of these forms, so all three are forbidden.
    patientName: full || null,
    firstName: first || null,
    lastName: last || null,
    dateOfBirth: row.dateOfBirth?.trim() || null,
    mrn: row.patientId?.trim() || null,
    patientId: row.patientId?.trim() || null,
    extraForbiddenTerms: [row.phone?.trim(), first ? `${first.charAt(0)}. ${last}` : null]
      .filter((t): t is string => typeof t === "string" && t.length >= 3),
  };
}

/**
 * Resolve the identity a selected image is forbidden to display.
 *
 * `accessionNumber` comes from the worklist row, not the patient row, because it
 * is what a PACS overlay most often prints.
 */
export async function resolvePatientIdentifiersForEgress(opts: {
  patientId: number | null;
  worklistId: number | null;
}): Promise<ResolvedEgressIdentity> {
  const { patientId, worklistId } = opts;

  if (patientId == null) {
    // No patient means no forbidden strings, which means a vacuous pass. Refuse.
    return {
      ok: false,
      reason:
        "this study is not linked to a patient record, so the images cannot be verified to be free of the patient's identifiers",
    };
  }

  const [patient] = await db
    .select({
      firstName: patientsTable.firstName,
      lastName: patientsTable.lastName,
      dateOfBirth: patientsTable.dateOfBirth,
      patientId: patientsTable.patientId,
      phone: patientsTable.phone,
    })
    .from(patientsTable)
    .where(eq(patientsTable.id, patientId))
    .limit(1);

  if (!patient) {
    return {
      ok: false,
      reason: "the patient record behind this study could not be read, so image identifiers could not be checked",
    };
  }

  const identifiers = identifiersFromPatientRow(patient);

  if (worklistId != null) {
    const [wl] = await db
      .select({ accessionNumber: radiologyWorklistTable.accessionNumber })
      .from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.id, worklistId))
      .limit(1);
    if (wl?.accessionNumber?.trim()) {
      identifiers.accessionNumber = wl.accessionNumber.trim();
    }
  }

  // A patient with no usable name and no date of birth is the same vacuous-pass
  // risk as no patient at all. `patient_id` alone is usually enough for the
  // common overlay, so require at least one real forbidden value.
  const hasAnythingToMatch = Boolean(
    identifiers.patientName
    || identifiers.dateOfBirth
    || identifiers.mrn
    || identifiers.accessionNumber,
  );
  if (!hasAnythingToMatch) {
    return {
      ok: false,
      reason: "the patient record carries no name, date of birth or identifier to check the images against",
    };
  }

  return { ok: true, identifiers, resolvedFrom: "patient_row" };
}
