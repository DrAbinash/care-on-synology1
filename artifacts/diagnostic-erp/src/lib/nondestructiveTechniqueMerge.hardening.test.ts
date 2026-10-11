/**
 * B-02A — the Technique merge may dedupe text it can prove is the same sentence.
 * It may not decide that an acquisition fact is unimportant.
 *
 * Technique is not boilerplate: it records what was actually acquired, and in this
 * codebase it is also *load-bearing* — `deriveSpineSequencesAvailable` reads it to
 * decide which sequences exist, which in turn drives limitation wording (#876
 * proved that by making the Technique round-trip work). So a merge that deletes a
 * fragment here does not merely shorten a paragraph; it changes derived clinical
 * state.
 *
 * `mergeTechniqueWithProvenance` had three ways of deleting acquisition facts, and
 * this file executes all of them. Measured at `6d452566` (#878 merged):
 *
 *   1. **Paraphrase replacement.** `findTechniqueParaphraseIndex` scored Jaccard
 *      similarity over tokens longer than two characters and, at ≥ 0.55, treated the
 *      two sentences as the same paragraph; the surviving slot then took the LONGER
 *      text (`if (s.length > kept.text.length) kept.text = s`). Longer is not more
 *      informative:
 *        "MRI of the brain was performed on a 1.5T scanner."
 *      + "Multiplanar multisequence MRI of the brain was performed."
 *        → "Multiplanar multisequence MRI of the brain was performed."   1.5T gone
 *      In the reverse order the 1.5T sentence is the shorter one and is dropped
 *      instead. Either way the field strength disappears.
 *
 *   2. **Concept-coverage discard.** If every recognised concept of the incoming
 *      sentence was already present, the incoming sentence was thrown away whole.
 *      The concept list is eleven patterns — 3T, 1.5T, contrast, multiplanar,
 *      multisequence, T1, T2, FLAIR, DWI, SWI, ADC — so STIR, GRE-as-such, MRA,
 *      spectroscopy, fat saturation, axial/sagittal/coronal planes, slice thickness,
 *      screening and limitation wording are INVISIBLE to it. A cervical or lumbar
 *      screening technique arriving at a brain technique therefore looked redundant
 *      and was deleted along with its STIR, its planes and its "limited planar and
 *      limited sequence" statement. Cross-pairwise over the shipped formats this
 *      lost an acquisition fact in 1338 of 5700 ordered pairs — the sweep below,
 *      which is now the regression gate.
 *
 *   3. Both paths then unioned the incoming source onto a sentence that producer
 *      never wrote, so provenance reported authorship of text it had not authored.
 *
 * The fix is subtraction: exact-normalized equivalence still dedupes and still
 * unions sources (that is textual fact, and §6 forbids losing it); a `|`-row or a
 * fragment differing only in case, punctuation or spacing still collapses; anything
 * else is appended verbatim. No similarity score, no concept set, no length
 * comparison participates in the decision any more — none of them can see the facts
 * that matter, and pretending otherwise is what lost them.
 *
 * What was deliberately NOT done: no synonym/abbreviation table, no MRI ontology,
 * no threshold retuning (0.55 → 0.9 would just change which facts get deleted), no
 * synthesized merged sentence ("Multiplanar multisequence MRI of the brain performed
 * on a 1.5T scanner." would be prose neither input contained), and no contradiction
 * adjudication — "1.5T" plus "3T" both staying is a contradiction for the
 * radiologist to see, which is the point. `jaccard`/`tokenSet` stay, because the
 * provenance-inheritance path (`isLightSentenceEdit`, `findFuzzyProvenanceMatch`)
 * uses them and only ever decides attribution, never text.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(() => ({ id: "t", dismiss: () => {}, update: () => {} })),
  useToast: vi.fn(),
}));

import {
  mergeReportFieldContentWithProvenance,
  mergeTechnique,
  mergeTechniqueWithProvenance,
  normalizeForDedupe,
  splitToSentences,
} from "@/lib/reportFieldMerge";
import {
  TECHNIQUE_SECTION_KEY,
  resolveDraftTechnique,
} from "@/lib/draftTechniqueRoundTrip";
import { DEFAULT_REPORT_FORMATS } from "@/lib/zai-workspace/report-formats-library";
import { DEFAULT_QUICK_SELECT_TILES } from "@/lib/zai-workspace/quick-select-library";
import { quickSelectTilePatch } from "@/lib/zai-workspace/quickSelectTilePayload";
import { deriveTechniqueFragments, mergeTwoFormatsBySlot } from "@/lib/formatSlotMerge";
import { deriveSpineSequencesAvailable } from "@/lib/mriSpineSequences";
import { emptyClinicalState } from "@/lib/zai-workspace/clinicalStateReset";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import type { FieldProvenanceMap, InsertSource } from "@/lib/reportFieldMerge";

const here = dirname(fileURLToPath(import.meta.url));
const mergeSrc = readFileSync(join(here, "reportFieldMerge.ts"), "utf8").replace(/\r\n/g, "\n");
const techniqueBody = (() => {
  const start = mergeSrc.indexOf("export function mergeTechniqueWithProvenance");
  const end = mergeSrc.indexOf("export function mergeTechnique(", start);
  return mergeSrc.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
})();

/**
 * Acquisition facts a Technique sentence can carry. This is a TEST-side audit
 * lens — the production merge no longer inspects concepts at all. Each pattern is
 * a fact a radiologist or a protocol author wrote, and none of them may vanish
 * because another sentence used similar words.
 */
