/**
 * #168 — choosing a Normal report format over a report that already asserts an
 * abnormality.
 *
 * The clinical owner's rule: a normal template must never silently introduce a
 * contradictory whole-study normal Conclusion, and it must not silently discard
 * clinical information either.
 *
 * What this branch actually did before the fix, measured against the real store
 * action rather than inferred from reading it: `confirmOverwriteAndApply` wrote all
 * four sections with `replaceProvenance: true` and marked every non-baseline
 * observation stale. So a herniation the radiologist had clicked DISAPPEARED from
 * the Impression, replaced by "Normal MRI of the lumbosacral spine." — and no
 * confirmation was offered, because a Quick Select sentence classifies as
 * `generated` provenance, which `analyzeFormatOverwrite` treats as safe to replace.
 * Where his own words were protected, the two instead stood side by side: an
 * Impression asserting a canal stenosis and asserting the study was normal.
 *
 * Both failure modes are one missing rule: this door is a template, not a verdict on
 * the study. It now asks the same question every other door asks — does this report
 * assert an abnormality? — and when it does, the format contributes its anatomy and
 * withholds its Conclusion, the same suspended-normal row the Quick Select door
 * leaves behind, so removing the last abnormality still restores exactly one normal.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  quickFindingPatch,
  type ClinicalQuickFindingBox,
} from "./quickSelectTilePayload";
import { DEFAULT_REPORT_FORMATS } from "./report-formats-library";
import {
  MRI_LS_SPINE_STANDARD_NORMAL_IMPRESSION,
  MRI_LS_SPINE_STANDARD_NORMAL_NAME,
} from "./fullReportBaseline";
import { SYSTEM_NORMAL_PATCH_ID } from "@/lib/conceptCanon/normalImpression";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import { buildLivePrintBodyHtml } from "../radiologyReportPrintLiveMerge";
import { useWorkspace } from "./store";

const LS_NORMAL = DEFAULT_REPORT_FORMATS.find(
  (f) => f.name === MRI_LS_SPINE_STANDARD_NORMAL_NAME,
)!;

const STUDY_CTX = buildReportingStudyContext({
  modality: "MR", studyDescription: "MRI LS Spine", regions: ["LS Spine"], source: "auto",
});
const CLICK_CTX = { region: "LS Spine", studyType: "LS Spine" };

/** quick-select-tiles.data.ts — t("findings","Disc herniation L4-L5", …). */
const HERNIATION: ClinicalQuickFindingBox = {
  id: 9101,
  label: "Disc herniation L4-L5",
  studyType: "LS Spine",
  field: "findings",
  findingText: "Broad-based disc bulge at L4-L5 with posterocentral-right paracentral "
    + "protrusion causing indentation on the thecal sac and mild narrowing of bilateral "
    + "neural foramina. No significant central canal stenosis.",
  impressionText: "Disc herniation at L4-L5 causing indentation on the thecal sac.",
  techniqueText: "",
  recommendationText: "Conservative management with NSAIDs and physiotherapy.",
  concept: "disc_contour",
  conflictGroup: "disc bulge",
};

const NORMAL_HEAD = "Normal MRI of the lumbosacral spine.";
const lines = (text: string) => text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
const impression = () => useWorkspace.getState().impressionText;
const saysNormalStudy = () => lines(impression()).some((l) => l.startsWith(NORMAL_HEAD));
const row = (id: string) => useWorkspace.getState().appliedPathologyPatches.find((p) => p.id === id);

function resetWorkspace() {
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
    impressionDependencyReasons: [],
    impressionBasis: null,
    impressionOrderFrozen: false,
    lastPatchSnapshot: null,
    confirmOverwriteOpen: false,
    pendingPathologyPatch: null,
    pendingFormatIds: [],
    pendingFormatOverwrite: null,
    pendingFormatRegion: null,
    startingCanvasBaseline: null,
    appliedFormatName: null,
    appliedFormatReportTitle: null,
    reportingContext: STUDY_CTX,
    reportFormats: DEFAULT_REPORT_FORMATS,
    selectedFormatIds: [],
    isFinalized: false,
  });
}

/** MODE A's own entry point — the pass the workspace runs when the study opens. */
function openNormalLsSpine() {
  const outcome = useWorkspace.getState()
    .generateProfessionalReport(STUDY_CTX, { automatic: true, requireOwnedApprovedNormal: true });
  expect(outcome.status, "the automatic pass must build the approved normal").toBe("generated");
}

function click(box: ClinicalQuickFindingBox) {
  const patch = quickFindingPatch(box, CLICK_CTX);
  expect(useWorkspace.getState().applyPathologyOverlay(patch)).toBe("applied");
  return patch.id!;
}

/**
 * The radiologist choosing a format from the picker — not an automatic apply. When
 * the report carries text his own hand wrote, the provenance gate is supposed to ask
 * first, so this answers the dialog rather than pretending it never appeared.
 */
function chooseFormat() {
  useWorkspace.getState().applyFormatById(LS_NORMAL.id, { regionChoice: "radiologist" });
  if (useWorkspace.getState().confirmOverwriteOpen) {
    useWorkspace.getState().confirmOverwriteAndApply();
  }
}

