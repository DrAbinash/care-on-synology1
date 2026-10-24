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
    expect(html).toContain("TEST PATIENT");
    expect(html).toContain("MRI BRAIN WITH CERVICAL SPINE");
    expect(html).toContain("Multiplanar MRI");
    expect(html).toContain("Neck pain");
    expect(html).toContain("Brain normal.");
    expect(html).toContain("No significant abnormality");
  });

  it("classic header omits blank ACC", () => {
    const html = buildPreviewHtml({
      patientName: "Test Patient",
      age: "",
      sex: "F",
      accessionNumber: "",
      referringDoctor: "Dr X",
      studyDate: "2026-01-01",
      headerStyle: "classic",
      studyName: "CT BRAIN",
      technique: "NCCT.",
      clinicalHistory: "",
      findingsMap: {},
      rawFindings: "Normal.",
      useStructured: false,
      impression: [],
      recommendation: "",
      imageRefs: [],
    });
    expect(html).toContain("REF. BY:");
    expect(html).not.toContain("ACC:");
    expect(html).not.toMatch(/Recommendation/i);
  });

  it("formats headings by case preference", () => {
    expect(fmtHeading("Technique", "all_caps")).toBe("TECHNIQUE");
    expect(fmtHeading("technique", "title_case")).toBe("Technique");
  });

  it("a stale structured map never beats the live text — the same refusal print and PDF make", () => {
    // The map goes stale the moment the radiologist types freeform findings
    // (the sync is one-way). This builder feeds the export preview pane and the
    // Word fallback; printing the scaffold while the editor shows typed
    // sentences is the "stale map beats live text" defect class #1157 closed
    // for print and PDF — this is the third builder, now under the same rule.
    const html = buildPreviewHtml({
      patientName: "Test Patient",
      age: "40",
      sex: "F",
      accessionNumber: "A1",
      referringDoctor: "Dr X",
      studyDate: "2026-01-01",
      studyName: "MRI BRAIN",
      technique: "T.",
      clinicalHistory: "",
      findingsMap: { "Cerebral parenchyma": { text: "Normal.", normal: true } },
      rawFindings: "Typed sentence the map never saw.",
      useStructured: true,
      impression: [],
      recommendation: "",
      imageRefs: [],
    });
    expect(html).toContain("Typed sentence the map never saw.");
    // The label prints case-formatted (fmtHeading, default all_caps).
    expect(html).not.toContain("CEREBRAL PARENCHYMA");
  });

  it("the structured scaffold flow still renders the map when the text is empty", () => {
    const html = buildPreviewHtml({
      patientName: "Test Patient",
      age: "40",
      sex: "F",
      accessionNumber: "A1",
      referringDoctor: "Dr X",
      studyDate: "2026-01-01",
      studyName: "MRI BRAIN",
      technique: "T.",
      clinicalHistory: "",
      findingsMap: { "Cerebral parenchyma": { text: "Normal.", normal: true } },
      rawFindings: "",
      useStructured: true,
      impression: [],
      recommendation: "",
      imageRefs: [],
    });
    expect(html).toContain("CEREBRAL PARENCHYMA");
    expect(html).toContain("Normal.");
  });
});

describe("formatReportExportError", () => {
  it("maps chunk load failures to a reload hint", () => {
    expect(formatReportExportError(new Error("Loading chunk 12 failed"), "Word")).toMatch(/Reload/);
  });
});
