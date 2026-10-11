import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  analyzeFormatOverwrite,
  classifyFormatSection,
  clinicalFieldsFromFormat,
  clinicalSavePayload,
  editorHasMeaningfulReportText,
  filterFormatsByPickerTab,
  formatContextRank,
  payloadContainsDemography,
  protocolScopeMatches,
  resolvePrintedReportTitle,
  resolveReportingRegionForFormat,
  shouldConfirmFormatOverwrite,
} from "./fullReportFormat";
import { setFormatApplyBridge } from "./formatApplyBridge";
import {
  DEFAULT_REPORT_FORMATS,
  createFormat,
  hydrateFormat,
  lookupFormatsForContext,
  lookupFormatsForPicker,
  payloadForApi,
} from "./report-formats-library";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import { matchStudyRegion } from "@/lib/studyRegion";
import { buildPreviewHtml } from "@/lib/radiologyReportPreviewHtml";
import { buildLivePrintBodyHtml } from "@/lib/radiologyReportPrintLiveMerge";
import { applyPathologyPatch } from "@/lib/pathologyPatch";
import { provenanceFromText } from "@/lib/reportFieldMerge";
import { DEFAULT_QUICK_SELECT_TILES } from "./quick-select-library";
import { useWorkspace } from "./store";
import type { ReportFormat } from "./types";

const REGIONS = ["Brain", "Cervical Spine", "Dorsal Spine", "LS Spine", "Whole Spine", "Spine"];

function ctxFor(description: string, protocolName?: string) {
  const region = matchStudyRegion(`MR ${description}`, REGIONS);
  return buildReportingStudyContext({
    modality: "MR",
    studyDescription: description,
    regions: region ? [region] : [],
    source: region ? "auto" : "unresolved",
    protocolName: protocolName ?? null,
  });
}

const FAZEKAS_SENILE = () =>
  DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI Brain — Fazekas Grade 1 + Senile Changes")!;

describe("full report format — heading + clinical payload", () => {
  it("reportTitle controls printed heading when supplied", () => {
    expect(resolvePrintedReportTitle("MRI BRAIN PLAIN", "MRI Brain from DICOM")).toBe("MRI BRAIN PLAIN");
  });

  it("old formats without reportTitle keep the current title fallback", () => {
    expect(resolvePrintedReportTitle("", "MRI Brain Plain")).toBe("MRI Brain Plain");
    expect(resolvePrintedReportTitle(undefined, "MRI LS Spine")).toBe("MRI LS Spine");
    const legacy = hydrateFormat({ name: "Legacy Brain", modality: "MR", bodyPart: "Brain" } as Partial<ReportFormat> & { name: string });
    expect(legacy.reportTitle).toBe("");
    expect(legacy.protocolScope).toBe("");
    expect(resolvePrintedReportTitle(legacy.reportTitle, "from DICOM")).toBe("from DICOM");
  });

  it("blank report + full format populates all clinical fields", () => {
    const f = FAZEKAS_SENILE();
    const clinical = clinicalFieldsFromFormat(f);
    expect(clinical.technique.length).toBeGreaterThan(20);
    expect(clinical.findings).toMatch(/Fazekas grade 1/i);
    expect(clinical.findings).toMatch(/age-related/i);
    expect(clinical.impression).toMatch(/Fazekas grade 1/i);
    expect(clinical.impression).toMatch(/atrophic/i);
    expect(clinical.reportTitle).toBe("MRI BRAIN PLAIN");
    expect(clinical.recommendation).toBe("");
    expect(shouldConfirmFormatOverwrite({
      technique: "", findings: "", impression: "", recommendation: "",
    })).toBe(false);
  });

  it("format never stores or applies another patient's demographics", () => {
    const saved = clinicalSavePayload({
      name: "MRI Brain — Fazekas 1 + Senile Changes",
      modality: "MR",
      bodyPart: "Brain",
      diagnosisTags: ["fazekas 1"],
      clinicalHistory: "MRI brain requested.",
      technique: "MRI brain 3T.",
      findings: "Fazekas 1.",
      impression: "Mild SVD.",
      recommendation: "",
      reportTitle: "MRI BRAIN PLAIN",
    });
    expect(payloadContainsDemography(saved as unknown as Record<string, unknown>)).toBe(false);
    const api = payloadForApi(saved);
    expect(payloadContainsDemography(api as unknown as Record<string, unknown>)).toBe(false);
    expect("patientName" in api).toBe(false);
    expect("age" in api).toBe(false);
    expect("uhid" in api).toBe(false);
    expect(api.reportTitle).toBe("MRI BRAIN PLAIN");
    expect(api.findings).toBe("Fazekas 1.");
  });

  it("Save current report as full format excludes demographics", () => {
    const created = createFormat(clinicalSavePayload({
      name: "Prepared Fazekas",
      modality: "MR",
      bodyPart: "Brain",
      diagnosisTags: [],
      clinicalHistory: "Headache.",
      technique: "3T brain.",
      findings: "Fazekas 1 + senile changes.",
      impression: "Mild SVD and atrophy.",
      recommendation: "",
      reportTitle: "MRI BRAIN PLAIN",
      protocolScope: "Plain",
    }));
    expect(created.name).toBe("Prepared Fazekas");
    expect(created.reportTitle).toBe("MRI BRAIN PLAIN");
    expect(created.protocolScope).toBe("Plain");
    expect((created as unknown as { patientName?: string }).patientName).toBeUndefined();
  });
});

