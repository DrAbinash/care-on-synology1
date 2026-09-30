/**
 * mriDorsoLumbarValidation.test.ts — the Dorso-Lumbar report shape and safety
 * net (spec §23, §25, §27, §28).
 *
 * These tests exist because a two-region examination can be wrong in ways
 * neither a Dorsal nor a Lumbar study can: the conus described when the bridge
 * was never acquired, the same junction spelled two ways and reported twice, a
 * dedicated Dorso-Lumbar booking worded as two screening modules. Every rule is
 * checked as a WARNING and a question — the tests also assert that nothing here
 * changes the text, because the radiologist owns the prose.
 */

import { describe, expect, it } from "vitest";

import {
  DORSOLUMBAR_CONTRADICTION_PAIRS,
  DORSOLUMBAR_FINDINGS_SECTIONS,
  dorsoLumbarFindingsOrder,
  dorsoLumbarFindingsSectionOf,
  dorsoLumbarLevelRank,
  dorsoLumbarTextContradictions,
  type DorsoLumbarContradictionInput,
  type DorsoLumbarFindingRow,
} from "@/lib/mriDorsoLumbarValidation";
import {
  JUNCTION_LEDGER_REGION,
  defaultDorsoLumbarState,
  dorsolumbarLevelKeyStrings,
  type DorsoLumbarState,
} from "@/lib/mriDorsoLumbarCoverage";
import { defaultLumbarNumbering } from "@/lib/mriSpineNumbering";
import {
  defaultSpineSequences,
  deriveSpineSequencesAvailable,
  type SpineSequencesAvailable,
} from "@/lib/mriSpineSequences";
import { SCREENING_LIMITATION_TEXT } from "@/lib/zai-workspace/baselines/screeningLimitation";
import { detectCriticalFindings } from "@/lib/criticalResults";

/** Coverage the radiologist can rely on, so unrelated rules stay quiet. */
function confident(over: Partial<DorsoLumbarState> = {}): DorsoLumbarState {
  return defaultDorsoLumbarState({
    numbering: "localizer-confirmed",
    wholeSpineLocalizer: true,
    superior: "T8-T9",
    inferior: "L5-S1",
    ...over,
  });
}

const ONE_COMPOSITION = {
  cervical: "accompanying-screening",
  dorsal: "dedicated-component",
  ls: "dedicated-component",
} as const;

function check(over: Partial<DorsoLumbarContradictionInput> = {}): string[] {
  return dorsoLumbarTextContradictions({
    findingsText: "",
    impressionText: "",
    state: confident(),
    sequences: defaultSpineSequences(),
    composition: "dorsolumbar-dedicated",
    roles: { ...ONE_COMPOSITION },
    patches: null,
    ...over,
  });
}

function row(
  concept: string,
  level: string,
  region = JUNCTION_LEDGER_REGION,
): DorsoLumbarFindingRow {
  return {
    observation: { concept, level, region, anatomicalSection: level },
    ownership: { concept, anatomicalSection: level },
  };
}

function sequencesWith(over: Partial<SpineSequencesAvailable>): SpineSequencesAvailable {
  return { ...defaultSpineSequences(), ...over };
}

