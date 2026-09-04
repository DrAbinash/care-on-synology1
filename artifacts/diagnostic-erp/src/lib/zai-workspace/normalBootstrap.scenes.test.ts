/**
 * normalBootstrap.scenes.test.ts — engine-verified workflow evidence for the
 * three requested demo scenes, produced from the REAL format library and the
 * REAL store overlay engine (no fixtures, no mocks):
 *
 *   Scene 1 — normal Brain immediately after opening (bootstrap output)
 *   Scene 2 — same case after an abnormal Quick Select (Fazekas 2)
 *   Scene 3 — LS spine normal → one-level abnormal (L4-L5 disc bulge)
 *             + abnormal→normal restoration (baseline returns on deselect)
 *
 * The narratives asserted here are the exact texts the Reporting Workspace
 * editor shows at each stage (console-logged for review).
 */
import { describe, expect, it, beforeEach } from "vitest";
import { DEFAULT_REPORT_FORMATS } from "./report-formats-library";
import { DEFAULT_QUICK_SELECT_TILES } from "./quick-select-library";
import { useWorkspace } from "./store";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import { resolveNormalBootstrapFormat } from "./normalBootstrap";

const BRAIN_NORMAL = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI Brain — Normal")!;
const LS_NORMAL = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI LS Spine — Normal")!;
const FAZEKAS2 = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Fazekas 2")!;
const DISC_L45 = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Disc herniation L4-L5")!;

function brainCtx() {
  return buildReportingStudyContext({ modality: "MR", studyDescription: "MRI Brain Plain", regions: ["Brain"], source: "auto" });
}
function lsCtx() {
  return buildReportingStudyContext({ modality: "MR", studyDescription: "MRI LS Spine", regions: ["LS Spine"], source: "auto" });
}

/** Apply a format the way applyFormatById does on a blank report. */
function applyBaseline(format: typeof BRAIN_NORMAL) {
  const s = useWorkspace.getState();
  s.setField("technique", format.technique, { source: "template", replaceProvenance: true });
  s.setField("findings", format.findings, { source: "template", replaceProvenance: true });
  s.setField("impression", format.impression, { source: "template", replaceProvenance: true });
  s.setField("recommendation", format.recommendation, { source: "template", replaceProvenance: true });
  useWorkspace.setState({ appliedFormatName: format.name, appliedFormatReportTitle: format.reportTitle || null });
}

function overlayTile(tile: typeof FAZEKAS2, id: string, region: string) {
  return useWorkspace.getState().applyPathologyOverlay({
    incoming: { findings: tile.sentence, impression: tile.impressionSentence },
    templates: { findings: tile.sentence, impression: tile.impressionSentence },
    ownership: {
      concept: tile.concept,
      anatomicalSection: tile.anatomicalSection,
      conflictGroup: tile.conflictGroup,
      baselineReplaces: tile.baselineReplaces,
    },
    source: "quick-select",
    id,
    region,
    label: tile.label,
    findingsText: tile.sentence,
  });
}

