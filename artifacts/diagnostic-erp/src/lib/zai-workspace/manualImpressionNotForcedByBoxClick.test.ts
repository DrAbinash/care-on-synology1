/**
 * Defect #180 — clicking a Quick Select box deleted a sentence the radiologist had
 * typed into the Impression field himself.
 *
 * The cause was not the box and not the system-owned normal: `applyPathologyOverlay`
 * implied `force` whenever the incoming tile took over an existing ledger slot
 * (`plan.action === "update"`), and `force` is the one flag that lets
 * `applyPathologyPatch` evict a provenance-protected sentence. So a tile for the
 * L4-L5 disc contour, clicking into the slot his own sentence described, replaced
 * that sentence with the tile's conclusion — silently, and with no review flag.
 * Measured by control: it happens with the system-normal row deleted from the ledger
 * entirely, so ruling 1's yield was never involved, and it does NOT happen to a
 * manual sentence in some other slot.
 *
 * Owner ruling 1 closes this: "Withdraw system-owned normal text when the
 * contradiction is reliably established; otherwise flag for review. Never silently
 * delete manual text." The collision now goes through the door built for it —
 * `ambiguous` → ConfirmOverwriteDialog — and the dialog names the sentence at risk,
 * because a warning that describes only the colliding slot is not a warning.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_QUICK_SELECT_TILES as TILES } from "./quick-select-tiles.data";
import { clinicalBoxForTile } from "./quickSelectTileFixture";
import {
  quickFindingPatch,
  type ClinicalQuickFindingBox,
} from "./quickSelectTilePayload";
import { DEFAULT_REPORT_FORMATS } from "./report-formats-library";
import { MRI_LS_SPINE_STANDARD_NORMAL_IMPRESSION } from "./fullReportBaseline";
import { SYSTEM_NORMAL_PATCH_ID } from "@/lib/conceptCanon/normalImpression";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import { useWorkspace } from "./store";

const STUDY_CTX = buildReportingStudyContext({
  modality: "MR", studyDescription: "MRI LS Spine", regions: ["LS Spine"], source: "auto",
});
const CLICK_CTX = { region: "LS Spine", studyType: "LS Spine" };

const NORMAL_HEAD = "Normal MRI of the lumbosacral spine.";
const HIS_HEMNATION = "Disc herniation at L4-L5 causing indentation on the thecal sac.";
const HIS_STENOSIS = "Moderate canal stenosis at L4-L5.";
const HIS_UNRELATED = "Clinical correlation is advised for right-sided radiculopathy.";

/** The shipped L4-L5 disc tile: its Findings wording is what makes the slot claim his sentence. */
const DISC_TILE: ClinicalQuickFindingBox = {
  id: 9101,
  label: "Disc herniation L4-L5",
  studyType: "LS Spine",
  field: "findings",
  findingText: "Broad-based disc bulge at L4-L5 with posterocentral-right paracentral protrusion "
    + "causing indentation on the thecal sac and mild narrowing of bilateral neural foramina.",
  impressionText: HIS_STENOSIS,
  techniqueText: "",
  recommendationText: "",
  concept: "disc_contour",
  conflictGroup: "disc bulge",
};

const lines = (text: string) => text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
const impression = () => useWorkspace.getState().impressionText;
const saysNormalStudy = () => lines(impression()).some((l) => l.startsWith(NORMAL_HEAD));
const pending = () => useWorkspace.getState().pendingPathologyPatch;

/** The editor's call shape — `findings-editor.tsx:395/403` passes no source. */
const type = (text: string) => useWorkspace.getState().setField("impression", text);

function click(tile: ClinicalQuickFindingBox) {
  const patch = quickFindingPatch(tile, CLICK_CTX);
  return useWorkspace.getState().applyPathologyOverlay(patch);
}

/**
 * The box production actually sends, read off the shipped catalogue through the one
 * adapter the overlay suites use. A fixture that files its own sentences could describe
 * a collision the clinic never has, so the two tests below are the proof on real prose.
 */
function shippedBox(label: string): ClinicalQuickFindingBox {
  const tile = TILES.find((t) => t.label === label);
  expect(tile, `the catalogue no longer ships ${label}`).toBeTruthy();
  return clinicalBoxForTile(tile!);
}

const shippedTileSentence = (label: string) =>
  TILES.find((t) => t.label === label)!.impressionSentence ?? "";

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
  const outcome = useWorkspace.getState()
    .generateProfessionalReport(STUDY_CTX, { automatic: true, requireOwnedApprovedNormal: true });
  expect(outcome.status).toBe("generated");
  expect(saysNormalStudy(), "the approved normal is on the page").toBe(true);
});

