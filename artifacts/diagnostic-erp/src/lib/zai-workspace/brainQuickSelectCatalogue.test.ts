/**
 * The brain Quick Select catalogue, measured against the brain normal it is
 * clicked on.
 *
 * Same oracles as cervicalQuickSelectCatalogue.test.ts: every claim is checked
 * against the real store, the real shipped baseline manifest and the real content
 * pack — not against a fixture — because the thing under test is a sentence a
 * radiologist will sign.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { DEFAULT_QUICK_SELECT_TILES } from "./quick-select-library";
import { DEFAULT_REPORT_FORMATS } from "./report-formats-library";
import { quickSelectTilePatch } from "./quickSelectTileFixture";
import { useWorkspace } from "./store";
import { MRI_BRAIN_STANDARD_NORMAL_MANIFEST } from "./baselines/mriBrainStandardNormal";
import { assertsAbnormality } from "@/lib/generateLocalImpression";
import { conceptsAssertedIn } from "@/lib/observationSlot";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import { CLINICAL_CONTENT_PACKS } from "@/lib/conceptCanon/contentPacks";

function brainCtx() {
  return buildReportingStudyContext({
    modality: "MR",
    studyDescription: "MRI Brain",
    regions: ["Brain"],
    source: "auto",
  });
}

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
    reportingContext: brainCtx(),
    reportFormats: DEFAULT_REPORT_FORMATS,
    selectedFormatIds: [],
    isFinalized: false,
    isDirty: false,
  });
  useWorkspace.getState().generateProfessionalReport(brainCtx());
}

const BRAIN_TILES = DEFAULT_QUICK_SELECT_TILES.filter(
  (t) => t.scopeBodyPart === "Brain" && t.scopeModality === "MR" && t.field === "findings",
);

const BASELINE_ROWS = (MRI_BRAIN_STANDARD_NORMAL_MANIFEST.observations ?? []).filter(
  (o) => o.field === "findings",
);

/**
 * Which scaffold normals a clicked box must delete — and which it must leave
 * alone.
 *
 * Both columns are authored from the clinical claim, not read out of the engine.
 * An earlier version of this file paired a box to a normal by substring, and that
 * is what made the two sides disagree: "periventricular" reaches into the
 * ventricular normal and "intraparenchymal" into the parenchymal one, neither of
 * which the box actually falsifies. Because the engine refused to retire them,
 * the only way to get green looked like deleting anatomy from a radiologist's
 * sentence — which is what was done, and what four clinical suites then caught.
 *
 * `must`    — the regions this box says are abnormal, so their normals go.
 *             One box may legitimately contradict several.
 * `mustNot` — anatomy this box says nothing about, so its normal stays. A right
 *             basal ganglia hemorrhage says nothing about the brainstem, and
 *             mild periventricular white-matter change says nothing about
 *             ventricular size.
 */
