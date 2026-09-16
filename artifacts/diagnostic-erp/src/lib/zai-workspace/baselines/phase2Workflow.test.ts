import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPreviewHtml } from "@/lib/radiologyReportPreviewHtml";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import {
  CLINICAL_UNDO_DEPTH,
} from "../clinicalUndo";
import {
  materializeFormatBaseline,
  reportFormatRevision,
  validateBaselineManifest,
} from "../fullReportBaseline";
import { DEFAULT_REPORT_FORMATS } from "../report-formats-library";
import { useWorkspace } from "../store";
import {
  buildStartingCanvasChangeHighlights,
  clinicalTextHasHighlightMarkup,
  reconstructStartingCanvasBaseline,
  SCREENING_LIMITATION_TEXT,
} from "../startingCanvasHighlight";
import {
  ownedBaselineCatalog,
  SCREENING_LIMITATION_CONCEPT,
} from "./index";

function formatByName(name: string) {
  const f = DEFAULT_REPORT_FORMATS.find((x) => x.name === name);
  if (!f) throw new Error(`missing format ${name}`);
  return f;
}

function reset(region = "LS Spine") {
  useWorkspace.setState({
    reportingContext: buildReportingStudyContext({
      modality: "MR",
      studyDescription: `MRI ${region}`,
      regions: [region],
      source: "auto",
    }),
    reportFormats: DEFAULT_REPORT_FORMATS,
    selectedFormatIds: [],
    findingsText: "",
    impressionText: "",
    recommendationText: "",
    techniqueText: "",
    clinicalHistoryText: "",
    appliedPathologyPatches: [],
    fieldProvenance: {},
    appliedFormatName: null,
    appliedFormatReportTitle: null,
    confirmOverwriteOpen: false,
    pendingPathologyPatch: null,
    lastPatchSnapshot: null,
    patchUndoStack: [],
    startingCanvasBaseline: null,
    isFinalized: false,
    impressionNeedsRefresh: false,
  });
}

function applyOwned(opts: {
  id: string;
  concept: string;
  level?: string;
  laterality?: string;
  region?: string;
  findings: string;
  impression?: string;
}) {
  return useWorkspace.getState().applyPathologyOverlay({
    id: opts.id,
    incoming: { findings: opts.findings, impression: opts.impression },
    templates: { findings: opts.findings, impression: opts.impression },
    ownership: {
      concept: opts.concept,
      conflictGroup: opts.concept,
      anatomicalSection: opts.level ?? opts.concept,
      laterality: opts.laterality,
    },
    source: "quick-select",
    region: opts.region ?? useWorkspace.getState().reportingContext.region ?? "LS Spine",
    concept: opts.concept,
    level: opts.level,
    laterality: opts.laterality,
    findingsText: opts.findings,
    impressionText: opts.impression,
    label: opts.id,
  });
}

