/**
 * One Quick Select box, one coherent report.
 *
 * The owner's workflow is: the Normal format opens, he reads the images, he
 * clicks one box, he prints. For that to be safe the box has to finish the whole
 * report — the sentence in Findings, the line in Impression, and the advice in
 * Recommendation — and undo all three when he clicks it off again. Recommendation
 * was silently dropped by the button even though the engine and the database
 * column both supported it, so a herniation could print with "Normal MRI
 * lumbo-sacral spine" advice underneath it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { quickSelectTileFromForm, quickSelectTilePatch } from "./quickSelectTilePayload";
import { DEFAULT_QUICK_SELECT_TILES, lookupTilesForContext } from "./quick-select-library";
import { DEFAULT_REPORT_FORMATS } from "./report-formats-library";
import { MRI_LS_SPINE_STANDARD_NORMAL_NAME } from "./fullReportBaseline";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import { useWorkspace } from "./store";
import type { QuickSelectTile } from "./types";

function tile(label: string): QuickSelectTile {
  const found = (DEFAULT_QUICK_SELECT_TILES as unknown as QuickSelectTile[]).find(
    (t) => t.label === label,
  );
  if (!found) throw new Error(`Quick Select tile "${label}" is missing from the catalog`);
  return found;
}

const LS_NORMAL = DEFAULT_REPORT_FORMATS.find((f) => f.name === MRI_LS_SPINE_STANDARD_NORMAL_NAME)!;

function resetWorkspace() {
  // Opening a format reports its use; this suite is about the report, not the hit.
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
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
    startingCanvasBaseline: null,
    appliedFormatName: null,
    appliedFormatReportTitle: null,
    reportingContext: buildReportingStudyContext({
      modality: "MR", studyDescription: "MRI LS Spine", regions: ["LS Spine"], source: "auto",
    }),
    reportFormats: DEFAULT_REPORT_FORMATS,
    selectedFormatIds: [],
    isFinalized: false,
  });
  // The Normal report is opened the way the workspace opens it, so the sections
  // carry the provenance the engine needs to know it may rewrite them.
  useWorkspace.getState().applyFormatById(LS_NORMAL.id);
}

describe("the payload one box click sends", () => {
  it("carries all three sentences a findings box promises", () => {
    const patch = quickSelectTilePatch(tile("Disc herniation L4-L5"), "findings");
    expect(patch.incoming).toEqual({
      findings: tile("Disc herniation L4-L5").sentence,
      impression: tile("Disc herniation L4-L5").impressionSentence,
      recommendation: tile("Disc herniation L4-L5").recommendationSentence,
    });
    expect(patch.templates).toBe(patch.incoming);
    expect(patch.source).toBe("quick-select");
  });

  it("sends nothing it does not have", () => {
    // A box with no advice of its own must leave the report's Recommendation
    // exactly as the radiologist or the format wrote it.
    const bare = quickSelectTilePatch(tile("Normal LS spine"), "findings");
    expect(bare.incoming.recommendation).toBeUndefined();
  });

  it("routes an Impression-field box to the Impression only", () => {
    const patch = quickSelectTilePatch(tile("Disc herniation L4-L5"), "impression");
    expect(patch.incoming.findings).toBeUndefined();
    expect(patch.incoming.recommendation).toBeUndefined();
    expect(patch.incoming.impression).toBe(tile("Disc herniation L4-L5").sentence);
  });
});

describe("one click on a normal report", () => {
  beforeEach(resetWorkspace);

  it("finishes the report: findings, impression and recommendation together", () => {
    const tileData = tile("Disc herniation L4-L5");
    const status = useWorkspace.getState().applyPathologyOverlay(
      quickSelectTilePatch(tileData, "findings"),
    );
    expect(status).toBe("applied");
    const s = useWorkspace.getState();

    expect(s.findingsText).toContain("Broad-based disc bulge at L4-L5");
    expect(s.impressionText).toContain("Disc herniation at L4-L5");
    expect(s.impressionText).not.toContain("Normal MRI");
    expect(s.recommendationText).toContain(
      "Conservative management with NSAIDs and physiotherapy",
    );
  });

  it("puts the advice back the way it was when the box is clicked off", () => {
    const tileData = tile("Disc herniation L4-L5");
    const id = quickSelectTilePatch(tileData, "findings").id!;
    useWorkspace.getState().applyPathologyOverlay(quickSelectTilePatch(tileData, "findings"));
    expect(useWorkspace.getState().recommendationText).not.toBe(LS_NORMAL.recommendation);

    useWorkspace.getState().removeObservation(id);
    const s = useWorkspace.getState();
    expect(s.findingsText).toContain("No significant disc bulge or protrusion");
    expect(s.impressionText).toBe(LS_NORMAL.impression);
    expect(s.recommendationText).toBe(LS_NORMAL.recommendation);
  });

  it("says the advice once, not once per click", () => {
    const patch = quickSelectTilePatch(tile("Disc herniation L4-L5"), "findings");
    useWorkspace.getState().applyPathologyOverlay(patch);
    useWorkspace.getState().applyPathologyOverlay({ ...patch, id: `${patch.id}-again` });
    const text = useWorkspace.getState().recommendationText;
    const hits = text.split("Conservative management with NSAIDs").length - 1;
    expect(hits).toBe(1);
  });
});

describe("boxes reachable on the study being read", () => {
  const ctxFor = (region: string) => buildReportingStudyContext({
    modality: "MR", studyDescription: `MRI ${region}`, regions: [region], source: "auto",
  });
  const labels = (region: string) => lookupTilesForContext(
    DEFAULT_QUICK_SELECT_TILES, "findings", "MR", ctxFor(region),
  ).map((t) => t.label);

  it("opens up on a Whole Spine screening study, which is three examinations", () => {
    const shown = labels("Whole Spine");
    expect(shown, "measured empty before this fix").toContain("Disc herniation L4-L5");
    expect(shown).toContain("Loss of cervical lordosis");
  });

  it("does not widen a single-segment study", () => {
    const shown = labels("LS Spine");
    expect(shown).toContain("Disc herniation L4-L5");
    expect(shown).not.toContain("Loss of cervical lordosis");
  });

  it("keeps a lumbar box owned by the lumbar region when a whole-spine study clicks it", () => {
    const patch = quickSelectTilePatch(tile("Disc herniation L4-L5"), "findings");
    expect(patch.region).toBe("LS Spine");
  });
});

describe("a box the radiologist makes himself", () => {
  it("keeps the advice he typed and puts it in the report", () => {
    // The editor's Save goes through the store, which persists to localStorage;
    // this is the closest this suite can come to actually clicking the button.
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    resetWorkspace();

    const advice = "Refer to the spine surgeon. Repeat MRI at 6 weeks.";
    useWorkspace.getState().saveQuickSelectTile({
      field: "findings",
      label: "My own herniation box",
      sentence: "Large right paracentral disc extrusion at L5-S1 compressing the S1 root.",
      category: "abnormal",
      scopeModality: "MR",
      scopeBodyPart: "LS Spine",
      favorite: false,
      custom: true,
      usageCount: 0,
      impressionSentence: "Disc extrusion at L5-S1 with S1 root compression.",
      recommendationSentence: advice,
    });

    const mine = useWorkspace.getState().quickSelectTiles
      .find((t) => t.label === "My own herniation box");
    expect(mine, "the saved box is not in the catalog").toBeTruthy();
    expect(mine!.recommendationSentence).toBe(advice);

    useWorkspace.getState().applyPathologyOverlay(quickSelectTilePatch(mine!, "findings"));
    const text = useWorkspace.getState().recommendationText;
    // One sentence per line, which is how the engine writes every section —
    // and the report's own advice is still there underneath it.
    expect(text.split("\n")).toEqual([
      "Clinical correlation.",
      "Refer to the spine surgeon.",
      "Repeat MRI at 6 weeks.",
    ]);
  });
});

describe("editing a shipped box keeps what it carries", () => {
  it("saves the Impression and Recommendation lines it was seeded with", () => {
    const existing = tile("Disc herniation L4-L5");
    // Exactly how the editor seeds its inputs from the tile being edited.
    const saved = quickSelectTileFromForm(existing, {
      field: "findings",
      label: "Disc herniation L4-L5",
      sentence: existing.sentence,
      mnemonic: existing.mnemonic ?? "",
      category: existing.category,
      scopeModality: existing.scopeModality ?? "",
      scopeBodyPart: existing.scopeBodyPart ?? "",
      favorite: false,
      conflictGroup: existing.conflictGroup ?? "",
      anatomicalSection: existing.anatomicalSection ?? "",
      baselineReplaces: existing.baselineReplaces ?? "",
      impressionSentence: existing.impressionSentence ?? "",
      recommendationSentence: existing.recommendationSentence ?? "",
    });
    // Renaming a box used to delete the sentence it wrote into the Impression,
    // because the save payload only carried fields that had an input.
    expect(saved.impressionSentence).toBe(existing.impressionSentence);
    expect(saved.recommendationSentence).toBe(existing.recommendationSentence);
  });

  it("keeps advice on the boxes the clinic relies on for a one-click report", () => {
    for (const label of [
      "Acute infarct (DWI)",
      "Fazekas 1",
      "Fazekas 2",
      "Glioma recurrence",
      "Hydrocephalus",
      "Disc herniation L4-L5",
      "Grade 1 spondylolisthesis L4-L5",
      "Compression fracture L1",
      "Loss of cervical lordosis",
    ]) {
      expect(tile(label).recommendationSentence, label).toBeTruthy();
    }
  });
});
