/**
 * Owner ruling 1 (2026-10-18), verbatim: "Manually entered abnormal Impressions must
 * not coexist with contradictory system-generated whole-study normal Impressions.
 * Withdraw system-owned normal text when the contradiction is reliably established;
 * otherwise flag for review. Never silently delete manual text."
 *
 * The typing door is the one door that had no rule at all. Quick Select yields the
 * system normal when an abnormal box is clicked (#163), and choosing a Normal format
 * over an abnormal report now asks the same question (#168) — but a radiologist who
 * simply WRITES his conclusion into the Impression field was never asked, so the
 * automatic pass could leave "Normal MRI of the lumbosacral spine." sitting above a
 * herniation he had just typed by hand, and that pair reaches the printer as one
 * section asserting the study is normal and the next asserting it is not.
 *
 * These tests pin all three clauses of the ruling against the real store action, not
 * a helper: withdrawal by recorded identity, refusal-with-a-visible-flag where even
 * the identity-scoped strip is refused, and the guarantee that his own words are the
 * one thing this door cannot delete.
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
import { useWorkspace } from "./store";

const LS_NORMAL = DEFAULT_REPORT_FORMATS.find(
  (f) => f.name === MRI_LS_SPINE_STANDARD_NORMAL_NAME,
)!;

const STUDY_CTX = buildReportingStudyContext({
  modality: "MR", studyDescription: "MRI LS Spine", regions: ["LS Spine"], source: "auto",
});
const CLICK_CTX = { region: "LS Spine", studyType: "LS Spine" };

const NORMAL_HEAD = "Normal MRI of the lumbosacral spine.";
const HIS_HEMNATION = "Disc herniation at L4-L5 causing indentation on the thecal sac.";
const HIS_STENOSIS = "Moderate canal stenosis at L4-L5.";

/** Reworded by hand, so the system's own sentence is no longer the system's own words. */
const HIS_REWORDED_NORMAL = MRI_LS_SPINE_STANDARD_NORMAL_IMPRESSION.replace(
  "No significant disc",
  "There is no significant disc",
);

const lines = (text: string) => text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
const impression = () => useWorkspace.getState().impressionText;
const findings = () => useWorkspace.getState().findingsText;
const row = (id: string) => useWorkspace.getState().appliedPathologyPatches.find((p) => p.id === id);
const normalRow = () => row(SYSTEM_NORMAL_PATCH_ID);
const saysNormalStudy = () => lines(impression()).some((l) => l.startsWith(NORMAL_HEAD));

/**
 * The radiologist typing. `findings-editor.tsx:395/403` calls
 * `setField(field, raw)` with NO source, which is what routes the write through
 * `reconcileProvenanceAfterManualEdit` — the semantic merge that leaves an untouched
 * system sentence owned by the system. Passing `"manual"` instead would take the
 * wholesale `replaceProvenance` branch and re-stamp the normal as his own words, so
 * the harness would be testing a call the editor never makes.
 */
const type = (text: string) => useWorkspace.getState().setField("impression", text);

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
  expect(saysNormalStudy(), "and it must put the approved normal on the page").toBe(true);
  expect(normalRow()?.lastRendered.impression?.trim(), "recorded as the system's own contribution")
    .toBeTruthy();
}

function click(box: ClinicalQuickFindingBox) {
  const patch = quickFindingPatch(box, CLICK_CTX);
  expect(useWorkspace.getState().applyPathologyOverlay(patch)).toBe("applied");
  return patch.id!;
}

const HERNIATION: ClinicalQuickFindingBox = {
  id: 9101,
  label: "Disc herniation L4-L5",
  studyType: "LS Spine",
  field: "findings",
  findingText: "Broad-based disc bulge at L4-L5 with posterocentral-right paracentral "
    + "protrusion causing indentation on the thecal sac and mild narrowing of bilateral "
    + "neural foramina.",
  impressionText: HIS_HEMNATION,
  techniqueText: "",
  recommendationText: "",
  concept: "disc_contour",
  conflictGroup: "disc bulge",
};

beforeEach(() => resetWorkspace());

