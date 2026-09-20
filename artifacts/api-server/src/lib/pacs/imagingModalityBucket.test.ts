import { describe, expect, it } from "vitest";
import {
  classifyDiagnosticService,
  classifyImagingBucket,
  isPathologyService,
  MODALITY_DISPLAY_LABEL,
  resolveModalityQuery,
} from "./imagingModalityBucket";

describe("classifyImagingBucket", () => {
  it("maps DICOM MR to MRI", () => {
    expect(classifyImagingBucket({ modality: "MR" })).toBe("MRI");
  });

  it("maps US and USG department", () => {
    expect(classifyImagingBucket({ modality: "US" })).toBe("USG");
    expect(classifyImagingBucket({ modality: "OT", department: "USG" })).toBe("USG");
  });

  it("maps CT", () => {
    expect(classifyImagingBucket({ modality: "CT" })).toBe("CT");
  });

  it("maps CT Scan department from catalog seed", () => {
    expect(classifyImagingBucket({ department: "CT Scan" })).toBe("CT");
    expect(classifyImagingBucket({ department: "ct scan" })).toBe("CT");
  });

  it("maps CR/DX to X-Ray", () => {
    expect(classifyImagingBucket({ modality: "CR" })).toBe("X-Ray");
    expect(classifyImagingBucket({ modality: "DX", department: "X-Ray" })).toBe("X-Ray");
  });

  it("detects OPG from description or test name", () => {
    expect(classifyImagingBucket({ modality: "CR", studyDescription: "OPG both jaws" })).toBe("OPG");
    expect(classifyImagingBucket({ modality: "CR", testName: "Dental OPG" })).toBe("OPG");
  });

  it("returns null for pathology", () => {
    expect(classifyImagingBucket({ modality: "OT", department: "Pathology" })).toBeNull();
  });
});

describe("isPathologyService / classifyDiagnosticService", () => {
  it("consolidates pathology departments into Pathology", () => {
    expect(isPathologyService({ department: "Pathology" })).toBe(true);
    expect(isPathologyService({ department: "Biochemistry", category: "Lab" })).toBe(true);
    expect(isPathologyService({ category: "Pathology", department: "Clinical Pathology" })).toBe(true);
    expect(classifyDiagnosticService({ department: "Pathology", testName: "CBC" })).toBe("Pathology");
  });

  it("never double-counts imaging as pathology", () => {
    expect(isPathologyService({ department: "MRI", category: "Pathology" })).toBe(false);
    expect(classifyDiagnosticService({ department: "MRI", testName: "MRI Brain" })).toBe("MRI");
  });

  it("excludes OPD / ECG from pathology consolidation", () => {
    expect(isPathologyService({ department: "OPD" })).toBe(false);
    expect(isPathologyService({ department: "ECG" })).toBe(false);
    expect(classifyDiagnosticService({ department: "OPD" })).toBeNull();
  });
});

describe("resolveModalityQuery", () => {
  it("accepts MRI / USG / OPG", () => {
    expect(resolveModalityQuery("MRI")).toBe("MRI");
    expect(resolveModalityQuery("usg")).toBe("USG");
    expect(resolveModalityQuery("OPG")).toBe("OPG");
  });

  it("accepts CT and CT Scan aliases", () => {
    expect(resolveModalityQuery("CT")).toBe("CT");
    expect(resolveModalityQuery("CT Scan")).toBe("CT");
    expect(resolveModalityQuery("ctscan")).toBe("CT");
  });

  it("accepts X-Ray aliases", () => {
    expect(resolveModalityQuery("X-Ray")).toBe("X-Ray");
    expect(resolveModalityQuery("XRay")).toBe("X-Ray");
    expect(resolveModalityQuery("x ray")).toBe("X-Ray");
  });

  it("accepts Pathology aliases", () => {
    expect(resolveModalityQuery("Pathology")).toBe("Pathology");
    expect(resolveModalityQuery("path")).toBe("Pathology");
  });

  it("rejects unknown values", () => {
    expect(resolveModalityQuery("")).toBeNull();
    expect(resolveModalityQuery(undefined)).toBeNull();
    expect(resolveModalityQuery("OPD")).toBeNull();
  });
});

describe("MODALITY_DISPLAY_LABEL", () => {
  it("uses clinic-facing CT Scan label", () => {
    expect(MODALITY_DISPLAY_LABEL.CT).toBe("CT Scan");
    expect(MODALITY_DISPLAY_LABEL.MRI).toBe("MRI");
    expect(MODALITY_DISPLAY_LABEL.USG).toBe("USG");
    expect(MODALITY_DISPLAY_LABEL["X-Ray"]).toBe("X-Ray");
    expect(MODALITY_DISPLAY_LABEL.Pathology).toBe("Pathology");
  });
});
