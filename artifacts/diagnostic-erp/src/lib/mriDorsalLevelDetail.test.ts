/**
 * mriDorsalLevelDetail.test.ts — the level-by-level thoracic detail form
 * (dorsal spec §9-§14, §22, §37).
 *
 * What this file protects:
 * - one level's selections compile to one bundle, and reading them back out of
 *   the single observation ledger returns the same detail;
 * - every emitted sentence is either canonical library wording or an explicitly
 *   declared structured choice, and the provenance is recorded on the atom;
 * - a diagnosis the radiologist did not select (OLF, epidural lipomatosis, a
 *   listhesis cause) is never stated, and the lumbar recess / traversing-root /
 *   pars vocabulary is absent from thoracic reporting;
 * - conus and cord-signal wording respects acquired coverage and sequences.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import {
  DORSAL_CANAL_MORPHOLOGY_OPTIONS,
  DORSAL_CORD_EFFECT_OPTIONS,
  DORSAL_EPIDURAL_OPTIONS,
  DORSAL_FORAMINAL_CAUSE_OPTIONS,
  DORSAL_OLF_MORPHOLOGY_OPTIONS,
  buildDorsalLevelDetailBundle,
  deriveDorsalLevelDetail,
  dorsalLevelDetailHasContent,
  dorsalLevelOptionsFor,
  type DorsalDetailAtom,
  type DorsalLevelDetail,
} from "@/lib/mriDorsalLevelDetail";
import { buildDorsalLevelBundle } from "@/lib/mriDorsalSubMasters";
import { DX_ALIGN, DX_CANAL, DX_DISC, DX_POSTERIOR, DX_SOFT } from "@/lib/mriDorsalLibrary";
import {
  DORSAL_LEVEL_CANAL_BASELINE,
  DORSAL_LEVEL_CORD_BASELINE,
  DORSAL_LEVEL_DISC_BASELINE,
  DORSAL_LEVEL_FORAMINAL_BASELINE,
} from "@/lib/mriDorsalLevelState";
import {
  defaultDorsalNumbering,
  dorsalLevelKeyStrings,
  type DorsalNumberingState,
} from "@/lib/mriDorsalNumbering";
import { defaultSpineSequences, type SpineSequencesAvailable } from "@/lib/mriSpineSequences";
import { CANONICAL_CONCEPTS } from "@/lib/conceptCanon/contentPacks";
import { useWorkspace } from "@/lib/zai-workspace/store";

const HERE = dirname(fileURLToPath(import.meta.url));
/** Mirrors SECTION_FRAMES in mriDorsalLevelDetail.ts. */
const DETAIL_FRAMES = [
  "CSF space",
  "Central canal",
  "Disc",
  "Disc fragment migration",
  "Spinal cord",
  "Spinal cord signal",
  "Neural foramina",
  "Ligamentum flavum",
  "Costovertebral region",
  "Alignment",
  "Epidural space",
  "Conus medullaris",
];

function sequences(overrides: Partial<SpineSequencesAvailable> = {}): SpineSequencesAvailable {
  const all = defaultSpineSequences();
  for (const key of Object.keys(all) as Array<keyof SpineSequencesAvailable>) all[key] = true;
  return { ...all, ...overrides };
}

function numbering(overrides: Partial<DorsalNumberingState> = {}): DorsalNumberingState {
  return {
    ...defaultDorsalNumbering(),
    coverage: "thoracolumbar",
    mode: "localizer-confirmed",
    wholeSpineLocalizer: true,
    ...overrides,
  };
}

function atomsFor(detail: DorsalLevelDetail, level = "T8-T9", opts: {
  numbering?: DorsalNumberingState | null;
  sequences?: SpineSequencesAvailable | null;
} = {}): DorsalDetailAtom[] {
  return buildDorsalLevelDetailBundle({
    level,
    detail,
    numbering: opts.numbering === undefined ? numbering() : opts.numbering,
    sequences: opts.sequences === undefined ? sequences() : opts.sequences,
  }).atoms;
}

function textOf(atoms: DorsalDetailAtom[]): string {
  return atoms.map((a) => a.findings).join(" ");
}

function concepts(atoms: DorsalDetailAtom[]): string[] {
  return atoms.map((a) => a.concept);
}

