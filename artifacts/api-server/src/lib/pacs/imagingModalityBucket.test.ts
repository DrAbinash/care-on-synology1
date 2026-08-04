import { describe, expect, it } from "vitest";
import { classifyImagingBucket } from "./imagingModalityBucket";

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
