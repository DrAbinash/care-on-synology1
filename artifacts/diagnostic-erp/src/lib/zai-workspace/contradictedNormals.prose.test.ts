/**
 * P0-2 — a normal the radiologist's own typed sentences contradict.
 *
 * Measured on the Oct 4 MRI Brain reporting trial: the report said
 * "Brain parenchyma shows normal signal intensity with preserved grey-white
 * differentiation." and, four lines below it, described bilateral periventricular
 * and deep white-matter T2/FLAIR hyperintensities with Fazekas grade II. One
 * examination, both statements, nothing on the page to say which it showed.
 *
 * Why it happens, from the same measurement: the deterministic Generate path asks
 * only ONE question of a clinician's free-text sentence — `which disc level does
 * this name?` (`professionalReport.ts` `levelsContradictedByUnexplainedLines`,
 * `supersededBaselineTexts`). An intracranial sentence names no level, so it
 * contradicts nothing, and the scaffold's organ-level normal is merged underneath
 * it again. Every other door in the app judges contradictions through the structured
 * slot rule instead (`prepareNormalSupersession`), and the click door really does
 * retire the same normal — measured: clicking the shipped "Fazekas 2" box leaves no
 * parenchyma normal, while typing the same clinical statement leaves both.
 *
 * So this suite holds the Generate path to the rule the rest of the product already
 * uses, and to the ruling that a contradiction this engine cannot resolve safely is
 * READ, not deleted (`CONTRADICTED_NORMAL_RETAINED_HINT` on the existing canvas
 * review banner). No new vocabulary: the attributions come from the shipped canon
 * oracle, `conceptsAssertedIn`, over the radiologist's own words.
 *
 * There is no DOM/React harness in this repo (`environment: "node"` repo-wide), so
 * the door is executed at the real store and the decision itself is a pure function
 * run directly — the same two-part proof `composerApplyGate.test.ts` uses.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_QUICK_SELECT_TILES } from "./quick-select-library";
import { DEFAULT_REPORT_FORMATS } from "./report-formats-library";
import { quickSelectTilePatch } from "./quickSelectTileFixture";
import { useWorkspace } from "./store";
import { MRI_BRAIN_STANDARD_NORMAL_MANIFEST } from "./baselines/mriBrainStandardNormal";
import { MRI_CERVICAL_STANDARD_NORMAL_MANIFEST } from "./baselines/mriCervicalStandardNormal";
import { MRI_KNEE_STANDARD_NORMAL_MANIFEST } from "./baselines/mriKneeStandardNormal";
import {
  proseContradictedBaselines, unreconcilableNormalSentences,
} from "./withdrawSupersededNormals";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";

const ctx = buildReportingStudyContext({
  modality: "MR", studyDescription: "MRI Brain", regions: ["Brain"], source: "auto",
});

const MANIFEST = (MRI_BRAIN_STANDARD_NORMAL_MANIFEST.observations ?? [])
  .filter((o) => o.field === "findings");
const TEXT_OF = (id: string) => MANIFEST.find((o) => o.id === id)?.renderedText ?? "";

const PARENCHYMA_NORMAL = TEXT_OF("brain-parenchyma");
const INFARCT_NORMAL = TEXT_OF("infarct");
const VENTRICLE_NORMAL = TEXT_OF("ventricles");
const BRAINSTEM_NORMAL = TEXT_OF("brainstem");
const HEMORRHAGE_NORMAL = TEXT_OF("hemorrhage");

/** The trial's own dictated sentence, word for word. */
const TYPED_SVD = "Multiple patchy and early confluent T2/FLAIR hyperintensities in bilateral periventricular and deep cerebral white matter, suggestive of chronic small-vessel ischemic changes - Fazekas grade II.";
const TYPED_ATROPHY = "Generalized cerebral volume loss with prominence of cortical sulci, ventricular system and basal cisterns, consistent with age-related cerebral atrophy.";
const TYPED_INFARCT = "Late subacute infarct in the left MCA territory with local mass effect.";
const NEGATED_DWI = "No diffusion restriction on DWI/ADC to suggest acute infarction.";
const NEGATED_HEMORRHAGE = "No intracranial hemorrhage, mass effect or midline shift.";
const NON_SPECIFIC = "The study is limited by motion.";