function resetLedger() {
  useWorkspace.setState({
    appliedPathologyPatches: [],
    patchUndoStack: [],
    lastPatchSnapshot: null,
    findingsText: "",
    impressionText: "",
    recommendationText: "",
    fieldProvenance: {},
    impressionOrderFrozen: false,
    dorsalNumbering: defaultDorsalNumbering(),
    sequencesAvailable: defaultSpineSequences(),
  });
}

function applyDetail(detail: DorsalLevelDetail, level = "T8-T9", overrides: {
  numbering?: DorsalNumberingState | null;
  sequences?: SpineSequencesAvailable | null;
} = {}) {
  const built = buildDorsalLevelBundle({
    level,
    detail,
    numbering: overrides.numbering === undefined ? numbering() : overrides.numbering,
    sequences: overrides.sequences === undefined ? sequences() : overrides.sequences,
    region: "Dorsal Spine",
  });
  useWorkspace.getState().applyMacroBundle(built);
  return built;
}

function derived(level = "T8-T9"): DorsalLevelDetail {
  return deriveDorsalLevelDetail(useWorkspace.getState().appliedPathologyPatches, level);
}

beforeEach(() => {
  resetLedger();
});

describe("detail compilation (spec §9, §37)", () => {
  it("reports whether a level has anything to say", () => {
    expect(dorsalLevelDetailHasContent({})).toBe(false);
    expect(dorsalLevelDetailHasContent({ canalMorphology: "cord_flattening" })).toBe(true);
    expect(dorsalLevelDetailHasContent({ apMm: 7 })).toBe(true);
    expect(dorsalLevelDetailHasContent({ flavum: { hypertrophy: true } })).toBe(true);
    expect(dorsalLevelDetailHasContent({ foramLeft: { severity: "mild" } })).toBe(true);
    expect(dorsalLevelDetailHasContent({ conus: { terminationLevel: "L1" } })).toBe(true);
    expect(atomsFor({})).toEqual([]);
  });

  it("keys one bundle per level so two levels never share it", () => {
    expect(buildDorsalLevelDetailBundle({ level: "T8-T9", detail: {}, numbering: numbering() }).bundleId)
      .toBe("spm-dx-detail-T8-T9");
    expect(buildDorsalLevelDetailBundle({ level: "T9-T10", detail: {}, numbering: numbering() }).bundleId)
      .not.toBe("spm-dx-detail-T8-T9");
  });

  it("keeps every option catalog reachable and each in its own conflict group", () => {
    for (const option of DORSAL_CANAL_MORPHOLOGY_OPTIONS) {
      const atoms = atomsFor({ canalMorphology: option.id });
      expect(atoms.map((a) => a.concept), option.id).toContain("canal_morphology");
    }
    const sides = DORSAL_FORAMINAL_CAUSE_OPTIONS.map((c) => atomsFor({
      foramRight: { severity: "moderate", cause: c.id },
    })[0]?.conflictGroup);
    expect(new Set(sides)).toEqual(new Set(["foraminal_stenosis-right"]));
    for (const effect of DORSAL_CORD_EFFECT_OPTIONS) {
      const atoms = atomsFor({ cordEffect: effect.id });
      expect(atoms.length, effect.id).toBeGreaterThan(0);
      expect(concepts(atoms), effect.id).toEqual(
        effect.id === "compressed" ? ["cord_compression"] : ["cord_caliber"],
      );
    }
    for (const finding of DORSAL_EPIDURAL_OPTIONS) {
      expect(atomsFor({ epidural: { finding: finding.id } }).length, finding.id).toBeGreaterThan(0);
    }
    const ossifications = DORSAL_OLF_MORPHOLOGY_OPTIONS.map((o) => atomsFor({
      flavum: { ossification: o.id },
    })[0]?.state);
    expect(ossifications).toEqual(["focal", "nodular", "continuous"]);
  });

  it("names only canonical concepts", () => {
    const detail: DorsalLevelDetail = {
      canalMorphology: "cord_flattening",
      apMm: 6,
      canalSeverity: "severe",
      discLocation: "extraforaminal",
      calcified: true,
      migration: "caudal",
      migrationMm: 4,
      cordEffect: "compressed",
      cordSignal: true,
      foramRight: { severity: "severe", cause: "disc", rootDescriptive: "symptomatic intercostal neuralgia" },
      foramLeft: { severity: "mild", cause: "posterior_element" },
      flavum: { hypertrophy: true, thicknessMm: 5, ossification: "continuous", laterality: "bilateral" },
      costovertebral: { arthropathy: true, osteophytes: true },
      listhesis: { direction: "antero", translationMm: 3 },
      epidural: { finding: "lipomatosis", canalEffect: true, cordEffect: true },
      conus: { terminationLevel: "L1", compressed: true, displaced: true, signalAbnormality: true },
    };
    const unknown = concepts(atomsFor(detail)).filter((c) => !CANONICAL_CONCEPTS.has(c));
    expect(unknown).toEqual([]);
  });
});

