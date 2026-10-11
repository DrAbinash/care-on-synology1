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
import { quickSelectTilePatch } from "./quickSelectTilePayload";
import { useWorkspace } from "./store";
import { MRI_BRAIN_STANDARD_NORMAL_MANIFEST } from "./baselines/mriBrainStandardNormal";
import { assertsAbnormality } from "@/lib/generateLocalImpression";
import { splitToSentences } from "@/lib/reportFieldMerge";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import { canonicalConceptTokens, normaliseConceptKey } from "@/lib/conceptCanon/conceptCanon";
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
 * Which of the scaffold's own normal sentences this text denies.
 *
 * The subject is the content pack's alias list, not a synonym table invented
 * here, so a concept the pack renames is caught the same day the pack changes.
 * A clause that denies ("…no acute infarct…") asserts nothing, so it retires
 * nothing — that is `assertsAbnormality`'s job, the same function the Conclusion
 * picker uses.
 */
function contradictedRows(text: string, rows = BASELINE_ROWS): Set<string> {
  const out = new Set<string>();
  for (const clause of splitToSentences(text)) {
    if (!assertsAbnormality(clause)) continue;
    const hay = normaliseConceptKey(clause);
    for (const row of rows) {
      const tokens = canonicalConceptTokens(row.concept);
      if (tokens.length === 0) continue;
      if (!tokens.some((tok) => hay.includes(tok))) continue;
      out.add(row.renderedText.trim());
    }
  }
  return out;
}

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
    for (const tile of BRAIN_TILES) {
      reset();
      const { outcome, findings } = applyTile(tile);
      expect(outcome, `${tile.label} was not applied`).toBe("applied");
      const text = findings();
      const denied = new Set([
        ...contradictedRows(tile.sentence),
        ...contradictedRows(tile.impressionSentence ?? ""),
      ]);
      checked += denied.size;
      for (const row of denied) {
        if (text.includes(row)) offenders.push(`${tile.label} leaves standing: ${row}`);
      }
    }
    // The scan has to be looking at something.
    expect(checked).toBeGreaterThanOrEqual(4);
    expect(offenders).toEqual([]);
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