const ACQUISITION_FACTS: Array<{ label: string; re: RegExp }> = [
  { label: "1.5T", re: /\b1\.5\s*t\b/i },
  { label: "3T", re: /\b3\s*t(esla)?\b/i },
  { label: "STIR", re: /\bstir\b/i },
  { label: "DWI", re: /\bdwi\b|diffusion/i },
  { label: "ADC", re: /\badc\b/i },
  { label: "SWI/GRE", re: /\bswi\b|\bgre\b/i },
  { label: "FLAIR", re: /\bflair\b/i },
  { label: "T1W", re: /\bt1w?\b/i },
  { label: "T2W", re: /\bt2w?\b/i },
  { label: "post-contrast", re: /post[- ]?contrast|with contrast|gadolin|gadobutrol|after intravenous/i },
  { label: "no-contrast", re: /without (intravenous )?contrast|non[- ]contrast|no contrast/i },
  { label: "MRA/MRV", re: /\bmra\b|\bmrva?\b|angiograph/i },
  { label: "spectroscopy", re: /spectroscop|\bmrs\b/i },
  { label: "fat suppression", re: /fat[- ]sat|spectral (presat|fat)/i },
  { label: "axial", re: /\baxial\b/i },
  { label: "sagittal", re: /\bsagittal\b/i },
  { label: "coronal", re: /\bcoronal\b/i },
  { label: "screening", re: /screening/i },
  { label: "limited planar/sequence", re: /limited (planar|sequence|coverage)|this is a limited/i },
  { label: "slice thickness", re: /\b\d+(\.\d+)?\s*mm\b/i },
];

function factsIn(text: string): Set<string> {
  return new Set(ACQUISITION_FACTS.filter((f) => f.re.test(text)).map((f) => f.label));
}

function manualOwned(existing: string, source: InsertSource = "manual"): FieldProvenanceMap {
  return { [normalizeForDedupe(existing)]: [source] };
}

/**
 * What a Technique block actually states, normalized for comparison. These tests
 * count sentences rather than lines on purpose: the merge has always re-laid an
 * existing Technique block by re-joining its sentences with "\n", so a single
 * input line "A. B. C." comes out as three lines. That layout behaviour is
 * pre-existing, is not an information loss, and is out of B-02A's scope (§22);
 * pinning it here would make the loss tests unreadable. It is recorded as a
 * finding instead.
 */
function stated(text: string): string[] {
  return splitToSentences(text).map(normalizeForDedupe);
}

function reset(context?: ReturnType<typeof buildReportingStudyContext>) {
  useWorkspace.setState({
    ...emptyClinicalState(),
    reportingContext: context ?? buildReportingStudyContext({
      modality: "MR", studyDescription: "MRI LS Spine", regions: ["LS Spine"], source: "auto",
    }),
    studies: [{ id: "study-1", patient: { name: "Test Patient", sex: "F" }, modality: "MR" }],
    activeStudyId: "study-1",
    activeStudyInstanceUID: "1.2.840.TEST",
    completedStudyIds: new Set<string>(),
  } as never);
}

/** Same shape the saved draft arrives in (B-01): TEXT column holding a JSON map. */
function savedDraftRow(technique: string, extraSections: Record<string, string> = {}) {
  const sections: Record<string, string> = { ...extraSections };
  if (technique.trim()) sections[TECHNIQUE_SECTION_KEY] = technique.trim();
  return {
    id: 101, studyId: 7, rawFindings: "Findings text",
    findingsSections: Object.keys(sections).length > 0 ? JSON.stringify(sections) : null,
    impression: JSON.stringify(["Impression text"]), recommendation: "Recommendation text",
    clinicalHistory: "Headache.", status: "draft", updatedAt: "2026-10-07T00:00:00.000Z",
  };
}

beforeEach(() => { vi.restoreAllMocks(); reset(); });