describe("full report format — preview / print pipeline", () => {
  it("preview uses current-patient demography + format reportTitle, not format library name", () => {
    const f = FAZEKAS_SENILE();
    const html = buildPreviewHtml({
      patientName: "AARAV KUMAR",
      age: "45",
      sex: "M",
      accessionNumber: "CRN-1001",
      referringDoctor: "Dr Mehta",
      studyDate: "26-08-2026",
      studyName: resolvePrintedReportTitle(f.reportTitle, "fallback"),
      technique: f.technique,
      clinicalHistory: f.clinicalHistory,
      findingsMap: {},
      rawFindings: f.findings,
      useStructured: false,
      impression: f.impression.split("\n").filter(Boolean),
      recommendation: f.recommendation,
      imageRefs: [],
    });
    expect(html).toContain("AARAV KUMAR");
    expect(html).toContain("MRI BRAIN PLAIN");
    expect(html).not.toContain("Fazekas Grade 1 + Senile Changes"); // library name is not the heading
    expect(html).toContain("Fazekas grade 1");
    expect(html).toMatch(/TECHNIQUE/i);
    expect(html).toMatch(/FINDINGS/i);
    expect(html).toMatch(/IMPRESSION/i);
    expect(html).not.toMatch(/>\s*<u>RECOMMENDATION<\/u>/i);
  });

  it("empty recommendation does not create a recommendation section", () => {
    const preview = buildPreviewHtml({
      patientName: "AARAV KUMAR",
      age: "45",
      sex: "M",
      accessionNumber: "A1",
      referringDoctor: "Dr X",
      studyDate: "2026-08-26",
      studyName: "MRI BRAIN PLAIN",
      technique: "MRI brain.",
      clinicalHistory: "",
      findingsMap: {},
      rawFindings: "Normal.",
      useStructured: false,
      impression: ["Normal."],
      recommendation: "",
      imageRefs: [],
    });
    expect(preview).not.toMatch(/Recommendation/i);
    const live = buildLivePrintBodyHtml({
      clinicalHistory: "",
      technique: "MRI brain.",
      rawFindings: "Normal.",
      findingsMap: {},
      useStructured: false,
      impression: ["Normal."],
      recommendation: "",
    });
    expect(live).not.toMatch(/Recommendation/i);
    expect(live).not.toContain("Please correlate with clinical findings.");
  });

  it("non-empty recommendation still prints", () => {
    const live = buildLivePrintBodyHtml({
      clinicalHistory: "",
      technique: "MRI.",
      rawFindings: "Finding.",
      findingsMap: {},
      useStructured: false,
      impression: ["Imp."],
      recommendation: "Follow-up MRI.",
    });
    expect(live).toMatch(/Recommendation/i);
    expect(live).toContain("Follow-up MRI.");
  });
});

