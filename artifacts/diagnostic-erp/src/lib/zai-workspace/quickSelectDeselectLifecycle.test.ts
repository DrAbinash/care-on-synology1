/**
 * #167 — the Quick Select lifecycle the clinical owner asked for, at the store's own
 * entry points: click a box, its Findings and Impression appear; click it off again,
 * ONLY what it owns leaves; when the last abnormality comes off, exactly the approved
 * normal returns.
 *
 * The case that broke in the real workspace (study 17, Playwright, 2026-10-18) is the
 * "Moderate canal stenosis L4-L5" box, whose Findings sentence and Impression sentence
 * are the SAME sentence ("Moderate canal stenosis at L4-L5."). Deselecting it took the
 * row out of the ledger and brought the approved normal back, but the sentence stayed
 * on the page in BOTH sections, so the printed Impression asserted a moderate canal
 * stenosis and, one line above it, that there was no canal abnormality — and the canvas
 * armed "Impression needs refresh / Refresh from Finding", pointing the radiologist at
 * the leftover text of the box he had just removed.
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
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import { useWorkspace } from "./store";

const STUDY_CTX = buildReportingStudyContext({
  modality: "MR", studyDescription: "MRI LS Spine", regions: ["LS Spine"], source: "auto",
});
const CLICK_CTX = { region: "LS Spine", studyType: "LS Spine" };

/** quick-select-tiles.data.ts:117 — t("findings","Disc herniation L4-L5", …). */
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

/**
 * quick-select-tiles.data.ts:123 — findingText and impressionSentence are one and the
 * same string. That identity is the whole defect: the two fields are edited by
 * different removal passes, and this row's wording is present in both.
 */
const STENOSIS: ClinicalQuickFindingBox = {
  id: 9102,
  label: "Moderate canal stenosis L4-L5",
  studyType: "LS Spine",
  field: "findings",
  findingText: "Moderate canal stenosis at L4-L5.",
  impressionText: "Moderate canal stenosis at L4-L5.",
  techniqueText: "",
  recommendationText: "",
  concept: "canal_stenosis",
  conflictGroup: "canal stenosis",
};

const SHARED_SENTENCE = "Moderate canal stenosis at L4-L5.";
const lines = (text: string) => text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
const findings = () => useWorkspace.getState().findingsText;
const impression = () => useWorkspace.getState().impressionText;

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
  });
}

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

/** The strip's "Remove from report" control, one step later in the same store. */
function deselect(rowId: string) {
  useWorkspace.getState().removeObservation(rowId);
}

/** The radiologist opening his own normal template, which is what the strip is used on. */
const LS_NORMAL = DEFAULT_REPORT_FORMATS.find(
  (f) => f.name === MRI_LS_SPINE_STANDARD_NORMAL_NAME,
)!;

function openNormalFormat() {
  useWorkspace.getState().applyFormatById(LS_NORMAL.id, { regionChoice: "radiologist" });
  if (useWorkspace.getState().confirmOverwriteOpen) {
    useWorkspace.getState().confirmOverwriteAndApply();
  }
  expect(lines(findings()).length, "the format's scaffold is on the page").toBeGreaterThan(10);
}

beforeEach(resetWorkspace);

