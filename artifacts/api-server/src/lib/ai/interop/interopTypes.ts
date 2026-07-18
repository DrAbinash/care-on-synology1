/**
 * Shared interop types — Phase P4. Pure (no DB/network). The canonical shape a
 * finalized/structured report presents to the SR, FHIR, and viewer mappers.
 */
export interface InteropEvidence {
  seriesInstanceUid?: string | null;
  sopInstanceUid?: string | null;
  frameNumber?: number | null;
  measurementRef?: string | null;
  confidence?: number | null;
}
export interface InteropFinding {
  key: string;
  text: string;
  laterality?: string;
  evidence?: InteropEvidence[];
}
export interface InteropMeasurement {
  id: string;
  value: number;
  unit: string;
}
export interface InteropReport {
  studyInstanceUid: string;
  accessionNumber?: string;
  patientId?: string;
  patientName?: string;
  modality?: string;
  reportId?: number;
  findings: InteropFinding[];
  measurements: InteropMeasurement[];
  impression: string[];
}
