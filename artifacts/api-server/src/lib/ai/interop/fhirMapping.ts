/**
 * FHIR R4 mapping — Phase P4 / Gate G17 (pure).
 *
 * Maps a finalized/structured report to FHIR resources (backend interfaces only —
 * no external send). DiagnosticReport, ImagingStudy, Observation, ServiceRequest.
 * Pure + unit-tested; persistence/logging is done by the service layer.
 */
import type { InteropReport, InteropMeasurement } from "./interopTypes";

const oid = (uid: string) => `urn:oid:${uid}`;

export function toImagingStudy(report: InteropReport): Record<string, unknown> {
  return {
    resourceType: "ImagingStudy",
    status: "available",
    identifier: [{ system: "urn:dicom:uid", value: oid(report.studyInstanceUid) }],
    subject: report.patientId ? { reference: `Patient/${report.patientId}` } : undefined,
    modality: report.modality ? [{ system: "http://dicom.nema.org/resources/ontology/DCM", code: report.modality }] : undefined,
    numberOfSeries: undefined,
  };
}

export function toObservation(report: InteropReport, m: InteropMeasurement): Record<string, unknown> {
  return {
    resourceType: "Observation",
    status: "final",
    category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "imaging" }] }],
    code: { text: m.id },
    subject: report.patientId ? { reference: `Patient/${report.patientId}` } : undefined,
    valueQuantity: { value: m.value, unit: m.unit },
    derivedFrom: [{ display: `ImagingStudy ${report.studyInstanceUid}` }],
  };
}

export function toDiagnosticReport(report: InteropReport): Record<string, unknown> {
  return {
    resourceType: "DiagnosticReport",
    status: "final",
    category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0074", code: "RAD", display: "Radiology" }] }],
    code: { text: report.modality ? `${report.modality} report` : "Radiology report" },
    subject: report.patientId ? { reference: `Patient/${report.patientId}` } : undefined,
    identifier: report.accessionNumber ? [{ system: "urn:care:accession", value: report.accessionNumber }] : undefined,
    imagingStudy: [{ display: `ImagingStudy ${report.studyInstanceUid}` }],
    conclusion: report.impression.join("\n"),
    result: report.measurements.map((m) => ({ display: `Observation ${m.id}=${m.value}${m.unit}` })),
  };
}

export function toServiceRequest(report: InteropReport): Record<string, unknown> {
  return {
    resourceType: "ServiceRequest",
    status: "completed",
    intent: "order",
    category: [{ coding: [{ system: "http://snomed.info/sct", code: "363679005", display: "Imaging" }] }],
    code: { text: report.modality ? `${report.modality} study` : "Imaging study" },
    subject: report.patientId ? { reference: `Patient/${report.patientId}` } : undefined,
    identifier: report.accessionNumber ? [{ system: "urn:care:accession", value: report.accessionNumber }] : undefined,
  };
}

export type FhirResourceType = "DiagnosticReport" | "ImagingStudy" | "Observation" | "ServiceRequest";

/** Build all resources for a report (Observations one-per-measurement). */
export function toFhirBundle(report: InteropReport): Array<{ resourceType: FhirResourceType; resource: Record<string, unknown> }> {
  return [
    { resourceType: "ServiceRequest", resource: toServiceRequest(report) },
    { resourceType: "ImagingStudy", resource: toImagingStudy(report) },
    ...report.measurements.map((m) => ({ resourceType: "Observation" as const, resource: toObservation(report, m) })),
    { resourceType: "DiagnosticReport", resource: toDiagnosticReport(report) },
  ];
}
