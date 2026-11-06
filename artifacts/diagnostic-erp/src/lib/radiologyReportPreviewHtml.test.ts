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

describe("the owner's fixed closing statement in the Preview / Word document", () => {
  // This builder is the on-screen Preview pane AND the source Word export converts,
  // so the sentence it prints here is the one that lands in the .doc a referrer is
  // sent. Requirement is exactly once, not merely present.
  const SENTENCE = /Please correlate with clinical findings/g;

  function preview(recommendation: string): string {
    return buildPreviewHtml({
      patientName: "Test Patient",
      age: "40",
      sex: "F",
      accessionNumber: "A1",
      referringDoctor: "Dr X",
      studyDate: "2026-10-27",
      studyName: "MRI BRAIN",
      technique: "Multiplanar MRI of brain.",
      clinicalHistory: "",
      findingsMap: {},
      rawFindings: "Mild small vessel change.",
      useStructured: false,
      impression: ["No acute infarct."],
      recommendation,
      imageRefs: [],
    });
  }

  it("closes the report even when the Recommendations field is empty", () => {
    const html = preview("");
    expect(html).not.toMatch(/<h3[^>]*>\s*<u>\s*RECOMMENDATION/i); // no section invented over nothing
    expect((html.match(SENTENCE) ?? []).length).toBe(1);
  });

  it("keeps the radiologist's own advice and still says it only once", () => {
    const html = preview("Repeat MRI in six weeks with contrast.");
    expect(html).toContain("Repeat MRI in six weeks with contrast.");
    expect((html.match(SENTENCE) ?? []).length).toBe(1);
  });

  it("does not repeat itself when his advice already is that sentence", () => {
    const html = preview("Please correlate with clinical findings.");
    expect((html.match(SENTENCE) ?? []).length).toBe(1);
    // His Recommendation section is untouched; only the footer line steps aside.
    expect(html).toMatch(/RECOMMENDATION/i);
    expect(html).toContain("Report issued by authorized radiologist only.");
  });

  it("is separate from the editable Recommendation section", () => {
    const html = preview("Clinical correlation.");
    const recAt = html.search(/RECOMMENDATION/i);
    const statementAt = html.indexOf("Please correlate with clinical findings.");
    expect(recAt).toBeGreaterThan(-1);
    expect(statementAt).toBeGreaterThan(recAt);
    // The statement is the footer paragraph, not a second advice paragraph.
    expect(html).toMatch(/<p class="closing-statement"[^>]*>Please correlate with clinical findings\./);
  });
});

describe("formatReportExportError", () => {
  it("maps chunk load failures to a reload hint", () => {
    expect(formatReportExportError(new Error("Loading chunk 12 failed"), "Word")).toMatch(/Reload/);
  });
});