describe("Findings order (spec §25)", () => {
  it("keeps the fourteen recommended sections in the spec's own order", () => {
    expect([...DORSOLUMBAR_FINDINGS_SECTIONS]).toEqual([
      "techniqueCoverage",
      "numbering",
      "alignment",
      "vertebralBodies",
      "discs",
      "levelByLevel",
      "thoracicCanalCord",
      "junctionConus",
      "lumbarCanalCauda",
      "foramina",
      "posteriorElements",
      "epiduralIntradural",
      "paravertebral",
      "accompanyingScreening",
    ]);
  });

  it("assigns a junction finding to exactly one section, never to both halves", () => {
    expect(dorsoLumbarFindingsSectionOf(row("canal_stenosis", "T8-T9"))).toBe("thoracicCanalCord");
    expect(dorsoLumbarFindingsSectionOf(row("canal_stenosis", "T12-L1"))).toBe("junctionConus");
    expect(dorsoLumbarFindingsSectionOf(row("disc_contour", "T12-L1"))).toBe("junctionConus");
    // The reversed bridge spelling is the same bridge, so it joins the same section.
    expect(dorsoLumbarFindingsSectionOf(row("cord_compression", "L1-T12"))).toBe("junctionConus");
    expect(dorsoLumbarFindingsSectionOf(row("lateral_recess_stenosis", "L4-L5"))).toBe("lumbarCanalCauda");
  });

  it("orders sections by the spec and levels craniocaudally inside a section", () => {
    const order = dorsoLumbarFindingsOrder(
      [row("disc_contour", "L3-L4", "LS Spine"), row("disc_contour", "T10-T11"), row("disc_contour", "L1-L2", "LS Spine")],
      confident(),
    );
    expect(order.map((g) => g.section)).toEqual(["discs"]);
    expect(order[0]!.rows.map((r) => r.observation?.level)).toEqual(["T10-T11", "L1-L2", "L3-L4"]);
  });

  it("sorts by the resolver's sequence, so a transitional vertebra cannot reorder the report", () => {
    const state = confident({
      lumbar: { ...defaultLumbarNumbering(), mode: "lstv-sacralization" },
    });
    const keys = dorsolumbarLevelKeyStrings(state);
    expect(keys).toContain("L5-T");
    // The transitional disc still sits between L4-L5 and the sacrum.
    expect(dorsoLumbarLevelRank("L5-T", state)).toBeGreaterThan(dorsoLumbarLevelRank("L4-L5", state));
    expect(dorsoLumbarLevelRank("L5-S1", state)).toBeGreaterThan(dorsoLumbarLevelRank("L5-T", state));
    const order = dorsoLumbarFindingsOrder(
      [row("disc_contour", "L5-T", "LS Spine"), row("disc_contour", "T11-T12"), row("disc_contour", "L4-L5", "LS Spine")],
      state,
    );
    expect(order[0]!.rows.map((r) => r.observation?.level)).toEqual(["T11-T12", "L4-L5", "L5-T"]);
  });

  it("studies-wide rows lead their section and unlevelled rows keep apply order", () => {
    const order = dorsoLumbarFindingsOrder(
      [row("alignment", ""), row("scoliosis", "T8-T9")],
      confident(),
    );
    const alignment = order.find((g) => g.section === "alignment");
    expect(alignment?.rows.map((r) => r.observation?.level)).toEqual(["", "T8-T9"]);
  });

  it("gives a junction concept exactly one section, whichever half names it", () => {
    for (const concept of ["canal_stenosis", "cord_compression", "disc_contour", "conus_medullaris", "thoracolumbar_junction"]) {
      const sections = new Set(
        ["T12-L1", "D12-L1", "L1-T12", "L1/D12", "TLS"].map((spelling) => dorsoLumbarFindingsSectionOf(row(concept, spelling))),
      );
      expect(sections.size, concept).toBe(1);
      expect([...sections][0], concept).toBe("junctionConus");
    }
  });
});

