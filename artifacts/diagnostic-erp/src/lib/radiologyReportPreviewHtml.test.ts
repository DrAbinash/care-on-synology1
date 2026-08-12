import { describe, it, expect } from "vitest";
import { buildPreviewHtml, fmtHeading, formatReportExportError } from "./radiologyReportPreviewHtml";

describe("buildPreviewHtml", () => {
  it("includes demographics, study name, technique, and findings", () => {
    const html = buildPreviewHtml({
      patientName: "Test Patient",
      age: "40",
      sex: "F",
      accessionNumber: "A1",
      referringDoctor: "Dr X",
      studyDate: "2026-01-01",
      studyName: "MRI BRAIN WITH CERVICAL SPINE",
      technique: "Multiplanar MRI of brain and cervical spine.",
      clinicalHistory: "Neck pain",
      findingsMap: {},
      rawFindings: "Brain normal.\nCervical spine normal.",
      useStructured: false,
      impression: ["No significant abnormality"],
      recommendation: "Clinical correlation.",
      imageRefs: [],
    });
    expect(html).toContain("Test Patient");
    expect(html).toContain("MRI BRAIN WITH CERVICAL SPINE");
    expect(html).toContain("Multiplanar MRI");
    expect(html).toContain("Neck pain");
    expect(html).toContain("Brain normal.");
    expect(html).toContain("No significant abnormality");
  });

  it("formats headings by case preference", () => {
    expect(fmtHeading("Technique", "all_caps")).toBe("TECHNIQUE");
    expect(fmtHeading("technique", "title_case")).toBe("Technique");
  });
});

describe("formatReportExportError", () => {
  it("maps chunk load failures to a reload hint", () => {
    expect(formatReportExportError(new Error("Loading chunk 12 failed"), "Word")).toMatch(/Reload/);
  });
});
