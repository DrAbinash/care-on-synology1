import { describe, expect, it, vi } from "vitest";
import { DEFAULT_REPORT_FORMATS } from "./report-formats-library";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import { emptyViewerMeasurementsState } from "@/lib/structuredViewerMeasurements";
import {
  quickFindingPatch,
  type ClinicalQuickFindingBox,
} from "./quickSelectTilePayload";
import { useWorkspace } from "./store";

const STUDY_CTX = buildReportingStudyContext({
  modality: "MR", studyDescription: "MRI LS Spine", regions: ["LS Spine"], source: "auto",
});
const CLICK_CTX = { region: "LS Spine", studyType: "LS Spine" };

const MILD: ClinicalQuickFindingBox = {
  id: 9111, label: "Mild canal stenosis L4-L5", studyType: "LS Spine", field: "findings",
  findingText: "Mild canal stenosis at L4-L5 without cord compression.",
  impressionText: "Mild canal stenosis at L4-L5.", techniqueText: "", recommendationText: "",
  concept: "canal_stenosis", conflictGroup: "canal stenosis",
};
const MODERATE: ClinicalQuickFindingBox = {
  ...MILD, id: 9102, label: "Moderate canal stenosis L4-L5",
  findingText: "Moderate canal stenosis at L4-L5.", impressionText: "Moderate canal stenosis at L4-L5.",
};

function resetWorkspace() {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  useWorkspace.setState({
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    impressionNeedsRefresh: false, impressionDependencyReasons: [], impressionBasis: null,
    impressionOrderFrozen: false, lastPatchSnapshot: null, confirmOverwriteOpen: false,
    pendingPathologyPatch: null, pendingFormatIds: [], pendingFormatOverwrite: null,
    pendingFormatRegion: null, startingCanvasBaseline: null, appliedFormatName: null,
    appliedFormatReportTitle: null, reportingContext: STUDY_CTX,
    reportFormats: DEFAULT_REPORT_FORMATS, selectedFormatIds: [], isFinalized: false,
    coverageMarks: [], coverageByScope: {}, regionTransitions: [],
    structuredViewerMeasurements: emptyViewerMeasurementsState(),
    canalApProvenance: {}, linkedStudy: null, appliedPatternMarkers: [],
    voiceComposerObservations: [], patchUndoStack: [], patchRedoStack: [],
    selectedObservationId: null, instantReportHold: null,
  });
}

function open() {
  const outcome = useWorkspace.getState()
    .generateProfessionalReport(STUDY_CTX, { automatic: true, requireOwnedApprovedNormal: true });
  expect(outcome.status).toBe("generated");
  return useWorkspace.getState().findingsText;
}

function click(box: ClinicalQuickFindingBox) {
  const patch = quickFindingPatch(box, CLICK_CTX);
  expect(useWorkspace.getState().applyPathologyOverlay(patch)).toBe("applied");
  return patch.id!;
}

describe("debug pollution", () => {
  it("what does the recompose+deselect flow leave behind?", () => {
    resetWorkspace();
    const scaffoldA = open().split(/\n+/).map((s) => s.trim()).filter(Boolean);
    click(MILD);
    click(MODERATE);
    useWorkspace.getState().composeInstantReport(STUDY_CTX, false);
    const row = useWorkspace.getState().appliedPathologyPatches.find(
      (p) => !p.stale && p.observation?.concept === "canal_stenosis",
    )!;
    useWorkspace.getState().removeObservation(row.id);
    resetWorkspace();
    const scaffoldB = open().split(/\n+/).map((s) => s.trim()).filter(Boolean);
    const missing = scaffoldA.filter((s) => !scaffoldB.includes(s));
    const added = scaffoldB.filter((s) => !scaffoldA.includes(s));
    console.log("MISSING FROM SECOND SCAFFOLD:", JSON.stringify(missing, null, 2));
    console.log("ADDED IN SECOND SCAFFOLD:", JSON.stringify(added, null, 2));
    // What store fields differ between the two fresh-open states?
    console.log("ledger rows:", useWorkspace.getState().appliedPathologyPatches.map((p) => `${p.id}:${p.observation?.concept}:${p.observation?.level ?? ""}:${p.stale ? "stale" : "live"}`));
  });
});
