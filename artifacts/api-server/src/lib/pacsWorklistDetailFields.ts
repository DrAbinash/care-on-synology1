/**
 * Explicit field selection for GET /api/radiology/pacs-worklist/:id.
 * Includes dicomMetadata + demographics for selected-study hydration.
 * Does NOT include aiDraftJson — callers use /ai-draft for drafts.
 */
import { patientsTable, radiologyWorklistTable } from "@workspace/db/schema";

export const PACS_WORKLIST_DETAIL_SELECT = {
  id: radiologyWorklistTable.id,
  studyId: radiologyWorklistTable.studyId,
  patientId: radiologyWorklistTable.patientId,
  // The clinic UHID, read off the patients master through this row's own link.
  // The list payload carries the same column, but a queue filter can hide the
  // open study from it — and a printed report cannot fall back to the numeric
  // `patientId` above, which is a sequence value, not an identifier.
  uhid: patientsTable.patientId,
  dicomPatientId: radiologyWorklistTable.dicomPatientId,
  patientName: radiologyWorklistTable.patientName,
  age: radiologyWorklistTable.age,
  sex: radiologyWorklistTable.sex,
  modality: radiologyWorklistTable.modality,
  studyDescription: radiologyWorklistTable.studyDescription,
  studyDate: radiologyWorklistTable.studyDate,
  accessionNumber: radiologyWorklistTable.accessionNumber,
  studyInstanceUID: radiologyWorklistTable.studyInstanceUID,
  // D1: how the UID above was obtained. Returned on the detail read so a
  // caller (and the viewer's unresolved panel) can tell a modality-supplied
  // binding from one recorded before provenance tracking, instead of inferring
  // authority from the UID merely being present.
  studyUidProvenance: radiologyWorklistTable.studyUidProvenance,
  referringDoctor: radiologyWorklistTable.referringDoctor,
  status: radiologyWorklistTable.status,
  // The report this study is bound to, and where it has got to. `status` alone
  // cannot tell a signed report from a study whose finalize died after the row
  // was created and bound but before the status flipped — and that half-state is
  // what a lost response to POST /api/patient-reports leaves behind. The
  // workspace reads this row to decide what to offer, so without these two
  // columns a reopened signed study shows no Print/PDF control, and a caller
  // retrying an interrupted finalize has no way to learn that its own previous
  // click already wrote the row.
  reportId: radiologyWorklistTable.reportId,
  deliveryStatus: radiologyWorklistTable.deliveryStatus,
  dicomMetadata: radiologyWorklistTable.dicomMetadata,
  createdAt: radiologyWorklistTable.createdAt,
  updatedAt: radiologyWorklistTable.updatedAt,
} as const;

/** Keys that must never appear on the narrow detail response. */
export const PACS_WORKLIST_DETAIL_OMIT = ["aiDraftJson"] as const;