function printedImpressionItems(): string[] {
  const html = buildLivePrintBodyHtml({
    clinicalHistory: useWorkspace.getState().clinicalHistoryText,
    technique: useWorkspace.getState().techniqueText,
    rawFindings: useWorkspace.getState().findingsText,
    findingsMap: {},
    useStructured: false,
    impression: lines(impression()),
    recommendation: useWorkspace.getState().recommendationText,
    headingCase: "all_caps",
    impressionStyle: "numbered",
  });
  const list = /<ol>([\s\S]*?)<\/ol>/.exec(html);
  if (!list) return [];
  return [...list[1]!.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]!.trim());
}

beforeEach(resetWorkspace);

describe("a Normal format chosen over an abnormal report", () => {
  it("keeps the conclusion he clicked and withholds the format's normal one", () => {
    openNormalLsSpine();
    const id = click(HERNIATION);
    expect(impression()).toBe(HERNIATION.impressionText);

    chooseFormat();

    expect(impression(), "the abnormal Conclusion is the radiologist's clinical content")
      .toBe(HERNIATION.impressionText);
    expect(saysNormalStudy(), "…and the whole-study normal may not be introduced over it").toBe(false);
    expect(row(id), "the clicked row must still be in the ledger").toBeTruthy();
    expect(row(id)!.stale, "staling the row would drop the conclusion from the next rebuild").toBeFalsy();
  });

  it("prints no Impression item that answers the abnormality it carries", () => {
    openNormalLsSpine();
    click(HERNIATION);
    chooseFormat();
    const items = printedImpressionItems();
    expect(items).toEqual([HERNIATION.impressionText]);
    expect(items.filter((i) => i.startsWith(NORMAL_HEAD))).toEqual([]);
  });

  it("still restores exactly one approved normal when the last abnormality comes off", () => {
    openNormalLsSpine();
    const id = click(HERNIATION);
    chooseFormat();
    // The normal this format carries was suspended, not forgotten — which is what
    // makes the ordinary end-of-sequence behaviour survive a format change.
    expect(row(SYSTEM_NORMAL_PATCH_ID)!.lastRendered.impression).toBe("");

    useWorkspace.getState().removeObservation(id);
    expect(impression()).toBe(MRI_LS_SPINE_STANDARD_NORMAL_IMPRESSION);
    expect(lines(impression())).toHaveLength(1);
    expect(printedImpressionItems()).toEqual([MRI_LS_SPINE_STANDARD_NORMAL_IMPRESSION]);
  });

  it("keeps every Conclusion line he wrote himself and introduces no normal of its own", () => {
    openNormalLsSpine();
    const his = "Disc herniation at L4-L5 compresses the traversing left L5 root.";
    useWorkspace.getState().mergeField("impression", his, "manual");
    const beforeLines = lines(impression());
    const normalBefore = beforeLines.filter((l) => l.startsWith(NORMAL_HEAD)).length;

    chooseFormat();

    const afterLines = lines(impression());
    expect(afterLines).toContain(his);
    expect(beforeLines.every((l) => afterLines.includes(l)), "his report is never shortened by a template")
      .toBe(true);
    expect(afterLines.filter((l) => l.startsWith(NORMAL_HEAD))).toHaveLength(normalBefore);

    // MEASURED, AND DELIBERATELY NOT FIXED BY THIS DOOR: `normalBefore` is 1, so the
    // Impression on the page still says the study is normal above his own abnormal
    // Conclusion. That normal was written by the automatic pass, not by this format
    // apply, and this door only ever refuses to ADD one — removing it means a free-text
    // abnormality (no ledger row, so no contribution identity to scope the deletion to
    // and no removal event to restore it from) silently editing his Conclusion. The
    // click door can do that safely because its abnormality IS a row. Typing an abnormal
    // conclusion into a normal report is a separate defect with a clinical decision
    // attached: does the normal come off the page, or does the doctor get told?
    expect(normalBefore, "documents the open gap rather than asserting it is closed").toBe(1);
  });

  it("leaves a report with nothing abnormal in it exactly as a normal apply should", () => {
    openNormalLsSpine();
    expect(impression()).toBe(MRI_LS_SPINE_STANDARD_NORMAL_IMPRESSION);

    chooseFormat();

    expect(impression()).toBe(MRI_LS_SPINE_STANDARD_NORMAL_IMPRESSION);
    expect(lines(impression())).toHaveLength(1);
    expect(row(SYSTEM_NORMAL_PATCH_ID)!.lastRendered.impression)
      .toBe(MRI_LS_SPINE_STANDARD_NORMAL_IMPRESSION);
  });

  it("survives save and reopen with the same clinical answer", () => {
    openNormalLsSpine();
    click(HERNIATION);
    chooseFormat();
    const before = impression();
    const serialized = useWorkspace.getState().serializeObservationLedger();
    const prose = {
      findingsText: useWorkspace.getState().findingsText,
      impressionText: before,
      recommendationText: useWorkspace.getState().recommendationText,
      techniqueText: useWorkspace.getState().techniqueText,
      clinicalHistoryText: useWorkspace.getState().clinicalHistoryText,
    };
    resetWorkspace();
    useWorkspace.setState(prose);
    expect(useWorkspace.getState().hydrateObservationLedger(serialized).ok).toBe(true);
    expect(impression()).toBe(before);
    expect(saysNormalStudy()).toBe(false);
    useWorkspace.getState().refreshImpressionFromLedger({
      automatic: true, excludeBaselineObservations: true,
    });
    expect(impression(), "the reopened ledger must not reinvent the normal").toBe(before);
  });
});
