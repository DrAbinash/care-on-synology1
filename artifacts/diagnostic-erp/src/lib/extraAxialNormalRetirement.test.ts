/**
 * An extra-axial collection must retire the sentence that denies one.
 *
 * The MRI Brain standard normal states "No extra-axial collection is identified."
 * A radiologist who dictates a convexity collection into the same examination
 * contradicts that line, and both doors are supposed to remove it. Measured at
 * `8bdc43e5`, neither did:
 *
 *   typed prose — `proseContradictedBaselines(MANIFEST, ["Right frontoparietal
 *     extra-axial crescentic collection, 9 mm thick."])` returned the empty set;
 *   the shared rule — `prepareNormalSupersession` with the extra-axial concept and
 *     no tile-authored `baselineReplaces` refused its own normal sentence.
 *
 * The cause is one normalisation, not one missing clinical fact. The canon resolves
 * the sentence: `conceptsAssertedIn` returned `["extra_axial"]` for it, because
 * `namesConcept` folds the sentence with `normaliseConceptKey` before scanning
 * ("extra-axial" → "extra axial"). Ownership did not fold: `sentenceMatchesConcept`
 * lowercased only, while `canonicalConceptTokens` hands back folded keys, so the
 * token "extra axial" could never be found inside "no extra-axial collection is
 * identified." The same concept was therefore recognised as a claim about the
 * extra-axial slot and then refused that slot's normal — the rule read the report
 * with one normalisation and wrote it with another.
 *
 * This suite pins the folded pair, and pins what must NOT move with it: the
 * whole-examination parenchyma normal stays out of reach of an extra-axial claim
 * (`GLOBAL_NORMAL_SUPERSESSION` deliberately has no key for extra-axial, subdural or
 * epidural collections — see `contentPacks.ts`), the midline and ventricular normals
 * are different slots, and a sentence that denies a collection retires nothing.
 *
 * No DOM harness exists in this repo (`environment: "node"` repo-wide), so the
 * decision is run as the pure rule both doors call, and the page is run at the real
 * store with a shipped box — the same two-part proof
 * `contradictedNormals.prose.test.ts` uses.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_QUICK_SELECT_TILES } from "./zai-workspace/quick-select-library";
import { DEFAULT_REPORT_FORMATS } from "./zai-workspace/report-formats-library";
import { quickSelectTilePatch } from "./zai-workspace/quickSelectTileFixture";
import { useWorkspace } from "./zai-workspace/store";
import { MRI_BRAIN_STANDARD_NORMAL_MANIFEST } from "./zai-workspace/baselines/mriBrainStandardNormal";
import { proseContradictedBaselines } from "./zai-workspace/withdrawSupersededNormals";
import { normalClaimSupersededBy } from "./pathologyPatch";
import { sentenceMatchesConcept } from "./observationSlot";
import { buildReportingStudyContext } from "./reportingStudyContext";

const MANIFEST = (MRI_BRAIN_STANDARD_NORMAL_MANIFEST.observations ?? [])
  .filter((o) => o.field === "findings");
const ROW = (id: string) => MANIFEST.find((o) => o.id === id)!;
const TEXT_OF = (id: string) => ROW(id).renderedText;

const EXTRA_AXIAL_NORMAL = TEXT_OF("extra-axial");
const PARENCHYMA_NORMAL = TEXT_OF("brain-parenchyma");
const MIDLINE_NORMAL = TEXT_OF("midline");
const VENTRICLE_NORMAL = TEXT_OF("ventricles");
const HEMORRHAGE_NORMAL = TEXT_OF("hemorrhage");
const BRAINSTEM_NORMAL = TEXT_OF("brainstem");

/** What a radiologist actually types for a convexity collection. */
const TYPED_SUBDURAL_PROSE = "Right frontoparietal extra-axial crescentic collection, 9 mm thick.";
const TYPED_EPIDURAL_PROSE = "Biconvex extra-axial collection in the right temporoparietal region.";
/** The shipped Subdural hematoma box, with its `{side}` parameter filled. */
const SHIPPED_SDH_SENTENCE = "Crescentic extra-axial collection over the right cerebral convexity, maximum thickness 7 mm, consistent with subdural hematoma.";
/** A sentence about the same compartment that denies any collection. */
const TYPED_NEGATION = "No extra-axial collection is identified.";