describe("provenance of every emitted sentence (spec §SOURCE CONTENT, §36)", () => {
  it("marks each atom as library wording or a declared structured choice", () => {
    const detail: DorsalLevelDetail = {
      canalMorphology: "v_shaped_olf",
      apMm: 6,
      canalSeverity: "severe",
      discLocation: "extraforaminal",
      calcified: true,
      migration: "cranial",
      migrationMm: 5,
      cordEffect: "flattened",
      cordSignal: true,
      foramRight: { severity: "moderate", cause: "osteophyte" },
      flavum: { hypertrophy: true, thicknessMm: 4, ossification: "nodular" },
      costovertebral: { arthropathy: true },
      listhesis: { direction: "retro", translationMm: 2 },
      epidural: { finding: "hematoma" },
      conus: { terminationLevel: "L1", signalAbnormality: true },
    };
    const atoms = atomsFor(detail);
    expect(atoms.length).toBeGreaterThan(12);
    const offenders = atoms.filter((a) => {
      if (a.proseSource === "structured-choice") {
        return !DETAIL_FRAMES.some((frame) => a.findings.startsWith(`${frame}:`));
      }
      return !Object.values({
        ...DX_ALIGN, ...DX_CANAL, ...DX_DISC, ...DX_POSTERIOR, ...DX_SOFT,
      }).some((template) => {
        const first = String(template).split(/[\[(]/)[0]!.trim().toLowerCase();
        return first.length > 12 && a.findings.toLowerCase().startsWith(first.slice(0, 40));
      });
    });
    expect(offenders.map((a) => `${a.concept}/${a.proseSource}: ${a.findings}`)).toEqual([]);
  });

  it("keeps the canal morphology descriptive instead of borrowing the library cause", () => {
    const atoms = atomsFor({ canalMorphology: "complete_csf_effacement", apMm: 5 });
    const text = textOf(atoms);
    expect(atoms[0]?.proseSource).toBe("structured-choice");
    expect(text).toContain("CSF space:");
    expect(text).toContain("(AP diameter = 5 mm)");
    expect(text).not.toMatch(/secondary to|characteristic of|degenerative/);
  });

  it("uses the library sentence only where the selected term implies it", () => {
    expect(textOf(atomsFor({ discLocation: "extraforaminal" })))
      .toContain(DX_DISC.extraforaminal.split(" at [")[0]!);
    const central = atomsFor({ discLocation: "central" });
    expect(central[0]?.proseSource).toBe("structured-choice");
    const calcified = textOf(atomsFor({ calcified: true, apMm: 6 }));
    expect(calcified).toContain("Calcified thoracic disc herniation at");
    const cv = textOf(atomsFor({ costovertebral: { arthropathy: true } }));
    expect(cv).toContain("Hypertrophic costovertebral joint arthropathy at");
    const lipomatosis = textOf(atomsFor({ epidural: { finding: "lipomatosis" } }));
    expect(lipomatosis).toContain(DX_SOFT.epiduralLipomatosis.split(" from [")[0]!);
  });
});

describe("no automatic diagnosis, no borrowed lumbar anatomy (spec §13-§20, §41)", () => {
  it("never states OLF from flavum hypertrophy alone", () => {
    const hypertrophy = atomsFor({ flavum: { hypertrophy: true, thicknessMm: 6 } });
    expect(concepts(hypertrophy)).toEqual(["ligamentum_flavum"]);
    expect(textOf(hypertrophy)).not.toMatch(/ossif/i);
    const olf = atomsFor({ flavum: { ossification: "focal", laterality: "right" } });
    expect(olf[0]?.concept).toBe("olf");
    expect(textOf(olf)).toContain("Ossification of the ligamentum flavum (OLF) at");
    expect(olf[0]?.laterality).toBe("right");
    expect(olf[0]?.conflictGroup).toBe("olf-right");
  });

  it("states a slip direction without inventing its cause or measurement", () => {
    const unmeasured = atomsFor({ listhesis: { direction: "antero" } });
    expect(textOf(unmeasured)).not.toMatch(/traumatic injury|degenerative facet/i);
    expect(unmeasured[0]?.proseSource).toBe("structured-choice");
    expect(unmeasured[0]?.measurement).toBeUndefined();
    const measured = atomsFor({ listhesis: { direction: "retro", translationMm: 4 } });
    expect(textOf(measured)).toMatch(/Retro listhesis|retrolisthesis/i);
    expect(textOf(measured)).toContain("4 mm");
    expect(measured[0]?.measurement).toBe("4");
  });

  it("keeps thoracic root wording descriptive and never imports the lumbar engine", () => {
    const atoms = atomsFor({
      foramRight: { severity: "moderate", cause: "lesion", rootDescriptive: "clinical T9 intercostal neuralgia" },
    });
    const text = textOf(atoms);
    expect(text).toContain("Neural foramina:");
    expect(text).toContain("(right, T8-T9)");
    expect(text).not.toMatch(/lesion cause/);
    const banned = /lateral recess|traversing root|exiting root|pars interarticularis|isthmic|castellvi|uncovertebral|sacralization/i;
    const wholeReport = textOf(atomsFor({
      canalMorphology: "cord_contact",
      discLocation: "foraminal",
      flavum: { ossification: "continuous" },
      costovertebral: { osteophytes: true },
      foramLeft: { severity: "severe", cause: "posterior_element" },
    }));
    expect(wholeReport).not.toMatch(banned);
    const source = readFileSync(resolve(HERE, "mriDorsalLevelDetail.ts"), "utf8");
    expect(source).not.toMatch(/mriLumbar(Recess|Root|Pars)/);
  });

  it("grades each foraminal side separately", () => {
    const atoms = atomsFor({
      foramRight: { severity: "severe", cause: "disc" },
      foramLeft: { severity: "mild" },
    });
    expect(atoms.length).toBe(2);
    expect(atoms.map((a) => a.laterality)).toEqual(["right", "left"]);
    expect(atoms.map((a) => a.conflictGroup)).toEqual(["foraminal_stenosis-right", "foraminal_stenosis-left"]);
    expect(atoms[0]?.proseSource).toBe("canonical-library");
    expect(atoms[1]?.proseSource).toBe("structured-choice");
  });

  it("splits epidural finding, canal effect and cord effect into separate atoms", () => {
    const atoms = atomsFor({ epidural: { finding: "collection", canalEffect: true, cordEffect: true } });
    expect(concepts(atoms)).toEqual(["epidural_collection", "canal_stenosis", "cord_compression"]);
    expect(new Set(atoms.map((a) => a.conflictGroup)).size).toBe(3);
  });
});

describe("coverage and sequence gating of level detail (spec §11, §12, §25)", () => {
  it("offers conus detail only when the junction was acquired", () => {
    const detail: DorsalLevelDetail = { conus: { terminationLevel: "L1", compressed: true } };
    expect(atomsFor(detail, "T12-L1", { numbering: numbering({ coverage: "complete" }) })).toEqual([]);
    // Each conus row keeps its own ledger slot, so none of them silently
    // replaces another selection the radiologist made at the same level.
    const covered = atomsFor(detail, "T12-L1");
    expect(concepts(covered)).toEqual(["conus_medullaris", "cord_compression"]);
    expect(textOf(covered)).toContain("Conus medullaris terminates normally at L1");
    expect(covered[1]?.state).toBe("conus_compression");
    expect(covered[1]?.baselineReplaces).toBe(DORSAL_LEVEL_CORD_BASELINE);
  });

  it("never defaults the stated conus termination level", () => {
    const atoms = atomsFor({ conus: {} }, "T12-L1");
    expect(atoms).toEqual([]);
    const stated = atomsFor({ conus: { terminationLevel: "T12-L1" } }, "T12-L1");
    expect(stated[0]?.measurement).toBe("T12-L1");
    expect(stated[0]?.findings).toContain("terminates normally at T12-L1");
  });

  it("keeps the cord normal honest when the conus was not acquired", () => {
    const covered = atomsFor({ cordEffect: "normal" });
    expect(covered[0]?.proseSource).toBe("canonical-library");
    expect(textOf(covered)).toContain("Thoracic spinal cord and conus medullaris display normal caliber");
    const limited = atomsFor({ cordEffect: "normal" }, "T4-T5", { numbering: numbering({ coverage: "complete" }) });
    expect(limited[0]?.proseSource).toBe("structured-choice");
    expect(textOf(limited)).not.toMatch(/conus/i);
    expect(textOf(limited)).toContain("Spinal cord: normal caliber and uniform intrinsic signal at this level at T4-T5.");
  });

  it("needs T2 before it will describe cord signal", () => {
    expect(concepts(atomsFor({ cordSignal: true }, "T8-T9", { sequences: sequences({ t2: false }) })))
      .not.toContain("cord_signal");
    const atoms = atomsFor({ cordSignal: true });
    expect(atoms[0]?.concept).toBe("cord_signal");
    expect(atoms[0]?.state).toBe("hyperintensity");
    expect(textOf(atoms)).toContain("Focal area of intrinsically elevated T2/STIR signal intensity within the spinal cord at T8-T9");
  });

  it("drops the whole detail build when the resolver says no level is available", () => {
    expect(dorsalLevelOptionsFor(numbering({ coverage: "upper" }))).toEqual(dorsalLevelKeyStrings(numbering({ coverage: "upper" })));
    expect(dorsalLevelOptionsFor(null)).toEqual(dorsalLevelKeyStrings(null));
    expect(dorsalLevelOptionsFor(numbering()).length).toBeGreaterThan(dorsalLevelOptionsFor(numbering({ coverage: "upper" })).length);
  });
});

describe("the ledger is the only state (spec §5, §22, §37)", () => {
  it("round-trips a full level through the ledger", () => {
    const detail: DorsalLevelDetail = {
      canalMorphology: "cord_flattening",
      apMm: 6,
      canalSeverity: "severe",
      discLocation: "paracentral",
      migration: "caudal",
      migrationMm: 4,
      cordEffect: "compressed",
      cordSignal: true,
      foramRight: { severity: "moderate", cause: "osteophyte" },
      flavum: { hypertrophy: true, thicknessMm: 5, ossification: "continuous", laterality: "bilateral" },
      costovertebral: { arthropathy: true, osteophytes: true },
      listhesis: { direction: "antero", translationMm: 3 },
      epidural: { finding: "lipomatosis" },
    };
    applyDetail(detail);
    applyDetail({ conus: { terminationLevel: "L1", compressed: true, signalAbnormality: true } }, "T12-L1");
    const back = derived();
    expect(back.canalMorphology).toBe("cord_flattening");
    expect(back.apMm).toBe(6);
    expect(back.canalSeverity).toBe("severe");
    expect(back.discLocation).toBe("paracentral");
    expect(back.migration).toBe("caudal");
    expect(back.migrationMm).toBe(4);
    expect(back.cordEffect).toBe("compressed");
    expect(back.cordSignal).toBe(true);
    expect(back.foramRight?.severity).toBe("moderate");
    expect(back.flavum?.ossification).toBe("continuous");
    expect(back.flavum?.thicknessMm).toBe(5);
    expect(back.costovertebral).toEqual({ arthropathy: true, osteophytes: true });
    expect(back.listhesis).toEqual({ direction: "antero", translationMm: 3 });
    expect(back.epidural?.finding).toBe("lipomatosis");
    expect(back.conus).toBeUndefined();
    // Conus rows belong to the junction level, so they read back there only.
    expect(derived("T12-L1").conus).toEqual({ terminationLevel: "L1", compressed: true, signalAbnormality: true });
    expect(derived("T8-T9").cordEffect).toBe("compressed");
    expect(derived("T8-T9").cordSignal).toBe(true);
  });

  it("writes no conus row for a level that is not the junction", () => {
    expect(atomsFor({ conus: { terminationLevel: "L1", compressed: true } }, "T8-T9")).toEqual([]);
    expect(atomsFor({ conus: { terminationLevel: "L1", compressed: true } }, "T12-L1").length).toBe(2);
  });

  it("keeps one disc contour observation per level and slot", () => {
    applyDetail({ calcified: true, apMm: 6 });
    expect(derived().calcified).toBe(true);
    // Location and calcification are the same disc-contour slot at the same
    // level, so the later selection replaces rather than contradicts it.
    applyDetail({ discLocation: "central" });
    expect(derived().discLocation).toBe("central");
    const discRows = useWorkspace.getState().appliedPathologyPatches
      .filter((p) => p.observation?.concept === "disc_contour");
    expect(discRows).toHaveLength(1);
  });

  it("writes one findings sentence per observation and nothing about another level", () => {
    applyDetail({ canalSeverity: "severe", foramRight: { severity: "mild" } }, "T8-T9");
    applyDetail({ canalSeverity: "moderate" }, "T10-T11");
    expect(derived("T8-T9").canalSeverity).toBe("severe");
    expect(derived("T10-T11").canalSeverity).toBe("moderate");
    expect(derived("T10-T11").foramRight).toBeUndefined();
    const findings = useWorkspace.getState().findingsText;
    expect(findings).toMatch(/T8-T9/);
    expect(findings).toMatch(/T10-T11/);
  });

  it("replaces the captured level detail rather than duplicating it", () => {
    applyDetail({ canalSeverity: "mild" });
    const first = useWorkspace.getState().appliedPathologyPatches.length;
    applyDetail({ canalSeverity: "severe" });
    expect(useWorkspace.getState().appliedPathologyPatches.length).toBe(first);
    expect(derived().canalSeverity).toBe("severe");
  });

  it("reconciles the normal baseline into the abnormal level statement", () => {
    // One findings write holding all four V1 dorsal level normals.
    useWorkspace.getState().setField("findings", [
      DORSAL_LEVEL_CANAL_BASELINE,
      DORSAL_LEVEL_DISC_BASELINE,
      DORSAL_LEVEL_CORD_BASELINE,
      DORSAL_LEVEL_FORAMINAL_BASELINE,
    ].join(" "), { source: "system" });
    applyDetail({ canalSeverity: "severe", foramRight: { severity: "moderate", cause: "disc" }, cordEffect: "compressed" });
    const findings = useWorkspace.getState().findingsText;
    expect(findings).toMatch(/severe/i);
    expect(findings).not.toContain(DORSAL_LEVEL_CANAL_BASELINE);
    expect(findings).not.toContain(DORSAL_LEVEL_FORAMINAL_BASELINE);
    expect(findings).not.toContain(DORSAL_LEVEL_CORD_BASELINE);
    // Nothing in this level selection spoke about the disc, so its normal stays
    // (the canvas keeps one sentence per line).
    expect(findings).toContain("Normal disc height and signal.");
    expect(findings).toContain("No disc herniation.");
  });

  it("removes exactly the level it captured when the bundle is cleared", () => {
    applyDetail({ canalSeverity: "severe" }, "T8-T9");
    applyDetail({ canalSeverity: "mild" }, "T10-T11");
    const built = applyDetail({ cordEffect: "flattened" }, "T12-L1");
    expect(useWorkspace.getState().removeMacroBundle(built.bundleId)).toBe("removed");
    expect(derived("T12-L1")).toEqual({});
    expect(derived("T8-T9").canalSeverity).toBe("severe");
    expect(derived("T10-T11").canalSeverity).toBe("mild");
  });

  it("leaves hand-written prose alone", () => {
    useWorkspace.getState().setField("findings", "Cord contour is preserved despite the prior laminectomy.", { source: "manual" });
    applyDetail({ cordEffect: "flattened" });
    expect(useWorkspace.getState().findingsText).toContain("despite the prior laminectomy");
  });

  it("counts structured choices so the UI can show what is library wording", () => {
    const bundle = buildDorsalLevelBundle({
      level: "T8-T9",
      detail: { canalSeverity: "severe", discLocation: "central" },
      numbering: numbering(),
      sequences: sequences(),
    });
    expect(bundle.structuredChoiceCount).toBe(bundle.observations.length);
    const library = buildDorsalLevelBundle({
      level: "T12-L1",
      detail: { conus: { terminationLevel: "L1" } },
      numbering: numbering(),
      sequences: sequences(),
    });
    expect(library.structuredChoiceCount).toBe(0);
    expect(library.observations[0]?.findingsText).toContain("Conus medullaris terminates normally at L1");
  });

  it("protects a manually edited level sentence from a later structured apply", () => {
    applyDetail({ canalSeverity: "moderate" });
    const manual = `${DX_CANAL.normal} Surgical change at T8-T9.`;
    useWorkspace.getState().setField("findings", manual, { source: "manual" });
    applyDetail({ canalSeverity: "severe" });
    expect(useWorkspace.getState().findingsText).toContain("Surgical change at T8-T9");
    expect(derived().canalSeverity).toBe("severe");
  });
});
