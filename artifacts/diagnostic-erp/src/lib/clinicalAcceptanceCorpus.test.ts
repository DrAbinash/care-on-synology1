/**
 * CLINICAL ACCEPTANCE CORPUS — Part 12 (permanent, shipped-tile corpus).
 *
 * Every case asserts BOTH directions the owner's acceptance framework demands:
 *
 *   REQUIRED — the sentences the report must carry (the finding, its
 *              impression, the retained unrelated normals), and
 *   FORBIDDEN — the sentences it must NOT carry (contradicted normals,
 *              duplicated findings, "normal study" conclusions over
 *              abnormalities).
 *
 * Everything drives the REAL shipped tiles (quick-select-tiles.data.ts) and
 * the REAL owned baselines (fullReportBaseline.ts + baselines/*) through the
 * real store entries the workspace itself uses — quickSelectTilePatch →
 * applyPathologyOverlay for clicks, removeObservation for deselects,
 * composeInstantReport for the Mode A pass, applyAiComposerAccepted for the AI
 * Apply step. No invented tile text anywhere: each case cites the tile line it
 * exercises.
 *
 * The five Part 7 mandatory cases (polarity, omission, manual survival,
 * AI-then-edit, contradiction flagged) live in their own describe below, and
 * the KNOWN FACET DEFECT is pinned as an it.fails with its full diagnosis —
 * convert it to a plain passing test only together with the engine fix.
 */
import { describe, expect, it, vi } from "vitest";
import { useWorkspace } from "./zai-workspace/store";
import {
  DEFAULT_QUICK_SELECT_TILES,
  type QuickSelectTile,
} from "./zai-workspace/quick-select-library";
import { quickSelectTilePatch, tileRowId, clickedTilePatch  } from "./zai-workspace/quickSelectTileFixture";
import type { QuickSelectParameterValues } from "./zai-workspace/quickSelectParameterContract";
import { buildReportingStudyContext } from "./reportingStudyContext";
import { DEFAULT_REPORT_FORMATS } from "./zai-workspace/report-formats-library";
import { normalizeForDedupe, splitToSentences } from "./reportFieldMerge";
import { emptyViewerMeasurementsState } from "./structuredViewerMeasurements";
import { defaultLumbarNumbering } from "./mriSpineNumbering";
import { defaultSpineSequences } from "./mriSpineSequences";
import { defaultScreeningState } from "./mriSpineScreening";
import { defaultVascularTechnique } from "./mriBrainVascularTechnique";

const tile = (label: string): QuickSelectTile => {
  const found = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === label);
  if (!found) throw new Error(`no shipped tile labelled ${label}`);
  return found;
};

const S = () => useWorkspace.getState();
const findingsOf = () => S().findingsText;
const impressionOf = () => S().impressionText;
const recommendationOf = () => S().recommendationText;

/** REQUIRED: the sentence must be present, exactly once. */
function required(sentence: string, where: "findings" | "impression" = "findings") {
  const text = where === "findings" ? findingsOf() : impressionOf();
  const key = normalizeForDedupe(sentence);
  const hits = splitToSentences(text).filter((s) => normalizeForDedupe(s) === key).length;
  expect(hits, `REQUIRED "${sentence}" in ${where}`).toBe(1);
}
/** FORBIDDEN: the sentence must be absent entirely. */
function forbidden(sentence: string, where: "findings" | "impression" = "findings") {
  const text = where === "findings" ? findingsOf() : impressionOf();
  expect(
    splitToSentences(text).some((s) => normalizeForDedupe(s) === normalizeForDedupe(sentence)),
    `FORBIDDEN "${sentence}" in ${where}`,
  ).toBe(false);
}