/** A normal stated in the radiologist's own words — wording no row of the approved
 *  format owns, so no door of this engine can claim the right to remove it. */
const OWN_NORMAL = "Brain parenchyma is normal.";

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
    reportingContext: ctx, reportFormats: DEFAULT_REPORT_FORMATS,
    selectedFormatIds: [], isFinalized: false, isDirty: false,
    ownershipReviewWarnings: [], normalLinesRemovedByRadiologist: [],
  });
  useWorkspace.getState().generateProfessionalReport(ctx);
}

function typeFindings(lines: string[]) {
  useWorkspace.getState().setField("findings", lines.join("\n"), { source: "manual" });
}

function page() {
  const s = useWorkspace.getState();
  return {
    findings: s.findingsText,
    lines: s.findingsText.split("\n").map((l) => l.trim()).filter(Boolean),
    patches: s.appliedPathologyPatches,
    warnings: s.ownershipReviewWarnings,
  };
}

function clickFazekas2() {
  const tile = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Fazekas 2");
  if (!tile) throw new Error("Fazekas 2 is not in the catalogue");
  const outcome = useWorkspace.getState()
    .applyPathologyOverlay(quickSelectTilePatch(tile, "findings", {}));
  if (outcome !== "applied") throw new Error(`Fazekas 2 was refused: ${outcome}`);
}

describe("proseContradictedBaselines — the shipped canon oracle, applied to typed prose", () => {
  it("attributes the trial's small-vessel sentence to the parenchyma normal and nothing else", () => {
    const retired = proseContradictedBaselines(MANIFEST, [TYPED_SVD]);
    expect(retired.has(PARENCHYMA_NORMAL)).toBe(true);
    // Nothing else in this examination's approved normal is falsified by it.
    expect([...retired]).toEqual([PARENCHYMA_NORMAL]);
  });

  it("a denied clause falsifies nothing: negatives keep their normals", () => {
    expect([...proseContradictedBaselines(MANIFEST, [NEGATED_DWI, NEGATED_HEMORRHAGE])]).toEqual([]);
  });

  it("a limitation sentence falsifies nothing", () => {
    expect([...proseContradictedBaselines(MANIFEST, [NON_SPECIFIC])]).toEqual([]);
  });

  it("an infarct sentence retires both normals it contradicts, and only those", () => {
    const retired = proseContradictedBaselines(MANIFEST, [TYPED_INFARCT]);
    expect(retired.has(PARENCHYMA_NORMAL)).toBe(true);
    expect(retired.has(INFARCT_NORMAL)).toBe(true);
    expect(retired.has(HEMORRHAGE_NORMAL)).toBe(false);
    expect(retired.has(BRAINSTEM_NORMAL)).toBe(false);
    expect([...retired].sort()).toEqual([INFARCT_NORMAL, PARENCHYMA_NORMAL].sort());
  });

  it("a cross-region alias cannot reach outside this examination's approved normal", () => {
    // "collapse" and "mass" resolve to lung and chest packs in the canon; the scan is
    // bounded by the rows the caller supplies, so a brain report has no chest normal
    // for them to retire. Measured with `lobar_collapse`/`mass_like_opacity` in the
    // attribution probe (tmp/p02/probe1.txt): neither claimed anything here.
    const retired = proseContradictedBaselines(MANIFEST, [TYPED_ATROPHY, TYPED_INFARCT]);
    const stillThere = [BRAINSTEM_NORMAL, HEMORRHAGE_NORMAL, NON_SPECIFIC]
      .filter((t) => retired.has(t));
    expect(stillThere).toEqual([]);
  });

  it("whole sentences only — no fragment of a normal is ever withheld", () => {
    const retired = proseContradictedBaselines(MANIFEST, [TYPED_SVD]);
    for (const text of retired) {
      expect(MANIFEST.some((o) => o.renderedText === text)).toBe(true);
    }
  });
});

