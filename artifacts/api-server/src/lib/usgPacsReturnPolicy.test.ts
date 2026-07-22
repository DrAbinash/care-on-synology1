import { describe, it, expect } from "vitest";
import {
  planUsgPacsReturn, type PacsReturnStudyState, type PacsReturnReportState,
} from "./usgPacsReturnPolicy";

const study = (over: Partial<PacsReturnStudyState> = {}): PacsReturnStudyState => ({
  studyId: 1,
  studyInstanceUid: "1.2.3.4",
  accessionNumber: "ACC1",
  patientId: 42,
  patientName: "Jane Doe",
  patientDisplayId: "P42",
  modality: "US",
  isObstetric: false,
  studyDate: "2024-06-01",
  referringDoctor: "Dr Ref",
  ...over,
});

const report = (over: Partial<PacsReturnReportState> = {}): PacsReturnReportState => ({
  reportId: 100, status: "final", sequenceNumber: 1, supersededByReportId: null, ...over,
});

describe("P6.1 usgPacsReturnPolicy — fail-closed eligibility", () => {
  it("allows a finalized non-OB report and builds canonical encapsulated-PDF tags", () => {
    const d = planUsgPacsReturn(study(), report());
    expect(d.eligible).toBe(true);
    expect(d.tags?.SOPClassUID).toBe("1.2.840.10008.5.1.4.1.1.104.1");
    expect(d.tags?.Modality).toBe("OT");
    expect(d.tags?.StudyInstanceUID).toBe("1.2.3.4");
    expect(d.tags?.PatientID).toBe("P42");
    expect(d.idempotencyKey).toBe("usg-pacs:1.2.3.4:100:1");
  });

  it("blocks a draft / non-finalized report", () => {
    const d = planUsgPacsReturn(study(), report({ status: "draft" }));
    expect(d.eligible).toBe(false);
    expect(d.blockReasons).toContain("not_finalized");
    expect(d.tags).toBeNull();
  });

  it("blocks when there is no report", () => {
    const d = planUsgPacsReturn(study(), report({ reportId: null, status: null }));
    expect(d.eligible).toBe(false);
    expect(d.blockReasons).toContain("no_report");
  });

  it("never auto-returns a superseded version", () => {
    const d = planUsgPacsReturn(study(), report({ supersededByReportId: 200 }));
    expect(d.eligible).toBe(false);
    expect(d.blockReasons).toContain("superseded_report");
  });

  it("blocks when the study has no StudyInstanceUID (never fabricates identity)", () => {
    const d = planUsgPacsReturn(study({ studyInstanceUid: null }), report());
    expect(d.eligible).toBe(false);
    expect(d.blockReasons).toContain("no_study_uid");
  });
});

describe("P6.1 usgPacsReturnPolicy — PCPNDT gate (obstetric, fail-closed)", () => {
  it("blocks an OB study when PCPNDT was not evaluated (missing = blocked)", () => {
    const d = planUsgPacsReturn(study({ isObstetric: true }), report());
    expect(d.eligible).toBe(false);
    expect(d.blockReasons).toContain("pcpndt_missing");
  });

  it("blocks an OB study when PCPNDT is not compliant, surfacing its errors", () => {
    const d = planUsgPacsReturn(study({ isObstetric: true }), report(), {
      compliant: false, errors: ["ID Card must be verified."],
    });
    expect(d.eligible).toBe(false);
    expect(d.blockReasons).toContain("pcpndt_not_compliant");
    expect(d.errors).toContain("ID Card must be verified.");
  });

  it("allows an OB study only when PCPNDT is compliant", () => {
    const d = planUsgPacsReturn(study({ isObstetric: true }), report(), { compliant: true, errors: [] });
    expect(d.eligible).toBe(true);
    expect(d.tags).not.toBeNull();
  });

  it("does NOT apply the PCPNDT gate to a non-obstetric study", () => {
    const d = planUsgPacsReturn(study({ isObstetric: false }), report());
    expect(d.eligible).toBe(true);
    expect(d.blockReasons).not.toContain("pcpndt_missing");
  });
});

describe("P6.1 usgPacsReturnPolicy — amended version labelling", () => {
  it("labels an amended series and keys idempotency per version", () => {
    const d = planUsgPacsReturn(study(), report({ reportId: 105, sequenceNumber: 2 }));
    expect(d.tags?.SeriesDescription).toMatch(/amended v2/);
    expect(d.idempotencyKey).toBe("usg-pacs:1.2.3.4:105:2");
  });
});