describe("the Quick Select select/deselect lifecycle (#167)", () => {
  it("selecting a box shows its Findings and its Impression without a normal left behind", () => {
    openNormalLsSpine();
    const normalBefore = impression();
    click(STENOSIS);
    expect(lines(findings())).toContain(STENOSIS.findingText);
    expect(impression()).toBe(STENOSIS.impressionText);
    expect(normalBefore).toBe(MRI_LS_SPINE_STANDARD_NORMAL_IMPRESSION);
  });

  it("deselecting the only box takes its sentence out of Findings AND Impression", () => {
    openNormalLsSpine();
    const id = click(STENOSIS);
    deselect(id);

    expect(lines(findings()), "the box's Findings sentence is its own contribution")
      .not.toContain(SHARED_SENTENCE);
    expect(impression(), "so is its Impression sentence")
      .toBe(MRI_LS_SPINE_STANDARD_NORMAL_IMPRESSION);
  });

  it("deselecting one of two boxes leaves the other untouched, then restores the normal", () => {
    openNormalLsSpine();
    const a = click(HERNIATION);
    const b = click(STENOSIS);
    expect(impression()).toContain(HERNIATION.impressionText);
    expect(impression()).toContain(STENOSIS.impressionText);

    deselect(a);
    expect(impression(), "only the herniation's own conclusion went").toBe(STENOSIS.impressionText);
    expect(lines(findings())).not.toContain(HERNIATION.impressionText);

    deselect(b);
    expect(lines(findings())).not.toContain(SHARED_SENTENCE);
    expect(impression()).toBe(MRI_LS_SPINE_STANDARD_NORMAL_IMPRESSION);
    expect(lines(impression())).toHaveLength(1);
  });

  it("deselecting after a same-slot severity change restores the pre-click normal, not the milder abnormal", () => {
    openNormalLsSpine();
    // The radiologist upgrades his claim — mild first, then the harsher box on
    // the same slot — and then retracts it entirely.
    click({
      ...STENOSIS,
      id: 9103,
      label: "Mild canal stenosis L4-L5",
      findingText: "Mild canal stenosis at L4-L5 without cord compression.",
      impressionText: "Mild canal stenosis at L4-L5.",
    });
    const severe = click(STENOSIS);
    expect(lines(findings())).toContain(SHARED_SENTENCE);
    deselect(severe);

    // The pre-click state is the approved normal, NOT the milder abnormal:
    // the upgrade retired the mild row's wording with the row itself, and the
    // slot's lineage (the normal the FIRST click retired) is what deselect
    // restores. Restoring the intermediate abnormal wording would put a finding
    // back on the page that nobody selected anymore (C3, owner directive:
    // "The fix must not restore intermediate abnormal wording after
    // deselection" — the old pin here asserted exactly that old behaviour).
    expect(impression(), "the box's own conclusion is gone")
      .not.toContain(SHARED_SENTENCE);
    expect(lines(findings()), "and so is its Findings sentence")
      .not.toContain(SHARED_SENTENCE);
    expect(lines(findings()), "the intermediate abnormal never comes back")
      .not.toContain("Mild canal stenosis at L4-L5 without cord compression.");
    expect(lines(findings()), "the L4-L5 canal normal the first click retired returns")
      .toContain("L4-L5: No spinal canal or thecal sac compression is seen.");
  });

  it("never deletes wording the radiologist typed himself when a box comes off", () => {
    openNormalLsSpine();
    const id = click(STENOSIS);
    const his = "Findings are otherwise unremarkable at this level.";
    useWorkspace.getState().mergeField("findings", his, "manual");

    deselect(id);

    expect(findings()).toContain(his);
    expect(impression()).toBe(MRI_LS_SPINE_STANDARD_NORMAL_IMPRESSION);
  });

  /**
   * The browser's step 7, one field over: a Conclusion he typed under a clicked box's
   * Conclusion, then the box comes off. His sentence must stay and the box's own must
   * go — the strip's manual-edit reconciliation must not promote the tile's wording to
   * "his" simply because the field was rewritten.
   */
  it("keeps a typed Conclusion and still removes the deselected box's own", () => {
    openNormalFormat();
    const a = click(HERNIATION);
    const his = "Clinical correlation with the restricted straight-leg raise.";
    // `setField`, not `mergeField`: that is the path the editor's onChange takes when
    // he types — the whole field arrives as new text and provenance is reconciled
    // against what survived.
    const before = impression();
    useWorkspace.getState().setField("impression", `${before}\n${his}`.trim());
    expect(impression()).toContain(HERNIATION.impressionText);
    expect(impression()).toContain(his);

    deselect(a);

    expect(impression(), "his sentence is his").toContain(his);
    expect(impression(), "the deselected box's sentence is not")
      .not.toContain(HERNIATION.impressionText);
    expect(findings(), "and so is its Findings paragraph")
      .not.toContain("Broad-based disc bulge at L4-L5");
  });

  it("survives save and reopen with the box still off the report", () => {
    openNormalLsSpine();
    const a = click(HERNIATION);
    const b = click(STENOSIS);
    deselect(a);
    deselect(b);
    const serialized = useWorkspace.getState().serializeObservationLedger();
    const prose = {
      findingsText: findings(), impressionText: impression(),
      recommendationText: useWorkspace.getState().recommendationText,
      techniqueText: useWorkspace.getState().techniqueText,
      clinicalHistoryText: useWorkspace.getState().clinicalHistoryText,
    };
    resetWorkspace();
    useWorkspace.setState(prose);
    expect(useWorkspace.getState().hydrateObservationLedger(serialized).ok).toBe(true);
    useWorkspace.getState().refreshImpressionFromLedger({
      automatic: true, excludeBaselineObservations: true,
    });
    expect(impression()).toBe(MRI_LS_SPINE_STANDARD_NORMAL_IMPRESSION);
    expect(lines(findings())).not.toContain(SHARED_SENTENCE);
  });
});