/**
 * The fences this rule earned by measurement. Each one is a mutant, not an opinion:
 * removing the line it guards turns exactly the test named under it red.
 *
 * A first cut of this rule attributed every canon concept a sentence mentions and let
 * each of them drive the retirement. Run over all 201 shipped box sentences against their
 * own examination's approved normal (both doors driving the real store), that version
 * retired three approved normals that the clicked versions of the same three boxes leave
 * standing — the brain parenchyma normal beneath Subdural hematoma, Epidural hematoma and
 * Subarachnoid hemorrhage (tmp/p02/census-m1.tsv vs census-branch2.tsv) — because
 * "subdural hematoma" contains the alias "hematoma". The other two fences each retired a
 * normal at a site the sentence never described: one sentence pinned to "C6" took the root
 * normals of all six disc levels, and a right-sided lesion deleted the opposite side's
 * normal (found on the pelvis format, reproduced below on a concept the canon knows).
 */
describe("what the typed door may NOT retire — the measured over-reach cases", () => {
  it("an extra-axial collection is not a claim about the brain parenchyma", () => {
    // "subdural hematoma" contains the alias "hematoma", so the generic hemorrhage
    // concept is attributed, and the curated table lets hemorrhage supersede the
    // parenchyma normal. The table deliberately has NO key for the extra-axial
    // collections, and a subdural bleed does not make the brain tissue abnormal — so the
    // generic word inside a more specific claim must not resurrect that contract.
    const retired = proseContradictedBaselines(MANIFEST,
      ["Crescentic extra-axial collection over the right cerebral convexity, maximum thickness 7 mm, consistent with subdural hematoma."]);
    expect(retired.has(PARENCHYMA_NORMAL)).toBe(false);
    // And it is not a blanket refusal: the bleed retires the normal that speaks for
    // bleeding. Measured — this sentence retires exactly this row and no other.
    expect(retired.has(TEXT_OF("hemorrhage"))).toBe(true);
    // The collection's OWN normal stays. Not a fence working, a limit: "extra_axial" is a
    // manifest concept with no entry in the canon packs, so no prose can be attributed to
    // it. The clicked box for that row has the same limit — this door retires what the
    // click door retires, and the rest of the page is his to read.
    expect(retired.has(TEXT_OF("extra_axial"))).toBe(false);
  });

  it("an intraparenchymal hemorrhage still retires the parenchyma normal", () => {
    // The fence must not become a veto — this is the same table, reached by a lesion that
    // really is inside the tissue it describes.
    const retired = proseContradictedBaselines(MANIFEST,
      ["Acute intraparenchymal hemorrhage in the right basal ganglia with surrounding edema."]);
    expect(retired.has(PARENCHYMA_NORMAL)).toBe(true);
  });

  it("a right-sided claim never silences the left side's normal", () => {
    // Laterality used to be passed empty "because the canon does not use a mentioned side
    // as a mutex". The shipped judge does refuse an opposite-side NORMAL, and passing no
    // side let "Moderate effusion in the right hip joint." delete the left hip's sentence.
    // The hip rows cannot carry that proof any more: "hip_left"/"hip_right" are manifest
    // concepts absent from the canon packs, so nothing is attributed to them at all. These
    // three rows are the same fence on a concept the canon does know.
    const SIDED = [
      { field: "findings", concept: "hemorrhage", renderedText: "No hemorrhage is seen in the left frontal lobe." },
      { field: "findings", concept: "hemorrhage", renderedText: "No hemorrhage is seen in the right frontal lobe." },
      { field: "findings", concept: "hemorrhage", renderedText: "No intracranial hemorrhage is seen." },
    ];
    const retired = proseContradictedBaselines(SIDED, ["Acute hemorrhage in the right frontal lobe."]);
    expect(retired.has("No hemorrhage is seen in the left frontal lobe.")).toBe(false);
    expect(retired.has("No hemorrhage is seen in the right frontal lobe.")).toBe(true);
    // A study-wide normal says there is no bleeding anywhere; a named bleed refutes it.
    expect(retired.has("No intracranial hemorrhage is seen.")).toBe(true);
  });

  it("a bare vertebra names a site this parser cannot resolve, so it retires no level", () => {
    // `extractLevel` reads disc spaces, not "C6". Treating the unparsed sentence as
    // level-free let one root claim delete the root normals of all six disc spaces.
    const retired = proseContradictedBaselines(
      MRI_CERVICAL_STANDARD_NORMAL_MANIFEST.observations ?? [],
      ["C6 nerve root compression with loss of the exiting root signal."],
    );
    const pinnedToALevel = (MRI_CERVICAL_STANDARD_NORMAL_MANIFEST.observations ?? [])
      .filter((o) => o.field === "findings" && (o.level ?? "") !== "" && o.concept === "root_contact")
      .filter((o) => retired.has(o.renderedText));
    expect(pinnedToALevel).toEqual([]);
  });

  it("a meniscal tear does not claim an effusion", () => {
    const retired = proseContradictedBaselines(
      MRI_KNEE_STANDARD_NORMAL_MANIFEST.observations ?? [],
      ["Oblique tear of the posterior horn of the medial meniscus."],
    );
    const effusion = (MRI_KNEE_STANDARD_NORMAL_MANIFEST.observations ?? [])
      .find((o) => o.concept === "effusion")?.renderedText ?? "";
    expect(effusion).toBeTruthy();
    expect(retired.has(effusion)).toBe(false);
  });
});

