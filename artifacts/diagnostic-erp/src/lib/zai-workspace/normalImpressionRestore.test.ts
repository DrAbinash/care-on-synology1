/**
 * CAT-P4 and CAT-P5, pinned as measured defects on the automatic Impression
 * composer — see the test body for what was observed and what is wrong about it.
 *
 * When the last abnormal box comes off, the removal path re-derives the Impression
 * line by line. A normal conclusion authored as a single sentence therefore came
 * back as TWO Impression items: the same words, a different report, and on the
 * numbered Impression the clinic prints, a visible duplicate section break.
 *
 * The box here is a fixture rather than a shipped tile on purpose: any clinic can
 * author a box whose conclusion supersedes no normal sentence of its own, and a
 * facet arthropathy is exactly that. `quickFindingPatch` is the builder the live
 * strip uses for a database row (`quickSelectBoxCatalogue.ts`), and the overlay
 * and removal are the real store actions — nothing below bypasses a write path.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { quickFindingPatch, type ClinicalQuickFindingBox } from "./quickSelectTilePayload";
import { DEFAULT_REPORT_FORMATS } from "./report-formats-library";
import { MRI_LS_SPINE_STANDARD_NORMAL_NAME } from "./fullReportBaseline";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import { useWorkspace } from "./store";

const LS_NORMAL = DEFAULT_REPORT_FORMATS.find((f) => f.name === MRI_LS_SPINE_STANDARD_NORMAL_NAME)!;
const CTX = { region: "LS Spine", studyType: "LS Spine" };

const facetBox: ClinicalQuickFindingBox = {
  id: 980,
  label: "Facet arthropathy L4-L5",
  studyType: "LS Spine",
  findingText: "Facet arthropathy at L4-L5.",
  impressionText: "Facet arthropathy at L4-L5.",
  techniqueText: "",
  recommendationText: "",
  concept: "facet_joint",
  conflictGroup: "facet",
  field: "findings",
};

beforeEach(() => {
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
  useWorkspace.getState().applyFormatById(LS_NORMAL.id);
});

describe("removing the last abnormal box", () => {
  it("CAT-P4 + CAT-P5, measured and NOT yet fixed: the normal conclusion is neither re-shaped nor withdrawn", () => {
    // Pinned as a defect record, not as accepted behaviour. Measured on this
    // branch with the real builder and the real store actions:
    //
    //   after apply  -> "Normal MRI of the lumbosacral spine.\nNo significant disc,
    //                    canal, foraminal or neural compressive abnormality.\n
    //                    Facet arthropathy at L4-L5."
    //   after remove -> the same normal conclusion, still on two lines.
    //   the format   -> one line: "Normal MRI of the lumbosacral spine. No significant…"
    //
    // CAT-P4 is the shape: the automatic Impression composer re-emits the normal
    // conclusion sentence by sentence, so a one-sentence format conclusion prints
    // as two numbered items. CAT-P5 is worse and is the reason this is a blocker:
    // a box whose conclusion supersedes no normal sentence of its own leaves the
    // WHOLE normal conclusion standing above it, so the report asserts a normal
    // study and a facet arthropathy in the same section. An attempted restore-side
    // guard was measured to be inert here — there is no suspended baseline patch
    // in this path — so the fix belongs in the composer, not in removal.
    const patch = quickFindingPatch(facetBox, CTX);
    expect(useWorkspace.getState().applyPathologyOverlay(patch)).toBe("applied");
    const afterApply = useWorkspace.getState().impressionText;
    expect(afterApply).toContain("Facet arthropathy at L4-L5.");
    expect(afterApply, "CAT-P5: the normal conclusion is still standing").toContain(
      "Normal MRI of the lumbosacral spine",
    );
    expect(afterApply.split("\n").filter((l) => l.trim())).toHaveLength(3);

    useWorkspace.getState().removeObservation(patch.id!);
    const afterRemove = useWorkspace.getState().impressionText;
    expect(afterRemove, "CAT-P4: a one-sentence conclusion comes back as two lines").not.toBe(
      LS_NORMAL.impression,
    );
    expect(afterRemove.replace(/\n/g, " ")).toBe(LS_NORMAL.impression);
  });

  it("never says the normal thing twice", () => {
    const patch = quickFindingPatch(facetBox, CTX);
    useWorkspace.getState().applyPathologyOverlay(patch);
    useWorkspace.getState().removeObservation(patch.id!);
    const text = useWorkspace.getState().impressionText;
    expect(text.match(/Normal MRI of the lumbosacral spine/g)?.length).toBe(1);
    expect(text.match(/No significant disc, canal, foraminal or neural/g)?.length).toBe(1);
  });

  it("does not resurrect a normal the radiologist deleted, and does not invent one", () => {
    // The guard is deliberately one-sided: a rebuild that no longer matches the
    // suspended string is left exactly as the removal path made it, so fixing the
    // shape can never become a way of overwriting what is on the page.
    const patch = quickFindingPatch(facetBox, CTX);
    useWorkspace.getState().applyPathologyOverlay(patch);
    useWorkspace.setState({ impressionText: "Facet arthropathy at L4-L5.\nRe operated spine." });
    useWorkspace.getState().removeObservation(patch.id!);
    const text = useWorkspace.getState().impressionText;
    expect(text).toContain("Re operated spine.");
  });
});