describe("the extra-axial normal is retired by an extra-axial claim", () => {
  it("the typed door retires the denial and nothing else on the page", () => {
    const retired = proseContradictedBaselines(MANIFEST, [TYPED_SUBDURAL_PROSE]);
    expect(retired.has(EXTRA_AXIAL_NORMAL)).toBe(true);
    expect([...retired]).toEqual([EXTRA_AXIAL_NORMAL]);
  });

  it("an epidural wording retires the same single line", () => {
    const retired = proseContradictedBaselines(MANIFEST, [TYPED_EPIDURAL_PROSE]);
    expect([...retired]).toEqual([EXTRA_AXIAL_NORMAL]);
  });

  it("a collection named inside the shipped subdural box sentence retires its own normal", () => {
    // The box sentence is a compound claim: it names the extra-axial compartment and
    // a hematoma. Both slots' denials go; the whole-examination parenchyma normal
    // does not, because an extra-axial bleed leaves the brain tissue alone.
    const retired = proseContradictedBaselines(MANIFEST, [SHIPPED_SDH_SENTENCE]);
    expect(retired.has(EXTRA_AXIAL_NORMAL)).toBe(true);
    expect(retired.has(HEMORRHAGE_NORMAL)).toBe(true);
    expect(retired.has(PARENCHYMA_NORMAL)).toBe(false);
  });

  it("a denial of a collection falsifies nothing", () => {
    expect([...proseContradictedBaselines(MANIFEST, [TYPED_NEGATION])]).toEqual([]);
  });

  it("the shared judge retires its own normal with no tile-authored contract", () => {
    // `baselineReplaces` is the tile's declared fact. Prose has none, so this is the
    // only arm that can reach the extra-axial normal from a dictated sentence —
    // which is exactly the arm that was refusing.
    const owner = {
      concept: "extra_axial", level: "", laterality: "right",
      anatomicalSection: "", baselineReplaces: "", ownText: TYPED_SUBDURAL_PROSE,
    };
    expect(normalClaimSupersededBy(EXTRA_AXIAL_NORMAL, owner)).toBe(true);
    expect(normalClaimSupersededBy(PARENCHYMA_NORMAL, owner)).toBe(false);
    expect(normalClaimSupersededBy(MIDLINE_NORMAL, owner)).toBe(false);
    expect(normalClaimSupersededBy(VENTRICLE_NORMAL, owner)).toBe(false);
    expect(normalClaimSupersededBy(BRAINSTEM_NORMAL, owner)).toBe(false);
  });
});

describe("folding the canon's separators changes which slot a sentence speaks for", () => {
  it("a hyphenated spelling is recognised by its own concept", () => {
    expect(sentenceMatchesConcept(EXTRA_AXIAL_NORMAL, "extra_axial")).toBe(true);
    expect(sentenceMatchesConcept(TYPED_SUBDURAL_PROSE, "extra_axial")).toBe(true);
  });

  it("folding never merges two different compartments", () => {
    expect(sentenceMatchesConcept(EXTRA_AXIAL_NORMAL, "midline")).toBe(false);
    expect(sentenceMatchesConcept(EXTRA_AXIAL_NORMAL, "hemorrhage")).toBe(false);
    expect(sentenceMatchesConcept(EXTRA_AXIAL_NORMAL, "ventricles")).toBe(false);
    expect(sentenceMatchesConcept(MIDLINE_NORMAL, "extra_axial")).toBe(false);
    expect(sentenceMatchesConcept(PARENCHYMA_NORMAL, "extra_axial")).toBe(false);
  });

  it("every approved normal this engine can attribute is matched by its own concept", () => {
    // The invariant the defect broke: a slot's own sentence must always be recognised
    // as that slot's, whatever separators the clinic's wording puts in it. Rows whose
    // concept is not in the canon packs are out of scope — the rule has no vocabulary
    // for them and the manifest header says so.
    const unattributed = MANIFEST
      .filter((o) => !!o.concept && sentenceMatchesConcept(o.renderedText, o.concept) === false)
      .filter((o) => o.renderedText.includes("-"))
      .map((o) => `${o.id} (${o.concept})`);
    expect(unattributed).toEqual([]);
  });
});

describe("the printed page", () => {
  function reset() {
    useWorkspace.setState({
      findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
      clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
      impressionNeedsRefresh: false, impressionOrderFrozen: false,
      lastPatchSnapshot: null, patchUndoStack: [],
      confirmOverwriteOpen: false, pendingPathologyPatch: null, pendingFormatIds: [],
      mergePreviewOpen: false,
      appliedFormatReportTitle: null, appliedFormatName: null, startingCanvasBaseline: null,
      canalApProvenance: {}, dorsalCanalForced: false,
      reportingContext: buildReportingStudyContext({
        modality: "MR", studyDescription: "MRI Brain", regions: ["Brain"], source: "auto",
      }),
      reportFormats: DEFAULT_REPORT_FORMATS,
      selectedFormatIds: [], isFinalized: false, isDirty: false,
      ownershipReviewWarnings: [], normalLinesRemovedByRadiologist: [],
    });
    useWorkspace.getState().generateProfessionalReport(
      useWorkspace.getState().reportingContext!,
    );
  }

  function clickExtraAxial() {
    const tile = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Extra-axial collection");
    if (!tile) throw new Error("Extra-axial collection is not in the catalogue");
    const outcome = useWorkspace.getState()
      .applyPathologyOverlay(quickSelectTilePatch(tile, "findings", { side: "right" }));
    if (outcome !== "applied") throw new Error(`Extra-axial collection was refused: ${outcome}`);
    return useWorkspace.getState().findingsText;
  }

  it("keeps every other normal and loses only the denied collection", () => {
    reset();
    const findings = clickExtraAxial();
    expect(findings).toContain("Right extra-axial fluid collection with mass effect.");
    expect(findings).not.toContain(EXTRA_AXIAL_NORMAL);
    for (const kept of [VENTRICLE_NORMAL, HEMORRHAGE_NORMAL, BRAINSTEM_NORMAL]) {
      expect(findings).toContain(kept);
    }
  });
});