// ─────────────────────────────────────────────────────────────────────────────
// T1–T10 — information loss, one test per acquisition fact class.
// ─────────────────────────────────────────────────────────────────────────────
describe("T1–T10 — every acquisition fact survives a similar-sounding arrival", () => {
  function expectNoLoss(existing: string, incoming: string, opts: { source?: InsertSource; must: string[] }) {
    const r = mergeTechniqueWithProvenance(existing, incoming, manualOwned(existing), opts.source ?? "template");
    const out = factsIn(r.text);
    for (const fact of opts.must) {
      expect(`${r.text} :: ${fact}`).toBeTruthy();
      expect([...factsIn(existing), ...factsIn(incoming)].includes(fact)).toBe(true);
      expect(out.has(fact)).toBe(true);
    }
    // And the existing sentence is still there in its own words.
    for (const s of stated(existing)) expect(stated(r.text)).toContain(s);
    return r;
  }

  it("T1 field strength survives a generic paraphrase arriving", () => {
    expectNoLoss(
      "MRI of the brain was performed on a 1.5T scanner.",
      "Multiplanar multisequence MRI of the brain was performed.",
      { must: ["1.5T"] },
    );
  });

  it("T2 field strength survives in the reverse arrival order too", () => {
    const r = expectNoLoss(
      "Multiplanar multisequence MRI of the brain was performed.",
      "MRI of the brain was performed on a 1.5T scanner.",
      { must: ["1.5T"] },
    );
    expect(r.text).toContain("1.5T scanner");
  });

  it("T3 two different field strengths are both kept — no adjudication", () => {
    const r = mergeTechniqueWithProvenance(
      "MRI performed on a 1.5T scanner.", "MRI performed on a 3T scanner.",
      manualOwned("MRI performed on a 1.5T scanner."), "template",
    );
    expect(stated(r.text)).toHaveLength(2);
    expect(r.text).toContain("1.5T");
    expect(r.text).toContain("3T");
  });

  it("T4 the non-contrast statement cannot be erased by a generic sentence", () => {
    expectNoLoss(
      "MRI brain performed without intravenous contrast.",
      "Multiplanar MRI brain was performed.",
      { must: ["no-contrast"] },
    );
  });

  it("T5 pre-/post-contrast information is preserved", () => {
    expectNoLoss(
      "Pre- and post-contrast MRI sequences were obtained.",
      "Multiplanar multisequence MRI was performed.",
      { must: ["post-contrast"] },
    );
  });

  it("T6 DWI and ADC are preserved", () => {
    expectNoLoss(
      "DWI and ADC sequences were obtained.",
      "Multiplanar multisequence MRI brain was performed.",
      { must: ["DWI", "ADC"] },
    );
  });

  it("T7 SWI/GRE is preserved", () => {
    expectNoLoss(
      "SWI sequences were obtained.",
      "Multiplanar multisequence MRI brain was performed.",
      { must: ["SWI/GRE"] },
    );
  });

  it("T8 STIR is preserved in both arrival directions", () => {
    // STIR is not in the old concept list at all, so the discard rule could not
    // even see it — the clearest proof that concept coverage was never a safe
    // equivalence test.
    const stir = "Sagittal T1W, T2W and STIR images were obtained.";
    const generic = "Multiplanar multisequence MRI of the spine was performed.";
    expectNoLoss(stir, generic, { must: ["STIR", "sagittal", "T1W", "T2W"] });
    const back = mergeTechniqueWithProvenance(generic, stir, manualOwned(generic), "template");
    expect(back.text).toContain("STIR");
  });

  it("T8b STIR survives the cross-region case that the concept rule deleted", () => {
    const brain = "MRI brain on 3T. T1W, T2W, FLAIR, DWI, ADC, post-contrast T1W GRE. 5 mm.";
    const lsScreening = "Limited planar and limited sequence MRI lumbosacral spine screening was performed (sagittal T1W, T2W and STIR).";
    const r = mergeTechniqueWithProvenance(brain, lsScreening, manualOwned(brain), "protocol");
    for (const fact of ["STIR", "sagittal", "screening", "limited planar/sequence"]) {
      expect(`${r.text} :: ${fact}`).toBeTruthy();
      expect(factsIn(r.text).has(fact)).toBe(true);
    }
    // The brain technique is untouched, not rewritten into something longer.
    // (Compared sentence by sentence because the merge re-lays its block.)
    expect(stated(r.text)).toEqual([...stated(brain), ...stated(lsScreening)]);
  });

  it("T9 a technical limitation is never treated as boilerplate", () => {
    expectNoLoss(
      "Study is partially limited by motion artefact.",
      "Multiplanar multisequence MRI was performed.",
      { must: [] },
    );
    const r = mergeTechniqueWithProvenance(
      "Study is partially limited by motion artefact.",
      "Multiplanar multisequence MRI was performed.",
      manualOwned("Study is partially limited by motion artefact."), "template",
    );
    expect(r.text).toContain("partially limited by motion artefact");
  });

  it("T10 shipped screening wording survives a plain protocol arriving, both ways", () => {
    const screening = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI Cervical Spine — Screening")!.technique!;
    const plain = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI Cervical Spine — Normal")!.technique!;
    expect(screening).toMatch(/limited planar and limited sequence/i);
    for (const [existing, incoming, label] of [[screening, plain, "screening first"], [plain, screening, "plain first"]] as const) {
      const r = mergeTechniqueWithProvenance(existing, incoming, manualOwned(existing), "protocol");
      const lost = [...factsIn(existing), ...factsIn(incoming)].filter((f) => !factsIn(r.text).has(f));
      expect(`${label} lost: ${lost.join(", ")}`).toBe(`${label} lost: `);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T11–T14 — conservative dedupe is still conservative dedupe, not "no dedupe".
// ─────────────────────────────────────────────────────────────────────────────
describe("T11–T14 — provable duplication still collapses", () => {
  const LS = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI LS Spine — Normal")!.technique!;

  it("T11 exact duplicate → one statement of each", () => {
    const r = mergeTechniqueWithProvenance(LS, LS, manualOwned(LS), "template");
    expect(stated(r.text)).toEqual(stated(LS));
    expect(new Set(stated(r.text)).size).toBe(stated(r.text).length);
    // And nothing was thrown away on the way: the merge result states exactly the
    // sentences the single block states.
    expect(stated(r.text).length).toBeGreaterThan(1);
  });

  it("T12 whitespace-only difference → still one statement", () => {
    const spaced = LS.replace(/\.\s/g, ".  ");
    const r = mergeTechniqueWithProvenance(LS, spaced, manualOwned(LS), "template");
    expect(stated(r.text)).toEqual(stated(LS));
  });

  it("T13 case/punctuation-only difference → still one statement", () => {
    const r = mergeTechniqueWithProvenance(
      "MRI brain performed without contrast.",
      "MRI Brain Performed Without Contrast",
      manualOwned("MRI brain performed without contrast."), "template",
    );
    expect(r.text).toBe("MRI brain performed without contrast.");
  });

  it("T14 a duplicate arriving from another source unions sources, inventing no sentence", () => {
    const first = mergeTechniqueWithProvenance("", LS, {}, "quick-select");
    const second = mergeTechniqueWithProvenance(first.text, LS, first.provenance, "protocol");
    const keys = Object.keys(second.provenance);
    expect(keys).toHaveLength(Object.keys(first.provenance).length);
    for (const key of keys) expect(second.provenance[key]!.length).toBeGreaterThanOrEqual(2);
    expect(stated(second.text)).toEqual(stated(first.text));
  });

  it("T14b a sentence repeated inside ONE incoming block collapses instead of throwing", () => {
    // The removed concept-aware code kept its dedupe index in a mixed index space
    // (`segments.length + keptIncoming.length - 1` read back through `segments`),
    // so this shape — a template block that states the same sequence twice — threw
    // `TypeError: Cannot read properties of undefined (reading 'sources')` out of
    // mergeField, formatSlotMerge and mergeTechnique alike. Positive control that
    // the case is real: the same call with the old function reproduces the throw.
    const block = "Sagittal T1W and T2W images were acquired. Slice thickness 3 mm. Sagittal T1W and T2W images were acquired.";
    const r = mergeTechniqueWithProvenance("MRI spine was performed on a 3T scanner.", block, {}, "template");
    expect(stated(r.text)).toEqual([
      "mri spine was performed on a 3t scanner",
      "sagittal t1w and t2w images were acquired",
      "slice thickness 3 mm",
    ]);
    expect(r.provenance[normalizeForDedupe("Slice thickness 3 mm.")]).toEqual(["template"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T15–T17 — overlap and polarity are not equivalence.
// ─────────────────────────────────────────────────────────────────────────────
describe("T15–T17 — generic/specific overlap and contrast polarity keep both", () => {
  it("T15 generic existing + specific incoming → both retained, no synthesized merge", () => {
    const r = mergeTechniqueWithProvenance(
      "MRI brain was performed.",
      "Multiplanar multisequence MRI brain was performed.",
      manualOwned("MRI brain was performed."), "template",
    );
    expect(stated(r.text)).toEqual([
      "mri brain was performed",
      "multiplanar multisequence mri brain was performed",
    ]);
    // §13: the merge must not write prose that neither input contained.
    expect(r.text).not.toMatch(/Multiplanar multisequence MRI brain was performed on/i);
  });

  it("T16 specific existing + generic incoming → the specific wording is not replaced", () => {
    const specific = "Multiplanar multisequence MRI brain was performed.";
    const r = mergeTechniqueWithProvenance(specific, "MRI brain was performed.", manualOwned(specific), "template");
    expect(stated(r.text)).toEqual([
      "multiplanar multisequence mri brain was performed",
      "mri brain was performed",
    ]);
  });

  it("T17 contrast and non-contrast statements never collapse into one another", () => {
    const r = mergeTechniqueWithProvenance(
      "Contrast-enhanced MRI was performed.",
      "MRI was performed without contrast.",
      manualOwned("Contrast-enhanced MRI was performed."), "template",
    );
    expect(stated(r.text)).toHaveLength(2);
    expect(r.text).toContain("Contrast-enhanced");
    expect(r.text).toContain("without contrast");
  });

  it("T17b sequence availability statements and their negation both remain", () => {
    const r = mergeTechniqueWithProvenance(
      "DWI sequences were obtained.",
      "DWI was not acquired due to poor cooperation.",
      manualOwned("DWI sequences were obtained."), "template",
    );
    expect(stated(r.text)).toEqual([
      "dwi sequences were obtained",
      "dwi was not acquired due to poor cooperation",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T18–T19 — provenance through the real action.
// ─────────────────────────────────────────────────────────────────────────────
describe("T18/T19 — provenance stays attributable through mergeField", () => {
  const STIR = "MRI lumbo-sacral spine on 3T. Sagittal T1W, T2W and STIR; axial T1W and T2W images were obtained.";
  const GENERIC = "Multiplanar multisequence MRI of the lumbosacral spine was performed.";

  it("T18 the manual Technique sentence keeps manual provenance and its own words", () => {
    reset();
    useWorkspace.getState().setField("technique", STIR, { source: "manual" });
    expect(useWorkspace.getState().mergeField("technique", GENERIC, "template")).toBe("applied");
    const st = useWorkspace.getState();
    expect(st.techniqueText).toContain("Sagittal T1W, T2W and STIR");
    expect(st.fieldProvenance.technique?.[normalizeForDedupe("Sagittal T1W, T2W and STIR; axial T1W and T2W images were obtained.")])
      .toEqual(["manual"]);
  });

  it("T19 the arriving template sentence carries the template source and nothing else", () => {
    reset();
    useWorkspace.getState().setField("technique", STIR, { source: "manual" });
    useWorkspace.getState().mergeField("technique", GENERIC, "template");
    const prov = useWorkspace.getState().fieldProvenance.technique ?? {};
    expect(prov[normalizeForDedupe(GENERIC)]).toEqual(["template"]);
    expect(Object.values(prov).some((sources) => sources.includes("template") && sources.includes("manual"))).toBe(false);
  });

  it("T19b an exact duplicate still unions sources, which is the only case that may", () => {
    reset();
    useWorkspace.getState().setField("technique", STIR, { source: "manual" });
    useWorkspace.getState().mergeField("technique", STIR, "protocol");
    const prov = useWorkspace.getState().fieldProvenance.technique ?? {};
    expect(prov[normalizeForDedupe("MRI lumbo-sacral spine on 3T.")]).toEqual(["manual", "protocol"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T20–T22 — the loop B-01 closed: merged Technique → save → reload → derive.
// ─────────────────────────────────────────────────────────────────────────────
describe("T20–T22 — merged Technique survives save/reload and still drives derivation", () => {
  const STIR = "MRI lumbo-sacral spine on 3T. Sagittal T1W, T2W and STIR; axial T1W and T2W images were obtained.";
  const GENERIC = "Multiplanar multisequence MRI of the lumbosacral spine was performed.";
  const context = { studyDescription: "MRI Lumbar Spine", protocolName: null, reportTitle: null };

  it("T20 both Technique facts are still present after the draft is stored and read back", () => {
    const merged = mergeTechnique(STIR, GENERIC);
    const restored = resolveDraftTechnique(savedDraftRow(merged));
    expect(restored).toContain("STIR");
    expect(restored).toContain("Sagittal T1W, T2W and STIR");
    expect(restored).toContain("Multiplanar multisequence MRI of the lumbosacral spine was performed.");
    expect(restored).toContain("3T");
  });

  it("T21 sequence derivation is identical before the merge and after it", () => {
    const before = deriveSpineSequencesAvailable({ techniqueText: STIR, ...context });
    const after = deriveSpineSequencesAvailable({ techniqueText: mergeTechnique(STIR, GENERIC), ...context });
    expect(after).toEqual(before);
    expect(after.stir).toBe(true);
    expect(after.axial).toBe(true);
  });

  it("T22 derivation survives the save/reload round trip, and the check is not vacuous", () => {
    const merged = mergeTechnique(STIR, GENERIC);
    const fromMerge = deriveSpineSequencesAvailable({ techniqueText: merged, ...context });
    const afterReload = deriveSpineSequencesAvailable({
      techniqueText: resolveDraftTechnique(savedDraftRow(merged)), ...context,
    });
    expect(afterReload).toEqual(fromMerge);
    // Control: if the Technique had been lost, derivation would differ — this is
    // what makes the equality above mean something.
    const lost = deriveSpineSequencesAvailable({ techniqueText: "", ...context });
    expect(lost.stir).toBe(false);
    expect(afterReload.stir).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T23–T24 — the neighbouring protections still hold.
// ─────────────────────────────────────────────────────────────────────────────
describe("T23/T24 — B-02 and B-09 are untouched by this change", () => {
  it("T23 Findings still merges with the B-02 rule and never through the technique path", () => {
    const r = mergeReportFieldContentWithProvenance({
      field: "findings",
      existing: "No acute infarct.",
      incoming: "No acute infarct or haemorrhage.",
      source: "quick-select",
      existingProvenance: manualOwned("No acute infarct."),
    });
    expect(r.text).toBe("No acute infarct.\nNo acute infarct or haemorrhage.");
    // Technique's fragment layout behaviour must not leak into Findings: no
    // re-splitting of an unchanged sentence.
    expect(r.text.split("\n")).toHaveLength(2);
  });

  it("T24 a Quick Select tile with an unchosen side still refuses, and the merge does not swallow parameter text", () => {
    reset();
    const infarct = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Acute infarct (DWI)")!;
    expect(useWorkspace.getState().applyPathologyOverlay(quickSelectTilePatch(infarct, "findings"))).toBe("refused");
    expect(useWorkspace.getState().findingsText).toBe("");
    // B-09's guard lives in the overlay path; B-02A must not paper over it nor
    // eat it. An unresolved parameter is still a sentence the radiologist has to
    // see, so the merge keeps it verbatim instead of folding it onto a
    // similar-sounding one — under the old rule this pair folded and lost "1.5T".
    const braced = "MRI of the {region} was performed on a 1.5T scanner.";
    const r = mergeTechniqueWithProvenance(
      braced, "Multiplanar multisequence MRI of the {region} was performed.",
      manualOwned(braced), "quick-select",
    );
    expect(stated(r.text)).toHaveLength(2);
    expect(r.text).toContain("{region}");
    expect(r.text).toContain("1.5T");
    // Census at this commit: every brace-carrying shipped tile is a
    // findings/impression tile — no technique tile carries a parameter, which is
    // why the refusal belongs to B-09 and not to this merge.
    const techTiles = DEFAULT_QUICK_SELECT_TILES.filter((t) => t.field === "technique");
    expect(techTiles.length).toBeGreaterThan(0);
    expect(techTiles.filter((t) => /\{[a-z]+\}/i.test(t.sentence))).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T25–T26 — the real callers of the Technique merge, not just the primitive.
// ─────────────────────────────────────────────────────────────────────────────
describe("T25/T26 — the format-combination caller keeps both protocols and does not double-append", () => {
  const fmt = (name: string) => DEFAULT_REPORT_FORMATS.find((f) => f.name === name)!;

  it("T25 combining a screening format with its plain twin states both, exactly once", () => {
    // `mergeTechniquePreservingScreening` exists because the old merge deleted
    // screening wording and something had to put it back. Now that nothing is
    // deleted, its re-append must stay silent — if it fires, the sentence is
    // printed twice on paper.
    const a = fmt("MRI Cervical Spine — Screening");
    const b = fmt("MRI Cervical Spine — Normal");
    const merged = mergeTwoFormatsBySlot(a, b);
    const text = merged.technique;
    for (const fact of ["screening", "limited planar/sequence", "sagittal", "axial", "3T"]) {
      expect(`${text} :: ${fact}`).toBeTruthy();
      expect(factsIn(text).has(fact)).toBe(true);
    }
    expect(text.match(/limited planar and limited sequence/gi)).toHaveLength(1);
    expect(text.match(/screening/gi)).toHaveLength(1);
    // The band-aid is still reachable, it is just no longer needed for this pair.
    expect(merged.techniqueSentences.filter((s) => /limited/i.test(s.text))).toHaveLength(1);
  });

  it("T26 every shipped format pair merges without losing an acquisition fact", () => {
    // Scope note as written in #879: only formats WITHOUT `techniqueFragments`
    // reached the merge this PR fixed, because `mergeTechniquePreservingScreening`
    // delegated to `mergeTechniqueFragments` whenever either side had fragments,
    // and that path takes its text from the fragment list rather than from
    // `.technique` — so a fact carried only in `.technique` was never part of the
    // combination. Measured then: the shipped "MRI Cervical Spine — Screening"
    // fragments say "Limited cervical spine screening with sagittal T1W, T2W;
    // selected axial T2W (limited planar and limited sequence)." while the same
    // format's technique string says "MRI cervical spine screening on 3T."
    //
    // FIXED in the block at the end of this file: the fragment union is now
    // followed by a rescue of every acquisition fact each side's own Technique line
    // states, so the fragment list orders the text instead of deciding what is
    // allowed to survive. This case still measures the path #879 owned.
    const withTech = DEFAULT_REPORT_FORMATS.filter(
      (f) => (f.technique ?? "").trim().length > 12 && !f.techniqueFragments?.length,
    );
    const withFragments = DEFAULT_REPORT_FORMATS.filter((f) => f.techniqueFragments?.length);
    expect(withTech.length).toBeGreaterThan(10);
    expect(withFragments.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    let pairs = 0;
    for (const a of withTech) {
      for (const b of withTech) {
        if (a === b) continue;
        pairs++;
        const text = mergeTwoFormatsBySlot(a, b).technique;
        const lost = [...factsIn(a.technique!), ...factsIn(b.technique!)].filter((f) => !factsIn(text).has(f));
        if (lost.length > 0) offenders.push(`${a.name} + ${b.name} → lost [${lost.join(", ")}]`);
      }
    }
    expect(pairs).toBeGreaterThan(100);
    expect(offenders.slice(0, 6)).toEqual([]);
    expect(offenders).toHaveLength(0);
  });

  it("T26b what the fragment path actually does, measured rather than assumed", () => {
    // Positive control for the scope note above: it isolates the MECHANISM — the
    // format's own technique string claims 3T and its fragment list, which the
    // merge preferred, does not. Those facts are still exactly true and still the
    // reason the loss happened; what changed is that the merge no longer stops at
    // the fragment list (see the rescue tests at the end of this file, which pin
    // the fixed outcome). Nothing here asserts the old bad output as expected, so
    // the fix cannot be mistaken for a regression.
    const a = fmt("MRI Cervical Spine — Screening");
    const b = DEFAULT_REPORT_FORMATS.find(
      (f) => f.name !== a.name && !f.techniqueFragments?.length && (f.technique ?? "").trim().length > 12,
    )!;
    expect(a.techniqueFragments?.length).toBeGreaterThan(0);
    // The mechanism: the format's own technique string claims 3T, and its
    // fragment list — the thing `mergeTechniquePreservingScreening` prefers —
    // does not. So the claim is absent before any merge runs.
    expect(a.technique).toMatch(/3T/i);
    expect(factsIn(a.technique!).has("3T")).toBe(true);
    const fragmentsSay3T = (a.techniqueFragments ?? []).some((f) => /\b3\s*t\b/i.test(f.text));
    expect(fragmentsSay3T).toBe(false);
    // Not a similarity artefact: deriveTechniqueFragments() of the same string
    // does carry the fact, which is what a fragment-less format uses.
    expect(factsIn(deriveTechniqueFragments(a.technique!).map((f) => f.text).join(" ")).has("3T")).toBe(true);
    expect(b.techniqueFragments ?? []).toHaveLength(0);
    // So in the combination, b keeps everything it states and only a's own
    // missing fragment claim disappears — the loss is in the data it merged from,
    // not in the rule this PR removed.
    const text = mergeTwoFormatsBySlot(a, b).technique;
    expect([...factsIn(b.technique!)].every((f) => factsIn(text).has(f))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property sweep — every shipped Technique pair, every acquisition fact.
// ─────────────────────────────────────────────────────────────────────────────
describe("sweep — no shipped Technique pair loses an acquisition fact", () => {
  const texts: string[] = [];
  for (const f of DEFAULT_REPORT_FORMATS) {
    const t = (f.technique ?? "").trim();
    if (t.length > 12) texts.push(t);
    for (const frag of f.techniqueFragments ?? []) if (frag.text?.trim()) texts.push(frag.text.trim());
  }

  it("cross-pairwise over the shipped technique library", () => {
    expect(texts.length).toBeGreaterThan(30);
    const offenders: string[] = [];
    let pairs = 0;
    for (const a of texts) {
      for (const b of texts) {
        if (a === b) continue;
        pairs++;
        const out = mergeTechniqueWithProvenance(a, b, manualOwned(a), "template").text;
        const lost = [...factsIn(a), ...factsIn(b)].filter((f) => !factsIn(out).has(f));
        if (lost.length > 0) offenders.push(`${a}  ||  ${b}  →  lost [${lost.join(", ")}]`);
      }
    }
    expect(pairs).toBeGreaterThan(1000);
    expect(offenders.slice(0, 8)).toEqual([]);
    expect(offenders).toHaveLength(0);
  });

  it("the sweep would have caught the defect it is written for (positive control)", () => {
    // Same loop, the exact pair #878 reported, against the OLD rule's outcome: if
    // the helper cannot detect a known loss, the sweep above is vacuous.
    const knownLoss = "Multiplanar multisequence MRI of the brain was performed.";
    const a = "MRI of the brain was performed on a 1.5T scanner.";
    const b = knownLoss;
    const lost = [...factsIn(a), ...factsIn(b)].filter((f) => !factsIn(knownLoss).has(f));
    expect(lost).toEqual(["1.5T"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Contract — the heuristics that deleted facts are gone, and cannot return quietly.
// ─────────────────────────────────────────────────────────────────────────────
describe("contract — no similarity, no concept coverage, no length comparison decides Technique text", () => {
  it("the technique merge never assigns new text to an existing fragment", () => {
    expect(techniqueBody).not.toMatch(/\.text\s*=\s*/);
    expect("segments[paraphraseIdx]!.text = incoming;").toMatch(/\.text\s*=\s*/);
    expect(techniqueBody.length).toBeGreaterThan(400);
  });

  it("no similarity score and no concept-coverage test gate the merge", () => {
    expect(techniqueBody).not.toMatch(/jaccard|findTechniqueParaphraseIndex|techniqueConcepts|0\.55/);
    expect(techniqueBody).toContain("normalizeForDedupe");
    // Positive controls: those names really are matcher-visible.
    expect("const score = jaccard(incTokens, tokenSet(s));").toMatch(/jaccard/);
    expect("if (sConcepts.size > 0 && newConcepts.length === 0) continue;").not.toMatch(/techniqueConcepts/);
  });

  it("the similarity helpers still exist for provenance inheritance only", () => {
    // Bound on CODE, not on raw text: the removal note in reportFieldMerge.ts
    // names the deleted helpers, and a matcher over raw text would read that
    // explanation as the defect being back.
    const codeOnly = mergeSrc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/(\s)\/\/[^/\n]*$/gm, "$1");
    // Non-vacuity: the strip must not have emptied the slice.
    expect(codeOnly).toContain("export function mergeTechniqueWithProvenance");
    expect(codeOnly).toMatch(/function splitToSentences/);
    expect(codeOnly.length).toBeGreaterThan(2000);

    expect(mergeSrc).toMatch(/export function fuzzySentenceSimilarity/);
    expect(mergeSrc).toMatch(/export function isLightSentenceEdit/);
    expect(mergeSrc).toMatch(/export function findFuzzyProvenanceMatch/);
    expect(codeOnly).not.toMatch(/TECHNIQUE_CONCEPTS|findTechniqueParaphraseIndex|techniqueConcepts/);
    // …and the one remaining user of the similarity score is the provenance
    // helper. Counted by call shape, not by identifier: the declaration itself
    // matches `jaccard(`, so a bare grep count would be off by one either way.
    expect(codeOnly.match(/\bjaccard\(/g) ?? []).toHaveLength(2);
    expect(codeOnly).not.toMatch(/jaccard\(incTokens/);
    const fromSimilarity = codeOnly.slice(codeOnly.indexOf("export function fuzzySentenceSimilarity"));
    expect(fromSimilarity.slice(0, 160)).toMatch(/return jaccard\(tokenSet\(a\), tokenSet\(b\)\)/);
    // `tokenSet` likewise: one declaration + its two uses inside the helper.
    expect(codeOnly.match(/\btokenSet\(/g) ?? []).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The fragment precedence — the defect T26's scope note reported and #919's
// continuation was asked to investigate (owner's §3: loss of "3T").
// ─────────────────────────────────────────────────────────────────────────────
describe("sweep — no shipped FORMAT pair loses an acquisition fact", () => {
  const fmt = (name: string) => DEFAULT_REPORT_FORMATS.find((f) => f.name === name)!;
  const formats = DEFAULT_REPORT_FORMATS.filter((f) => (f.technique ?? "").trim().length > 12);

  it("covers enough of the shipped library to mean anything", () => {
    expect(formats.length).toBeGreaterThan(8);
    expect(formats.some((f) => f.techniqueFragments?.length)).toBe(true);
  });

  it("cross-pairwise every format, fragments included", () => {
    const offenders: string[] = [];
    let pairs = 0;
    for (const a of formats) {
      for (const b of formats) {
        if (a === b) continue;
        pairs++;
        const text = mergeTwoFormatsBySlot(a, b).technique;
        const lost = [...factsIn(a.technique!), ...factsIn(b.technique!)].filter(
          (f) => !factsIn(text).has(f),
        );
        if (lost.length > 0) offenders.push(`${a.name} + ${b.name} → lost [${lost.join(", ")}]`);
      }
    }
    expect(pairs).toBeGreaterThan(50);
    expect(offenders.slice(0, 8)).toEqual([]);
    expect(offenders).toHaveLength(0);
  });

  it("keeps 3T that only the Technique line states", () => {
    // The pair T26b measured and could not fix. The format's fragment list never
    // mentions the field strength; its Technique line does. Before the rescue step
    // the combination came back without 3T, and no merge rule was involved — the
    // fact was absent before anything compared it.
    const a = fmt("MRI Cervical Spine — Screening");
    const b = DEFAULT_REPORT_FORMATS.find(
      (f) => f.name !== a.name && !f.techniqueFragments?.length && (f.technique ?? "").trim().length > 12,
    )!;
    expect(a.technique).toMatch(/3T/i);
    expect((a.techniqueFragments ?? []).some((f) => /\b3\s*t\b/i.test(f.text))).toBe(false);
    const text = mergeTwoFormatsBySlot(a, b).technique;
    expect(factsIn(text).has("3T")).toBe(true);
  });

  it("keeps 1.5T from one side and 3T from the other", () => {
    const a = { name: "A", bodyPart: "SPINE_CERVICAL", technique: "MRI cervical spine performed at 1.5T.", techniqueFragments: [{ text: "Sagittal T2W and STIR sequences.", dedupeKey: "a-sequences", preserve: true }] };
    const b = { name: "B", bodyPart: "SPINE_LS", technique: "MRI lumbo-sacral spine performed at 3T with gadolinium.", techniqueFragments: [{ text: "Axial T1W and T2W images.", dedupeKey: "b-sequences", preserve: true }] };
    const text = mergeTwoFormatsBySlot(a as never, b as never).technique;
    const facts = factsIn(text);
    expect(facts.has("1.5T")).toBe(true);
    expect(facts.has("3T")).toBe(true);
    expect(facts.has("post-contrast")).toBe(true);
  });

  it("does not let a contrast study merge into a non-contrast one", () => {
    const a = { name: "A", bodyPart: "BRAIN", technique: "MRI brain performed without contrast.", techniqueFragments: [{ text: "Sagittal T1W and T2W.", dedupeKey: "a1", preserve: true }] };
    const b = { name: "B", bodyPart: "BRAIN", technique: "MRI brain with gadolinium.", techniqueFragments: [{ text: "Axial T1W post-contrast.", dedupeKey: "b1", preserve: true }] };
    const facts = factsIn(mergeTwoFormatsBySlot(a as never, b as never).technique);
    expect(facts.has("no-contrast")).toBe(true);
    expect(facts.has("post-contrast")).toBe(true);
  });

  it("does not change the result when the fragments already say everything", () => {
    // Positive control for the rescue step: it is a safety net, and on a format
    // whose fragments are complete it must add nothing. Without this the rescue
    // could be quietly duplicating technique sentences.
    const a = fmt("MRI Cervical Spine — Screening");
    const viaFragments = mergeTwoFormatsBySlot(a, a).technique;
    const lost = [...factsIn(a.technique!)].filter((f) => !factsIn(viaFragments).has(f));
    expect(lost).toEqual([]);
    expect(viaFragments.match(/screening/gi)?.length).toBeLessThanOrEqual(2);
  });
});