describe("workflow scenes — normal bootstrap → deviations → restoration", () => {
  beforeEach(() => {
    useWorkspace.setState({
      findingsText: "",
      impressionText: "",
      recommendationText: "",
      techniqueText: "",
      clinicalHistoryText: "",
      fieldProvenance: {},
      appliedPathologyPatches: [],
      impressionNeedsRefresh: false,
      lastPatchSnapshot: null,
      confirmOverwriteOpen: false,
      pendingPathologyPatch: null,
      appliedFormatReportTitle: null,
      appliedFormatName: null,
      reportingContext: brainCtx(),
      reportFormats: DEFAULT_REPORT_FORMATS,
      selectedFormatIds: [],
      isFinalized: false,
    });
  });

  it("Scene 1 — normal Brain immediately after opening: complete report present", () => {
    const decision = resolveNormalBootstrapFormat({ ctx: brainCtx(), formats: DEFAULT_REPORT_FORMATS });
    expect(decision?.status).toBe("apply");
    applyBaseline(BRAIN_NORMAL);
    const s = useWorkspace.getState();

    // What the editor shows on open — every section complete, nothing to "start".
    console.log("SCENE 1 — MRI Brain Plain, immediately after open:\nTECHNIQUE:\n" + s.techniqueText + "\n\nFINDINGS:\n" + s.findingsText + "\n\nIMPRESSION:\n" + s.impressionText);
    expect(s.techniqueText.trim()).not.toBe("");
    expect(s.findingsText).toContain("Brain parenchyma shows normal signal intensity");
    expect(s.impressionText).toContain("Normal MRI brain");
    expect(s.recommendationText.trim()).not.toBe("");
    expect(useWorkspace.getState().appliedFormatName).toBe("MRI Brain — Normal");
    // Report is complete and coherent → finalize is possible right away.
    expect(editorComplete(s)).toBe(true);
  });

  it("Scene 2 — same case after abnormal Quick Select (Fazekas 2)", () => {
    applyBaseline(BRAIN_NORMAL);
    const result = overlayTile(FAZEKAS2, "qf-fazekas2-scene", "Brain");
    expect(result).toBe("applied");
    const s = useWorkspace.getState();

    console.log("SCENE 2 — after Fazekas 2 Quick Select:\nFINDINGS:\n" + s.findingsText + "\n\nIMPRESSION:\n" + s.impressionText);
    // Abnormal finding + impression line present.
    expect(s.findingsText).toContain("Fazekas grade 2");
    expect(s.impressionText).toContain("Fazekas grade 2");
    // Normal impression yielded (no contradictory "Normal MRI brain").
    expect(s.impressionText).not.toContain("Normal MRI brain");
    // Residual template normal line with intervening words must also yield
    // (previously "No acute intracranial abnormality." survived next to the
    // abnormal line — manual cleanup friction on every abnormal report).
    expect(s.impressionText).not.toContain("No acute intracranial abnormality");
    // Untouched structures remain normal (slot isolation).
    expect(s.findingsText).toContain("Ventricular system and cisternal spaces are normal");
    expect(s.findingsText).toContain("No restricted diffusion");
    expect(s.findingsText).toContain("Flow voids");
    // Ledger owns the slot → deselect can restore.
    const patch = useWorkspace.getState().appliedPathologyPatches.find((p) => p.id === "qf-fazekas2-scene");
    expect(patch).toBeTruthy();
  });

  it("Scene 3 — LS spine normal → one-level abnormal (L4-L5), then deselect restores baseline", () => {
    const decision = resolveNormalBootstrapFormat({ ctx: lsCtx(), formats: DEFAULT_REPORT_FORMATS });
    expect(decision?.status).toBe("apply");
    applyBaseline(LS_NORMAL);

    const beforeFindings = useWorkspace.getState().findingsText;
    const result = overlayTile(DISC_L45, "qf-disc-l45-scene", "LS Spine");
    expect(result).toBe("applied");
    const s = useWorkspace.getState();

    console.log("SCENE 3a — LS normal after L4-L5 disc bulge:\nFINDINGS:\n" + s.findingsText + "\n\nIMPRESSION:\n" + s.impressionText);
    // The abnormal level's finding + impression present.
    expect(s.findingsText).toContain("L4-L5");
    expect(s.findingsText).toContain("disc bulge");
    expect(s.impressionText).toContain("Disc herniation at L4-L5");
    // Other levels / unrelated normal statements remain normal.
    expect(s.findingsText).toContain("Lumbar vertebrae show normal alignment and marrow signal");
    expect(s.findingsText).toContain("Conus medullaris at L1 with normal appearance");
    // Normal impression yielded for the abnormal report.
    expect(s.impressionText).not.toContain("Normal MRI of the lumbar");
    // Residual contradictory normal line must yield as well.
    expect(s.impressionText).not.toContain("No acute bony or disc abnormality");

    // Abnormal → normal: deselect restores the system-owned baseline.
    useWorkspace.getState().removeObservation("qf-disc-l45-scene");
    const restored = useWorkspace.getState();
    console.log("SCENE 3b — after deselecting the L4-L5 abnormal:\nFINDINGS:\n" + restored.findingsText + "\n\nIMPRESSION:\n" + restored.impressionText);
    expect(restored.findingsText).not.toContain("Broad-based disc bulge at L4-L5");
    expect(restored.impressionText).not.toContain("Disc herniation at L4-L5");
    // Baseline text returned (deterministic, ownership-based restoration).
    // Sentence content matches the pre-overlay baseline exactly; the restored
    // form is newline-joined (the editor's canonical sentence layout).
    const sentences = (t: string) =>
      t.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
    expect(sentences(restored.findingsText)).toEqual(sentences(beforeFindings));
    // System normal impression re-seeded after the last abnormal is removed.
    expect(restored.impressionText.toLowerCase()).toContain("normal");
  });
});

function editorComplete(s: { techniqueText: string; findingsText: string; impressionText: string; recommendationText: string }): boolean {
  return Boolean(s.techniqueText.trim() && s.findingsText.trim() && s.impressionText.trim() && s.recommendationText.trim());
}