describe("the Generate door, driven the way the trial drove it", () => {
  it("typed small-vessel abnormality + pressed Generate: one statement, not two (P0-2)", () => {
    reset();
    typeFindings([PARENCHYMA_NORMAL, TYPED_SVD]);
    useWorkspace.getState().generateProfessionalReport(ctx);
    const r = page();

    expect(r.findings.includes("normal signal intensity with preserved grey-white")).toBe(false);
    expect(r.lines).toContain(TYPED_SVD);
    // The rest of the approved normal is untouched — one retired row, sixteen lines in.
    expect(r.lines).toContain(HEMORRHAGE_NORMAL);
    expect(r.lines).toContain(BRAINSTEM_NORMAL);
    expect(r.lines.filter((l) => MANIFEST.some((o) => o.renderedText === l)).length)
      .toBe(MANIFEST.length - 1);
  });

  it("the retirement leaves the ledger and the prose agreeing", () => {
    reset();
    typeFindings([PARENCHYMA_NORMAL, TYPED_SVD]);
    useWorkspace.getState().generateProfessionalReport(ctx);
    const r = page();
    const parenRow = r.patches.find((p) => p.observation?.concept === "brain_parenchyma");
    expect(parenRow, "the scaffold row must still exist to be restored later").toBeTruthy();
    expect(parenRow?.stale).toBe(true);
    expect(r.findings.includes(PARENCHYMA_NORMAL)).toBe(false);
  });

  it("a normal this press removed is not also named on the banner", () => {
    // The two halves are one decision: judge the contradiction, remove the sentence, then
    // name what is left. If the naming ever reports a normal this press did remove, the
    // radiologist reads "kept, it is this examination's approved normal and this door could
    // not remove it" under a report where the normal is gone — a warning about a clash that
    // is not on his page, which is how the banner loses its credibility.
    reset();
    typeFindings([PARENCHYMA_NORMAL, TYPED_SVD]);
    useWorkspace.getState().generateProfessionalReport(ctx);
    expect(page().warnings).toEqual([]);
    expect(page().findings.includes(PARENCHYMA_NORMAL)).toBe(false);
  });

  it("nothing is invented: every sentence on the page came from the format or the radiologist", () => {
    reset();
    typeFindings([PARENCHYMA_NORMAL, TYPED_SVD, TYPED_ATROPHY]);
    useWorkspace.getState().generateProfessionalReport(ctx);
    const scaffoldOrOwn = new Set<string>([
      ...MANIFEST.map((o) => o.renderedText),
      TYPED_SVD, TYPED_ATROPHY,
    ]);
    const invented = page().lines.filter((l) => !scaffoldOrOwn.has(l));
    expect(invented).toEqual([]);
  });

  it("pressing twice changes nothing the first press did not already do", () => {
    reset();
    typeFindings([PARENCHYMA_NORMAL, TYPED_SVD]);
    useWorkspace.getState().generateProfessionalReport(ctx);
    const first = page().findings;
    useWorkspace.getState().generateProfessionalReport(ctx);
    expect(page().findings).toBe(first);
  });

  it("a complete normal keeps every one of its sentences", () => {
    reset();
    typeFindings([NEGATED_DWI, NEGATED_HEMORRHAGE, NON_SPECIFIC]);
    useWorkspace.getState().generateProfessionalReport(ctx);
    const r = page();
    expect(r.findings).toContain(PARENCHYMA_NORMAL);
    expect(r.lines.filter((l) => MANIFEST.some((o) => o.renderedText === l)).length)
      .toBe(MANIFEST.length);
    expect(r.warnings).toEqual([]);
  });

  it("the click door's behaviour is unchanged: it already retired this normal", () => {
    reset();
    clickFazekas2();
    const afterClick = page().findings;
    expect(afterClick.includes("normal signal intensity with preserved grey-white")).toBe(false);
    useWorkspace.getState().generateProfessionalReport(ctx);
    // and a pressed Generate does not resurrect it
    expect(page().findings.includes("normal signal intensity with preserved grey-white")).toBe(false);
  });

  it("taking the contradicting sentence away and pressing Generate rebuilds the approved normal", () => {
    reset();
    typeFindings([PARENCHYMA_NORMAL, TYPED_SVD]);
    useWorkspace.getState().generateProfessionalReport(ctx);
    expect(page().findings.includes(PARENCHYMA_NORMAL)).toBe(false);
    // The radiologist edits his own sentence out of the report he now has, and asks
    // for the examination's approved normal again. A press is that request — which is
    // why only an unpressed pass refuses to resurrect a retired normal (store.ts).
    const withoutContradiction = page().lines.filter((l) => l !== TYPED_SVD);
    typeFindings(withoutContradiction);
    useWorkspace.getState().generateProfessionalReport(ctx);
    expect(page().findings).toContain(PARENCHYMA_NORMAL);
  });
});