const OWNERSHIP: Record<string, { must: string[]; mustNot: string[] }> = {
  "Basal ganglia hemorrhage": {
    // `brain_parenchyma` is in `must`, not `mustNot`: an intraparenchymal
    // hemorrhage is a parenchymal lesion, so the whole-examination statement that
    // the parenchyma has normal signal is falsified by it. That is a supersession
    // contract on the concept, not a word match — see GLOBAL_NORMAL_SUPERSESSION.
    must: ["hemorrhage", "basal_ganglia", "midline", "brain_parenchyma"],
    mustNot: ["ventricles", "infarct", "diffusion", "extra_axial",
      "brainstem", "cerebellum", "posterior_fossa", "vascular_flow_voids"],
  },
  "Acute hemorrhage": {
    must: ["hemorrhage", "basal_ganglia", "midline", "brain_parenchyma"],
    mustNot: ["ventricles", "infarct", "diffusion", "extra_axial",
      "brainstem", "cerebellum", "posterior_fossa", "vascular_flow_voids"],
  },
  "Acute infarct (DWI)": {
    must: ["infarct", "diffusion", "brain_parenchyma"],
    mustNot: ["hemorrhage", "ventricles", "basal_ganglia", "midline", "extra_axial",
      "brainstem", "cerebellum"],
  },
  "Chronic infarct": {
    // `diffusion` is deliberately not listed either way, and since #928 it is
    // genuinely neither: the infarct pack no longer aliases "restricted diffusion",
    // so a chronic claim neither retires the DWI/ADC normal nor keeps it by force —
    // the tile says nothing about the sequence, and the report says nothing more.
    // `brain_parenchyma` is in `must`: encephalomalacia with gliosis is lost
    // parenchyma, whatever words the tile happens to use.
    must: ["infarct", "brain_parenchyma"],
    mustNot: ["hemorrhage", "ventricles", "basal_ganglia", "midline", "extra_axial", "diffusion"],
  },
  Contusion: {
    must: ["hemorrhage", "brain_parenchyma"],
    mustNot: ["basal_ganglia", "extra_axial", "midline", "ventricles"],
  },
  "Diffuse axonal injury": {
    must: ["brain_parenchyma"],
    mustNot: ["hemorrhage", "infarct", "ventricles", "midline", "basal_ganglia",
      "cerebellum", "brainstem"],
  },
  "Hippocampal sclerosis": {
    must: ["brain_parenchyma"],
    mustNot: ["hemorrhage", "infarct", "ventricles", "midline", "basal_ganglia", "cerebellum"],
  },
  Cavernoma: {
    must: ["brain_parenchyma"],
    mustNot: ["hemorrhage", "infarct", "ventricles", "midline", "extra_axial", "basal_ganglia"],
  },
  AVM: {
    must: ["brain_parenchyma"],
    mustNot: ["hemorrhage", "infarct", "ventricles", "midline", "extra_axial",
      "basal_ganglia", "vascular_flow_voids"],
  },
  "Cerebral atrophy": {
    // The exemption that proves the rule: a brain can atrophy with normal signal,
    // so a volume claim falsifies none of these. Atrophy retires no normal at all.
    must: [],
    mustNot: ["brain_parenchyma", "hemorrhage", "infarct", "diffusion", "ventricles",
      "midline", "basal_ganglia", "extra_axial"],
  },
  Hydrocephalus: {
    must: ["ventricles"],
    mustNot: ["midline", "hemorrhage", "infarct", "diffusion", "basal_ganglia", "extra_axial",
      "brain_parenchyma"],
  },
  "Subdural hematoma": {
    must: ["hemorrhage", "extra_axial"],
    // Extra-axial blood: the parenchyma itself can be normal, and its
    // whole-examination normal must survive the click.
    mustNot: ["ventricles", "basal_ganglia", "midline", "brain_parenchyma", "infarct",
      "diffusion", "brainstem", "cerebellum"],
  },
  "Epidural hematoma": {
    must: ["hemorrhage", "extra_axial"],
    mustNot: ["ventricles", "basal_ganglia", "midline", "brain_parenchyma", "infarct", "diffusion"],
  },
  "Subarachnoid hemorrhage": {
    must: ["hemorrhage"],
    mustNot: ["basal_ganglia", "ventricles", "extra_axial", "midline", "brain_parenchyma"],
  },
  "Fazekas 1": {
    must: ["brain_parenchyma"],
    mustNot: ["ventricles", "basal_ganglia", "midline", "hemorrhage", "infarct",
      "diffusion", "extra_axial", "brainstem", "cerebellum"],
  },
  "Fazekas 2": {
    must: ["brain_parenchyma"],
    mustNot: ["ventricles", "basal_ganglia", "midline", "hemorrhage", "infarct", "diffusion"],
  },
  "Fazekas 3": {
    must: ["brain_parenchyma"],
    mustNot: ["ventricles", "basal_ganglia", "midline", "hemorrhage", "infarct", "diffusion"],
  },
  Microbleeds: {
    // Microbleeds are not a hemorrhage: the macroscopic negative survives.
    must: ["brain_parenchyma"],
    mustNot: ["hemorrhage", "ventricles", "basal_ganglia", "midline", "infarct"],
  },
  "Lacunar infarcts": {
    must: ["brain_parenchyma"],
    mustNot: ["infarct", "diffusion", "hemorrhage", "ventricles", "basal_ganglia"],
  },
  "Demyelinating lesion": {
    must: ["brain_parenchyma"],
    mustNot: ["ventricles", "infarct", "hemorrhage", "basal_ganglia", "diffusion"],
  },
  "Midline shift": {
    must: ["midline"],
    mustNot: ["hemorrhage", "basal_ganglia", "ventricles", "extra_axial", "brain_parenchyma"],
  },
  "Extra-axial collection": {
    must: ["extra_axial"],
    mustNot: ["hemorrhage", "midline", "ventricles", "basal_ganglia", "brain_parenchyma"],
  },
  "Mass lesion": {
    must: ["brain_parenchyma"],
    mustNot: ["hemorrhage", "ventricles", "basal_ganglia", "midline", "extra_axial"],
  },
  "Cerebral edema": {
    must: ["brain_parenchyma"],
    mustNot: ["hemorrhage", "basal_ganglia", "midline", "extra_axial"],
  },
};