type Ctx = ReturnType<typeof buildReportingStudyContext>;
const brainCtx = () => buildReportingStudyContext({
  modality: "MR", studyDescription: "MRI Brain Plain", regions: ["Brain"], source: "auto",
});
const cervicalCtx = () => buildReportingStudyContext({
  modality: "MR", studyDescription: "MRI Cervical Spine", regions: ["Cervical Spine"], source: "auto",
});
const lsCtx = () => buildReportingStudyContext({
  modality: "MR", studyDescription: "MRI LS Spine Plain", regions: ["LS Spine"], source: "auto",
});

function resetShell(ctx: Ctx): void {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  useWorkspace.setState({
    reportFormats: DEFAULT_REPORT_FORMATS, reportingContext: ctx,
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    impressionNeedsRefresh: false, impressionDependencyReasons: [], impressionBasis: null,
    lastPatchSnapshot: null, confirmOverwriteOpen: false, pendingPathologyPatch: null,
    voiceComposerObservations: [], patchUndoStack: [], patchRedoStack: [],
    impressionOrderFrozen: false, startingCanvasBaseline: null, selectedFormatIds: [],
    isFinalized: false, structuredViewerMeasurements: emptyViewerMeasurementsState(),
    canalApProvenance: {}, regionTransitions: [], coverageMarks: [], coverageByScope: {},
    normalLinesRemovedByRadiologist: [],
    lumbarNumbering: defaultLumbarNumbering(),
    sequencesAvailable: defaultSpineSequences(),
    screening: defaultScreeningState(),
    vascularTechnique: defaultVascularTechnique(),
    linkedStudy: null, appliedPatternMarkers: [], selectedObservationId: null,
    instantReportHold: null,
  });
}

/** Open the study the way the workspace opens it: Mode A composes the approved normal. */
function openStudy(ctx: Ctx) {
  resetShell(ctx);
  const decision = S().composeInstantReport(ctx, false);
  expect(decision.action, `Mode A declined to compose: ${JSON.stringify(decision)}`).toBe("compose");
}

function click(t: QuickSelectTile, params: QuickSelectParameterValues = {}) {
  const outcome = S().applyPathologyOverlay(clickedTilePatch(t, "findings", params));
  if (outcome !== "applied") throw new Error(`${t.label} click was ${outcome}`);
  return tileRowId(t, params.side);
}

/** The Mode A pass the workspace debounce runs. */
const recompose = (ctx: Ctx) => S().composeInstantReport(ctx, false);