describe("full report format — protocol ranking", () => {
  it("protocol/sub-technique-specific format ranks above generic format", () => {
    const ctx = ctxFor("MRI Cervical Spine Screening", "MRI Cervical Spine Screening");
    const ranked = lookupFormatsForContext(DEFAULT_REPORT_FORMATS, "MR", ctx);
    expect(ranked[0]?.name).toBe("MRI Cervical Spine — Screening");
    expect(ranked.some((f) => f.name === "MRI Cervical Spine — Normal")).toBe(true);
  });

  it("generic cervical format remains available as fallback", () => {
    const ctx = ctxFor("MRI Cervical Spine");
    const ranked = lookupFormatsForContext(DEFAULT_REPORT_FORMATS, "MR", ctx);
    expect(ranked.some((f) => f.name === "MRI Cervical Spine — Normal")).toBe(true);
    expect(ranked.some((f) => f.name === "MRI Cervical Spine — Screening")).toBe(true);
  });

  it("lookupFormatsForPicker falls back to modality when region is unresolved", () => {
    const ctx = ctxFor("Nuclear medicine bone scan");
    expect(ctx.region).toBeNull();
    const { formats, scope } = lookupFormatsForPicker(DEFAULT_REPORT_FORMATS, "MR", ctx);
    expect(scope).toBe("modality");
    expect(formats.length).toBeGreaterThan(0);
    expect(formats.every((f) => f.modality === "MR")).toBe(true);
  });

  it("lookupFormatsForPicker prefers bodyPart fallback before modality dump", () => {
    const ctx = buildReportingStudyContext({
      modality: "MR",
      studyDescription: "unknown study",
      regions: [],
      source: "unresolved",
      protocolName: null,
    });
    const { formats, scope } = lookupFormatsForPicker(DEFAULT_REPORT_FORMATS, "MR", ctx, {
      bodyPartFallback: "Brain",
    });
    expect(scope).toBe("bodyPart");
    expect(formats.every((f) => f.bodyPart === "Brain")).toBe(true);
  });

  it("favorites and recent tabs filter without dropping the library", () => {
    const formats: ReportFormat[] = [
      { ...FAZEKAS_SENILE(), favorite: true, usageCount: 3, id: "a" },
      { ...FAZEKAS_SENILE(), name: "Other", favorite: false, usageCount: 0, id: "b" },
    ];
    expect(filterFormatsByPickerTab(formats, "favorites").map((f) => f.id)).toEqual(["a"]);
    expect(filterFormatsByPickerTab(formats, "recent").map((f) => f.id)).toEqual(["a"]);
    expect(filterFormatsByPickerTab(formats, "all")).toHaveLength(2);
    expect(formatContextRank(formats[0]!, { protocolName: "Plain", studyDescription: "MRI Brain Plain" }))
      .toBeGreaterThan(formatContextRank(formats[1]!, { studyDescription: "MRI Brain Plain" }));
  });
});

