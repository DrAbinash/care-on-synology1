import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { BUILTIN_ABNORMAL_PATTERNS } from "./abnormalPatterns";
import { stageAbnormalPatternForConfirm } from "@/hooks/radiology-workspace/useAbnormalPatternSuggestions";
import {
  extractAppliedPatternsFromStructuredJson,
  storedMarkerAfterLibraryVersionBump,
} from "@/lib/abnormalPatternDraft";

const lumbar = BUILTIN_ABNORMAL_PATTERNS.find((p) => p.id === "lumbar-degenerative-cascade")!;

function resetWorkspace() {
  useWorkspace.setState({
    clinicalHistoryText: "",
    techniqueText: "",
    findingsText: "",
    impressionText: "",
    recommendationText: "",
    fieldProvenance: {},
    appliedPathologyPatches: [],
    lastPatchSnapshot: null,
    patchUndoStack: [],
    isFinalized: false,
    isDirty: false,
    voiceComposerObservations: [],
    voiceComposerTranscriptHistory: [],
    mergePreviewOpen: false,
    lastMergeResult: null,
    lastMergeFormats: null,
    abnormalPatternConfirm: null,
    appliedPatternMarkers: [],
    confirmOverwriteOpen: false,
    pendingPathologyPatch: null,
    activeFindingsSectionId: null,
    linkedStudy: null,
    primaryFindingsSection: null,
  } as never);
}

describe("abnormal pattern confirm apply", () => {
  beforeEach(() => {
    resetWorkspace();
  });

  it("confirmed apply writes ledger observations and a frozen bundle marker", () => {
    stageAbnormalPatternForConfirm(lumbar, "LS Spine");
    expect(useWorkspace.getState().appliedPathologyPatches).toEqual([]);
    expect(useWorkspace.getState().mergePreviewOpen).toBe(true);

    useWorkspace.getState().applyMergedResult();

    const state = useWorkspace.getState();
    expect(state.mergePreviewOpen).toBe(false);
    expect(state.abnormalPatternConfirm).toBeNull();
    expect(state.appliedPathologyPatches.length).toBe(lumbar.bundle.length);
    for (const patch of state.appliedPathologyPatches) {
      expect(patch.source).toBe("abnormal-pattern");
      expect(patch.observation?.region).toBe("LS Spine");
      expect(patch.observation?.bundleId).toBe(`pattern-${lumbar.id}-v${lumbar.version}`);
      expect(patch.observation?.conflictGroup).toBeTruthy();
      expect(patch.ownership.conflictGroup).toBe(patch.observation?.conflictGroup);
    }
    const concepts = state.appliedPathologyPatches.map((p) => p.observation?.concept);
    expect(concepts).toEqual(expect.arrayContaining(["disc_signal", "disc_height", "osteophytes", "facet_joint", "endplate"]));
    expect(state.findingsText).toContain("Lumbar discs show loss of T2 signal (desiccation).");
    expect(state.impressionText).toContain("Lumbar degenerative disc disease.");
    expect(state.appliedPatternMarkers).toEqual([
      expect.objectContaining({
        patternId: lumbar.id,
        version: 1,
        bundleId: "pattern-lumbar-degenerative-cascade-v1",
      }),
    ]);
  });

  it("undoLastPatch reverts a pattern apply fully", () => {
    const beforeFindings = "Basal screening line.";
    useWorkspace.setState({ findingsText: beforeFindings, impressionText: "Normal study." } as never);
    stageAbnormalPatternForConfirm(lumbar, "LS Spine");
    useWorkspace.getState().applyMergedResult();
    expect(useWorkspace.getState().appliedPathologyPatches.length).toBeGreaterThan(0);

    const undone = useWorkspace.getState().undoLastPatch();
    expect(undone).toBe(true);
    const state = useWorkspace.getState();
    expect(state.appliedPathologyPatches).toEqual([]);
    expect(state.findingsText).toBe(beforeFindings);
    expect(state.impressionText).toBe("Normal study.");
    expect(state.appliedPatternMarkers).toEqual([]);
  });

  it("a library version bump does not mutate the stored applied marker", () => {
    stageAbnormalPatternForConfirm(lumbar, "LS Spine");
    useWorkspace.getState().applyMergedResult();
    const stored = useWorkspace.getState().appliedPatternMarkers[0]!;
    const frozen = storedMarkerAfterLibraryVersionBump(stored, lumbar.version + 1);
    expect(frozen).toBe(stored);
    expect(frozen.version).toBe(1);
    expect(frozen.bundleId).toBe("pattern-lumbar-degenerative-cascade-v1");
    useWorkspace.setState({
      abnormalPatternLibrary: [{ ...lumbar, version: lumbar.version + 1 }],
    } as never);
    expect(useWorkspace.getState().appliedPatternMarkers[0]).toEqual(stored);
    expect(useWorkspace.getState().appliedPatternMarkers[0]?.version).toBe(1);
  });

  it("an unconfirmed suggestion leaves the ledger untouched", () => {
    stageAbnormalPatternForConfirm(lumbar, "LS Spine");
    expect(useWorkspace.getState().appliedPathologyPatches).toEqual([]);
    expect(useWorkspace.getState().findingsText).toBe("");
    expect(useWorkspace.getState().impressionText).toBe("");
    useWorkspace.getState().cancelMerge();
    expect(useWorkspace.getState().appliedPathologyPatches).toEqual([]);
    expect(useWorkspace.getState().findingsText).toBe("");
    expect(useWorkspace.getState().abnormalPatternConfirm).toBeNull();
    expect(useWorkspace.getState().mergePreviewOpen).toBe(false);
  });

  it("round-trips applied markers through structuredJson without rewriting version", () => {
    const column = {
      kind: "care.structured_json_envelope",
      careAppliedPatterns: [{
        patternId: lumbar.id,
        version: 1,
        bundleId: "pattern-lumbar-degenerative-cascade-v1",
        appliedAt: "2026-09-27T00:00:00.000Z",
      }],
    };
    const restored = extractAppliedPatternsFromStructuredJson(column);
    expect(restored).toEqual(column.careAppliedPatterns);
    expect(storedMarkerAfterLibraryVersionBump(restored[0]!, 9).version).toBe(1);
    expect(extractAppliedPatternsFromStructuredJson(null)).toEqual([]);
  });
});
