/**
 * Explicit field selection for GET /api/radiology/pacs-worklist/:id.
 * Includes dicomMetadata + demographics for selected-study hydration.
 * Does NOT include aiDraftJson — callers use /ai-draft for drafts.
 */
import { radiologyWorklistTable } from "@workspace/db/schema";

export const PACS_WORKLIST_DETAIL_SELECT = {
  id: radiologyWorklistTable.id,
  studyId: radiologyWorklistTable.studyId,
  patientId: radiologyWorklistTable.patientId,
  dicomPatientId: radiologyWorklistTable.dicomPatientId,
  patientName: radiologyWorklistTable.patientName,
  age: radiologyWorklistTable.age,
  sex: radiologyWorklistTable.sex,
  modality: radiologyWorklistTable.modality,
  studyDescription: radiologyWorklistTable.studyDescription,
  studyDate: radiologyWorklistTable.studyDate,
  accessionNumber: radiologyWorklistTable.accessionNumber,
  studyInstanceUID: radiologyWorklistTable.studyInstanceUID,
  referringDoctor: radiologyWorklistTable.referringDoctor,
  status: radiologyWorklistTable.status,
  dicomMetadata: radiologyWorklistTable.dicomMetadata,
  createdAt: radiologyWorklistTable.createdAt,
  updatedAt: radiologyWorklistTable.updatedAt,
} as const;

/** Keys that must never appear on the narrow detail response. */
export const PACS_WORKLIST_DETAIL_OMIT = ["aiDraftJson"] as const;
