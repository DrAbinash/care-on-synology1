import { describe, it, expect } from "vitest";
import {
  mapPatient, mapDiagnosticReport, mapObservation, mapReportWithObservations,
  mapServiceRequest, parseParameters, normalizeBirthDate, normalizeGender,
  mapReportStatus, makeSearchBundle, capabilityStatement,
  type PatientRow, type ReportRow,
} from "./fhirMappers";

const PATIENT: PatientRow = {
  id: 42, patientId: "P-0042", firstName: "Asha", lastName: "Rao",
  dateOfBirth: "1990-05-15", gender: "Female", phone: "9876543210", email: "asha@example.com", address: "12 MG Road",
};

describe("normalizeBirthDate", () => {
  it("keeps a full ISO date", () => expect(normalizeBirthDate("1990-05-15")).toBe("1990-05-15"));
  it("keeps year-month and year", () => {
    expect(normalizeBirthDate("1990-05")).toBe("1990-05");
    expect(normalizeBirthDate("1990")).toBe("1990");
  });
  it("drops unparseable free text (age strings are not birthDates)", () => {
    expect(normalizeBirthDate("35 yrs")).toBeUndefined();
    expect(normalizeBirthDate("")).toBeUndefined();
    expect(normalizeBirthDate(null)).toBeUndefined();
  });
});

describe("normalizeGender", () => {
  it("maps CARE free-text to FHIR administrative-gender", () => {
    expect(normalizeGender("Female")).toBe("female");
    expect(normalizeGender("M")).toBe("male");
    expect(normalizeGender("Other")).toBe("other");
    expect(normalizeGender("")).toBe("unknown");
    expect(normalizeGender("banana")).toBe("unknown");
  });
});

describe("mapPatient", () => {
  it("produces a valid FHIR Patient", () => {
    const p = mapPatient(PATIENT);
    expect(p.resourceType).toBe("Patient");
    expect(p.id).toBe("42");
    expect(p.identifier).toEqual([{ system: "urn:care:patient-id", value: "P-0042" }]);
    expect(p.gender).toBe("female");
    expect(p.birthDate).toBe("1990-05-15");
    expect(p.telecom).toEqual([
      { system: "phone", value: "9876543210" },
      { system: "email", value: "asha@example.com" },
    ]);
    expect(p.name?.[0]?.family).toBe("Rao");
    expect(p.name?.[0]?.given).toEqual(["Asha"]);
  });

  it("omits optional fields when blank", () => {
    const p = mapPatient({ ...PATIENT, email: null, address: null, dateOfBirth: "not a date" });
    expect(p.telecom).toEqual([{ system: "phone", value: "9876543210" }]);
    expect(p.address).toBeUndefined();
    expect(p.birthDate).toBeUndefined();
  });
});

describe("parseParameters", () => {
  it("parses a JSON array, tolerating null/garbage", () => {
    expect(parseParameters(null)).toEqual([]);
    expect(parseParameters("not json")).toEqual([]);
    expect(parseParameters('{"not":"array"}')).toEqual([]);
    expect(parseParameters('[{"name":"Hb","value":"12.5","unit":"g/dL"}]')).toHaveLength(1);
  });
});

describe("mapObservation", () => {
  it("emits valueQuantity for numeric values with a unit", () => {
    const o = mapObservation(7, 0, { name: "Hb", value: "12.5", unit: "g/dL", refRange: "12-15", flag: "L" }, 42, "verified");
    expect(o.id).toBe("7-0");
    expect(o.status).toBe("final");
    expect(o.valueQuantity).toEqual({ value: 12.5, unit: "g/dL" });
    expect(o.valueString).toBeUndefined();
    expect(o.referenceRange).toEqual([{ text: "12-15" }]);
    expect(o.interpretation?.[0]?.coding?.[0]?.code).toBe("L");
    expect(o.subject.reference).toBe("Patient/42");
  });

  it("emits valueString for non-numeric values", () => {
    const o = mapObservation(7, 1, { name: "Blood group", value: "O+", unit: null, refRange: null, flag: null }, 42, "draft");
    expect(o.valueString).toBe("O+");
    expect(o.valueQuantity).toBeUndefined();
    expect(o.status).toBe("preliminary"); // draft report → preliminary observation
    expect(o.interpretation).toBeUndefined();
  });

  it("falls back to a text interpretation for unknown flags", () => {
    const o = mapObservation(7, 2, { name: "X", value: "1", flag: "weird-flag" }, 42, "verified");
    expect(o.interpretation).toEqual([{ text: "weird-flag" }]);
  });
});

