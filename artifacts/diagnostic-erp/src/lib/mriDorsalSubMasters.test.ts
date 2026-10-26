/**
 * mriDorsalSubMasters.test.ts — the fourteen dorsal / thoracic clinical
 * sub-masters, the canonical macros, coverage gating and the shared lesion form
 * (dorsal spec §39-§45).
 *
 * The binding rules this file exists to protect:
 * - a tile is only appliable when the acquisition AND the acquired coverage can
 *   support it, and an unsupported tile is still LISTED (struck-through with a
 *   reason) rather than silently hidden;
 * - no tile invents clinical prose: every emitted sentence is canonical library
 *   wording with variables substituted, a declared structured-choice frame, or a
 *   system limitation statement;
 * - nothing auto-diagnoses: TB, metastasis, dAVF, OLF, OPLL, DISH, myelomalacia
 *   and tumour type only appear when the radiologist selects that tile;
 * - the conus is never described when coverage stops above the junction;
 * - normal → abnormal reconciliation works, bundles are reversible, and one
 *   coverage change moves the level rows, the AP table and the validator together.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import {
  DORSAL_PRESETS,
  DORSAL_SUBMASTER_IDS,
  MRI_DORSAL_SUB_MASTERS,
  allDorsalTileIds,
  buildDorsalLesionAtoms,
  buildDorsalLesionBundle,
  buildDorsalLevelBundle,
  buildDorsalPresetBundle,
  buildDorsalTileBundle,
  dorsalPresetAvailability,
  dorsalPresetBundleId,
  dorsalSubMasterById,
  dorsalTileAvailability,
  dorsalTileBundleId,
  type DorsalTile,
  type DorsalTileContext,
} from "@/lib/mriDorsalSubMasters";
import { DX_LIBRARY_PROSE, DX_ALIGN, DX_CANAL, DX_BONE, DX_DISC, DX_POSTERIOR, DX_SOFT, fillDxProse } from "@/lib/mriDorsalLibrary";
import {
  defaultDorsalNumbering,
  dorsalApCanalLevels,
  dorsalLevelKeyStrings,
  type DorsalNumberingState,
} from "@/lib/mriDorsalNumbering";
import { DORSAL_NORMAL_SENTENCE_BY_CONCEPT } from "@/lib/mriDorsalBaselines";
import { structuredCanalApContradiction } from "@/lib/mriLumbarLevelState";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import type { AppliedPathologyPatch } from "@/lib/pathologyPatch";
import { CANONICAL_CONCEPTS } from "@/lib/conceptCanon/contentPacks";
import { defaultSpineSequences, type SpineSequencesAvailable } from "@/lib/mriSpineSequences";
import { dorsalTextContradictions } from "@/lib/mriSpineContradictions";
import { offeredScreeningRegions, resolveScreeningRoles } from "@/lib/mriSpineScreeningRoles";
import {
  SCREENING_LIMITATION_BUNDLE_ID,
  defaultScreeningState,
  screeningLedgerBundles,
  screeningPresetSelections,
} from "@/lib/mriSpineScreening";
import { SCREENING_SCHEMAS } from "@/lib/mriSpineScreeningSchemas";
import { useWorkspace } from "@/lib/zai-workspace/store";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = resolve(HERE, "../..");
/** The store re-seeds this report-level normal impression on its own. */
const SYSTEM_NORMAL_PATCH_ID = "system-normal-study";

const ALL_TILES: Array<{ tile: DorsalTile; palette: string }> = MRI_DORSAL_SUB_MASTERS.flatMap((sm) =>
  sm.tiles.map((tile) => ({ tile, palette: sm.id })),
);

/** Mirrors SECTION_FRAMES in mriDorsalSubMasters.ts / mriDorsalLevelDetail.ts. */
const STRUCTURED_CHOICE_FRAMES = [
  "Alignment",
  "Thoracic curvature",
  "Deformity",
  "Bones / marrow",
  "Endplates",
  "Discs",
  "Disc",
  "Disc fragment migration",
  "Central canal",
  "CSF space",
  "Spinal cord",
  "Spinal cord signal",
  "Conus medullaris",
  "Neural foramina",
  "Costovertebral region",
  "Posterior elements",
  "Ligaments",
  "Ligamentum flavum",
  "Epidural space",
  "Intradural space",
  "Cord parenchyma",
  "Perimedullary vessels",
  "Paravertebral soft tissues",
  "Thoracolumbar junction",
  "Hardware",
  "Vertebral numbering",
  "Coverage",
];

/** System wording about what the study covered — never a clinical claim. */
const SYSTEM_STATEMENT_PREFIXES = [
  "This examination did not include",
  "This examination covers",
  "Screening of the",
  "Levels stated for",
  "Acquired coverage extends",
];

/**
 * An interpretation the software will not assert by itself is allowed only when
 * it names its author, so it can never be mistaken for canonical prose.
 */
const ATTRIBUTION = /(?:selected|stated|classified|recorded|suggested) by the reporting radiologist/i;

const LIBRARY_CHUNKS: string[] = [...new Set(
  Object.values(DX_LIBRARY_PROSE).flatMap((template) =>
    String(template)
      .split(/\[[^\]]*\]|\bX(?:\.\d+)? ?(?:mm|cm|mm2|cm2|%|x)/g)
      .map((chunk) => chunk.replace(/\s+/g, " ").trim().toLowerCase())
      .filter((chunk) => chunk.split(" ").length >= 4),
  ),
)];

const LIBRARY_SENTENCES: string[] = Object.values(DX_LIBRARY_PROSE).map((s) =>
  String(s).replace(/\s+/g, " ").trim().toLowerCase(),
);

function sequences(overrides: Partial<SpineSequencesAvailable> = {}): SpineSequencesAvailable {
  const all = defaultSpineSequences();
  for (const key of Object.keys(all) as Array<keyof SpineSequencesAvailable>) all[key] = true;
  return { ...all, ...overrides };
}

function ctx(overrides: Partial<DorsalTileContext> = {}): DorsalTileContext {
  return {
    level: "T8-T9",
    numbering: dorsalState(),
    sequences: sequences(),
    region: "Dorsal Spine",
    ...overrides,
  };
}

function dorsalState(overrides: Partial<DorsalNumberingState> = {}): DorsalNumberingState {
  return { ...defaultDorsalNumbering(), coverage: "thoracolumbar", mode: "localizer-confirmed", wholeSpineLocalizer: true, ...overrides };
}

function tileFindings(tile: DorsalTile, context = ctx()): string[] {
  return tile.atoms(context).map((a) => a.findings).filter((f) => f.trim().length > 0);
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
    lumbarNumbering: useWorkspace.getState().lumbarNumbering,
    sequencesAvailable: defaultSpineSequences(),
    screening: defaultScreeningState(),
  });
}

function applyTile(tileId: string, context = ctx()) {
  const built = buildDorsalTileBundle(tileId, context);
  if (built.observations.length > 0) useWorkspace.getState().applyMacroBundle(built);
  return built;
}

function applyPreset(presetId: string, context = ctx()) {
  const built = buildDorsalPresetBundle(presetId, context);
  if (built.observations.length > 0) useWorkspace.getState().applyMacroBundle(built);
  return built;
}