describe("clinical acceptance corpus — MRI Brain (shipped tiles, owned baseline)", () => {
  it("complete normal MRI brain: every owned normal once, no abnormal claims, no duplicates", () => {
    openStudy(brainCtx());
    // REQUIRED — the owned baseline's own sentences, each exactly once.
    for (const sentence of [
      "Brain parenchyma shows normal signal intensity with preserved grey-white differentiation.",
      "No acute infarct is seen.",
      "No intracranial hemorrhage is seen.",
      "No restricted diffusion is seen on DWI/ADC.",
      "Ventricular system and cisternal spaces are normal in size and configuration.",
      "No extra-axial collection is identified.",
      "No midline shift is seen.",
      "Basal ganglia and thalami are normal in signal intensity.",
      "Flow voids in major intracranial vessels are preserved.",
      "Brainstem shows normal morphology and signal intensity.",
      "Cerebellar hemispheres show normal morphology and signal intensity.",
      "Posterior fossa structures are unremarkable.",
    ]) {
      required(sentence);
    }
    expect(impressionOf()).toBe("Normal MRI of the brain. No acute intracranial abnormality.");
    // FORBIDDEN — a normal study asserts nothing abnormal.
    forbidden("Restricted diffusion in the left MCA territory on DWI/ADC, consistent with acute infarct.");
    forbidden("Acute intraparenchymal hemorrhage");
    forbidden("Hydrocephalus.");
    // Idempotence: the second pass writes nothing (Part 5, once-only).
    const before = findingsOf();
    expect(recompose(brainCtx()).action).toBe("compose");
    expect(findingsOf()).toBe(before);
  });

  it("acute infarction (tile :80): the finding prints, its denials retire, the conclusion changes", () => {
    openStudy(brainCtx());
    click(tile("Acute infarct (DWI)"), { side: "left" });
    // REQUIRED — the shipped tile's own sentences (the engine renders its
    // two-sentence contribution one sentence per line) and its conclusion.
    required("Restricted diffusion in the left MCA territory on DWI/ADC, consistent with acute infarct.");
    required("No hemorrhagic transformation.");
    required("Acute left MCA territory infarct.", "impression");
    expect(recommendationOf()).toMatch(/Immediate stroke team notification/);
    expect(recommendationOf()).toMatch(/MRA head and neck recommended/);
    // FORBIDDEN — the infarct denial the tile falsifies, and the normal conclusion.
    forbidden("No acute infarct is seen.");
    forbidden("No restricted diffusion is seen on DWI/ADC.");
    forbidden("Normal MRI of the brain.", "impression");
    // Unrelated normals stay.
    required("No midline shift is seen.");
    required("Ventricular system and cisternal spaces are normal in size and configuration.");
  });

  it("intracranial hemorrhage (tile :81): the finding prints, its denial retires, the conclusion changes", () => {
    openStudy(brainCtx());
    click(tile("Basal ganglia hemorrhage"), { side: "right" });
    required("Acute intraparenchymal hemorrhage in the right basal ganglia with intraventricular extension.");
    // Tile :81 shipped "midline shift of ___ mm" with no question that could fill it.
    // The shift is still claimed; the number that was never asked for is not printed.
    required("Mass effect with midline shift.");
    required("Acute right basal ganglia hemorrhage.", "impression");
    forbidden("No intracranial hemorrhage is seen.");
    // The hemorrhage asserts midline shift wording; the shipped midline denial retires.
    forbidden("No midline shift is seen.");
    forbidden("Normal MRI of the brain.", "impression");
    required("No acute infarct is seen.");
  });

  it("multiple brain abnormalities: infarct + hemorrhage coexist, each conclusion present, no duplicates", () => {
    openStudy(brainCtx());
    click(tile("Acute infarct (DWI)"), { side: "left" });
    click(tile("Basal ganglia hemorrhage"), { side: "right" });
    click(tile("Hydrocephalus"));
    required("Restricted diffusion in the left MCA territory on DWI/ADC, consistent with acute infarct.");
    required("Acute intraparenchymal hemorrhage in the right basal ganglia with intraventricular extension.");
    required("Hydrocephalus.", "impression");
    required("Acute left MCA territory infarct.", "impression");
    forbidden("No acute infarct is seen.");
    forbidden("No intracranial hemorrhage is seen.");
    forbidden("Ventricular system and cisternal spaces are normal in size and configuration.");
    forbidden("Normal MRI of the brain.", "impression");
    // No duplicated impression lines.
    const lines = impressionOf().split(/\n+/).map((l) => l.trim()).filter(Boolean);
    expect(new Set(lines.map(normalizeForDedupe)).size).toBe(lines.length);
  });

  it("Part 7 case 1 — polarity: the normal tile clicked after the abnormal never re-adds the denial", () => {
    openStudy(brainCtx());
    click(tile("Acute infarct (DWI)"), { side: "left" });
    click(tile("Normal brain parenchyma"));
    required("Restricted diffusion in the left MCA territory on DWI/ADC, consistent with acute infarct.");
    required("No hemorrhagic transformation.");
    // The denial the abnormal owns stays retired; the normal tile's own
    // parenchyma claim was withheld — the owner ruling (2026-10-19, outcome D).
    forbidden("No evidence of acute infarct, hemorrhage, or mass lesion.");
  });

  it("Part 7 case 2 — omission: no impression-worthy finding is omitted from the conclusion", () => {
    openStudy(brainCtx());
    click(tile("Acute infarct (DWI)"), { side: "left" });
    click(tile("Basal ganglia hemorrhage"), { side: "right" });
    const lines = impressionOf().split(/\n+/).map((l) => l.trim()).filter(Boolean);
    expect(lines.some((l) => /MCA territory infarct/.test(l)), "the infarct conclusion is present").toBe(true);
    expect(lines.some((l) => /basal ganglia hemorrhage/.test(l)), "the hemorrhage conclusion is present").toBe(true);
    expect(impressionOf()).not.toMatch(/^Normal MRI of the brain/);
  });

  it("Part 7 case 5 — a contradictory hand-typed normal is flagged, not silently kept", () => {
    openStudy(brainCtx());
    click(tile("Acute infarct (DWI)"), { side: "left" });
    // The radiologist hand-types the denial the finding falsifies.
    S().setField("findings", `${findingsOf()}\nNo acute infarct is seen.`, { source: "manual" });
    // The engine may not delete the radiologist's own words; what it owes is
    // the visible advisory (the armed dependency), exactly as the CT journey
    // pins it.
    expect(
      S().impressionNeedsRefresh
        || S().appliedPathologyPatches.some((p) => p.stale)
        || S().impressionDependencyReasons.length > 0,
      "the contradiction advisory must be armed over a hand-typed denial",
    ).toBe(true);
  });
});