describe("full report format — workspace apply", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    useWorkspace.setState({
      findingsText: "",
      impressionText: "",
      recommendationText: "",
      techniqueText: "",
      clinicalHistoryText: "",
      appliedFormatReportTitle: null,
      selectedFormatIds: [],
      confirmOverwriteOpen: false,
      pendingFormatIds: [],
      reportFormats: DEFAULT_REPORT_FORMATS,
      fieldProvenance: {},
      appliedPathologyPatches: [],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("one-click apply on a blank report fills clinical fields and printed title", () => {
    const f = FAZEKAS_SENILE();
    useWorkspace.getState().applyFormatById(f.id);
    const s = useWorkspace.getState();
    expect(s.confirmOverwriteOpen).toBe(false);
    expect(s.techniqueText).toBe(f.technique);
    expect(s.findingsText).toContain("Fazekas grade 1");
    expect(s.impressionText).toContain("Fazekas grade 1");
    expect(s.recommendationText).toBe("");
    expect(s.appliedFormatReportTitle).toBe("MRI BRAIN PLAIN");
    expect(editorHasMeaningfulReportText({
      technique: s.techniqueText,
      findings: s.findingsText,
      impression: s.impressionText,
      recommendation: s.recommendationText,
    })).toBe(true);
  });

  it("existing manual report requires overwrite confirmation", () => {
    useWorkspace.getState().setField("findings", "I typed this myself.");
    const f = FAZEKAS_SENILE();
    useWorkspace.getState().applyFormatById(f.id);
    const pending = useWorkspace.getState();
    expect(pending.confirmOverwriteOpen).toBe(true);
    expect(pending.findingsText).toBe("I typed this myself.");
    pending.confirmOverwriteAndApply();
    expect(useWorkspace.getState().findingsText).toContain("Fazekas grade 1");
    expect(useWorkspace.getState().confirmOverwriteOpen).toBe(false);
  });

  it("worklist clinical history alone does not block one-click apply", () => {
    useWorkspace.setState({ clinicalHistoryText: "Worklist: headache." });
    const f = FAZEKAS_SENILE();
    useWorkspace.getState().applyFormatById(f.id);
    expect(useWorkspace.getState().confirmOverwriteOpen).toBe(false);
    expect(useWorkspace.getState().findingsText).toContain("Fazekas");
  });

  it("Quick Select can still modify the report after a full format", () => {
    const f = FAZEKAS_SENILE();
    useWorkspace.getState().applyFormatById(f.id);
    const hemor = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Basal ganglia hemorrhage")!;
    const result = applyPathologyPatch({
      existing: {
        clinicalHistory: useWorkspace.getState().clinicalHistoryText,
        technique: useWorkspace.getState().techniqueText,
        findings: useWorkspace.getState().findingsText,
        impression: useWorkspace.getState().impressionText,
        recommendation: useWorkspace.getState().recommendationText,
      },
      incoming: { findings: hemor.sentence, impression: hemor.impressionSentence },
      ownership: {
        anatomicalSection: hemor.anatomicalSection,
        conflictGroup: hemor.conflictGroup,
      },
      provenance: {
        findings: provenanceFromText(useWorkspace.getState().findingsText, "template"),
        impression: provenanceFromText(useWorkspace.getState().impressionText, "template"),
      },
      source: "quick-select",
    });
    expect(result.narrative.findings.toLowerCase()).toMatch(/basal ganglia/);
    expect(result.narrative.findings).toMatch(/hemorrhage/i);
    expect(result.narrative.findings).toContain("Fazekas");
  });

  it("existing report formats remain backward compatible", () => {
    const brain = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI Brain — Normal")!;
    useWorkspace.getState().applyFormatById(brain.id);
    const s = useWorkspace.getState();
    expect(s.findingsText).toBe(brain.findings);
    expect(s.impressionText).toBe(brain.impression);
    expect(s.techniqueText).toBe(brain.technique);
    expect(s.recommendationText).toBe(brain.recommendation);
    expect(s.appliedFormatReportTitle).toBe("MRI BRAIN PLAIN");
  });
});

describe("one-click format — reporting region resolve", () => {
  const CATALOG = ["Brain", "Cervical Spine", "LS Spine", "Knee", "Dorsal Spine"];

  it("LS Spine / Cervical / Brain formats map via explicit bodyPart", () => {
    const ls = DEFAULT_REPORT_FORMATS.find((f) => f.bodyPart === "LS Spine")!;
    const cerv = DEFAULT_REPORT_FORMATS.find((f) => f.bodyPart === "Cervical Spine")!;
    const brain = DEFAULT_REPORT_FORMATS.find((f) => f.bodyPart === "Brain")!;
    expect(resolveReportingRegionForFormat(ls, CATALOG)).toEqual({ status: "resolved", region: "LS Spine" });
    expect(resolveReportingRegionForFormat(cerv, CATALOG)).toEqual({ status: "resolved", region: "Cervical Spine" });
    expect(resolveReportingRegionForFormat(brain, CATALOG)).toEqual({ status: "resolved", region: "Brain" });
  });

  it("ambiguous / empty bodyPart does not silently choose", () => {
    expect(resolveReportingRegionForFormat({ name: "Mystery", bodyPart: "" }, CATALOG)).toEqual({
      status: "unresolved",
    });
    expect(resolveReportingRegionForFormat({ name: "Orbit", bodyPart: "Not A Region" }, CATALOG)).toEqual({
      status: "unresolved",
    });
  });

  it("canonical aliases resolve (C Spine → Cervical Spine)", () => {
    expect(resolveReportingRegionForFormat({ name: "C", bodyPart: "C Spine" }, CATALOG)).toEqual({
      status: "resolved",
      region: "Cervical Spine",
    });
  });
});

describe("one-click format — provenance-aware overwrite", () => {
  it("classifies blank / template / manual / ambiguous", () => {
    expect(classifyFormatSection("", undefined)).toBe("blank");
    expect(classifyFormatSection("Normal MRI.", provenanceFromText("Normal MRI.", "template"))).toBe("template");
    expect(classifyFormatSection("I typed this.", provenanceFromText("I typed this.", "manual"))).toBe("manual");
    expect(classifyFormatSection("Orphan text.", {})).toBe("ambiguous");
  });

  it("generated/template report applies without confirmation", () => {
    const analysis = analyzeFormatOverwrite({
      technique: "Protocol technique.",
      findings: "Template findings.",
      impression: "Template impression.",
      recommendation: "",
      fieldProvenance: {
        technique: provenanceFromText("Protocol technique.", "protocol"),
        findings: provenanceFromText("Template findings.", "template"),
        impression: provenanceFromText("Template impression.", "template"),
      },
      currentRegion: "Brain",
      resolvedRegion: "LS Spine",
    });
    expect(analysis.requiresConfirmation).toBe(false);
    expect(analysis.regionChanging).toBe(true);
    expect(shouldConfirmFormatOverwrite({
      technique: analysis.sections[0] ? "Protocol technique." : "",
      findings: "Template findings.",
      impression: "Template impression.",
      recommendation: "",
      fieldProvenance: {
        technique: provenanceFromText("Protocol technique.", "protocol"),
        findings: provenanceFromText("Template findings.", "template"),
        impression: provenanceFromText("Template impression.", "template"),
      },
    })).toBe(false);
  });

  it("manual content requires confirmation and lists sections", () => {
    const analysis = analyzeFormatOverwrite({
      technique: "",
      findings: "Radiologist wrote this.",
      impression: "Also mine.",
      recommendation: "",
      fieldProvenance: {
        findings: provenanceFromText("Radiologist wrote this.", "manual"),
        impression: provenanceFromText("Also mine.", "manual"),
      },
      currentRegion: "Brain",
      resolvedRegion: "LS Spine",
    });
    expect(analysis.requiresConfirmation).toBe(true);
    expect(analysis.confirmingSections).toEqual(["findings", "impression"]);
    expect(analysis.regionFrom).toBe("Brain");
    expect(analysis.regionTo).toBe("LS Spine");
  });
});

describe("one-click format — apply + region bridge + cancel", () => {
  let appliedRegion: string | null = null;
  let autosaveBumps = 0;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    appliedRegion = null;
    autosaveBumps = 0;
    setFormatApplyBridge({
      availableRegions: () => ["Brain", "Cervical Spine", "LS Spine", "Knee"],
      currentRegion: () => appliedRegion ?? "Brain",
      applyReportingRegion: (r) => { appliedRegion = r; },
      invalidatePendingAutosave: () => { autosaveBumps += 1; },
    });
    useWorkspace.setState({
      findingsText: "",
      impressionText: "",
      recommendationText: "",
      techniqueText: "",
      clinicalHistoryText: "",
      appliedFormatReportTitle: null,
      appliedFormatName: null,
      selectedFormatIds: [],
      confirmOverwriteOpen: false,
      pendingFormatIds: [],
      pendingFormatOverwrite: null,
      pendingFormatRegion: null,
      reportFormats: DEFAULT_REPORT_FORMATS,
      fieldProvenance: {},
      appliedPathologyPatches: [],
      isFinalized: false,
    });
  });

  afterEach(() => {
    setFormatApplyBridge(null);
    vi.unstubAllGlobals();
  });

  it("LS Spine format sets reporting region to LS Spine without confirm on blank report", () => {
    const f = DEFAULT_REPORT_FORMATS.find((x) => x.name === "MRI LS Spine — Normal")!;
    useWorkspace.getState().applyFormatById(f.id);
    const s = useWorkspace.getState();
    expect(s.confirmOverwriteOpen).toBe(false);
    expect(appliedRegion).toBe("LS Spine");
    expect(s.findingsText).toBe(f.findings);
    expect(s.appliedFormatName).toBe(f.name);
    expect(autosaveBumps).toBe(1);
  });

  it("Cervical / Brain formats set matching reporting regions", () => {
    const cerv = DEFAULT_REPORT_FORMATS.find((x) => x.name === "MRI Cervical Spine — Normal")!;
    useWorkspace.getState().applyFormatById(cerv.id);
    expect(appliedRegion).toBe("Cervical Spine");
    const brain = DEFAULT_REPORT_FORMATS.find((x) => x.name === "MRI Brain — Normal")!;
    useWorkspace.getState().applyFormatById(brain.id);
    expect(appliedRegion).toBe("Brain");
  });

  it("ambiguous bodyPart keeps current region", () => {
    appliedRegion = "Brain";
    const orphan = createFormat(clinicalSavePayload({
      name: "Ambiguous Format",
      modality: "MR",
      bodyPart: "",
      diagnosisTags: [],
      clinicalHistory: "",
      technique: "t",
      findings: "f",
      impression: "i",
      recommendation: "",
    }));
    useWorkspace.setState({ reportFormats: [...DEFAULT_REPORT_FORMATS, orphan] });
    useWorkspace.getState().applyFormatById(orphan.id);
    expect(appliedRegion).toBe("Brain");
    expect(useWorkspace.getState().findingsText).toBe("f");
  });

  it("reporting-region change does not alter DICOM/ERP identity on studies", () => {
    const before = {
      studies: [{
        id: "s1",
        studyInstanceUID: "1.2.3",
        modality: "MR" as const,
        patient: { id: "P1", name: "Ada", age: "40", sex: "F" as const },
        accessionNumber: "ACC-1",
      }],
    };
    useWorkspace.setState({
      studies: before.studies as never,
      activeStudyId: "s1",
    });
    const f = DEFAULT_REPORT_FORMATS.find((x) => x.name === "MRI LS Spine — Normal")!;
    useWorkspace.getState().applyFormatById(f.id);
    const st = useWorkspace.getState().studies.find((s) => s.id === "s1")!;
    expect(st.studyInstanceUID).toBe("1.2.3");
    expect(st.patient?.id).toBe("P1");
    expect(st.patient?.name).toBe("Ada");
    expect(st.accessionNumber).toBe("ACC-1");
    expect(st.modality).toBe("MR");
  });

  it("manual content + region change shows confirmation; cancel preserves both", () => {
    appliedRegion = "Brain";
    useWorkspace.getState().setField("findings", "Manual brain findings.");
    const f = DEFAULT_REPORT_FORMATS.find((x) => x.name === "MRI LS Spine — Normal")!;
    useWorkspace.getState().applyFormatById(f.id);
    const pending = useWorkspace.getState();
    expect(pending.confirmOverwriteOpen).toBe(true);
    expect(pending.pendingFormatOverwrite?.regionChanging).toBe(true);
    expect(pending.pendingFormatOverwrite?.confirmingSections).toContain("findings");
    expect(pending.findingsText).toBe("Manual brain findings.");
    expect(appliedRegion).toBe("Brain");
    pending.cancelOverwrite();
    expect(useWorkspace.getState().confirmOverwriteOpen).toBe(false);
    expect(useWorkspace.getState().findingsText).toBe("Manual brain findings.");
    expect(appliedRegion).toBe("Brain");
  });

  it("confirm changes region and applies format content atomically", () => {
    appliedRegion = "Brain";
    useWorkspace.getState().setField("findings", "Manual brain findings.");
    const f = DEFAULT_REPORT_FORMATS.find((x) => x.name === "MRI LS Spine — Normal")!;
    useWorkspace.getState().applyFormatById(f.id);
    useWorkspace.getState().confirmOverwriteAndApply();
    expect(appliedRegion).toBe("LS Spine");
    expect(useWorkspace.getState().findingsText).toBe(f.findings);
    expect(useWorkspace.getState().appliedFormatName).toBe(f.name);
  });

  it("template/generated content auto-applies without confirmation", () => {
    useWorkspace.getState().setField("findings", "Prior format findings.", { source: "template", replaceProvenance: true });
    const f = DEFAULT_REPORT_FORMATS.find((x) => x.name === "MRI LS Spine — Normal")!;
    useWorkspace.getState().applyFormatById(f.id);
    expect(useWorkspace.getState().confirmOverwriteOpen).toBe(false);
    expect(useWorkspace.getState().findingsText).toBe(f.findings);
    expect(appliedRegion).toBe("LS Spine");
  });

  it("observation ledger patches are marked stale, not deleted", () => {
    useWorkspace.setState({
      appliedPathologyPatches: [{
        id: "p1",
        ownership: { anatomicalSection: "disc", conflictGroup: "g" },
        templates: { findings: "old" },
        lastRendered: { findings: "old" },
        source: "quick-select",
        observation: { id: "p1" } as never,
        replacedBaseline: { findings: [], impression: [] },
        protected: false,
        stale: false,
      }],
    });
    const f = DEFAULT_REPORT_FORMATS.find((x) => x.name === "MRI Brain — Normal")!;
    useWorkspace.getState().applyFormatById(f.id);
    const patches = useWorkspace.getState().appliedPathologyPatches;
    expect(patches).toHaveLength(1);
    expect(patches[0]!.stale).toBe(true);
  });

  it("finalized reports cannot apply formats", () => {
    useWorkspace.setState({ isFinalized: true, findingsText: "" });
    const f = DEFAULT_REPORT_FORMATS.find((x) => x.name === "MRI Brain — Normal")!;
    useWorkspace.getState().applyFormatById(f.id);
    expect(useWorkspace.getState().findingsText).toBe("");
    expect(appliedRegion).toBeNull();
  });

  it("autosave invalidation runs after successful apply", () => {
    const f = DEFAULT_REPORT_FORMATS.find((x) => x.name === "MRI Brain — Normal")!;
    useWorkspace.getState().applyFormatById(f.id);
    expect(autosaveBumps).toBe(1);
  });
});
