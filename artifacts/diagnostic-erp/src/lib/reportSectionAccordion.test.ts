import { describe, expect, it } from "vitest";
import {
  FINDINGS_TOOLS,
  REPORT_SECTIONS,
  clip,
  countAssisted,
  formatProvenanceSummary,
  nextActiveSection,
  nextFindingsTool,
  provenanceCounts,
  sectionForAltDigit,
  sectionStatuses,
  splitLines,
  summarizeDemography,
  summarizeFieldText,
  summarizeFindings,
  summarizeImpression,
  summarizeRecommendation,
  summarizeRefDoctor,
  summarizeRegion,
  summarizeReport,
  summarizeTechnique,
} from "./reportSectionAccordion";

describe("major section order", () => {
  it("matches the clinical reporting order, nine sections", () => {
    expect(REPORT_SECTIONS.map((s) => s.id)).toEqual([
      "demography",
      "refDoctor",
      "region",
      "history",
      "technique",
      "findings",
      "impression",
      "recommendation",
      "report",
    ]);
  });

  it("maps Alt+1…9 onto those sections and ignores anything else", () => {
    expect(sectionForAltDigit("1")).toBe("demography");
    expect(sectionForAltDigit("6")).toBe("findings");
    expect(sectionForAltDigit("9")).toBe("report");
    expect(sectionForAltDigit("0")).toBeNull();
    expect(sectionForAltDigit("x")).toBeNull();
  });
});

describe("one active section at a time", () => {
  it("opening another section replaces the current one", () => {
    expect(nextActiveSection("demography", "refDoctor")).toBe("refDoctor");
    expect(nextActiveSection("findings", "impression")).toBe("impression");
    expect(nextActiveSection(null, "findings")).toBe("findings");
  });

  it("re-clicking the open header collapses everything (overview mode)", () => {
    expect(nextActiveSection("findings", "findings")).toBeNull();
  });
});

describe("findings assistance drawers", () => {
  it("offers Quick Select, Quick Add, Structured and Suggestions", () => {
    expect(FINDINGS_TOOLS.map((t) => t.id)).toEqual([
      "quickSelect",
      "quickAdd",
      "structured",
      "suggestions",
    ]);
  });

  it("selecting a drawer closes the previous one", () => {
    expect(nextFindingsTool("quickSelect", "quickAdd")).toBe("quickAdd");
    expect(nextFindingsTool("quickAdd", "structured")).toBe("structured");
    expect(nextFindingsTool("structured", "suggestions")).toBe("suggestions");
  });

  it("re-clicking the active tab hides the drawer and returns height to the editor", () => {
    expect(nextFindingsTool("suggestions", "suggestions")).toBeNull();
  });

  it("is independent of the major accordion state", () => {
    // Same helper shape, separate state: closing a drawer never closes Findings.
    expect(nextFindingsTool("quickAdd", "quickAdd")).toBeNull();
    expect(nextActiveSection("findings", "impression")).toBe("impression");
  });
});

