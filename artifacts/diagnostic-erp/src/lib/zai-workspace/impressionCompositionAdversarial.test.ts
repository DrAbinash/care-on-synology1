/**
 * The lumbar spine sequence a radiologist actually performs, pinned end to end
 * against the real store actions and the real print body.
 *
 * Open → click a box → click a second box → click the first one off → click the
 * second one off → save → reopen. Two defects lived in that sequence, and neither
 * was visible in a pure-helper test:
 *
 *  CAT-P5 — a box whose concept the content-pack registry does not flag
 *  impression-worthy (`facet_joint`, `ligamentum_flavum`, `disc_height`,
 *  `disc_signal`, `endplate`, `schmorl` — eight of the twenty-two shipped lumbar
 *  boxes) never withdrew the whole-examination normal, so one Impression section
 *  asserted the study was normal and asserted a facet arthropathy, in that order,
 *  on the page the clinic signs.
 *
 *  CAT-P4 — the sentence-level field merge re-flows a block one sentence per line,
 *  so a baseline Impression authored as ONE statement printed as TWO numbered
 *  Impression items, and the restore after the last abnormality came back as that
 *  two-line reconstruction rather than the approved string.
 *
 * Every box here is a shipped lumbar row, copied verbatim from
 * `quick-select-tiles.data.ts` (label, the four sentences, concept, conflict group)
 * and driven through `quickFindingPatch` — the builder the live strip uses for a
 * database row (`quickSelectBoxCatalogue.ts`) — then through `applyPathologyOverlay`
 * / `removeObservation`. Withdrawal is identified by the system normal patch's own
 * recorded contribution; nothing in this file matches the Impression against a list
 * of normal-sounding phrases.
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

/** quick-select-tiles.data.ts — t("findings","Facet arthropathy L4-L5", …). */
const FACET: ClinicalQuickFindingBox = {
  id: 9001,
  label: "Facet arthropathy L4-L5",
  studyType: "LS Spine",
  field: "findings",
  findingText: "Facet arthropathy at L4-L5.",
  impressionText: "Facet arthropathy at L4-L5.",
  techniqueText: "",
  recommendationText: "",
  concept: "facet_joint",
  conflictGroup: "facet",
};

/** quick-select-tiles.data.ts — t("findings","Disc bulge L3-L4", …). */
const BULGE: ClinicalQuickFindingBox = {
  id: 9002,
  label: "Disc bulge L3-L4",
  studyType: "LS Spine",
  field: "findings",
  findingText: "Disc bulge at L3-L4 without nerve root compression.",
  impressionText: "Disc bulge at L3-L4 without nerve root compression.",
  techniqueText: "",
  recommendationText: "",
  concept: "disc_contour",
  conflictGroup: "disc bulge",
};

/**
 * quick-select-tiles.data.ts — t("findings","Disc herniation L4-L5", …). Its
 * Findings carry the compatible negative "No significant central canal stenosis.",
 * a statement about the canal that nothing here contradicts.
 */
const HERNIATION: ClinicalQuickFindingBox = {
  id: 9003,
  label: "Disc herniation L4-L5",
  studyType: "LS Spine",
  field: "findings",
  findingText: "Broad-based disc bulge at L4-L5 with posterocentral-right paracentral "
    + "protrusion causing indentation on the thecal sac and mild narrowing of bilateral "
    + "neural foramina. No significant central canal stenosis.",
  impressionText: "Disc herniation at L4-L5 causing indentation on the thecal sac.",
  techniqueText: "",
  recommendationText: "Conservative management with NSAIDs and physiotherapy. "
    + "MRI if radicular symptoms persist. Surgical referral if neurological deficits develop.",
  concept: "disc_contour",
  conflictGroup: "disc bulge",
};

const CLICK_CTX = { region: "LS Spine", studyType: "LS Spine" };
/** The study the worklist row resolves to, in the shape the engine reads. */
const STUDY_CTX = buildReportingStudyContext({
  modality: "MR", studyDescription: "MRI LS Spine", regions: ["LS Spine"], source: "auto",
});

const lines = (text: string) => text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
const impression = () => useWorkspace.getState().impressionText;
const saysNormalStudy = () => lines(impression()).some(
  (line) => line.startsWith("Normal MRI of the lumbosacral spine."),
);

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
 * The numbered Impression items as the print body lays them out — the same
 * `<ol><li>` markup the signed report's body is built with, so a count here is a
 * count on the page and not a count of this test's own idea of a line.
 */
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