describe("clinical acceptance corpus — MRI Cervical Spine (shipped tiles)", () => {
  it("cervical disc osteophyte complex family: herniation and root compression coexist, own normal retires", () => {
    openStudy(cervicalCtx());
    click(tile("Disc herniation C5-C6"));
    click(tile("Nerve root compression C6"), { side: "left" });
    // REQUIRED — both shipped sentences, both conclusions.
    required("Central disc herniation at C5-C6.");
    required("The left C6 nerve root shows compression by the disc-osteophyte complex.");
    required("Disc herniation at C5-C6.", "impression");
    required("Left C6 nerve root compression.", "impression");
    // FORBIDDEN — the C5-C6 contour normal the herniation falsified.
    forbidden("C5-C6: No significant disc bulge or protrusion is seen.");
    // The other levels' contour normals survive.
    required("C4-C5: No significant disc bulge or protrusion is seen.");
    required("C6-C7: No significant disc bulge or protrusion is seen.");
  });
});

describe("clinical acceptance corpus — MRI Lumbar Spine (shipped tiles)", () => {
  it("lumbar disc bulge at two levels (tiles :117, :118): each retires only its own level's normal", () => {
    openStudy(lsCtx());
    click(tile("Disc herniation L4-L5"));
    click(tile("Disc bulge L3-L4"));
    required("Broad-based disc bulge at L4-L5 with posterocentral-right paracentral protrusion causing indentation on the thecal sac and mild narrowing of bilateral neural foramina.");
    required("No significant central canal stenosis.");
    required("Disc bulge at L3-L4 without nerve root compression.");
    forbidden("L4-L5: No significant disc bulge or protrusion is seen.");
    forbidden("L3-L4: No significant disc bulge or protrusion is seen.");
    required("L2-L3: No significant disc bulge or protrusion is seen.");
    required("L5-S1: No significant disc bulge or protrusion is seen.");
    required("Disc herniation at L4-L5 causing indentation on the thecal sac.", "impression");
    required("Disc bulge at L3-L4 without nerve root compression.", "impression");
  });

  it("canal stenosis (tile :123) and ligamentum flavum (tile :134) retire their own normals only", () => {
    openStudy(lsCtx());
    click(tile("Moderate canal stenosis L4-L5"));
    click(tile("LF hypertrophy L4-L5"));
    required("Moderate canal stenosis at L4-L5.");
    required("Ligamentum flavum hypertrophy at L4-L5.");
    forbidden("L4-L5: No spinal canal or thecal sac compression is seen.");
    forbidden("Ligamentum flavum is not hypertrophied.");
    // Unrelated normals — the disc contour normal at L4-L5 survives both clicks.
    required("L4-L5: No significant disc bulge or protrusion is seen.");
    required("L4-L5: Neural foramina are patent bilaterally.");
    required("Moderate canal stenosis at L4-L5.", "impression");
    required("Ligamentum flavum hypertrophy at L4-L5.", "impression");
    forbidden("Normal MRI of the lumbosacral spine.", "impression");
  });

  it("bilateral findings (tile :142): left and right both print and both conclude", () => {
    openStudy(lsCtx());
    click(tile("Foraminal stenosis L4-L5"), { side: "left", severity: "Moderate" });
    click(tile("Foraminal stenosis L4-L5"), { side: "right", severity: "Moderate" });
    required("Moderate left neural foraminal stenosis at L4-L5.");
    required("Moderate right neural foraminal stenosis at L4-L5.");
    forbidden("L4-L5: Neural foramina are patent bilaterally.");
    required("Moderate left neural foraminal stenosis at L4-L5.", "impression");
    required("Moderate right neural foraminal stenosis at L4-L5.", "impression");
  });

  it("normal → abnormal → normal restoration: deselect returns exactly the approved scaffold", () => {
    openStudy(lsCtx());
    const scaffold = findingsOf();
    const row = click(tile("Moderate canal stenosis L4-L5"));
    forbidden("L4-L5: No spinal canal or thecal sac compression is seen.");
    S().removeObservation(row);
    recompose(lsCtx());
    required("L4-L5: No spinal canal or thecal sac compression is seen.");
    forbidden("Moderate canal stenosis at L4-L5.");
    // Full-set equivalence, order-independent (the journeys' own rule).
    const after = splitToSentences(findingsOf()).map(normalizeForDedupe).filter(Boolean).sort();
    const before = splitToSentences(scaffold).map(normalizeForDedupe).filter(Boolean).sort();
    expect(after).toEqual(before);
  });

  it("Part 7 case 3 — manual text survives every click and the Mode A pass", () => {
    openStudy(lsCtx());
    const his = "Small Schmorl node at the superior endplate of L2, typed by the radiologist.";
    S().setField("findings", `${findingsOf()}\n${his}`, { source: "manual" });
    click(tile("LF hypertrophy L4-L5"));
    required(his);
    recompose(lsCtx());
    required(his);
  });

  it("Part 7 case 4 — AI-then-edit: the radiologist's edit of an applied AI draft survives recompose", () => {
    openStudy(lsCtx());
    const aiDraft = {
      findings: "Mild asymmetry of the lumbosacral nerve root sleeve distribution, AI-drafted.",
      impression: "Clinical correlation advised for the AI-drafted observation.",
      recommendation: "",
    };
    expect(S().applyAiComposerAccepted(aiDraft)).toBe("applied");
    required("Mild asymmetry of the lumbosacral nerve root sleeve distribution, AI-drafted.");
    // The radiologist edits the applied sentence by hand.
    const edited = "Mild asymmetry of the lumbosacral nerve root sleeve distribution, revised after review.";
    S().setField("findings", findingsOf().replace(
      "Mild asymmetry of the lumbosacral nerve root sleeve distribution, AI-drafted.",
      edited,
    ));
    recompose(lsCtx());
    required(edited);
    forbidden("Mild asymmetry of the lumbosacral nerve root sleeve distribution, AI-drafted.");
  });
});