describe("#180 · a box click may not force over what he wrote", () => {
  it("keeps his Impression sentence and asks, instead of replacing it silently", () => {
    openNormalThenContradictIt();

    expect(click(DISC_TILE), "the click asks rather than deletes").toBe("pending");
    expect(impression(), "his sentence is still on the page").toContain(HIS_HEMNATION);
    // Priority 1 hold semantics: while the answer is outstanding the click has
    // written NOTHING — the tile's conclusion is not "arrived beside it" yet.
    // It appears only when he presses Replace; a cancel never sees it at all.
    expect(impression(), "the tile's conclusion is held with the click, not inserted")
      .not.toContain(HIS_STENOSIS);
    expect(useWorkspace.getState().confirmOverwriteOpen, "with the dialog open").toBe(true);
  });

  it("names the sentence at risk, in the section it sits in", () => {
    openNormalThenContradictIt();
    click(DISC_TILE);

    const kept = pending()?.manualKept;
    expect(kept, "the pending patch carries what would be lost").toBeTruthy();
    expect(kept!.impression, "his Impression line, as the page shows it").toContain(HIS_HEMNATION);
    expect(kept!.findings, "his Findings were never in play").toEqual([]);
    expect(pending()!.incoming.impression, "and the wording that would replace it").toBe(HIS_STENOSIS);
  });

  it("is not the system normal that causes it — same result with that row deleted", () => {
    openNormalThenContradictIt();
    useWorkspace.setState((s) => ({
      appliedPathologyPatches: s.appliedPathologyPatches
        .filter((p) => p.id !== SYSTEM_NORMAL_PATCH_ID),
    }));

    expect(click(DISC_TILE)).toBe("pending");
    expect(impression(), "his sentence survives without any system row on the ledger")
      .toContain(HIS_HEMNATION);
  });

  it("still replaces without asking when his line is the tile's own wording", () => {
    useWorkspace.getState().setField("impression", MRI_LS_SPINE_STANDARD_NORMAL_IMPRESSION);
    type(HIS_STENOSIS);

    expect(click(DISC_TILE), "re-clicking the tile he just retyped is not a conflict").toBe("applied");
    expect(lines(impression()), "one line, the tile's").toEqual([HIS_STENOSIS]);
    expect(useWorkspace.getState().confirmOverwriteOpen, "and no dialog").toBe(false);
  });

  it("still replaces without asking a sentence in some other slot", () => {
    openNormalThenContradictIt();
    type(`${HIS_HEMNATION}\n${HIS_UNRELATED}`);
    useWorkspace.setState((s) => ({
      appliedPathologyPatches: s.appliedPathologyPatches.filter(
        (p) => p.id !== SYSTEM_NORMAL_PATCH_ID),
    }));

    expect(click({ ...DISC_TILE, impressionText: HIS_STENOSIS, conflictGroup: "canal stenosis",
      concept: "spinal_stenosis",
      findingText: "Moderate hypertrophy of ligamentum flavum at L4-L5." })).toBe("applied");
    expect(impression(), "the sentence this tile does not describe is kept").toContain(HIS_UNRELATED);
  });

  it("asks about the collision on the box the catalogue actually ships", () => {
    const tileSentence = shippedTileSentence("Disc herniation L4-L5");
    const HIS_PARAPHRASE = "Disc herniation at L4-L5 indenting the thecal sac.";
    expect(tileSentence, "the shipped tile writes its own conclusion").toBeTruthy();
    expect(HIS_PARAPHRASE, "and it is not the wording he chose").not.toBe(tileSentence);

    type(HIS_PARAPHRASE);
    expect(saysNormalStudy(), "ruling 1 withdrew the normal").toBe(false);

    expect(click(shippedBox("Disc herniation L4-L5")), "so the click asks").toBe("pending");
    expect(impression(), "his wording is not silently traded for the tile's")
      .toContain(HIS_PARAPHRASE);
    expect(pending()?.manualKept?.impression, "and the dialog is told which line")
      .toContain(HIS_PARAPHRASE);
  });

  it("does not interrupt him when his sentence is the tile's own wording", () => {
    const tileSentence = shippedTileSentence("Disc herniation L4-L5");

    type(tileSentence);
    expect(click(shippedBox("Disc herniation L4-L5")), "the same words are not a loss").toBe("applied");
    expect(lines(impression()), "one line, not his sentence twice").toEqual([tileSentence]);
    expect(useWorkspace.getState().confirmOverwriteOpen, "and no dialog").toBe(false);
  });

  it("keeps his sentence when he declines", () => {
    openNormalThenContradictIt();
    click(DISC_TILE);

    useWorkspace.getState().cancelOverwrite();

    expect(impression()).toContain(HIS_HEMNATION);
    expect(useWorkspace.getState().confirmOverwriteOpen, "the dialog closed").toBe(false);
    expect(saysNormalStudy(), "and the withdrawn normal did not ride in with the cancel").toBe(false);
  });

  it("replaces it when he agrees — the confirmation path still works", () => {
    openNormalThenContradictIt();
    click(DISC_TILE);

    useWorkspace.getState().confirmOverwriteAndApply();

    expect(impression(), "his sentence goes only after he said so")
      .not.toContain(HIS_HEMNATION);
    expect(impression(), "and the tile's conclusion stands").toContain(HIS_STENOSIS);
    expect(saysNormalStudy(), "with the normal still withdrawn").toBe(false);
  });
});

/** He writes his own abnormal conclusion over the normal the study opened with. */
function openNormalThenContradictIt() {
  type(`${MRI_LS_SPINE_STANDARD_NORMAL_IMPRESSION}\n${HIS_HEMNATION}`);
  expect(saysNormalStudy(), "ruling 1 withdrew the normal").toBe(false);
  expect(impression()).toContain(HIS_HEMNATION);
}