describe("dorsal sub-master structure (spec §2, §38)", () => {
  it("exposes the fourteen sub-masters with reachable, unique tiles", () => {
    expect(MRI_DORSAL_SUB_MASTERS.map((m) => m.id)).toEqual([...DORSAL_SUBMASTER_IDS]);
    expect(MRI_DORSAL_SUB_MASTERS.every((m) => m.tiles.length > 0)).toBe(true);
    const ids = ALL_TILES.map(({ tile }) => tile.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(allDorsalTileIds().sort()).toEqual([...ids].sort());
    expect(dorsalSubMasterById("canalCord")?.tiles.length).toBeGreaterThan(4);
  });

  it("keeps rare pathology behind advanced disclosure", () => {
    const advanced = ALL_TILES.filter(({ tile }) => tile.advanced);
    expect(advanced.length).toBeGreaterThan(15);
    expect(MRI_DORSAL_SUB_MASTERS.every((m) => m.hint.length > 10)).toBe(true);
  });

  it("emits a tile for every declared clinical concept that the canon knows", () => {
    // A tile that names an unknown concept would never reconcile or be
    // impression-rated, so every emitted concept must be canonical.
    const concepts = new Set<string>();
    for (const { tile } of ALL_TILES) {
      for (const atom of tile.atoms(ctx())) concepts.add(atom.concept);
    }
    for (const preset of DORSAL_PRESETS) {
      for (const atom of preset.atoms(ctx())) concepts.add(atom.concept);
    }
    const unknown = [...concepts].filter((c) => !CANONICAL_CONCEPTS.has(c));
    expect(unknown, `concepts missing from the content pack: ${unknown.join(", ")}`).toEqual([]);
  });

  /**
   * A tile that states a size may only print one the radiologist entered.
   *
   * `fillDxProse` substitutes bare macro slots (`X mm`, `X x X x X cm`, `X%`) in
   * order per unit and, when the caller supplied no value, intentionally leaves the
   * slot standing rather than guessing — which is right for the engine but means a
   * tile routing straight through it prints the literal words "measuring X mm in
   * thickness" into Findings, Impression and the signed PDF, asserting a measurement
   * nobody made. `libMeasured` is the door for those tiles; this scan is what makes
   * adding a macro line without it impossible to miss, which is how the canal,
   * fracture, retropulsion and cold-abscess lines all shipped a placeholder.
   */
  it("never emits a bare measurement slot when the radiologist entered no value", () => {
    const offenders: string[] = [];
    const check = (where: string, text: string | undefined) => {
      if (!text) return;
      if (/X\s*(?:mm|cm|%)/i.test(text) || /X x X/.test(text)) offenders.push(`${where}: ${text}`);
    };
    // ctx() with no overrides is exactly the state where nothing was measured.
    for (const { tile, palette } of ALL_TILES) {
      for (const atom of tile.atoms(ctx())) {
        check(`${palette}/${tile.id}`, atom.findings);
        if (atom.impression) check(`${palette}/${tile.id}#impression`, atom.impression);
      }
    }
    for (const preset of DORSAL_PRESETS) {
      for (const atom of preset.atoms(ctx())) {
        check(preset.id, atom.findings);
        if (atom.impression) check(`${preset.id}#impression`, atom.impression);
      }
    }
    expect(offenders, `Unmeasured size printed as a literal slot:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("prints the measurement the radiologist entered, and only that", () => {
    const spondylitis = DORSAL_PRESETS.filter((p) => p.id === "preset-spondylodiscitis-collection");
    expect(spondylitis).toHaveLength(1);
    const measured = spondylitis[0].atoms(ctx({ mm: 7 })).map((a) => a.findings).join(" ");
    expect(measured).toContain("measuring 7 mm in thickness");
    const unmeasured = spondylitis[0].atoms(ctx()).map((a) => a.findings).join(" ");
    expect(unmeasured).not.toMatch(/X mm/);
    // Dropping the number must not drop the finding it belonged to.
    expect(unmeasured).toContain("flattening of the ventral surface of the thoracic spinal cord");
  });
});

describe("canonical prose guard (spec §SOURCE CONTENT, §36)", () => {
  it("never emits a sentence that is not library wording, a declared choice, or a system statement", () => {
    const offenders: string[] = [];
    const check = (where: string, text: string) => {
      if (!text.trim()) return;
      const lower = text.replace(/\s+/g, " ").trim().toLowerCase();
      const isFrame = STRUCTURED_CHOICE_FRAMES.some((frame) => lower.startsWith(`${frame.toLowerCase()}:`));
      const isSystem = SYSTEM_STATEMENT_PREFIXES.some((prefix) => lower.startsWith(prefix.toLowerCase()));
      const isAttributed = ATTRIBUTION.test(lower);
      const isLibrary = LIBRARY_CHUNKS.some((chunk) => lower.includes(chunk))
        || LIBRARY_SENTENCES.some((sentence) => lower.includes(sentence));
      if (!isFrame && !isSystem && !isAttributed && !isLibrary) offenders.push(`${where}: ${text}`);
    };
    for (const { tile, palette } of ALL_TILES) {
      for (const atom of tile.atoms(ctx())) {
        check(`${palette}/${tile.id}`, atom.findings);
        if (atom.impression) check(`${palette}/${tile.id}#impression`, atom.impression);
      }
    }
    for (const preset of DORSAL_PRESETS) {
      for (const atom of preset.atoms(ctx())) {
        check(preset.id, atom.findings);
        if (atom.impression) check(`${preset.id}#impression`, atom.impression);
      }
    }
    expect(offenders, `Invented prose:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("fills the library's bare measurement placeholders from the stated values", () => {
    const built = ctx({ mm: 6, mm2: 4, cm: 4, cm2: 3, cm3: 2, pct: 45, level2: "T11-T12" });
    const leftovers: string[] = [];
    for (const { tile, palette } of ALL_TILES) {
      for (const atom of tile.atoms(built)) {
        if (/\bX\b ?(%|mm|cm)/.test(atom.findings)) leftovers.push(`${palette}/${tile.id}: ${atom.findings}`);
      }
    }
    for (const preset of DORSAL_PRESETS) {
      for (const atom of preset.atoms(built)) {
        if (/\bX\b ?(%|mm|cm)/.test(atom.findings)) leftovers.push(`${preset.id}: ${atom.findings}`);
      }
    }
    expect(leftovers, leftovers.join("\n")).toEqual([]);
    // Without a stated measurement nothing is invented — and, since audit P1-c, the
    // bare slot is no longer what gets printed either. This asserted that
    // "approximately X% anterior height loss" stayed visible, which proved no number
    // was guessed but also pinned the literal placeholder reaching Findings and the
    // signed PDF. The library now carries its own un-measured wording of the same
    // finding, so the guarantee holds on both halves: no invented number, and no
    // slot printed as if it were prose.
    const unsupplied = buildDorsalPresetBundle("preset-thoracolumbar-burst", ctx({ mm: undefined, pct: undefined }));
    const unsuppliedText = unsupplied.observations.map((o) => o.findingsText ?? "").join(" ");
    expect(unsuppliedText).toContain("with anterior height loss");
    expect(unsuppliedText).not.toMatch(/X\s*%/);
  });

  it("keeps every library-derived tile sentence traceable to the library file on disk", () => {
    const library = readFileSync(
      resolve(HERE, "../../../../docs/clinical-libraries/mri-dorsal-clinical-content-library.md"),
      "utf8",
    ).replace(/\*\*/g, "").replace(/\s+/g, " ");
    // The tile that states OLF must use the library's own OLF sentence.
    const olf = buildDorsalTileBundle("oo-olf", ctx({ level: "T10-T11" }));
    const text = olf.observations.map((o) => o.findingsText).join(" ");
    expect(library).toContain("Ossification of the ligamentum flavum (OLF) at");
    expect(text).toContain("Ossification of the ligamentum flavum (OLF) at");
  });

  it("renders an unsupplied variable as a visible fill-in instead of guessing", () => {
    const built = buildDorsalTileBundle("dr-conus-normal", ctx({ conusLevel: undefined }));
    expect(built.observations[0]?.findingsText).toContain("[T12-L1 / L1]");
    const stated = buildDorsalTileBundle("dr-conus-normal", ctx({ conusLevel: "L1" }));
    expect(stated.observations[0]?.findingsText).toContain("terminates normally at L1");
  });
});

describe("coverage and sequence gating (spec §4, §12, §25)", () => {
  it("blocks every conus / junction tile when coverage stops above the junction", () => {
    const noJunction = ctx({ numbering: dorsalState({ coverage: "complete" }) });
    const gated = ALL_TILES.filter(({ tile }) => tile.requiresJunction);
    expect(gated.length).toBeGreaterThan(6);
    for (const { tile } of gated) {
      const gate = dorsalTileAvailability(tile, noJunction);
      expect(gate.available, tile.id).toBe(false);
      expect(gate.reason, tile.id).toBe("coverage");
      expect(
        dorsalTileAvailability(tile, ctx()).available,
        tile.id,
      ).toBe(true);
    }
  });

  it("emits no conus sentence in the normal preset without junction coverage", () => {
    const built = buildDorsalPresetBundle("preset-normal-dorsal", ctx({ numbering: dorsalState({ coverage: "complete" }) }));
    expect(built.observations.some((o) => o.concept === "conus_medullaris")).toBe(false);
    expect(built.observations.some((o) => /terminates normally/i.test(o.findingsText ?? ""))).toBe(false);
    // The conus is replaced by a stated coverage limitation, not by silence.
    expect(built.observations.some((o) => o.concept === "screening_limitation")).toBe(true);
    const wide = buildDorsalPresetBundle("preset-normal-dorsal", ctx({ conusLevel: "L1" }));
    expect(wide.observations.some((o) => (o.findingsText ?? "").includes("Conus medullaris terminates normally at L1"))).toBe(true);
  });

  it("gates STIR, contrast and axial-dependent tiles but keeps them listed", () => {
    // The canonical dorsal library contains no diffusion-only sentence, so DWI
    // gating applies to the shared lesion form's signal pattern instead (see
    // "drops DWI and susceptibility wording when diffusion was not acquired").
    for (const key of ["stir", "contrast", "axial"] as const) {
      const tiles = ALL_TILES.filter(({ tile }) => tile.requires?.includes(key)).map(({ tile }) => tile);
      expect(tiles.length, key).toBeGreaterThan(0);
      for (const tile of tiles) {
        const gate = dorsalTileAvailability(tile, ctx({ sequences: sequences({ [key]: false }) }));
        expect(gate.available, `${key}/${tile.id}`).toBe(false);
        expect(gate.reason).toBe("sequence");
        expect(gate.notice).toMatch(/Requires/i);
      }
    }
    const diffusionClaims = ALL_TILES
      .flatMap(({ tile }) => tile.atoms(ctx({ sequences: sequences({ dwi: false }) })))
      .filter((atom) => /\bDWI\b|diffusion/i.test(atom.findings));
    expect(diffusionClaims.map((atom) => atom.findings)).toEqual([]);
  });

  it("never states a fluid-sensitive or contrast finding the study cannot show", () => {
    const noStir = ctx({ sequences: sequences({ stir: false }), level2: "T11-T12", cm: 4, mm: 5 });
    const noContrast = ctx({ sequences: sequences({ contrast: false }), level2: "T11-T12", cm: 4, mm: 5 });
    const offenders: string[] = [];
    const scan = (where: string, atom: { concept: string; findings: string }, available: SpineSequencesAvailable) => {
      const text = atom.findings;
      // A limitation sentence names the sequence it is missing — that is its job.
      if (atom.concept === "screening_limitation" || /did not include|cannot be assessed/i.test(text)) return;
      if (/on STIR|fat-suppressed/i.test(text) && !available.stir) offenders.push(`${where} (STIR): ${text}`);
      if (/T2\/STIR/i.test(text) && !available.t2 && !available.stir) offenders.push(`${where} (T2/STIR): ${text}`);
      if (/enhancement/i.test(text) && !available.contrast) offenders.push(`${where} (contrast): ${text}`);
    };
    for (const { tile, palette } of ALL_TILES) {
      for (const build of [noStir, noContrast]) {
        if (!dorsalTileAvailability(tile, build).available) continue;
        for (const atom of tile.atoms(build)) scan(`${palette}/${tile.id}`, atom, build.sequences);
      }
    }
    for (const preset of DORSAL_PRESETS) {
      for (const build of [noStir, noContrast]) {
        if (!dorsalPresetAvailability(preset, build).supported) continue;
        for (const atom of preset.atoms(build)) scan(preset.id, atom, build.sequences);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("requires a stated extent before a longitudinal or OPLL sentence", () => {
    const gated = ALL_TILES.filter(({ tile }) => tile.requiresExtent).map(({ tile }) => tile);
    expect(gated.length).toBeGreaterThan(1);
    for (const tile of gated) {
      expect(dorsalTileAvailability(tile, ctx({ level2: undefined })).available, tile.id).toBe(false);
      expect(dorsalTileAvailability(tile, ctx({ level2: "T11-T12" })).available, tile.id).toBe(true);
    }
  });

  it("reports a preset as partial and says what was downgraded", () => {
    const noStir = ctx({ sequences: sequences({ stir: false }) });
    const gate = dorsalPresetAvailability(DORSAL_PRESETS.find((p) => p.id === "preset-thoracolumbar-burst")!, noStir);
    expect(gate.supported).toBe(false);
    expect(gate.notice).toMatch(/does not include stir/i);
    const built = buildDorsalPresetBundle("preset-thoracolumbar-burst", noStir);
    expect(built.notice).toMatch(/Partly limited/i);
    // The PLC findings sentence needs STIR; without it that observation is not
    // made, and a limitation takes its place.
    expect(built.observations.some((o) => o.concept === "posterior_ligamentous_complex")).toBe(false);
    expect(built.observations.some((o) => /did not include STIR/i.test(o.findingsText ?? ""))).toBe(true);
    // The library's own macro impression lines stay verbatim when the
    // radiologist selects the macro, so the PLC line survives inside them —
    // in the Impression contribution, not the Findings paragraph.
    const impressionLines = built.observations.filter((o) => o.role === "impression");
    expect(impressionLines.some((o) => /posterior ligamentous complex injury at T12-L1/i.test(o.incoming.impression ?? ""))).toBe(true);
    expect(built.observations.some((o) => /^\d+\.\s/.test(o.findingsText ?? ""))).toBe(false);
  });

  it("swaps an acute-fracture preset to the chronic pattern without a fluid-sensitive sequence", () => {
    const withStir = applyPreset("preset-acute-compression-fracture", ctx({ vertebra: "T12", pct: 30 }));
    expect(withStir.observations[0]?.findingsText).toMatch(/Acute wedge compression fracture of the T12/);
    resetLedger();
    const withoutStir = applyPreset("preset-acute-compression-fracture", ctx({
      sequences: sequences({ stir: false }),
      vertebra: "T12",
    }));
    expect(withoutStir.observations[0]?.findingsText).toMatch(/Chronic wedging/);
    expect(withoutStir.observations.some((o) => /did not include STIR/i.test(o.findingsText ?? ""))).toBe(true);
  });
});

describe("cord observations stay separable (spec §11)", () => {
  it("keeps compression, morphology and signal as three surviving observations", () => {
    applyTile("cc-cord-compression");
    applyTile("cc-cord-flattening");
    applyTile("cc-cord-signal");
    const patches = useWorkspace.getState().appliedPathologyPatches;
    const concepts = patches.map((p) => p.observation?.concept);
    expect(concepts).toContain("cord_compression");
    expect(concepts).toContain("cord_caliber");
    expect(concepts).toContain("cord_signal");
    expect(patches.length).toBeGreaterThanOrEqual(3);
  });

  it("does not turn a T2 hyperintensity into myelomalacia or myelopathy by itself", () => {
    const signal = buildDorsalTileBundle("cc-cord-signal", ctx());
    const text = signal.observations.map((o) => o.findingsText).join(" ");
    expect(text).toContain("intrinsically elevated T2/STIR signal intensity");
    // The library writes this finding as an open differential. The tile keeps
    // both alternatives verbatim and records only "hyperintensity" as its state,
    // so nothing resolves the cause on the radiologist's behalf.
    expect(text).toContain("compatible with compressive myelopathy / myelomalacia");
    expect(signal.observations[0]?.state).toBe("hyperintensity");
    // The interpretive wording exists only on the explicitly named tiles.
    const interpretation = buildDorsalTileBundle("cc-compressive-myelopathy", ctx());
    expect(interpretation.observations.map((o) => o.findingsText).join(" ")).toContain("selected by the reporting radiologist");
  });
});

describe("no automatic diagnosis (spec §15-§20, §36)", () => {
  it("keeps tuberculous wording off every descriptive infection tile", () => {
    const descriptive = ["in-disc-involvement", "in-endplate-erosion", "in-spondylodiscitis", "in-marrow-edema", "in-paravertebral", "in-epidural-component", "in-prevertebral", "in-psoas"];
    for (const id of descriptive) {
      const text = buildDorsalTileBundle(id, ctx()).observations.map((o) => o.findingsText).join(" ");
      expect(text, id).not.toMatch(/tuberculous|Pott|cold abscess/i);
    }
    const tb = buildDorsalTileBundle("in-tb-interpretation", ctx({ level: "T10-T11" }));
    expect(tb.observations.map((o) => o.findingsText).join(" ")).toMatch(/tuberculous spondylitis/i);
    const cold = buildDorsalTileBundle("in-cold-abscess", ctx({ level: "T8-T9", level2: "T11", cm: 4 }));
    expect(cold.observations.map((o) => o.findingsText).join(" ")).toContain("characteristic of tuberculous cold abscess");
  });

  it("does not convert multifocal marrow lesions into metastases", () => {
    const focal = buildDorsalTileBundle("tm-multifocal", ctx());
    expect(focal.observations.map((o) => o.findingsText).join(" ")).not.toMatch(/metastases|metastatic/i);
    const classification = buildDorsalTileBundle("tm-classify-suspicious", ctx());
    expect(classification.observations.map((o) => o.findingsText).join(" ")).toContain("classified by the reporting radiologist");
    const metastatic = buildDorsalTileBundle("tm-classify-metastatic", ctx());
    expect(metastatic.observations.map((o) => o.findingsText).join(" ")).toMatch(/metastases/);
  });

  it("does not diagnose a dAVF from flow voids alone", () => {
    const voids = buildDorsalTileBundle("va-flow-voids", ctx({ level: "T6", level2: "T12" }));
    const text = voids.observations.map((o) => o.findingsText).join(" ");
    expect(text).toContain("serpiginous flow voids");
    // The library sentence names the concern as a differential, and the tile
    // keeps it exactly as written rather than promoting it to a diagnosis.
    expect(text).toContain("highly concerning for a spinal dural arteriovenous fistula (dAVF)");
    const suspicion = buildDorsalTileBundle("va-davf-suspicion", ctx());
    expect(suspicion.observations.map((o) => o.findingsText).join(" ")).toContain("raise suspicion");
    expect(suspicion.observations.map((o) => o.incoming.impression ?? "").join(" "))
      .toContain("stated by the reporting radiologist");
  });

  it("requires an explicit selection before OLF, OPLL or DISH is stated", () => {
    const hypertrophy = buildDorsalTileBundle("oo-lf-hypertrophy-only", ctx());
    expect(hypertrophy.observations.map((o) => o.findingsText).join(" ")).not.toMatch(/ossification/i);
    for (const id of ["oo-olf", "oo-opl", "oo-dish"]) {
      const text = buildDorsalTileBundle(id, ctx({ level2: "T11-T12" })).observations.map((o) => o.findingsText).join(" ");
      expect(text).toMatch(/Ossification|Diffuse Idiopathic Skeletal Hypertrophy/);
    }
  });

  it("never states hardware loosening from signal alone without selection", () => {
    const artifact = buildDorsalTileBundle("po-hardware-artifact", ctx());
    expect(artifact.observations.map((o) => o.findingsText).join(" ")).not.toMatch(/loosen/i);
    const loosening = buildDorsalTileBundle("po-hardware-loosening", ctx());
    expect(loosening.observations.map((o) => o.findingsText).join(" ")).toContain("stated by the reporting radiologist");
  });
});

describe("thoracic-specific vocabulary discipline (spec §41)", () => {
  it("uses no cervical uncovertebral terminology and no lumbar recess / pars engine", () => {
    const banned = /uncovertebral|lateral recess|traversing root|exiting root|pars interarticularis|isthmic|castellvi|sacralization/i;
    const offenders: string[] = [];
    for (const { tile, palette } of ALL_TILES) {
      for (const finding of tileFindings(tile)) {
        if (banned.test(finding)) offenders.push(`${palette}/${tile.id}: ${finding}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps thoracic root wording descriptive unless the radiologist names a root", () => {
    const foraminal = buildDorsalTileBundle("ad-root-descriptive", ctx({ level: "T7-T8", side: "left" }));
    const text = foraminal.observations.map((o) => o.findingsText).join(" ");
    expect(text).toContain("intercostal nerve");
    expect(text).not.toMatch(/\bT\d radiculopathy\b/i);
  });

  it("has no hard-coded thoracic level array in the dorsal canvas components", () => {
    const source = readFileSync(
      resolve(PKG_DIR, "src/components/radiology/reporting-canvas/MriDorsalSubMasterPanel.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/\["T1-T2",\s*"T2-T3"/);
    expect(source).toMatch(/dorsalLevelKeys\(numbering\)/);
  });
});

describe("normal → abnormal reconciliation (spec §5)", () => {
  it("removes the library normal cord sentence when compression is documented", () => {
    resetLedger();
    useWorkspace.getState().setField("findings", DX_CANAL.cordNormal, { source: "system" });
    expect(useWorkspace.getState().findingsText).toContain("normal caliber");
    applyTile("cc-cord-compression");
    const findings = useWorkspace.getState().findingsText;
    expect(findings).toMatch(/cord compression/i);
    expect(findings).not.toContain("normal caliber and uniform intrinsic signal intensity");
  });

  it("carries a baseline claim for every concept the normal preset seeds", () => {
    const preset = DORSAL_PRESETS.find((p) => p.id === "preset-normal-dorsal")!;
    const seededConcepts = preset.atoms(ctx()).map((a) => a.concept);
    for (const concept of seededConcepts) {
      expect(DORSAL_NORMAL_SENTENCE_BY_CONCEPT[concept], concept).toBeTruthy();
    }
  });

  it("reconciles a marrow lesion against the no-focal-lesion normal", () => {
    resetLedger();
    useWorkspace.getState().setField("findings", DX_BONE.noFocalLesion, { source: "system" });
    applyTile("tm-focal-lesion", ctx({ vertebra: "T8" }));
    const findings = useWorkspace.getState().findingsText;
    expect(findings).toMatch(/focal marrow-replacing lesion/);
    expect(findings).not.toContain("No acute compression fracture, focal lytic/sclerotic lesion");
  });

  it("keeps unrelated normal anatomy when one region becomes abnormal", () => {
    applyPreset("preset-normal-dorsal", ctx());
    const before = useWorkspace.getState().appliedPathologyPatches.length;
    applyTile("cc-cord-compression", ctx({ level: "T4-T5" }));
    const after = useWorkspace.getState().appliedPathologyPatches;
    expect(after.length).toBeGreaterThan(before - 1);
    // The marrow / alignment normals at other sites are untouched.
    expect(after.some((p) => (p.lastRendered.findings ?? "").includes("Vertebral body heights and marrow signal"))).toBe(true);
  });
});

describe("presets are reversible starting points (spec §35, §45)", () => {
  it("applies and removes each preset without stranding observations", () => {
    for (const preset of DORSAL_PRESETS) {
      resetLedger();
      const built = applyPreset(preset.id, ctx({ level: "T8-T9", level2: "T11-T12", conusLevel: "L1", vertebra: "T8", mm: 5, mm2: 4, pct: 30, cm: 4, cm2: 3, choice: "without" }));
      expect(built.observations.length, preset.id).toBeGreaterThan(0);
      const removed = useWorkspace.getState().removeMacroBundle(built.bundleId);
      expect(removed, preset.id).toBe("removed");
      // Only the store's own report-level normal impression may survive.
      const stranded = useWorkspace.getState().appliedPathologyPatches.filter((p) => p.id !== SYSTEM_NORMAL_PATCH_ID);
      expect(stranded.map((p) => p.id), preset.id).toEqual([]);
    }
  });

  it("flags critical presets without claiming any communication", () => {
    const critical = DORSAL_PRESETS.filter((p) => p.critical).map((p) => p.id);
    expect(critical).toContain("preset-thoracolumbar-burst");
    expect(critical).toContain("preset-calcified-disc-cord");
    for (const preset of DORSAL_PRESETS) {
      const text = preset.atoms(ctx()).map((a) => `${a.findings} ${a.impression ?? ""}`).join(" ");
      expect(text, preset.id).not.toMatch(/clinician (?:informed|notified)|called the referring/i);
    }
  });

  it("keeps preset summary lines in the Impression field, not the Findings paragraph", () => {
    for (const preset of DORSAL_PRESETS) {
      for (const atom of preset.atoms(ctx({ level2: "T11-T12", conusLevel: "L1", vertebra: "T8", mm: 5 }))) {
        expect(atom.findings, `${preset.id} findings`).not.toMatch(/^\d+\.\s/);
      }
    }
    resetLedger();
    applyPreset("preset-calcified-disc-cord", ctx({ mm: 6 }));
    expect(useWorkspace.getState().findingsText).not.toMatch(/^\d+\./m);
    expect(useWorkspace.getState().impressionText).toMatch(/calcified/i);
  });

  it("never auto-finalizes a report when a preset is applied", () => {
    resetLedger();
    applyPreset("preset-cord-compression-signal", ctx());
    expect(useWorkspace.getState().isFinalized).toBe(false);
    expect(useWorkspace.getState().isDirty).toBe(true);
  });

  it("protects a hand-written sentence over a preset baseline", () => {
    resetLedger();
    useWorkspace.getState().setField("findings", "Cord appearance is normal despite prior myelitis.", { source: "manual" });
    const built = applyPreset("preset-normal-dorsal", ctx());
    const statuses = built.observations.map((o) => useWorkspace.getState().removeMacroBundle(built.bundleId));
    expect(statuses.length).toBeGreaterThan(0);
    expect(useWorkspace.getState().findingsText).toContain("despite prior myelitis");
  });

  it("restores the previous ledger through clinical undo", () => {
    resetLedger();
    applyTile("df-hyperkyphosis");
    const count = useWorkspace.getState().appliedPathologyPatches.length;
    applyTile("cc-cord-compression");
    expect(useWorkspace.getState().appliedPathologyPatches.length).toBeGreaterThan(count);
    useWorkspace.getState().undoLastPatch();
    expect(useWorkspace.getState().appliedPathologyPatches.some((p) => p.observation?.concept === "cord_compression")).toBe(false);
  });
});

describe("shared lesion form (spec §19, §24)", () => {
  it("maps each compartment to its own canonical concept", () => {
    const intradural = buildDorsalLesionAtoms({ compartment: "intradural", level: "T6-T7" }, ctx());
    expect(intradural[0]?.concept).toBe("intradural_lesion");
    const intramedullary = buildDorsalLesionAtoms({ compartment: "intramedullary", level: "T4-T5", level2: "T7-T8" }, ctx());
    expect(intradural[0]?.concept).not.toBe(intramedullary[0]?.concept);
    const epidural = buildDorsalLesionAtoms({ compartment: "epidural", level: "T8-T9" }, ctx());
    expect(epidural[0]?.concept).toBe("epidural_collection");
  });

  it("states dimensions in mm or cm without inventing a diagnosis", () => {
    const atoms = buildDorsalLesionAtoms(
      { compartment: "paravertebral", level: "T8-T11", cmAP: 6, cmTransverse: 4, laterality: "left" },
      ctx(),
    );
    expect(atoms[0]?.findings).toMatch(/measuring 6 x 4 cm/);
    expect(atoms[0]?.findings).not.toMatch(/lymphoma|metastas/i);
  });

  it("emits a limitation instead of an enhancement claim without contrast", () => {
    const withContrast = buildDorsalLesionAtoms(
      { compartment: "epidural", level: "T8-T9", enhancement: "rim" },
      ctx({ sequences: sequences({ contrast: true }) }),
    );
    expect(withContrast.some((a) => /rim enhancement/.test(a.findings))).toBe(true);
    const without = buildDorsalLesionAtoms(
      { compartment: "epidural", level: "T8-T9", enhancement: "rim" },
      ctx({ sequences: sequences({ contrast: false }) }),
    );
    expect(without.some((a) => /did not include contrast/i.test(a.findings))).toBe(true);
    expect(without.some((a) => /rim enhancement/.test(a.findings))).toBe(false);
  });

  it("drops DWI and susceptibility wording when diffusion was not acquired", () => {
    const atoms = buildDorsalLesionAtoms(
      { compartment: "intramedullary", level: "T4-T5", level2: "T7-T8", t1: "hypointense", t2: "hyperintense", dwi: "no restriction", susceptibility: "no blooming" },
      ctx({ sequences: sequences({ dwi: false }) }),
    );
    expect(atoms[0]?.findings).toContain("T1: hypointense");
    expect(atoms[0]?.findings).not.toMatch(/DWI\/ADC/);
  });

  it("adds canal, cord, foraminal and paravertebral effect as separable observations", () => {
    const built = buildDorsalLesionBundle(
      {
        compartment: "epidural",
        level: "T7-T8",
        canalEffect: true,
        cordEffect: true,
        foraminalEffect: true,
        paravertebralExtension: true,
        laterality: "right",
      },
      ctx(),
    );
    const concepts = built.observations.map((o) => o.concept);
    expect(concepts).toEqual(expect.arrayContaining(["epidural_collection", "canal_stenosis", "cord_compression", "foraminal_stenosis", "paravertebral_collection"]));
  });
});

describe("screening composition for a dedicated dorsal study (spec §26-§29, §44)", () => {
  it("never offers a dorsal screening module inside a dedicated dorsal study", () => {
    const resolved = resolveScreeningRoles({ name: "MRI DORSAL SPINE WITH WHOLE SPINE SCREENING" });
    expect(resolved.roles.dorsal).toBe("primary-dedicated");
    expect(offeredScreeningRegions(resolved.roles)).toEqual(["cervical", "ls"]);
  });

  it("groups two accompanying regions as whole-spine screening with one limitation line", () => {
    const state = defaultScreeningState();
    for (const region of ["cervical", "ls"] as const) {
      state[region] = {
        ...state[region],
        role: "accompanying-screening",
        performed: true,
        selections: screeningPresetSelections(SCREENING_SCHEMAS[region]),
      };
    }
    const bundles = screeningLedgerBundles({
      state,
      schemas: SCREENING_SCHEMAS,
      sequences: sequences({ cervicalScreening: true, lsScreening: true }),
      numbering: useWorkspace.getState().lumbarNumbering,
      ledgerRegion: "Dorsal Spine",
    });
    const limitation = bundles.filter((b) => b.bundleId === SCREENING_LIMITATION_BUNDLE_ID);
    expect(limitation).toHaveLength(1);
    expect(limitation[0]?.observations).toHaveLength(1);
    // Each performed region keeps its own bundle, so one region can be changed
    // without touching the other's screening prose.
    expect(bundles.map((b) => b.bundleId).filter((id) => id !== SCREENING_LIMITATION_BUNDLE_ID).sort())
      .toEqual(["spm-screen-cervical", "spm-screen-ls"]);
  });

  it("emits no screening prose for a region that was not performed", () => {
    const state = defaultScreeningState();
    state.cervical = {
      ...state.cervical,
      performed: true,
      role: "accompanying-screening",
      selections: screeningPresetSelections(SCREENING_SCHEMAS.cervical),
    };
    const bundles = screeningLedgerBundles({
      state,
      schemas: SCREENING_SCHEMAS,
      sequences: sequences({ cervicalScreening: true }),
      numbering: useWorkspace.getState().lumbarNumbering,
      ledgerRegion: "Dorsal Spine",
    });
    expect(bundles.some((b) => b.bundleId === "spm-screen-dorsal")).toBe(false);
    expect(bundles.some((b) => b.bundleId === "spm-screen-ls")).toBe(false);
    expect(bundles.some((b) => b.bundleId === "spm-screen-cervical")).toBe(true);
  });

  it("keeps screening conflicts out of the dedicated dorsal observations", () => {
    const state = defaultScreeningState();
    state.ls = {
      ...state.ls,
      performed: true,
      role: "accompanying-screening",
      selections: screeningPresetSelections(SCREENING_SCHEMAS.ls),
    };
    const bundles = screeningLedgerBundles({
      state,
      schemas: SCREENING_SCHEMAS,
      sequences: sequences({ lsScreening: true }),
      numbering: useWorkspace.getState().lumbarNumbering,
      ledgerRegion: "Dorsal Spine",
    });
    expect(bundles.length).toBeGreaterThan(0);
    // Screening rows own a screening anatomical section, never a dorsal level,
    // so a dedicated dorsal observation can never overwrite them.
    const rows = bundles.flatMap((b) => b.observations.map((o) => ({
      section: o.ownership.anatomicalSection ?? "",
      concept: o.concept ?? "",
    })));
    expect(rows.filter((r) => /^T\d/.test(r.section))).toEqual([]);
    expect(
      rows.filter((r) => r.concept !== "screening_limitation").every((r) => /^screening (cervical|dorsal|ls)$/.test(r.section)),
    ).toBe(true);
  });
});

describe("billed study resolver (spec §28)", () => {
  it("maps verified dorsal codes to the dorsal primary-dedicated role", () => {
    expect(resolveScreeningRoles({ name: "MRI DORSAL SPINE" }).roles.dorsal).toBe("primary-dedicated");
    expect(resolveScreeningRoles({ name: "MRI THORACIC SPINE" }).roles.dorsal).toBe("primary-dedicated");
    expect(resolveScreeningRoles({ code: "MRI021", name: "MRI DORSAL SPINE SCREENING" }).roles.dorsal).toBe("primary-screening");
  });

});

describe("dorsal contradiction validator (spec §33)", () => {
  it("warns when a normal cord sits beside cord compression", () => {
    const warnings = dorsalTextContradictions({
      findingsText: `${DX_CANAL.cordNormal} Severe thoracic cord compression at T8-T9.`,
      impressionText: "",
      numbering: dorsalState(),
    });
    expect(warnings.some((w) => /spinal cord/i.test(w))).toBe(true);
  });

  it("warns about a conus statement outside acquired coverage", () => {
    const warnings = dorsalTextContradictions({
      findingsText: "Conus medullaris terminates normally at L1.",
      impressionText: "",
      numbering: dorsalState({ coverage: "complete" }),
    });
    expect(warnings.some((w) => /Coverage check/i.test(w))).toBe(true);
  });

  it("warns about axial-dependent foraminal grading without axial sequences", () => {
    const warnings = dorsalTextContradictions({
      findingsText: "Moderate left foraminal narrowing at T11-T12.",
      impressionText: "",
      sequences: sequences({ axial: false }),
      numbering: dorsalState(),
    });
    expect(warnings.some((w) => /Axial check/i.test(w))).toBe(true);
  });

  it("flags a level that the recorded coverage never included", () => {
    const warnings = dorsalTextContradictions({
      findingsText: "Disc protrusion at T12-L1.",
      impressionText: "",
      numbering: dorsalState({ coverage: "upper" }),
    });
    expect(warnings.some((w) => /Level naming/i.test(w))).toBe(true);
  });

  it("says nothing about a clean report", () => {
    expect(dorsalTextContradictions({
      findingsText: fillDxProse(DX_ALIGN.normal, {}).text,
      impressionText: "",
      sequences: sequences(),
      numbering: dorsalState(),
    })).toEqual([]);
  });
});

describe("named dorsal observations (spec §40-§43)", () => {
  const cases: Array<[string, RegExp, string]> = [
    ["dd-central-protrusion", /Central disc protrusion at T8-T9 measuring approximately/, "disc_contour"],
    ["dd-calcified-herniation", /Calcified thoracic disc herniation at/, "disc_contour"],
    ["dd-paracentral-extrusion", /paracentral disc extrusion/i, "disc_contour"],
    ["dd-extraforaminal", /Far lateral \/ extraforaminal disc herniation/, "disc_contour"],
    ["dd-diffuse-bulge", /^Discs: diffuse disc bulge/, "disc_contour"],
    ["dd-sequestration", /^Discs: sequestered disc fragment/, "disc_contour"],
    ["dd-modic3", /^Endplates: Modic type III/, "endplate"],
    ["dd-focal-sclerosis", /^Bones \/ marrow: focal vertebral sclerosis/, "bone_lesion"],
    ["cc-cord-displacement", /^Spinal cord: displacement of the cord/, "cord_caliber"],
    ["cc-cord-swelling", /focal cord swelling|cord swelling/i, "cord_caliber"],
    ["cc-cord-atrophy", /atrophy/i, "cord_caliber"],
    ["id-syrinx", /syrinx|cord cavity/i, "syrinx"],
    ["id-cord-expansion", /expansion|expanded/i, "cord_caliber"],
    ["tr-burst", /burst fracture/i, "compression_fracture"],
    ["tr-epidural-hematoma", /epidural hematoma/i, "epidural_collection"],
    ["tr-plc-disruption", /posterior ligamentous complex/i, "posterior_ligamentous_complex"],
    ["tm-epidural-extension", /epidural/i, "epidural_space"],
    ["tm-pedicle", /pedicle/i, "posterior_elements"],
    ["oo-olf", /Ossification of the ligamentum flavum \(OLF\)/, "olf"],
    ["oo-opl-focal", /^Ligaments: focal ventral ligamentous ossification/, "ossification_posterior_longitudinal"],
    ["oo-dish", /Diffuse Idiopathic Skeletal Hypertrophy|DISH/, "dish"],
    ["df-scoliosis", /Scoliotic deformity of the thoracic spine convex to the right/i, "scoliosis"],
    ["in-gibbus", /gibbus|kyphotic/i, "gibbus_deformity"],
    ["po-hardware-artifact", /hardware|artifact/i, "hardware_postop"],
  ];

  it.each(cases)("%s states one canonical observation", (id, expected, concept) => {
    const built = buildDorsalTileBundle(id, ctx({ level2: "T11-T12", mm: 6, mm2: 4, cm: 4, vertebra: "T12", side: "right" }));
    const text = built.observations.map((o) => o.findingsText).join(" ");
    expect(text, id).toMatch(expected);
    expect(built.observations.map((o) => o.concept), id).toContain(concept);
    // Every one of them is a structured-template observation on the one ledger.
    expect(built.observations.length, id).toBeGreaterThan(0);
  });

  it("keeps the OPLL pattern tiles separate so no grade is invented", () => {
    const ids = ["oo-opl-focal", "oo-opl-segmental", "oo-opl-continuous"];
    const states = ids.map((id) => buildDorsalTileBundle(id, ctx()).observations[0]?.state);
    expect(states).toEqual(["focal", "segmental", "continuous"]);
    expect(buildDorsalTileBundle("oo-opl-continuous", ctx({ level2: undefined })).observations[0]?.findingsText)
      .not.toMatch(/through/);
  });

  it("warns when a measured dorsal AP diameter contradicts a mild grade (spec §10)", () => {
    resetLedger();
    const built = buildDorsalLevelBundle({
      level: "T8-T9",
      detail: { canalMorphology: "csf_preserved", apMm: 6.5, canalSeverity: "mild" },
      numbering: dorsalState(),
      sequences: sequences(),
    });
    useWorkspace.getState().applyMacroBundle(built);
    const warnings = structuredCanalApContradiction(useWorkspace.getState().appliedPathologyPatches);
    expect(warnings.some((w) => /AP canal 6.5 mm at T8-T9/i.test(w))).toBe(true);
  });
});

describe("impression refresh and protection for dorsal content (spec §32, §45)", () => {
  it("marks the impression stale when findings change, and refreshes from the ledger", () => {
    resetLedger();
    applyPreset("preset-calcified-disc-cord", ctx({ mm: 6 }));
    expect(useWorkspace.getState().impressionText).toMatch(/calcified/i);
    useWorkspace.getState().setField("findings", `${useWorkspace.getState().findingsText} Additional manual sentence about the posterior elements.`, { source: "manual" });
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(true);
    useWorkspace.getState().refreshImpressionFromLedger();
    expect(useWorkspace.getState().impressionText).toMatch(/calcified/i);
  });

  it("never overwrites a hand-written impression", () => {
    resetLedger();
    useWorkspace.getState().setField("impression", "Clinical question answered; impression dictated by the radiologist.", { source: "manual" });
    const manual = useWorkspace.getState().impressionText;
    applyPreset("preset-cord-compression-signal", ctx());
    expect(useWorkspace.getState().impressionText).toContain(manual);
  });
});

describe("whole-model binding (spec §45)", () => {
  it("moves the level rows, the AP table and the allowed-level check together", () => {
    for (const coverage of ["upper", "complete", "thoracolumbar"] as const) {
      const state = dorsalState({ coverage });
      expect(dorsalApCanalLevels(state)).toEqual(dorsalLevelKeyStrings(state));
      const warnings = dorsalTextContradictions({
        findingsText: `Disc protrusion at ${dorsalLevelKeyStrings(state)[0]}.`,
        impressionText: "",
        numbering: state,
      });
      expect(warnings.filter((w) => /Level naming/i.test(w))).toEqual([]);
    }
  });

  it("keeps every dorsal UI file reading levels from the resolver", () => {
    const uiFiles = [
      "src/components/radiology/reporting-canvas/MriDorsalCanvas.tsx",
      "src/components/radiology/reporting-canvas/MriDorsalSubMasterPanel.tsx",
      "src/components/radiology/reporting-canvas/SpineApCanalMeasurements.tsx",
      "src/components/radiology/reporting-canvas/SpineScreeningPanel.tsx",
      "src/components/radiology/workspace/ReportingToolsRail.tsx",
      "src/hooks/radiology-workspace/useWorkspaceClinicalUi.tsx",
    ];
    for (const rel of uiFiles) {
      const src = readFileSync(resolve(PKG_DIR, rel), "utf8");
      expect(src, `${rel} must not enumerate thoracic levels`).not.toMatch(/"T\d+(?:-[TL]\d+)?"\s*,\s*"T\d+/);
    }
  });

  it("re-scopes a captured observation instead of re-labelling it silently", () => {
    resetLedger();
    applyTile("jj-conus-compression", ctx({ numbering: dorsalState({ coverage: "thoracolumbar" }) }));
    expect(useWorkspace.getState().appliedPathologyPatches.some((p) => p.observation?.concept === "conus_medullaris")).toBe(true);
    // Narrowing coverage makes that level unavailable; the validator must then
    // surface the stale claim rather than quietly renaming it.
    const warnings = dorsalTextContradictions({
      findingsText: useWorkspace.getState().findingsText,
      impressionText: "",
      numbering: dorsalState({ coverage: "complete" }),
    });
    expect(warnings.some((w) => /Coverage check/i.test(w))).toBe(true);
  });

  it("keys tile bundles by level so two levels never share a bundle", () => {
    expect(dorsalTileBundleId("cc-cord-compression", "T8-T9")).not.toBe(dorsalTileBundleId("cc-cord-compression", "T9-T10"));
    expect(dorsalPresetBundleId("preset-gibbus-deformity", "T12-L1")).toContain("T12-L1");
    expect(dorsalPresetBundleId("preset-gibbus-deformity", "T12-L1"))
      .not.toBe(dorsalPresetBundleId("preset-gibbus-deformity", "T8-T9"));
  });

  it("keeps the dorsal and LS screening namespaces apart", () => {
    const state = defaultScreeningState();
    for (const region of ["dorsal", "ls"] as const) {
      state[region] = {
        ...state[region],
        performed: true,
        role: "primary-screening",
        selections: screeningPresetSelections(SCREENING_SCHEMAS[region]),
      };
    }
    const bundles = screeningLedgerBundles({
      state,
      schemas: SCREENING_SCHEMAS,
      sequences: sequences({ dorsalScreening: true, lsScreening: true }),
      numbering: useWorkspace.getState().lumbarNumbering,
      ledgerRegion: "Whole Spine",
    });
    const groups = [...new Set(bundles.flatMap((b) => b.observations.map((o) => o.ownership.conflictGroup ?? "")))];
    const dorsalGroups = groups.filter((g) => g.startsWith("screen-dorsal-"));
    const lsGroups = groups.filter((g) => g.startsWith("screen-ls-"));
    // Region-scoped conflict groups: a dorsal screening row can never absorb an
    // LS screening row at the same nominal site, and both namespaces are used.
    expect(dorsalGroups.length).toBeGreaterThan(0);
    expect(lsGroups.length).toBeGreaterThan(0);
    expect(dorsalGroups.filter((g) => lsGroups.includes(g))).toEqual([]);
  });
});

// ─── Shared engines stay scoped to dorsal ──────────────────────────────────
//
// Dorsal reuses three shared engines (impression priority, the AP-canal
// contradiction rule and level lettering). Each of them also serves shipped
// lumbar reports, so the dorsal behaviour has to be additive: measured here so
// a future edit cannot quietly re-rank or re-word an MRI Lumbar impression.
describe("dorsal scoping of shared engines (spec §10, §31)", () => {
  type PatchInit = {
    id: string;
    region: string;
    concept: string;
    level: string;
    measurement: string;
    severity: string;
  };
  const patch = (i: PatchInit): AppliedPathologyPatch =>
    ({
      id: i.id,
      ownership: { concept: i.concept, anatomicalSection: i.level },
      templates: { findings: "f", impression: "", recommendation: "" },
      lastRendered: { findings: "f", impression: "", recommendation: "" },
      source: "structured-template",
      observation: {
        id: i.id,
        region: i.region,
        anatomicalSection: "spine",
        concept: i.concept,
        conceptSource: "explicit",
        conflictGroup: i.concept,
        level: i.level,
        laterality: "",
        state: "",
        severity: i.severity,
        measurement: i.measurement,
        slotKey: i.id,
        source: "structured-template",
        baselineReplaces: "",
        supportsLaterality: false,
        bundleId: "b",
        sectionsOwned: ["findings"],
        role: "finding",
        specificity: "level",
      },
    } as unknown as AppliedPathologyPatch);

  it("never treats a lumbar canal-morphology row as an AP measurement", () => {
    // The dorsal level form records the AP diameter on the CSF-morphology row;
    // the lumbar form measures on `canal_ap` and carries no diameter there.
    const lumbar = structuredCanalApContradiction([
      patch({ id: "l-sev", region: "LS Spine", concept: "canal_stenosis", level: "L4-L5", measurement: "", severity: "none" }),
      patch({ id: "l-morph", region: "LS Spine", concept: "canal_morphology", level: "L4-L5", measurement: "9 mm", severity: "" }),
    ]);
    expect(lumbar).toEqual([]);

    const dorsal = structuredCanalApContradiction([
      patch({ id: "d-sev", region: "Dorsal Spine", concept: "canal_stenosis", level: "D8-D9", measurement: "", severity: "none" }),
      patch({ id: "d-morph", region: "Dorsal Spine", concept: "canal_morphology", level: "D8-D9", measurement: "9 mm", severity: "" }),
    ]);
    expect(dorsal).toEqual([
      "Structured mismatch: AP canal 9 mm at T8-T9 coexists with canal stenosis marked none.",
    ]);
  });

  it("keeps the shipped lumbar level label untouched while dorsal re-letters D to T", () => {
    const lumbar = structuredCanalApContradiction([
      patch({ id: "l2-sev", region: "LS Spine", concept: "canal_stenosis", level: "L4-L5", measurement: "", severity: "mild" }),
      patch({ id: "l2-ap", region: "LS Spine", concept: "canal_ap", level: "L4-L5", measurement: "9 mm", severity: "" }),
    ]);
    expect(lumbar).toEqual([
      "Structured mismatch: AP canal 9 mm at L4-L5 coexists with canal stenosis marked mild.",
    ]);
  });

  it("re-orders a dorsal impression through the store and leaves a lumbar one alone", () => {
    const lines = [
      "Moderate foraminal stenosis at T11-T12.",
      "T8-T9 cord compression with intrinsic cord signal change.",
    ];
    const useSegment = (region: string) => {
      const ctx = buildReportingStudyContext({
        modality: "MR",
        studyDescription: `MRI ${region}`,
        regions: [region],
        source: "auto",
      });
      useWorkspace.setState({
        impressionText: lines.join("\n"),
        impressionOrderFrozen: false,
        reportingContext: ctx,
      });
      return ctx.spineSegment;
    };

    expect(useSegment("LS Spine")).toBe("lumbar");
    expect(useWorkspace.getState().orderImpressionByPriority()).toBe(false);
    expect(useWorkspace.getState().impressionText).toBe(lines.join("\n"));

    expect(useSegment("Dorsal Spine")).toBe("dorsal");
    expect(useWorkspace.getState().orderImpressionByPriority()).toBe(true);
    expect(useWorkspace.getState().impressionText.split("\n")).toEqual([lines[1], lines[0]]);
  });
});