describe("unreconcilableNormalSentences — what the engine may not remove, it names", () => {
  it("two hand-written claims that contradict each other are reported, not deleted", () => {
    // Neither sentence is the scaffold's: both arrived from the keyboard, so no door
    // owns either one, and deleting either would delete clinical prose.
    const kept = unreconcilableNormalSentences(`${OWN_NORMAL}\n${TYPED_SVD}`, MANIFEST);
    expect(kept.length).toBe(1);
    expect(kept[0].sentence).toBe(OWN_NORMAL);
    expect(kept[0].reason).toContain("you wrote");
  });

  it("a report that says only normal things raises nothing", () => {
    expect(unreconcilableNormalSentences(`${OWN_NORMAL}\n${NEGATED_DWI}`, MANIFEST)).toEqual([]);
  });

  it("a format normal the page still carries beside its refutation is named", () => {
    // The hole this closes: retiring a scaffold normal is two steps — judge the
    // contradiction, then ask the ledger to remove the sentence — and the second step can
    // fail (no applied patch for that row, or the radiologist wrote the same sentence
    // himself so the ledger fence protects it). An exemption keyed on the manifest swore
    // the clash was resolved while both statements stayed on the page.
    const kept = unreconcilableNormalSentences(`${PARENCHYMA_NORMAL}\n${TYPED_SVD}`, MANIFEST);
    expect(kept.length).toBe(1);
    expect(kept[0].sentence).toBe(PARENCHYMA_NORMAL);
    expect(kept[0].reason).toContain("could not remove it");
  });

  it("a scaffold normal already retired by this engine is not also warned about", () => {
    // The page after the door: the abnormality stands and the format's normal is gone,
    // so there is nothing left to name. This ordering is what makes the exemption above
    // unnecessary — callers run this AFTER the removal.
    const kept = unreconcilableNormalSentences(TYPED_SVD, MANIFEST);
    expect(kept).toEqual([]);
  });

  it("the warning reaches the existing canvas review banner", () => {
    reset();
    // Hand-written normal + hand-written abnormality, and the scaffold row for that
    // sentence does not exist because this line is not the format's wording.
    typeFindings([OWN_NORMAL, TYPED_SVD]);
    useWorkspace.getState().generateProfessionalReport(ctx);
    const r = page();
    expect(r.findings).toContain(OWN_NORMAL);
    expect(r.warnings.some((w) => w.sentence.includes(OWN_NORMAL))).toBe(true);
    expect(r.warnings.every((w) => typeof w.hint === "string" && w.hint.length > 0)).toBe(true);
  });

  it("no warning is armed for a consistent report", () => {
    reset();
    clickFazekas2();
    useWorkspace.getState().generateProfessionalReport(ctx);
    expect(page().warnings).toEqual([]);
  });
});