describe("Ruling 1 · the typing door withdraws the system normal, by identity", () => {
  it("removes the whole-study normal he has just contradicted by hand", () => {
    openNormalLsSpine();

    type(`${MRI_LS_SPINE_STANDARD_NORMAL_IMPRESSION}\n${HIS_HEMNATION}`);

    expect(impression(), "his sentence is on the page").toContain(HIS_HEMNATION);
    expect(saysNormalStudy(), "the contradictory normal is gone").toBe(false);
    expect(impression(), "and nothing else was swept up with it")
      .not.toContain(HIS_STENOSIS);
  });

  it("suspends the system row rather than deleting it, so the approved wording survives", () => {
    openNormalLsSpine();
    const templatesBefore = normalRow()?.templates.impression ?? "";

    type(`${MRI_LS_SPINE_STANDARD_NORMAL_IMPRESSION}\n${HIS_HEMNATION}`);

    expect(normalRow(), "the row is still in the ledger").toBeTruthy();
    expect(normalRow()?.lastRendered.impression ?? "", "its live contribution is suspended").toBe("");
    expect(normalRow()?.templates.impression ?? "", "the exact approved text is preserved for ruling 3")
      .toBe(templatesBefore);
    expect(normalRow()?.templates.impression?.trim(), "and that text is the normal, not a blank")
      .toBeTruthy();
  });

  it("removes only the system's own sentence — every other line on the page survives", () => {
    openNormalLsSpine();
    // Three sentences in one write: the system's normal, an abnormal line of his, and a
    // second abnormal line. The strip operates on the recorded contribution of the system
    // normal row and nothing else, so both of his must remain — including the one that is
    // itself an abnormality. A door that deleted "the contradictory text" by pattern would
    // take his with it.
    type(`${MRI_LS_SPINE_STANDARD_NORMAL_IMPRESSION}\n${HIS_STENOSIS}\n${HIS_HEMNATION}`);

    expect(impression(), "his first abnormal sentence stays").toContain(HIS_STENOSIS);
    expect(impression(), "his second abnormal sentence stays").toContain(HIS_HEMNATION);
    expect(saysNormalStudy(), "only the system's normal is gone").toBe(false);
    expect(lines(impression()), "and the section is exactly his two lines")
      .toEqual([HIS_STENOSIS, HIS_HEMNATION]);
  });

  it("does not resurrect the normal when a box is clicked onto the report he contradicted", () => {
    openNormalLsSpine();
    type(`${MRI_LS_SPINE_STANDARD_NORMAL_IMPRESSION}\n${HIS_HEMNATION}`);
    expect(saysNormalStudy(), "the typing door withdrew it").toBe(false);

    click({ ...HERNIATION, impressionText: HIS_STENOSIS });

    expect(impression(), "the box's conclusion lands").toContain(HIS_STENOSIS);
    expect(saysNormalStudy(), "and the suspended normal did not come back").toBe(false);
    // Deliberately not asserted here: whether HIS_HEMNATION survives the click. It does
    // not, and that is a separate pre-existing defect on the box door, not on this one.
    // Measured by control: with the system row suspended by direct setState — so this
    // ruling-1 block provably never runs — clicking a box still replaces a hand-written
    // Impression line with the box's own. With no system row on the ledger at all, the
    // same click preserves it. Recorded as #180; fixing it belongs to its own change.
  });

  it("does nothing when what he typed states no abnormality", () => {
    openNormalLsSpine();
    const before = impression();

    // Reordering / re-typing the normal itself is not a contradiction, so this door
    // must not treat every manual write as an abnormality claim.
    type(MRI_LS_SPINE_STANDARD_NORMAL_IMPRESSION);

    expect(impression()).toBe(before);
    expect(saysNormalStudy()).toBe(true);
    expect(normalRow()?.lastRendered.impression?.trim(), "the normal is still the system's live contribution")
      .toBeTruthy();
  });
});

describe("Ruling 1 · where withdrawal is refused, the report is flagged, never edited", () => {
  it("keeps both of his sentences and raises the named review flag instead", () => {
    openNormalLsSpine();
    // He rewrites the normal's own words. The system no longer owns that sentence, so
    // the identity-scoped strip has nothing it is allowed to remove.
    type(HIS_REWORDED_NORMAL);
    expect(normalRow()?.protected, "his rewording protects the row").toBe(true);

    type(`${HIS_REWORDED_NORMAL}\n${HIS_HEMNATION}`);

    expect(impression(), "his reworded sentence survives untouched").toContain(HIS_REWORDED_NORMAL);
    expect(impression(), "and his abnormal sentence survives untouched").toContain(HIS_HEMNATION);
    expect(useWorkspace.getState().impressionNeedsRefresh, "the canvas says the Conclusion needs review")
      .toBe(true);
    expect(
      useWorkspace.getState().impressionDependencyReasons,
      "and names why: normal above an abnormality",
    ).toContain("impression-contradicts-findings");
  });

  it("carries that refusal across the reload rather than losing it with the session", () => {
    openNormalLsSpine();
    type(HIS_REWORDED_NORMAL);
    type(`${HIS_REWORDED_NORMAL}\n${HIS_HEMNATION}`);

    expect(useWorkspace.getState().impressionBasis?.recordedBy, "the armed basis is persisted state")
      .toBe("unreconciled");
  });
});

describe("Ruling 1 · the automatic pass must not undo the withdrawal", () => {
  it("does not re-seed the normal while his own abnormal line owns the field", () => {
    openNormalLsSpine();
    type(`${MRI_LS_SPINE_STANDARD_NORMAL_IMPRESSION}\n${HIS_HEMNATION}`);
    expect(saysNormalStudy()).toBe(false);

    // The 700 ms Mode-A pass, and the explicit seed door, both run over a report that
    // has just been edited. Either re-seeding here would put the contradiction straight
    // back on the paper.
    useWorkspace.getState().seedSystemNormalImpression();
    expect(saysNormalStudy(), "the seed door refuses: his sentence owns the field").toBe(false);

    const outcome = useWorkspace.getState()
      .generateProfessionalReport(STUDY_CTX, { automatic: true });
    expect(outcome.status).toBe("generated");
    expect(saysNormalStudy(), "and so does the automatic pass").toBe(false);
    expect(impression()).toContain(HIS_HEMNATION);
  });

  it("keeps his typed conclusion after that pass", () => {
    openNormalLsSpine();
    type(`${MRI_LS_SPINE_STANDARD_NORMAL_IMPRESSION}\n${HIS_HEMNATION}`);
    useWorkspace.getState().generateProfessionalReport(STUDY_CTX, { automatic: true });

    expect(impression()).toContain(HIS_HEMNATION);
    expect(findings(), "the findings he never touched are still there").toBeTruthy();
  });
});