describe("Phase 2 owned baseline workflows", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  });

  it("registers all 8 Phase 2 formats in the library with valid manifests", () => {
    for (const entry of ownedBaselineCatalog()) {
      const format = formatByName(entry.name);
      expect(format.baselineManifest?.revision).toBe(entry.manifest.revision);
      expect(validateBaselineManifest(format, entry.bodyPart)).toEqual({
        ok: true,
        missing: [],
        duplicateSlots: [],
      });
      expect(materializeFormatBaseline(format, entry.bodyPart).length).toBe(
        entry.manifest.observations.length,
      );
    }
  });

  it("MRI Brain Standard Normal: replace then restore exact baseline statement", () => {
    reset("Brain");
    const format = formatByName("MRI Brain — Standard Normal");
    useWorkspace.getState().applyFormatById(format.id);
    const baseline = "No acute infarct is seen.";
    expect(useWorkspace.getState().findingsText).toContain(baseline);
    const abnormal = "Acute infarct in the left MCA territory.";
    expect(applyOwned({
      id: "brain-infarct",
      concept: "infarct",
      region: "Brain",
      findings: abnormal,
      impression: "Acute left MCA territory infarct.",
    })).toBe("applied");
    const after = useWorkspace.getState();
    expect(after.findingsText).toContain(abnormal);
    expect(after.findingsText).not.toContain(baseline);
    expect(after.findingsText).toContain("No midline shift is seen.");
    expect(after.findingsText).toContain("No intracranial hemorrhage is seen.");

    const infarctPatch = after.appliedPathologyPatches.find((p) => p.id === "brain-infarct");
    expect(infarctPatch).toBeTruthy();
    expect(useWorkspace.getState().removeObservation("brain-infarct")).toBe("removed");
    expect(useWorkspace.getState().findingsText).toContain(baseline);
    expect(useWorkspace.getState().findingsText).not.toContain(abnormal);
  });

  it("MRI Cervical Standard Normal: level-specific disc replace leaves other levels", () => {
    reset("Cervical Spine");
    const format = formatByName("MRI Cervical Spine — Standard Normal");
    useWorkspace.getState().applyFormatById(format.id);
    const c56Disc = "C5-C6: No significant disc bulge or protrusion is seen.";
    const c45Disc = "C4-C5: No significant disc bulge or protrusion is seen.";
    expect(useWorkspace.getState().findingsText).toContain(c56Disc);
    expect(applyOwned({
      id: "c56-bulge",
      concept: "disc_contour",
      level: "C5-C6",
      region: "Cervical Spine",
      findings: "Diffuse disc bulge at C5-C6 indents the anterior thecal sac.",
    })).toBe("applied");
    const text = useWorkspace.getState().findingsText;
    expect(text).toContain("Diffuse disc bulge at C5-C6");
    expect(text).not.toContain(c56Disc);
    expect(text).toContain(c45Disc);
    expect(text).toContain("C5-C6: No spinal canal or thecal sac compression is seen.");
  });

  it("screening formats keep mandatory limitation through abnormal + undo", () => {
    reset("LS Spine");
    const format = formatByName("MRI LS Spine — Screening Normal");
    useWorkspace.getState().applyFormatById(format.id);
    expect(useWorkspace.getState().findingsText).toContain(SCREENING_LIMITATION_TEXT);
    const limitationPatch = useWorkspace.getState().appliedPathologyPatches.find(
      (p) => p.observation?.concept === SCREENING_LIMITATION_CONCEPT,
    );
    expect(limitationPatch?.protected).toBe(true);

    expect(applyOwned({
      id: "ls-screen-disc",
      concept: "disc_contour",
      region: "LS Spine",
      findings: "Significant disc herniation is identified on screening sequences.",
    })).toBe("applied");
    expect(useWorkspace.getState().findingsText).toContain(SCREENING_LIMITATION_TEXT);

    expect(useWorkspace.getState().undoLastPatch()).toBe(true);
    expect(useWorkspace.getState().findingsText).toContain(SCREENING_LIMITATION_TEXT);
    expect(useWorkspace.getState().findingsText).not.toContain("Significant disc herniation");
  });

  it("Whole Spine Screening keeps regional ownership isolated", () => {
    reset("Whole Spine");
    const format = formatByName("MRI Whole Spine — Screening Normal");
    useWorkspace.getState().applyFormatById(format.id);
    const dorsalDisc = "Dorsal spine: No significant disc herniation is identified on screening sequences.";
    const lumbarDisc = "Lumbar spine: No significant disc herniation is identified on screening sequences.";
    expect(useWorkspace.getState().findingsText).toContain(dorsalDisc);
    expect(useWorkspace.getState().findingsText).toContain(lumbarDisc);

    expect(applyOwned({
      id: "cervical-disc-abn",
      concept: "disc_contour",
      level: "cervical",
      region: "Cervical Spine",
      findings: "Cervical spine: Significant disc herniation is identified on screening sequences.",
    })).toBe("applied");
    const text = useWorkspace.getState().findingsText;
    expect(text).toContain("Cervical spine: Significant disc herniation");
    expect(text).toContain(dorsalDisc);
    expect(text).toContain(lumbarDisc);
    expect(text.split(SCREENING_LIMITATION_TEXT).length - 1).toBe(1);
  });

  it("supports ~5-level clinical Undo of sequential abnormals", () => {
    reset("LS Spine");
    const format = formatByName("MRI LS Spine — Standard Normal");
    useWorkspace.getState().applyFormatById(format.id);
    const a = "Loss of normal lumbar lordosis is noted.";
    const b = "Diffuse disc bulge at L4-L5 indents the anterior thecal sac.";
    const c = "Mild central canal stenosis at L4-L5.";
    expect(applyOwned({ id: "a", concept: "alignment", findings: a })).toBe("applied");
    expect(applyOwned({
      id: "b",
      concept: "disc_contour",
      level: "L4-L5",
      findings: b,
    })).toBe("applied");
    expect(applyOwned({
      id: "c",
      concept: "canal_stenosis",
      level: "L4-L5",
      findings: c,
    })).toBe("applied");
    expect(useWorkspace.getState().findingsText).toContain(c);

    expect(useWorkspace.getState().undoLastPatch()).toBe(true);
    expect(useWorkspace.getState().findingsText).not.toContain(c);
    expect(useWorkspace.getState().findingsText).toContain(b);

    expect(useWorkspace.getState().undoLastPatch()).toBe(true);
    expect(useWorkspace.getState().findingsText).not.toContain(b);
    expect(useWorkspace.getState().findingsText).toContain(a);

    expect(useWorkspace.getState().undoLastPatch()).toBe(true);
    expect(useWorkspace.getState().findingsText).not.toContain(a);
    expect(useWorkspace.getState().findingsText).toContain("Normal lumbar lordosis is maintained.");
  });

  it("bounds clinical Undo history to CLINICAL_UNDO_DEPTH", () => {
    reset("LS Spine");
    const format = formatByName("MRI LS Spine — Standard Normal");
    useWorkspace.getState().applyFormatById(format.id);
    for (let i = 0; i < CLINICAL_UNDO_DEPTH + 2; i++) {
      applyOwned({
        id: `u-${i}`,
        concept: "alignment",
        findings: i % 2 === 0
          ? "Loss of normal lumbar lordosis is noted."
          : "Normal lumbar lordosis is maintained.",
      });
    }
    expect(useWorkspace.getState().patchUndoStack.length).toBeLessThanOrEqual(CLINICAL_UNDO_DEPTH);
  });

  it("workspace highlights distinguish abnormal vs manual; preview stays clean", () => {
    reset("LS Spine");
    const format = formatByName("MRI LS Spine — Standard Normal");
    useWorkspace.getState().applyFormatById(format.id);
    const abnormal = "Diffuse disc bulge at L4-L5 indents the anterior thecal sac.";
    applyOwned({
      id: "qi-l45",
      concept: "disc_contour",
      level: "L4-L5",
      findings: abnormal,
    });
    useWorkspace.getState().setField(
      "findings",
      useWorkspace.getState().findingsText.replace(
        "Normal lumbar lordosis is maintained.",
        "Mild loss of lumbar lordosis is noted.",
      ),
    );
    const state = useWorkspace.getState();
    expect(clinicalTextHasHighlightMarkup(state.findingsText)).toBe(false);
    const spans = buildStartingCanvasChangeHighlights({
      baseline: state.startingCanvasBaseline,
      findingsText: state.findingsText,
      impressionText: state.impressionText,
      patches: state.appliedPathologyPatches,
    });
    expect(spans.some((s) => s.kind === "known-abnormal" && s.bold && s.text === abnormal)).toBe(true);
    expect(spans.some((s) => s.kind === "manual-change" && !s.bold && /Mild loss/.test(s.text))).toBe(true);
    expect(spans.every((s) => s.text !== state.findingsText)).toBe(true);

    const html = buildPreviewHtml({
      patientName: "TEST",
      age: "40",
      sex: "M",
      accessionNumber: "A1",
      referringDoctor: "Dr",
      studyDate: "2026-09-16",
      studyName: format.reportTitle || format.name,
      technique: state.techniqueText,
      clinicalHistory: state.clinicalHistoryText,
      findingsMap: {},
      rawFindings: state.findingsText,
      useStructured: false,
      impression: state.impressionText.split("\n"),
      recommendation: state.recommendationText,
      imageRefs: [],
    });
    expect(html).toContain(abnormal);
    expect(html).not.toMatch(/canvas-change-highlight|data-canvas-change|data-editor-only/);
    expect(html).not.toMatch(/yellow|#ff0|background-color:\s*#?f{0,2}f[eb]/i);
  });

  it("reconstructs Starting Canvas baseline from format identity when revision matches", () => {
    const format = formatByName("MRI Brain — Standard Normal");
    const canvas = reconstructStartingCanvasBaseline({
      formatName: format.name,
      formatRevision: reportFormatRevision(format),
      baselineManifestRevision: format.baselineManifest?.revision,
      appliedAt: "2026-01-01T00:00:00.000Z",
      format,
      reportFormatRevision,
    });
    expect(canvas?.findings).toBe(format.findings);
    expect(canvas?.impression).toBe(format.impression);

    const drifted = reconstructStartingCanvasBaseline({
      formatName: format.name,
      baselineManifestRevision: "stale-revision",
      format,
      reportFormatRevision,
    });
    expect(drifted).toBeNull();
  });

  it("protects manual text from silent overwrite on matching concept", () => {
    reset("Brain");
    const format = formatByName("MRI Brain — Standard Normal");
    useWorkspace.getState().applyFormatById(format.id);
    const before = useWorkspace.getState().findingsText;
    const manual = "No acute infarct is seen — correlate carefully with clinical stroke protocol.";
    useWorkspace.getState().setField(
      "findings",
      before.replace("No acute infarct is seen.", manual),
    );
    const status = applyOwned({
      id: "brain-infarct-2",
      concept: "infarct",
      region: "Brain",
      findings: "Acute infarct in the right PCA territory.",
    });
    expect(status).toBe("pending");
    expect(useWorkspace.getState().findingsText).toContain(manual);
    useWorkspace.getState().cancelOverwrite();
    expect(useWorkspace.getState().findingsText).toContain(manual);
  });
});