describe("Contradictions and coverage (spec §27)", () => {
  it("raises a normal-versus-abnormal contradiction without touching the text", () => {
    const findings = "Alignment of the visualized spine is maintained. Scoliotic curvature convex to the right, apex at T8-T9.";
    const warnings = check({ findingsText: findings });
    expect(warnings.some((w) => w.startsWith("Contradiction in alignment"))).toBe(true);
    expect(check({ findingsText: "Alignment of the visualized spine is maintained." })).toEqual([]);
    expect(DORSOLUMBAR_CONTRADICTION_PAIRS.length).toBeGreaterThanOrEqual(10);
  });

  it("flags conus and junction wording the acquired coverage cannot support", () => {
    const state = confident({ superior: "T8-T9", inferior: "T10-T11" });
    const warnings = check({
      state,
      findingsText: "The conus medullaris demonstrates normal signal. Thoracolumbar junction alignment is maintained.",
    });
    expect(warnings.some((w) => w.includes("describes the conus medullaris"))).toBe(true);
    expect(warnings.some((w) => w.includes("does not include the T12-L1 level"))).toBe(true);
  });

  it("flags cauda wording when no lumbar segment was covered", () => {
    const state = confident({ superior: "T11-T12", inferior: "T12-L1" });
    const warnings = check({
      state,
      findingsText: "Cauda equina crowding is present at the covered levels.",
    });
    expect(warnings.some((w) => w.includes("no lumbar segment was covered"))).toBe(true);
  });

  it("accepts an explicit limitation sentence about an uncovered structure", () => {
    const state = confident({ superior: "T8-T9", inferior: "T10-T11" });
    expect(check({
      state,
      findingsText: "The conus medullaris is not included in the acquired coverage and cannot be assessed.",
    })).toEqual([]);
  });

  it("refuses lumbar root / recess / pars logic at a thoracic level", () => {
    const warnings = check({
      findingsText: "Lateral recess stenosis with traversing root impingement at T7-T8.",
    });
    expect(warnings.some((w) => w.startsWith("Anatomy check"))).toBe(true);
    expect(check({ findingsText: "Lateral recess stenosis with traversing root impingement at L4-L5." })).toEqual([]);
  });

  it("names the same bridge written two different ways", () => {
    const warnings = check({
      findingsText: "Central canal stenosis at T12-L1. Disc extrusion at L1-T12 on the left.",
    });
    expect(warnings.some((w) => w.startsWith("Junction naming"))).toBe(true);
    expect(check({ findingsText: "Central canal stenosis at T12-L1." })).toEqual([]);
  });

  it("allows one spelling to repeat — only two spellings of one level is a problem", () => {
    expect(check({
      findingsText: "Canal stenosis at T12-L1. Disc bulge also maximal at T12-L1.",
    })).toEqual([]);
  });

  it("requires the screening limitation to appear exactly once (spec §23)", () => {
    const twice = `${SCREENING_LIMITATION_TEXT} ${SCREENING_LIMITATION_TEXT}`;
    expect(check({ findingsText: twice }).some((w) => w.startsWith("Screening limitation"))).toBe(true);
    expect(check({ findingsText: SCREENING_LIMITATION_TEXT })).toEqual([]);
  });

  it("rejects a dedicated composition worded as two independent screenings (spec §23)", () => {
    const warnings = check({
      roles: { cervical: "absent", dorsal: "primary-screening", ls: "primary-screening" },
      findingsText: "Dorsal and LS screening modules performed separately.",
    });
    expect(warnings.some((w) => w.startsWith("Composition check"))).toBe(true);
    expect(check({ roles: { ...ONE_COMPOSITION }, findingsText: "One Dorso-Lumbar examination." })).toEqual([]);
  });

  it("asks for the numbering basis when certainty is reduced", () => {
    const state = defaultDorsoLumbarState({ numbering: "uncertain", superior: "T8-T9", inferior: "L3-L4" });
    expect(check({ state, findingsText: "Mild disc bulge at L2-L3." }).some((w) => w.startsWith("Numbering caution"))).toBe(true);
    expect(check({
      state,
      findingsText: "Absolute level assignment is uncertain across the junction; numbering is from the last rib-bearing vertebra.",
    })).toEqual([]);
  });

  it("gates sequence-dependent wording, including the GRE/SWI blooming rule", () => {
    const warnings = check({
      sequences: defaultSpineSequences(),
      findingsText: "Marrow edema at T12-L1. No restricted diffusion. Enhancement along the epidural space. Blooming along the posterior elements.",
    });
    expect(warnings.filter((w) => w.startsWith("Sequence check")).length).toBe(4);
    const withSequences = check({
      sequences: sequencesWith({ stir: true, dwi: true, contrast: true, greSwi: true }),
      findingsText: "Marrow edema at T12-L1. No restricted diffusion. Enhancement along the epidural space. Blooming along the posterior elements.",
    });
    expect(withSequences.filter((w) => w.startsWith("Sequence check"))).toEqual([]);
  });

  it("derives GRE/SWI availability from the recorded technique, and never assumes it", () => {
    expect(deriveSpineSequencesAvailable({ techniqueText: "Sagittal T1, T2 and axial GRE sequences" }).greSwi).toBe(true);
    expect(deriveSpineSequencesAvailable({ techniqueText: "Sagittal T1, T2, STIR" }).greSwi).toBe(false);
  });

  it("delegates the ledger rules instead of redefining them", () => {
    const stranded = check({
      state: confident({ superior: "T8-T9", inferior: "T12-L1" }),
      patches: [row("disc_contour", "L4-L5", "LS Spine")],
    });
    expect(stranded.some((w) => w.startsWith("Level naming"))).toBe(true);
    const splitJunction = check({
      patches: [
        row("canal_stenosis", "T12-L1", JUNCTION_LEDGER_REGION),
        row("canal_stenosis", "T12-L1", "LS Spine"),
      ],
    });
    expect(splitJunction.some((w) => w.startsWith("Junction ownership"))).toBe(true);
    expect(check({ patches: [row("canal_stenosis", "T12-L1", JUNCTION_LEDGER_REGION)] })).toEqual([]);
  });

  it("says nothing when the report is coherent", () => {
    const warnings = check({
      findingsText: [
        "Technique: multisequence MRI of the dorso-lumbar spine without contrast.",
        SCREENING_LIMITATION_TEXT,
        "Vertebral numbering is confirmed on the whole-spine localizer.",
        "Alignment is maintained. Vertebral body heights and marrow signal are preserved.",
        "The conus medullaris terminates at T12-L1 and demonstrates normal signal.",
        "Cauda equina nerve roots are normal in course and caliber.",
        "No significant canal or foraminal narrowing within the acquired coverage.",
      ].join(" "),
      impressionText: "No acute dorso-lumbar abnormality within the acquired coverage.",
      patches: [row("conus_medullaris", "T12-L1"), row("canal_stenosis", "L3-L4", "LS Spine")],
    });
    expect(warnings).toEqual([]);
  });
});

describe("Critical wording (spec §28)", () => {
  it("reaches the existing critical workflow through shared terms", () => {
    const labels = (findings: string) => detectCriticalFindings(findings, []).map((h) => h.label);
    expect(labels("Conus compression at T12-L1 with canal compromise.")).toContain("conus compression");
    expect(labels("Epidural hematoma at L2-L3 compressing the cauda equina.")).toContain("extradural haematoma");
    expect(labels("Acute thoracolumbar burst fracture with retropulsion.")).toContain("burst fracture");
    expect(labels("Cauda equina syndrome is suspected clinically.")).toContain("cauda equina syndrome");
  });

  it("does not fire on the negated form of a Dorso-Lumbar critical term", () => {
    expect(detectCriticalFindings("No conus compression is seen.", [])).toEqual([]);
    expect(detectCriticalFindings("No epidural hematoma is identified.", [])).toEqual([]);
  });
});