describe("mapDiagnosticReport", () => {
  const REPORT: ReportRow = {
    id: 7, reportNumber: "RPT-20260101-001", type: "pathology", patientId: 42,
    title: "Complete Blood Count", impression: "Mild anaemia", status: "verified",
    parameters: '[{"name":"Hb","value":"10.5","unit":"g/dL","refRange":"12-15","flag":"L"},{"name":"WBC","value":"7000","unit":"/uL"}]',
    signedAt: new Date("2026-01-01T09:00:00Z"), verifiedAt: new Date("2026-01-01T10:00:00Z"),
  };

  it("maps status, category, conclusion and result references", () => {
    const r = mapDiagnosticReport(REPORT, { testCode: "CBC", testName: "Complete Blood Count" });
    expect(r.status).toBe("final");
    expect(r.category?.[0]?.coding?.[0]?.code).toBe("LAB");
    expect(r.conclusion).toBe("Mild anaemia");
    expect(r.code.coding?.[0]).toEqual({ system: "urn:care:test-code", code: "CBC", display: "Complete Blood Count" });
    expect(r.result).toEqual([{ reference: "Observation/7-0" }, { reference: "Observation/7-1" }]);
    expect(r.issued).toBe("2026-01-01T10:00:00.000Z"); // verifiedAt preferred for issued
    expect(r.subject.reference).toBe("Patient/42");
  });

  it("uses RAD category for radiology reports", () => {
    const r = mapDiagnosticReport({ ...REPORT, type: "radiology", parameters: null });
    expect(r.category?.[0]?.coding?.[0]?.code).toBe("RAD");
    expect(r.result).toBeUndefined();
  });

  it("mapReportWithObservations returns report + one observation per parameter", () => {
    const { report, observations } = mapReportWithObservations(REPORT);
    expect(report.result).toHaveLength(2);
    expect(observations).toHaveLength(2);
    expect(observations[0]?.id).toBe("7-0");
    expect(observations[0]?.valueQuantity?.value).toBe(10.5);
    expect(observations[1]?.valueQuantity?.value).toBe(7000);
  });
});

describe("mapReportStatus", () => {
  it("maps CARE lifecycle to FHIR report status", () => {
    expect(mapReportStatus("draft")).toBe("partial");
    expect(mapReportStatus("pending_verification")).toBe("preliminary");
    expect(mapReportStatus("verified")).toBe("final");
    expect(mapReportStatus("delivered")).toBe("final");
    expect(mapReportStatus("weird")).toBe("unknown");
  });
});

describe("mapServiceRequest", () => {
  it("maps an ordered test to an active ServiceRequest", () => {
    const sr = mapServiceRequest(
      { id: 5, status: "active", displayName: null },
      { orderNumber: "ORD-2026-0001", patientId: 42, createdAt: new Date("2026-01-01T08:00:00Z") },
      { testCode: "CBC", testName: "Complete Blood Count" },
    );
    expect(sr.resourceType).toBe("ServiceRequest");
    expect(sr.status).toBe("active");
    expect(sr.intent).toBe("order");
    expect(sr.identifier).toEqual([{ system: "urn:care:order-number", value: "ORD-2026-0001" }]);
    expect(sr.code?.text).toBe("Complete Blood Count");
    expect(sr.authoredOn).toBe("2026-01-01T08:00:00.000Z");
  });

  it("maps a cancelled test to revoked", () => {
    const sr = mapServiceRequest({ id: 5, status: "cancelled" }, { orderNumber: "O", patientId: 1 });
    expect(sr.status).toBe("revoked");
  });
});

describe("makeSearchBundle + capabilityStatement", () => {
  it("wraps resources in a searchset Bundle with fullUrls", () => {
    const b = makeSearchBundle([mapPatient(PATIENT)], "https://care.example/fhir");
    expect(b.type).toBe("searchset");
    expect(b.total).toBe(1);
    expect(b.entry[0]?.fullUrl).toBe("https://care.example/fhir/Patient/42");
  });

  it("emits a FHIR R4 CapabilityStatement", () => {
    const cs = capabilityStatement("https://care.example/fhir");
    expect(cs.resourceType).toBe("CapabilityStatement");
    expect(cs.fhirVersion).toBe("4.0.1");
  });
});
