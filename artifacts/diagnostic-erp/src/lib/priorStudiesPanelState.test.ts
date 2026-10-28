import { describe, expect, it } from "vitest";
import { buildPriorStudiesPath, derivePriorPanelState, derivePriorReport } from "./priorStudiesPanelState";

// PR1-B frontend coverage: the prior-studies panels' four user-visible states.
// A failed request must surface as "error" (with retry), never collapse into
// "empty" — that silent collapse is how the dead endpoint went unnoticed.

describe("derivePriorPanelState", () => {
  it("no patient context → no-patient", () => {
    expect(derivePriorPanelState({ patientId: undefined, isLoading: false, isError: false, studyCount: 0 })).toBe("no-patient");
    expect(derivePriorPanelState({ patientId: null, isLoading: true, isError: true, studyCount: 3 })).toBe("no-patient");
  });

  it("loading state wins while the request is in flight", () => {
    expect(derivePriorPanelState({ patientId: 12, isLoading: true, isError: false, studyCount: 0 })).toBe("loading");
  });

  it("a failed request is an error state — NEVER shown as 'no prior studies'", () => {
    expect(derivePriorPanelState({ patientId: 12, isLoading: false, isError: true, studyCount: 0 })).toBe("error");
  });

  it("zero studies with a successful request → empty", () => {
    expect(derivePriorPanelState({ patientId: 12, isLoading: false, isError: false, studyCount: 0 })).toBe("empty");
  });

  it("studies present → populated", () => {
    expect(derivePriorPanelState({ patientId: 12, isLoading: false, isError: false, studyCount: 4 })).toBe("populated");
  });
});

describe("buildPriorStudiesPath", () => {
  it("targets the canonical /api path with patientId and limit", () => {
    expect(buildPriorStudiesPath({ patientId: 42 }))
      .toBe("/api/radiology-copilot/prior-studies?patientId=42&limit=20");
  });

  it("includes excludeStudyId so a study never compares against itself", () => {
    expect(buildPriorStudiesPath({ patientId: 42, limit: 20, excludeStudyId: 7 }))
      .toBe("/api/radiology-copilot/prior-studies?patientId=42&limit=20&excludeStudyId=7");
  });

  it("omits excludeStudyId when absent", () => {
    expect(buildPriorStudiesPath({ patientId: 42, limit: 10, excludeStudyId: null }))
      .toBe("/api/radiology-copilot/prior-studies?patientId=42&limit=10");
  });
});

/**
 * The shapes below are the ones the Reporting Workspace really stores: lifted
 * from `patient_reports.body` of a study signed on the isolated rig, so this is
 * the column as written, not a guess at it.
 */
const WORKSPACE_BODY = [
  '<div class="section-heading">CLINICAL HISTORY</div>',
  "<p>MRI brain requested. Correlate with presenting symptoms.</p>",
  '<div class="section-heading">FINDINGS</div>',
  '<p style="margin:0 0 12px;">Ventricular system and cisternal spaces are normal in size and configuration.<br/>No midline shift is seen.</p>',
  '<div class="section-heading">IMPRESSION</div><ul><li>Normal MRI of the brain.</li><li>No acute intracranial abnormality.</li></ul>',
  '<div class="section-heading">RECOMMENDATION</div>',
  "<p>Clinical correlation advised.</p>",
].join("\n");

describe("derivePriorReport — the signed text, not the markup around it", () => {
  it("shows a workspace-signed prior as Findings and Impression", () => {
    const { sections } = derivePriorReport({
      finalReport: WORKSPACE_BODY,
      impression: "Normal MRI of the brain. No acute intracranial abnormality.",
      testName: "MRI Brain",
    });
    expect(sections.map((s) => s.label)).toEqual(["Findings", "Impression"]);
    expect(sections[0].text).toContain("Ventricular system and cisternal spaces are normal in size and configuration.");
    expect(sections[0].text).toContain("No midline shift is seen.");
    expect(sections[1].text).toContain("Normal MRI of the brain.");
  });

  it("prints no markup anywhere, in the box text or in the text the comparison reads", () => {
    const { sections, plainText } = derivePriorReport({
      finalReport: WORKSPACE_BODY, impression: null, testName: "MRI Brain",
    });
    for (const text of [...sections.map((s) => s.text), plainText]) {
      expect(text, "a report tag is not clinical prose").not.toMatch(/<[a-z]/i);
      expect(text).not.toContain("section-heading");
    }
  });

  it("falls back to the impression column when the stored body has no IMPRESSION section", () => {
    const { sections } = derivePriorReport({
      finalReport: '<div class="section-heading">FINDINGS</div><p>A chronic subdural collection overlies the left hemisphere.</p>',
      impression: "Chronic subdural haematoma over the left hemisphere.",
      testName: "MRI Brain",
    });
    expect(sections).toEqual([
      { label: "Findings", text: "A chronic subdural collection overlies the left hemisphere." },
      { label: "Impression", text: "Chronic subdural haematoma over the left hemisphere." },
    ]);
  });

  it("keeps the plain-text FINDINGS: / IMPRESSION: rows the structured writer stores", () => {
    const { sections } = derivePriorReport({
      finalReport: "FINDINGS: Liver measures 14 cm. No focal lesion.\nIMPRESSION: Normal study.",
      impression: null,
      testName: "US Abdomen",
    });
    expect(sections.map((s) => s.label)).toEqual(["Findings", "Impression"]);
    expect(sections[0].text).toContain("No focal lesion.");
  });

  it("renders an unlabelled historical block as Report rather than nothing", () => {
    const { sections } = derivePriorReport({
      finalReport: "<p>Study performed without intravenous contrast. No acute abnormality identified.</p>",
      impression: null,
      testName: "CT Brain",
    });
    expect(sections).toHaveLength(1);
    expect(sections[0].label).toBe("Report");
    expect(sections[0].text).toContain("No acute abnormality identified.");
  });

  it("reports a study with no report behind it as empty, not as an error", () => {
    expect(derivePriorReport({ finalReport: null, impression: null, testName: "CT Brain" }))
      .toEqual({ sections: [], plainText: "" });
    expect(derivePriorReport(null)).toEqual({ sections: [], plainText: "" });
  });
});