describe("collapsed summaries", () => {
  it("demography reads name • age/sex • id", () => {
    expect(
      summarizeDemography({ patientName: "Aarav Kumar", age: "45", sex: "Male", patientCode: "P-00789" }),
    ).toBe("Aarav Kumar • 45/M • P-00789");
  });

  it("demography degrades gracefully when fields are missing", () => {
    expect(summarizeDemography({ patientName: "Aarav Kumar" })).toBe("Aarav Kumar");
    expect(summarizeDemography({})).toBe("No patient loaded");
  });

  it("referring doctor gets a Dr prefix only when missing", () => {
    expect(summarizeRefDoctor("Pradeep KR Jha")).toBe("Dr Pradeep KR Jha");
    expect(summarizeRefDoctor("Dr Pradeep KR Jha")).toBe("Dr Pradeep KR Jha");
    expect(summarizeRefDoctor("")).toBe("Not set");
    expect(summarizeRefDoctor(null)).toBe("Not set");
  });

  it("region shows region • test • protocol status", () => {
    expect(
      summarizeRegion({ regions: ["Brain"], protocolName: "MRI Brain Plain", testName: "MRI Brain" }),
    ).toBe("Brain • MRI Brain • MRI Brain Plain");
  });

  it("region flags a missing protocol and a template mismatch", () => {
    expect(summarizeRegion({ regions: ["Brain"] })).toBe("Brain • protocol not applied");
    expect(summarizeRegion({ regions: ["Brain"], protocolName: "P", templateMismatch: true })).toBe(
      "Brain • template mismatch",
    );
    expect(summarizeRegion({ regions: [] })).toBe("No region • protocol not applied");
  });

  it("region collapses more than two regions", () => {
    expect(summarizeRegion({ regions: ["Brain", "LS Spine", "Neck", "Orbit"] })).toBe(
      "Brain + LS Spine +2 • protocol not applied",
    );
  });

  it("history shows the first line and a remainder count", () => {
    expect(summarizeFieldText("Headache, vomiting", "Not recorded")).toBe("Headache, vomiting");
    expect(summarizeFieldText("Headache\nVomiting\nFever", "Not recorded")).toBe(
      "Headache • +2 more",
    );
    expect(summarizeFieldText("   \n  ", "Not recorded")).toBe("Not recorded");
  });

  it("technique falls back to the protocol name when nothing is written", () => {
    expect(summarizeTechnique({ techniqueText: "MRI 3T standard" })).toBe("MRI 3T standard");
    expect(summarizeTechnique({ techniqueText: "", protocolName: "MRI Brain Plain" })).toBe(
      "MRI Brain Plain • not written",
    );
    expect(summarizeTechnique({ techniqueText: "" })).toBe("Not written");
  });

  it("findings counts lines, assisted segments and warnings", () => {
    const text = Array.from({ length: 14 }, (_, i) => `line ${i + 1}`).join("\n");
    expect(summarizeFindings({ findingsText: text, structured: false, assistedCount: 3, lintCount: 0 })).toBe(
      "14 lines • 3 assisted • no unresolved warnings",
    );
    expect(summarizeFindings({ findingsText: text, structured: false, lintCount: 2 })).toBe(
      "14 lines • 2 warnings",
    );
    expect(summarizeFindings({ findingsText: "", structured: false })).toBe("Empty");
  });

  it("findings reports structured section counts in structured mode", () => {
    expect(
      summarizeFindings({ findingsText: "", structured: true, structuredSectionCount: 5, lintCount: 0 }),
    ).toBe("Structured · 5 sections • no unresolved warnings");
  });

  it("impression shows the line count or the single line", () => {
    expect(summarizeImpression("Acute infarct.")).toBe("Acute infarct.");
    expect(summarizeImpression("Acute infarct.\nOld lacune.")).toBe(
      "2 impression lines • Acute infarct.",
    );
    expect(summarizeImpression("")).toBe("Empty");
  });

  it("recommendation flags a critical finding", () => {
    expect(summarizeRecommendation("Clinical correlation", false)).toBe("Clinical correlation");
    expect(summarizeRecommendation("Clinical correlation", true)).toBe("Clinical correlation • CRITICAL");
  });

  it("report shows layout and paper", () => {
    expect(summarizeReport({ layoutLabel: "Classic" })).toBe("Classic • A4");
    expect(summarizeReport({ layoutLabel: "Premium", imageCount: 3 })).toBe("Premium • A4 • 3 images");
  });

  it("clips long text instead of wrapping the header", () => {
    expect(clip("a".repeat(80), 10)).toBe(`${"a".repeat(9)}…`);
    expect(clip("  spaced    out  ")).toBe("spaced out");
  });

  it("splitLines drops blank lines", () => {
    expect(splitLines("a\n\n  \nb")).toEqual(["a", "b"]);
  });
});

describe("section status ticks", () => {
  const base = {
    hasPatient: true,
    refDoctor: "Dr X",
    regions: ["Brain"],
    clinicalHistoryText: "Headache",
    techniqueText: "MRI 3T",
    findingsText: "Normal.",
    structured: false,
    impressionText: "No acute abnormality.",
    recommendationText: "Clinical correlation.",
    reportReady: true,
  };

  it("marks completed sections done", () => {
    const s = sectionStatuses(base);
    expect(s.demography).toBe("done");
    expect(s.findings).toBe("done");
    expect(s.report).toBe("done");
  });

  it("marks empty sections empty", () => {
    const s = sectionStatuses({ ...base, clinicalHistoryText: "", findingsText: "", reportReady: false });
    expect(s.history).toBe("empty");
    expect(s.findings).toBe("empty");
    expect(s.report).toBe("empty");
  });

  it("raises attention for template mismatch and critical findings", () => {
    const s = sectionStatuses({ ...base, templateMismatch: true, critical: true });
    expect(s.region).toBe("attention");
    expect(s.recommendation).toBe("attention");
  });

  it("counts structured sections as filled findings", () => {
    const s = sectionStatuses({ ...base, findingsText: "", structured: true, structuredSectionCount: 4 });
    expect(s.findings).toBe("done");
  });
});

describe("compact provenance", () => {
  const segments = [
    { kind: "manual", label: "Manual" },
    { kind: "manual", label: "Manual" },
    { kind: "quick-select", label: "Quick Select" },
    { kind: "structured-template", label: "Structured" },
    { kind: "quick-select", label: "Quick Select" },
    { kind: "quick-select", label: "Quick Select" },
  ];

  it("counts per source kind, most frequent first", () => {
    expect(provenanceCounts(segments)).toEqual([
      { kind: "quick-select", label: "Quick Select", count: 3 },
      { kind: "manual", label: "Manual", count: 2 },
      { kind: "structured-template", label: "Structured", count: 1 },
    ]);
  });

  it("renders a one-line summary", () => {
    expect(formatProvenanceSummary(provenanceCounts(segments))).toBe(
      "Quick Select 3 • Manual 2 • Structured 1",
    );
    expect(formatProvenanceSummary([])).toBe("Manual");
  });

  it("counts only non-manual segments as assisted", () => {
    expect(countAssisted(segments)).toBe(4);
    expect(countAssisted([{ kind: "manual", label: "Manual" }])).toBe(0);
  });
});
