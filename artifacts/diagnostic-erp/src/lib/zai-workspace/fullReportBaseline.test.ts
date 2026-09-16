import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPreviewHtml } from "@/lib/radiologyReportPreviewHtml";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import {
  MRI_LS_SPINE_STANDARD_NORMAL_MANIFEST,
  MRI_LS_SPINE_STANDARD_NORMAL_NAME,
  materializeFormatBaseline,
  reportFormatRevision,
  validateBaselineManifest,
} from "./fullReportBaseline";
import { DEFAULT_REPORT_FORMATS } from "./report-formats-library";
import { useWorkspace } from "./store";

const STANDARD = DEFAULT_REPORT_FORMATS.find(
  (format) => format.name === MRI_LS_SPINE_STANDARD_NORMAL_NAME,
)!;

function reset() {
  useWorkspace.setState({
    reportingContext: buildReportingStudyContext({
      modality: "MR",
      studyDescription: "MRI LS Spine Plain",
      regions: ["LS Spine"],
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
    isFinalized: false,
    impressionNeedsRefresh: false,
  });
}

function applyOwned(opts: {
  id: string;
  concept: string;
  level?: string;
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
    },
    source: "quick-select",
    region: "LS Spine",
    concept: opts.concept,
    level: opts.level,
    findingsText: opts.findings,
    label: opts.id,
  });
}