describe("facet arthropathy at a lumbar level — the study-wide facet normal (engine fix landed)", () => {
  /**
   * HISTORY (pinned 2026-10-20 as it.fails, fixed the same week; keep the
   * diagnosis with the regression so the rule cannot drift back silently):
   *
   * The shipped facet tile (quick-select-tiles.data.ts:129, "Facet arthropathy
   * L4-L5", concept facet_joint, level read from its wording) used NOT to
   * retire the owned baseline's own study-wide facet normal (fullReportBaseline
   * facet-joints row: "Lumbar facet joints are unremarkable.", concept
   * facet_joint, NO level), so the report carried BOTH:
   *
   *   "Lumbar facet joints are unremarkable."   (baseline, level-less)
   *   "Facet arthropathy at L4-L5."             (tile, level-bearing)
   *
   * The failing half was `sentenceOwnedBySlot`'s study-wide escape
   * (observationSlot.ts): the level gate wants to let one level's pathology own
   * a sentence that speaks for every level, but `isStudyWideClaim` counted
   * "Lumbar" — the observation's OWN region word, part of the anatomy wording —
   * as a region-mention site pin, so the study-wide normal read as scoped and
   * the tile did not own it. The fix is region-aware
   * (`isStudyWideClaimForLevel`): the observation's own region word is not a
   * pin, a FOREIGN region word still is, and the concept gate stays. Deselect
   * restoration then works through the shipped replacedBaseline contract —
   * which is why this case now also asserts the deselect half the old pin
   * could not.
   */
  it("facet arthropathy at L4-L5 must retire its own study-wide facet normal", () => {
    openStudy(lsCtx());
    required("Lumbar facet joints are unremarkable.");
    click(tile("Facet arthropathy L4-L5"));
    required("Facet arthropathy at L4-L5.");
    required("Facet arthropathy at L4-L5.", "impression");
    forbidden("Lumbar facet joints are unremarkable.");
    // Unrelated normals are untouched by the facet click.
    required("Ligamentum flavum is not hypertrophied.");
    required("L4-L5: No spinal canal or thecal sac compression is seen.");
    forbidden("Normal MRI of the lumbosacral spine.", "impression");
  });

  it("deselecting the facet tile restores the retired normal exactly once, and the pass keeps it", () => {
    openStudy(lsCtx());
    const scaffold = findingsOf();
    const row = click(tile("Facet arthropathy L4-L5"));
    forbidden("Lumbar facet joints are unremarkable.");
    S().removeObservation(row);
    required("Lumbar facet joints are unremarkable.");
    forbidden("Facet arthropathy at L4-L5.");
    forbidden("Facet arthropathy at L4-L5.", "impression");
    // The Mode A pass over the restored report is idempotent.
    expect(recompose(lsCtx()).action).toBe("compose");
    required("Lumbar facet joints are unremarkable.");
    forbidden("Facet arthropathy at L4-L5.");
    // Full-set equivalence with the scaffold it started from.
    const after = splitToSentences(findingsOf()).map(normalizeForDedupe).filter(Boolean).sort();
    const before = splitToSentences(scaffold).map(normalizeForDedupe).filter(Boolean).sort();
    expect(after).toEqual(before);
  });

  it("the Mode A pass after the facet click keeps the normal retired and the finding printed once", () => {
    openStudy(lsCtx());
    click(tile("Facet arthropathy L4-L5"));
    expect(recompose(lsCtx()).action).toBe("compose");
    required("Facet arthropathy at L4-L5.");
    required("Facet arthropathy at L4-L5.", "impression");
    forbidden("Lumbar facet joints are unremarkable.");
    forbidden("Normal MRI of the lumbosacral spine.", "impression");
    // Second pass is the once-only pass: nothing is duplicated, nothing moves.
    const once = findingsOf();
    expect(recompose(lsCtx()).action).toBe("compose");
    expect(findingsOf()).toBe(once);
  });

  it("facet + ligamentum flavum hypertrophy: each retires only its own normal", () => {
    openStudy(lsCtx());
    click(tile("Facet arthropathy L4-L5"));
    click(tile("LF hypertrophy L4-L5"));
    required("Facet arthropathy at L4-L5.");
    required("Ligamentum flavum hypertrophy at L4-L5.");
    forbidden("Lumbar facet joints are unremarkable.");
    forbidden("Ligamentum flavum is not hypertrophied.");
    // Unrelated normals stay: the study-wide vertebral-body and lordosis rows,
    // and the per-level canal row at the level both findings name.
    required("Lumbar vertebral bodies demonstrate normal height and marrow signal.");
    required("Normal lumbar lordosis is maintained.");
    required("L4-L5: No spinal canal or thecal sac compression is seen.");
    required("Ligamentum flavum hypertrophy at L4-L5.", "impression");
    forbidden("Normal MRI of the lumbosacral spine.", "impression");
  });

  it("facet + disc bulge: both own normals retire, the untouched levels stay", () => {
    openStudy(lsCtx());
    click(tile("Facet arthropathy L4-L5"));
    click(tile("Disc bulge L3-L4"));
    required("Facet arthropathy at L4-L5.");
    required("Disc bulge at L3-L4 without nerve root compression.");
    forbidden("Lumbar facet joints are unremarkable.");
    forbidden("L3-L4: No significant disc bulge or protrusion is seen.");
    // The L4-L5 contour normal the facet tile has no concept stake in survives,
    // and so do the levels nobody clicked.
    required("L4-L5: No significant disc bulge or protrusion is seen.");
    required("L5-S1: No significant disc bulge or protrusion is seen.");
  });

  it("facet + canal stenosis: the facet normal and the L4-L5 canal row retire, the L4-L5 disc row stays", () => {
    openStudy(lsCtx());
    click(tile("Facet arthropathy L4-L5"));
    click(tile("Moderate canal stenosis L4-L5"));
    required("Facet arthropathy at L4-L5.");
    required("Moderate canal stenosis at L4-L5.");
    forbidden("Lumbar facet joints are unremarkable.");
    forbidden("L4-L5: No spinal canal or thecal sac compression is seen.");
    required("L4-L5: No significant disc bulge or protrusion is seen.");
    required("Ligamentum flavum is not hypertrophied.");
  });

  it("selection order does not change the retired set (facet first vs facet last)", () => {
    openStudy(lsCtx());
    click(tile("Moderate canal stenosis L4-L5"));
    click(tile("LF hypertrophy L4-L5"));
    click(tile("Facet arthropathy L4-L5"));
    const facetLast = splitToSentences(findingsOf()).map(normalizeForDedupe).filter(Boolean).sort();
    openStudy(lsCtx());
    click(tile("Facet arthropathy L4-L5"));
    click(tile("LF hypertrophy L4-L5"));
    click(tile("Moderate canal stenosis L4-L5"));
    const facetFirst = splitToSentences(findingsOf()).map(normalizeForDedupe).filter(Boolean).sort();
    expect(facetFirst).toEqual(facetLast);
    // And both orders reach the same clinical verdicts.
    forbidden("Lumbar facet joints are unremarkable.");
    forbidden("Ligamentum flavum is not hypertrophied.");
    forbidden("L4-L5: No spinal canal or thecal sac compression is seen.");
  });

  it("manual text before and after the facet click survives, recompose included", () => {
    openStudy(lsCtx());
    const before = "Tiny incidental Tarlov cyst at S2, typed by the radiologist before any click.";
    S().setField("findings", `${findingsOf()}\n${before}`, { source: "manual" });
    click(tile("Facet arthropathy L4-L5"));
    required(before);
    const after = "Facet joints at L4-L5 show sclerosis, typed by the radiologist after the click.";
    S().setField("findings", `${findingsOf()}\n${after}`, { source: "manual" });
    required(after);
    recompose(lsCtx());
    required(before);
    required(after);
    forbidden("Lumbar facet joints are unremarkable.");
  });

  it("a hand-edited facet normal asks before it is replaced; the radiologist's words are never silently deleted", () => {
    openStudy(lsCtx());
    const edited = "Lumbar facet joints show minimal irregularity, reworded by the radiologist.";
    S().setField("findings", findingsOf().replace(
      "Lumbar facet joints are unremarkable.",
      edited,
    ), { source: "manual" });
    forbidden("Lumbar facet joints are unremarkable.");
    // The click must NOT replace the hand-edited sentence on its own authority.
    // The pending state keeps the radiologist's words on the page and puts the
    // decision behind the dialog; cancel rolls the whole click back.
    expect(S().applyPathologyOverlay(quickSelectTilePatch(tile("Facet arthropathy L4-L5"), "findings"))).toBe("pending");
    expect(S().confirmOverwriteOpen).toBe(true);
    required(edited);
    S().cancelOverwrite();
    required(edited);
    forbidden("Facet arthropathy at L4-L5.");
    // Asked again, the radiologist confirms; their sentence is replaced on
    // that authority, and a deselect brings their words back — not invented
    // text, not the pristine baseline they had already reworded.
    expect(S().applyPathologyOverlay(quickSelectTilePatch(tile("Facet arthropathy L4-L5"), "findings"))).toBe("pending");
    S().confirmOverwriteAndApply();
    required("Facet arthropathy at L4-L5.");
    forbidden(edited);
    S().removeObservation(tileRowId(tile("Facet arthropathy L4-L5")));
    required(edited);
    forbidden("Facet arthropathy at L4-L5.");
    forbidden("Facet arthropathy at L4-L5.", "impression");
  });

  it("facet re-click is idempotent: one finding sentence, one conclusion line", () => {
    openStudy(lsCtx());
    const row = click(tile("Facet arthropathy L4-L5"));
    expect(click(tile("Facet arthropathy L4-L5"))).toBe(row);
    expect(splitToSentences(findingsOf()).filter((s) => normalizeForDedupe(s) === normalizeForDedupe("Facet arthropathy at L4-L5."))).toHaveLength(1);
    expect(splitToSentences(impressionOf()).filter((s) => normalizeForDedupe(s) === normalizeForDedupe("Facet arthropathy at L4-L5."))).toHaveLength(1);
  });
});