describe("the approved lumbar spine sequence", () => {
  it("1 — opening the examination gives one complete normal with ONE normal Impression", () => {
    openNormalLsSpine();
    expect(impression()).toBe(MRI_LS_SPINE_STANDARD_NORMAL_IMPRESSION);
    expect(lines(impression())).toHaveLength(1);
    expect(useWorkspace.getState().findingsText).toContain("L4-L5: No significant disc bulge");
    expect(useWorkspace.getState().isFinalized).toBe(false);
    expect(printedImpressionItems()).toHaveLength(1);
  });

  it("2 — a facet arthropathy withdraws the whole-study normal (CAT-P5)", () => {
    openNormalLsSpine();
    click(FACET);
    expect(impression()).toBe("Facet arthropathy at L4-L5.");
    expect(saysNormalStudy(), "the normal conclusion must be off the page").toBe(false);
  });

  it("3 — a second abnormality joins it in clinical order, not click order", () => {
    openNormalLsSpine();
    click(FACET);
    click(BULGE);
    expect(impression()).toBe([
      "Disc bulge at L3-L4 without nerve root compression.",
      "Facet arthropathy at L4-L5.",
    ].join("\n"));
  });

  it("4 — removing the facet keeps the bulge and does NOT bring the normal back", () => {
    openNormalLsSpine();
    const facetId = click(FACET);
    click(BULGE);
    useWorkspace.getState().removeObservation(facetId);
    expect(impression()).toBe("Disc bulge at L3-L4 without nerve root compression.");
    expect(saysNormalStudy()).toBe(false);
  });

  it("5 — removing the last abnormality restores exactly the approved normal, as one statement (CAT-P4)", () => {
    openNormalLsSpine();
    const facetId = click(FACET);
    const bulgeId = click(BULGE);
    useWorkspace.getState().removeObservation(facetId);
    useWorkspace.getState().removeObservation(bulgeId);
    expect(impression()).toBe(MRI_LS_SPINE_STANDARD_NORMAL_IMPRESSION);
    // The same string the examination's own format brought when it opened — the
    // restore returns what the clinic approved, not a reconstruction of it.
    expect(impression()).toBe(LS_NORMAL.impression.trim());
    expect(lines(impression())).toHaveLength(1);
    expect(printedImpressionItems()).toEqual([MRI_LS_SPINE_STANDARD_NORMAL_IMPRESSION]);
  });

  it("6 — a hand-edited Impression keeps the edit and is never re-sorted", () => {
    openNormalLsSpine();
    const facetId = click(FACET);
    useWorkspace.getState().setField(
      "impression",
      "Facet arthropathy at L4-L5.\nClinically significant at L3-L4 as well.",
    );
    useWorkspace.getState().removeObservation(facetId);
    const text = impression();
    // The sentence the radiologist added is theirs and stays, in their order.
    expect(text).toContain("Clinically significant at L3-L4 as well.");
    // §37: they wrote this field, so the automatic ordering keeps its hands off it,
    // and a normal they left out is not stitched back underneath their own layout.
    expect(useWorkspace.getState().impressionOrderFrozen).toBe(true);
    expect(saysNormalStudy()).toBe(false);
    // Measured, and it is the box's own sentence: provenance is keyed on the
    // normalised statement, so retyping a box's words verbatim does not move them
    // out of its ownership, and clicking the box off takes them out with it. What
    // this pins is that the radiologist's ADDED sentence survives that.
    expect(lines(text)).toEqual(["Clinically significant at L3-L4 as well."]);
  });

  it("7 — rewording the normal makes it the radiologist's: never deleted, contradiction named", () => {
    openNormalLsSpine();
    useWorkspace.getState().setField(
      "impression",
      "Normal MRI of the lumbosacral spine. No significant disc protrusion at L4-L5.",
    );
    click(FACET);
    expect(impression(), "radiologist wording is never deleted automatically").toContain(
      "No significant disc protrusion at L4-L5.",
    );
    // The abnormality still reaches the Conclusion: refusing to delete the
    // radiologist's sentence may not silently drop the facet arthropathy.
    expect(impression()).toContain("Facet arthropathy at L4-L5.");
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(true);
    expect(useWorkspace.getState().impressionDependencyReasons)
      .toContain("impression-contradicts-findings");
  });

  it("8 — a normal typed by hand beside an abnormality is kept and flagged, not deleted", () => {
    openNormalLsSpine();
    click(HERNIATION);
    useWorkspace.getState().setField(
      "impression",
      `${impression()}\nNormal MRI of the lumbosacral spine.`,
    );
    click(BULGE);
    expect(impression()).toContain("Normal MRI of the lumbosacral spine.");
    expect(impression()).toContain("Disc bulge at L3-L4 without nerve root compression.");
    expect(useWorkspace.getState().impressionDependencyReasons)
      .toContain("impression-contradicts-findings");
  });

  it("9 — the compatible negative and every other level survive the withdrawal", () => {
    openNormalLsSpine();
    click(HERNIATION);
    const findings = useWorkspace.getState().findingsText;
    // Withdrawal is scoped to the system normal patch's own recorded contribution.
    // These are other rows speaking, and the box's own negative is the most
    // specific statement in the report.
    expect(findings).toContain("No significant central canal stenosis.");
    expect(findings).toContain("L1-L2: No significant disc bulge or protrusion is seen.");
    expect(findings).toContain("L5-S1: No significant disc bulge or protrusion is seen.");
    expect(impression()).toBe("Disc herniation at L4-L5 causing indentation on the thecal sac.");
  });

  it("10 — any click order composes the same Impression", () => {
    openNormalLsSpine();
    click(FACET);
    click(BULGE);
    const facetFirst = impression();

    resetWorkspace();
    openNormalLsSpine();
    click(BULGE);
    click(FACET);
    expect(impression()).toBe(facetFirst);
  });

  it("11 — save and reopen keeps the withdrawn normal withdrawn and the order intact", () => {
    openNormalLsSpine();
    click(FACET);
    click(BULGE);
    const before = impression();
    const serialized = useWorkspace.getState().serializeObservationLedger();
    const prose = {
      findingsText: useWorkspace.getState().findingsText,
      impressionText: before,
      recommendationText: useWorkspace.getState().recommendationText,
      techniqueText: useWorkspace.getState().techniqueText,
      clinicalHistoryText: useWorkspace.getState().clinicalHistoryText,
    };
    // Close the study, then reopen it the way a draft does: the prose columns come
    // back from their own columns, the ledger from `structured_json`.
    resetWorkspace();
    useWorkspace.setState(prose);
    const hydrated = useWorkspace.getState().hydrateObservationLedger(serialized);
    expect(hydrated.ok).toBe(true);
    expect(impression()).toBe(before);
    expect(saysNormalStudy()).toBe(false);
    // An automatic pass after the reload gives the same answer the session gave.
    useWorkspace.getState().refreshImpressionFromLedger({
      automatic: true, excludeBaselineObservations: true,
    });
    expect(saysNormalStudy()).toBe(false);
    expect(impression()).toBe(before);
  });

  it("12 — the normal is suspended, not forgotten: its own contribution is what comes back", () => {
    openNormalLsSpine();
    const facetId = click(FACET);
    const suspended = useWorkspace.getState().appliedPathologyPatches
      .find((p) => p.id === SYSTEM_NORMAL_PATCH_ID);
    expect(suspended?.lastRendered.impression ?? "", "withdrawn").toBe("");
    expect(suspended?.templates.impression).toBe(MRI_LS_SPINE_STANDARD_NORMAL_IMPRESSION);
    useWorkspace.getState().removeObservation(facetId);
    expect(impression()).toBe(suspended?.templates.impression);
  });

  it("13 — a normal the radiologist deleted is not resurrected by deselecting a box", () => {
    openNormalLsSpine();
    const first = click(FACET);
    useWorkspace.getState().removeObservation(first);
    // The normal is back on the page, so deleting it now is a decision about it.
    expect(impression()).toBe(MRI_LS_SPINE_STANDARD_NORMAL_IMPRESSION);
    useWorkspace.getState().setField("impression", "");
    expect(useWorkspace.getState().appliedPathologyPatches
      .find((p) => p.id === SYSTEM_NORMAL_PATCH_ID)?.protected).toBe(true);

    const again = click(FACET);
    useWorkspace.getState().removeObservation(again);
    expect(saysNormalStudy(), "a normal they removed stays removed").toBe(false);
    expect(impression()).toBe("");
  });

  it("14 — a pressed Refresh re-orders what it composed, whoever was clicked last", () => {
    openNormalLsSpine();
    click(FACET);
    // A dictated finding the ledger has no row for. The composer promotes it into the
    // Conclusion and appends it — after the box's own line, which is neither the
    // clinical order nor a stable answer to "what did I click first".
    useWorkspace.getState().setField(
      "findings",
      `${useWorkspace.getState().findingsText}\nSevere canal stenosis at L4-L5 with thecal sac compression.`,
    );
    useWorkspace.getState().refreshImpressionFromLedger();
    expect(impression()).toBe([
      "Severe canal stenosis at L4-L5 with thecal sac compression.",
      "Facet arthropathy at L4-L5.",
    ].join("\n"));
  });
});