/**
 * The sequence the browser actually ran, which the store-only case above does not
 * cover: the normal report came from the FORMAT picker (so the ledger holds the
 * format's per-level baseline rows, not just the system normal), the two boxes were
 * clicked onto that scaffold, and they came off in the same order. This is what the
 * radiologist does — he opens his normal template, then clicks what he sees.
 */
describe("the same lifecycle on a report opened from the Normal format (#167)", () => {
  it("deselecting both boxes leaves no box sentence behind in either section", () => {
    openNormalFormat();
    const scaffold = lines(findings());
    const a = click(HERNIATION);
    const b = click(STENOSIS);
    expect(lines(findings())).toContain(SHARED_SENTENCE);
    expect(impression()).toContain(STENOSIS.impressionText);

    deselect(a);
    deselect(b);

    expect(lines(findings()), "a removed box owns its Findings sentence")
      .not.toContain(SHARED_SENTENCE);
    expect(impression(), "and the approved normal comes back alone")
      .toBe(MRI_LS_SPINE_STANDARD_NORMAL_IMPRESSION);
    expect(scaffold.length).toBeGreaterThan(0);
    void a; void b;
  });

  it("removes only the box that came off, keeping the other's two sentences", () => {
    openNormalFormat();
    const a = click(HERNIATION);
    const b = click(STENOSIS);
    deselect(a);

    expect(lines(findings())).not.toContain("Disc herniation at L4-L5 causing indentation on the thecal sac.");
    expect(impression()).toBe(STENOSIS.impressionText);
    deselect(b);
    expect(lines(findings())).not.toContain(SHARED_SENTENCE);
    void a; void b;
  });

  /**
   * The one thing the unit tests above omit and the running app does every time: the
   * 700 ms automatic Mode-A pass, which re-runs the generator after the click. That
   * pass records the report it just built as the canvas baseline — and the sentence it
   * is holding is the box's own. Removal then deletes the contribution and restores
   * "what the baseline says goes at this slot", which is the same sentence, so the
   * box comes off the ledger and stays on the page.
   */
  it("takes the sentence off the page even though the automatic pass ran first", () => {
    openNormalFormat();
    const b = click(STENOSIS);
    useWorkspace.getState().generateProfessionalReport(STUDY_CTX, { automatic: true });
    expect(lines(findings())).toContain(SHARED_SENTENCE);
    expect(lines(findings()), "the level's normal line is off the page while the box stands")
      .not.toContain("L4-L5: No spinal canal or thecal sac compression is seen.");

    deselect(b);

    expect(lines(findings()), "a deselected box owns its Findings sentence")
      .not.toContain(SHARED_SENTENCE);
    expect(lines(findings()), "and the level's normal line comes back with it")
      .toContain("L4-L5: No spinal canal or thecal sac compression is seen.");
    expect(impression(), "and its Impression sentence")
      .toBe(MRI_LS_SPINE_STANDARD_NORMAL_IMPRESSION);
  });
});