describe("analogous study-wide baselines — the same rule on sibling concepts", () => {
  it("Grade 1 spondylolisthesis L4-L5 retires 'No spondylolisthesis is seen.' and leaves lordosis alone", () => {
    openStudy(lsCtx());
    click(tile("Grade 1 spondylolisthesis L4-L5"));
    required("Grade 1 spondylolisthesis at L4-L5.");
    forbidden("No spondylolisthesis is seen.");
    required("Normal lumbar lordosis is maintained.");
    required("Lumbar facet joints are unremarkable.");
    required("Grade 1 spondylolisthesis at L4-L5.", "impression");
    forbidden("Normal MRI of the lumbosacral spine.", "impression");
  });

  it("Compression fracture L1 retires the vertebral-body normal (its pack contract) and nothing else study-wide", () => {
    openStudy(lsCtx());
    click(tile("Compression fracture L1"));
    required("Acute compression fracture at L1 vertebral body with marrow edema on T2/STIR.");
    required("Posterior wall intact.");
    forbidden("Lumbar vertebral bodies demonstrate normal height and marrow signal.");
    required("Lumbar facet joints are unremarkable.");
    required("Normal lumbar lordosis is maintained.");
    required("Ligamentum flavum is not hypertrophied.");
    forbidden("Normal MRI of the lumbosacral spine.", "impression");
  });

  it("LF hypertrophy L4-L5 retires its own normal and never the facet normal's neighbour", () => {
    openStudy(lsCtx());
    click(tile("LF hypertrophy L4-L5"));
    required("Ligamentum flavum hypertrophy at L4-L5.");
    forbidden("Ligamentum flavum is not hypertrophied.");
    required("Lumbar facet joints are unremarkable.");
    required("Normal lumbar lordosis is maintained.");
  });
});