function applyTile(tile: (typeof BRAIN_TILES)[number]) {
  const side = /\{side\}/i.test(tile.sentence) ? "right" : undefined;
  const outcome = useWorkspace
    .getState()
    .applyPathologyOverlay(quickSelectTilePatch(tile, "findings", side ? { side } : {}));
  return { outcome, findings: () => useWorkspace.getState().findingsText };
}

describe("the brain Quick Select catalogue", () => {
  beforeEach(() => reset());

  it("has a real catalogue to measure", () => {
    // Without this the scan below is vacuously true on an empty list — which is
    // exactly how a deleted section reads as a pass.
    expect(BRAIN_TILES.length).toBeGreaterThanOrEqual(8);
    expect(BASELINE_ROWS.length).toBeGreaterThanOrEqual(10);
  });

  it("no box can be clicked without retiring every normal it denies", () => {
    const offenders: string[] = [];
    let checked = 0;
    for (const [label, rule] of Object.entries(OWNERSHIP)) {
      const tile = BRAIN_TILES.find((t) => t.label === label);
      if (!tile) {
        offenders.push(`${label} is missing from the catalogue`);
        continue;
      }
      reset();
      const { outcome, findings } = applyTile(tile);
      if (outcome !== "applied") {
        offenders.push(`${label} was not applied`);
        continue;
      }
      const text = findings();
      const rowFor = (concept: string) => BASELINE_ROWS.find((r) => r.concept === concept);
      for (const concept of rule.must) {
        const row = rowFor(concept);
        if (!row) { offenders.push(`${label} :: no baseline row for ${concept}`); continue; }
        checked++;
        if (text.includes(row.renderedText.trim())) {
          offenders.push(`${label} leaves the ${concept} normal standing: ${row.renderedText}`);
        }
      }
      for (const concept of rule.mustNot) {
        const row = rowFor(concept);
        if (!row) { offenders.push(`${label} :: no baseline row for ${concept}`); continue; }
        checked++;
        if (!text.includes(row.renderedText.trim())) {
          offenders.push(`${label} retires the ${concept} normal it does not deny: ${row.renderedText}`);
        }
      }
    }
    // Every entry of the table has to be exercised in both directions, or an
    // emptied table reads as a pass.
    expect(Object.keys(OWNERSHIP).length).toBeGreaterThanOrEqual(15);
    expect(checked).toBeGreaterThanOrEqual(60);
    expect(offenders).toEqual([]);
  });

  it("the engine and the box agree on what the box's own words claim", () => {
    // The ratchet. `conceptsAssertedIn` is the rule the patch engine uses to
    // decide what a compound sentence falsifies, so a new box that names an
    // anatomy and fails to retire that anatomy's normal is caught the day it is
    // added — without the substring over-reach the authored table exists to stop.
    const offenders: string[] = [];
    let checked = 0;
    for (const tile of BRAIN_TILES) {
      const claimed = conceptsAssertedIn(
        `${tile.sentence} ${tile.impressionSentence ?? ""}`,
        tile.concept ?? null,
      );
      if (claimed.length === 0) continue;
      reset();
      const { outcome, findings } = applyTile(tile);
      expect(outcome, `${tile.label} was not applied`).toBe("applied");
      const text = findings();
      for (const concept of claimed) {
        const row = BASELINE_ROWS.find((r) => r.concept === concept);
        if (!row) continue;
        checked++;
        if (text.includes(row.renderedText.trim())) {
          offenders.push(`${tile.label} claims ${concept} but leaves its normal standing`);
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(10);
    expect(offenders).toEqual([]);
  });

  it("anatomy is never deleted from a sentence to make retirement pass", () => {
    // This guard exists because one attempt to get this file green removed
    // "basal ganglia" from the hemorrhage box's sentence and its Impression.
    // That is a clinical loss the clinic would have signed, and the retirement
    // problem was in the engine, not in the prose.
    const REQUIRED: Record<string, string[]> = {
      "Basal ganglia hemorrhage": ["basal ganglia", "intraparenchymal", "intraventricular", "mass effect", "midline shift"],
      "Acute hemorrhage": ["basal ganglia", "intraparenchymal", "intraventricular"],
      "Acute infarct (DWI)": ["mca", "restricted diffusion", "acute infarct"],
      "Fazekas 1": ["brain parenchyma", "periventricular", "fazekas grade 1"],
      "Fazekas 2": ["brain parenchyma", "periventricular", "confluent"],
      "Fazekas 3": ["brain parenchyma", "deep white matter", "fazekas grade 3"],
      "Subdural hematoma": ["subdural hematoma", "extra-axial", "convexity"],
      "Epidural hematoma": ["epidural hematoma", "extra-axial"],
      "Subarachnoid hemorrhage": ["subarachnoid hemorrhage", "basal cisterns"],
      Microbleeds: ["brain parenchyma", "gre/swi", "microbleeds"],
      "Demyelinating lesion": ["brain parenchyma", "demyelinating"],
      "Chronic infarct": ["encephalomalacia", "chronic infarct"],
      Contusion: ["contusion", "intraparenchymal hemorrhage"],
      "Mass lesion": ["brain parenchyma", "mass lesion", "edema"],
      "Cerebral edema": ["brain parenchyma", "edema"],
      Hydrocephalus: ["ventricular system", "hydrocephalus"],
    };
    const offenders: string[] = [];
    for (const [label, phrases] of Object.entries(REQUIRED)) {
      const tile = BRAIN_TILES.find((t) => t.label === label);
      if (!tile) { offenders.push(`${label} is missing from the catalogue`); continue; }
      const hay = `${tile.sentence} ${tile.impressionSentence ?? ""}`.toLowerCase();
      for (const p of phrases) {
        if (!hay.includes(p.toLowerCase())) offenders.push(`${label} no longer says "${p}"`);
      }
    }
    expect(offenders).toEqual([]);
    // The hemorrhage box must still put the location in the Impression, which is
    // the line the clinic reads first.
    const hem = BRAIN_TILES.find((t) => t.label === "Basal ganglia hemorrhage")!;
    expect(hem.impressionSentence ?? "").toMatch(/basal ganglia/i);
  });

  it("clears a normal it contradicts even when no shared word gives it away", () => {
    // Named pairs where the denial shares no phrase with the normal — the scan
    // above pairs by content-pack tokens, but these are clinical denials that
    // need explicit `baselineReplaces` or a conflictGroup match.
    const EXPLICIT: Array<[string, string[]]> = [
      ["Hydrocephalus", ["Ventricular system and cisternal spaces are normal in size and configuration."]],
    ];
    const offenders: string[] = [];
    for (const [label, expectedRetired] of EXPLICIT) {
      const tile = BRAIN_TILES.find((t) => t.label === label);
      if (!tile) {
        offenders.push(`${label} is missing from the catalogue`);
        continue;
      }
      reset();
      const { findings } = applyTile(tile);
      const text = findings();
      for (const row of expectedRetired) {
        if (text.includes(row)) offenders.push(`${label} leaves standing: ${row}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("a finding in one region leaves other regions' normals alone", () => {
    // A left MCA infarct must not retire the posterior fossa, the ventricles, etc.
    const tile = BRAIN_TILES.find((t) => t.label.includes("Acute infarct"));
    if (!tile) throw new Error("the acute infarct tile is missing");
    reset();
    const { findings } = applyTile(tile);
    const text = findings();
    // The infarct tile's concept is "infarct", so it must not retire ventricles,
    // brainstem, cerebellum, etc.
    expect(text).toContain("Ventricular system and cisternal spaces are normal");
    expect(text).toContain("Brainstem shows normal morphology");
    expect(text).toContain("Cerebellar hemispheres show normal morphology");
  });

  it("the levels (regions) the baseline describes equal what the tiles cover", () => {
    // The brain baseline has 12 observations. Each should be coverable by at
    // least one tile (either by concept match or by being a normal that no
    // abnormal tile contradicts).
    const concepts = new Set(BRAIN_TILES.map((t) => t.concept).filter(Boolean));
    const baselineConcepts = BASELINE_ROWS.map((o) => o.concept).filter(Boolean);
    // At least the major concepts (infarct, hemorrhage, ventricles) should be
    // covered by tiles.
    expect(concepts.has("infarct")).toBe(true);
    expect(concepts.has("hemorrhage")).toBe(true);
    expect(concepts.has("ventricles")).toBe(true);
    expect(baselineConcepts.length).toBeGreaterThanOrEqual(10);
  });

  it("no box invents advice — every recommendationSentence is verbatim a shipped Report Format of the same examination", () => {
    const offenders: string[] = [];
    for (const tile of BRAIN_TILES) {
      if (!tile.recommendationSentence) continue;
      const wanted = tile.recommendationSentence.trim();
      const match = DEFAULT_REPORT_FORMATS.find(
        (f) =>
          f.modality === tile.scopeModality &&
          f.bodyPart === tile.scopeBodyPart &&
          (f.recommendation ?? "").trim() === wanted,
      );
      if (!match) offenders.push(`${tile.label} :: ${wanted.slice(0, 80)}`);
    }
    expect(offenders).toEqual([]);
  });

  it("a Conclusion line appears only where the content pack ranks the concept impression-worthy", () => {
    const offenders: string[] = [];
    for (const tile of BRAIN_TILES) {
      if (!tile.impressionSentence) continue;
      const pack = CLINICAL_CONTENT_PACKS.find((p) => p.concept === tile.concept);
      if (!pack) {
        offenders.push(`${tile.label} :: concept ${tile.concept} not in content pack`);
        continue;
      }
      if (pack.impressionworthyAbnormal !== true) {
        offenders.push(`${tile.label} :: ${tile.concept} is not impression-worthy`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the one baseline concept the pack does not carry is named, so the blind spot is visible instead of silent", () => {
    const blind: string[] = [];
    for (const obs of BASELINE_ROWS) {
      if (!obs.concept) continue;
      const pack = CLINICAL_CONTENT_PACKS.find((p) => p.concept === obs.concept);
      if (!pack) blind.push(obs.concept);
    }
    // The brain baseline has no uncanonised concepts (all are in the pack).
    expect(blind).toEqual([]);
  });

  it("deselect restores the normal — retirement, not deletion", () => {
    // A tile with baselineReplaces must point to a sentence that exists in the
    // baseline, so deselect can restore it.
    const offenders: string[] = [];
    for (const tile of BRAIN_TILES) {
      if (!tile.baselineReplaces) continue;
      const found = BASELINE_ROWS.find((o) => o.renderedText === tile.baselineReplaces);
      if (!found) offenders.push(`${tile.label} :: baselineReplaces sentence not in baseline`);
    }
    expect(offenders).toEqual([]);
  });

  it("after a box deviates, the store's Conclusion drops the scaffold's normal sentence", () => {
    // A tile's impressionSentence must not be the same as any baseline sentence
    // it retires — otherwise the Conclusion would print the normal it's supposed
    // to replace.
    const offenders: string[] = [];
    for (const tile of BRAIN_TILES) {
      if (!tile.impressionSentence || !tile.baselineReplaces) continue;
      if (tile.impressionSentence === tile.baselineReplaces) {
        offenders.push(`${tile.label} :: impressionSentence equals baselineReplaces`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("named pairs where the denial shares no word with the normal are checked explicitly", () => {
    // A tile that retires a normal by baselineReplaces must have a concept that
    // matches the observation's concept — otherwise the scan's token match would
    // miss it.
    const offenders: string[] = [];
    for (const tile of BRAIN_TILES) {
      if (!tile.baselineReplaces || !tile.concept) continue;
      const obs = BASELINE_ROWS.find((o) => o.renderedText === tile.baselineReplaces);
      if (!obs) continue;
      if (obs.concept !== tile.concept) {
        offenders.push(`${tile.label} :: tile concept ${tile.concept} != obs concept ${obs.concept}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("none of the baseline findings sentences asserts abnormality", () => {
    const offenders: string[] = [];
    let scanned = 0;
    for (const obs of BASELINE_ROWS) {
      scanned++;
      if (assertsAbnormality(obs.renderedText)) offenders.push(obs.renderedText);
    }
    // The scan itself has to be non-vacuous.
    expect(scanned).toBeGreaterThanOrEqual(10);
    expect(offenders).toEqual([]);
  });

  it("the scan's own semantics: a denial reads as agreement", () => {
    // A sentence that denies a finding must not be read as asserting one.
    const denials = [
      "No acute infarct is seen.",
      "No intracranial hemorrhage is seen.",
      "No restricted diffusion is seen on DWI/ADC.",
      "No midline shift is seen.",
      "Ventricular system and cisternal spaces are normal in size and configuration.",
      "Brain parenchyma shows normal signal intensity with preserved grey-white differentiation.",
    ];
    for (const d of denials) {
      expect(assertsAbnormality(d), `denial read as abnormal: ${d}`).toBe(false);
    }
  });
});