describe("MRI LS Spine Standard Normal — owned starting canvas", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    reset();
  });

  it("has a valid, versioned, atomic ownership manifest", () => {
    expect(STANDARD.baselineManifest).toEqual(MRI_LS_SPINE_STANDARD_NORMAL_MANIFEST);
    expect(validateBaselineManifest(STANDARD)).toEqual({
      ok: true,
      missing: [],
      duplicateSlots: [],
    });
    expect(reportFormatRevision(STANDARD)).toMatch(/^fnv1a-[0-9a-f]{8}$/);
    expect(materializeFormatBaseline(STANDARD, "LS Spine").length).toBeGreaterThan(30);
  });

  it("applies the full canonical report and materializes baseline ledger slots", () => {
    useWorkspace.getState().applyFormatById(STANDARD.id);
    const state = useWorkspace.getState();
    expect(state.clinicalHistoryText).toMatch(/lumbosacral spine/i);
    expect(state.techniqueText).toMatch(/sagittal/i);
    expect(state.findingsText).toContain("Normal lumbar lordosis is maintained.");
    expect(state.findingsText).toContain("L4-L5: No significant disc bulge or protrusion is seen.");
    expect(state.impressionText).toMatch(/Normal MRI of the lumbosacral spine/i);
    expect(state.appliedFormatName).toBe(MRI_LS_SPINE_STANDARD_NORMAL_NAME);
    expect(state.appliedPathologyPatches.some((p) =>
      p.observation?.role === "baseline"
      && p.observation.concept === "disc_contour"
      && p.observation.level === "L4-L5")).toBe(true);
  });

  it("replaces alignment, L4-L5 disc and neural effects while preserving unrelated normals", () => {
    useWorkspace.getState().applyFormatById(STANDARD.id);
    const untouchedL34 = "L3-L4: No significant disc bulge or protrusion is seen.";
    const untouchedConus = "Conus medullaris terminates at L1 and appears normal.";

    expect(applyOwned({
      id: "qi-alignment-loss",
      concept: "alignment",
      findings: "Loss of normal lumbar lordosis is noted.",
    })).toBe("applied");
    expect(applyOwned({
      id: "qi-l45-bulge",
      concept: "disc_contour",
      level: "L4-L5",
      findings: "Diffuse disc bulge at L4-L5 indents the anterior thecal sac.",
      impression: "Diffuse disc bulge at L4-L5.",
    })).toBe("applied");
    expect(applyOwned({
      id: "qi-l45-canal",
      concept: "canal_stenosis",
      level: "L4-L5",
      findings: "Thecal sac compression with moderate canal stenosis is seen at L4-L5.",
      impression: "Moderate canal stenosis at L4-L5.",
    })).toBe("applied");
    expect(applyOwned({
      id: "qi-l45-root",
      concept: "root_contact",
      level: "L4-L5",
      findings: "Bilateral traversing nerve root compression is seen at L4-L5.",
      impression: "Bilateral neural compression at L4-L5.",
    })).toBe("applied");

    const findings = useWorkspace.getState().findingsText;
    expect(findings).toContain("Loss of normal lumbar lordosis");
    expect(findings).toContain("Diffuse disc bulge at L4-L5");
    expect(findings).toContain("Thecal sac compression");
    expect(findings).toContain("Bilateral traversing nerve root compression");
    expect(findings).not.toContain("Normal lumbar lordosis is maintained.");
    expect(findings).not.toContain("L4-L5: No significant disc bulge");
    expect(findings).not.toContain("L4-L5: No spinal canal or thecal sac compression");
    expect(findings).not.toContain("L4-L5: No exiting or traversing nerve root compression");
    expect(findings).toContain(untouchedL34);
    expect(findings).toContain(untouchedConus);
  });

  it("protects manually edited same-slot text and requires confirmation", () => {
    useWorkspace.getState().applyFormatById(STANDARD.id);
    const before = useWorkspace.getState().findingsText;
    const manual = "L4-L5: Small focal disc bulge is described manually by the radiologist.";
    useWorkspace.getState().setField(
      "findings",
      before.replace(
        "L4-L5: No significant disc bulge or protrusion is seen.",
        manual,
      ),
    );
    const status = applyOwned({
      id: "qi-l45-protected",
      concept: "disc_contour",
      level: "L4-L5",
      findings: "Diffuse disc bulge at L4-L5 indents the thecal sac.",
    });
    expect(status).toBe("pending");
    expect(useWorkspace.getState().confirmOverwriteOpen).toBe(true);
    expect(useWorkspace.getState().findingsText).toContain(manual);
    useWorkspace.getState().cancelOverwrite();
    expect(useWorkspace.getState().findingsText).toContain(manual);
  });

  it("deselect restores the exact owned baseline and keeps ownership active", () => {
    useWorkspace.getState().applyFormatById(STANDARD.id);
    applyOwned({
      id: "qi-l45-bulge",
      concept: "disc_contour",
      level: "L4-L5",
      findings: "Diffuse disc bulge at L4-L5 indents the anterior thecal sac.",
      impression: "Diffuse disc bulge at L4-L5.",
    });
    expect(useWorkspace.getState().removeObservation("qi-l45-bulge")).toBe("removed");
    const state = useWorkspace.getState();
    expect(state.findingsText).toContain(
      "L4-L5: No significant disc bulge or protrusion is seen.",
    );
    expect(state.impressionText).toBe(STANDARD.impression);
    expect(state.appliedPathologyPatches.some((p) =>
      !p.stale
      && p.observation?.role === "baseline"
      && p.observation.concept === "disc_contour"
      && p.observation.level === "L4-L5")).toBe(true);
  });

  it("save/reopen serialization preserves baseline ownership and preview stays clinical-only", () => {
    useWorkspace.getState().applyFormatById(STANDARD.id);
    applyOwned({
      id: "qi-l45-bulge",
      concept: "disc_contour",
      level: "L4-L5",
      findings: "Diffuse disc bulge at L4-L5 indents the anterior thecal sac.",
    });
    const before = useWorkspace.getState();
    const ledger = before.serializeObservationLedger();
    const findings = before.findingsText;
    const impression = before.impressionText;

    reset();
    useWorkspace.getState().setEditorContent({
      clinicalHistory: STANDARD.clinicalHistory,
      technique: STANDARD.technique,
      findings,
      impression,
      recommendation: STANDARD.recommendation,
    });
    const hydrated = useWorkspace.getState().hydrateObservationLedger(ledger);
    expect(hydrated.ok).toBe(true);
    expect(useWorkspace.getState().appliedPathologyPatches.some((p) =>
      p.observation?.concept === "disc_contour"
      && p.observation.level === "L4-L5")).toBe(true);

    const html = buildPreviewHtml({
      patientName: "TEST PATIENT",
      age: "40",
      sex: "M",
      accessionNumber: "ACC-1",
      referringDoctor: "Dr Test",
      studyDate: "2026-09-16",
      studyName: STANDARD.reportTitle ?? STANDARD.name,
      technique: STANDARD.technique,
      clinicalHistory: STANDARD.clinicalHistory,
      findingsMap: {},
      rawFindings: findings,
      useStructured: false,
      impression: impression.split("\n"),
      recommendation: STANDARD.recommendation,
      imageRefs: [],
    });
    expect(html).toContain("Diffuse disc bulge at L4-L5");
    expect(html).not.toMatch(/slotKey|care\.observation_ledger|baselineManifest/);
  });
});
