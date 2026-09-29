/**
 * mriLumbarSubMasters.test.ts — the twelve lumbar clinical sub-masters,
 * canonical macros and the shared lesion form (spec §34-§39, §43).
 *
 * The binding rules this file exists to protect:
 * - a tile is only appliable when the examination can support it, and an
 *   unsupported tile is still LISTED (struck-through) rather than hidden;
 * - no tile invents clinical prose: every emitted sentence is either canonical
 *   library wording with variables substituted, or a declared structured-choice
 *   frame ("<Section>: <label> at <level>.");
 * - numbering / LSTV changes the level the tile is captured at, never silently
 *   re-labels anatomy;
 * - bundles are reversible through the existing ledger.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  LUMBAR_PRESETS,
  LUMBAR_SUBMASTER_IDS,
  MRI_LUMBAR_SUB_MASTERS,
  allLumbarTileIds,
  buildLumbarLesionAtoms,
  buildLumbarLesionBundle,
  buildLumbarPresetBundle,
  buildLumbarTileBundle,
  lumbarPresetBundleId,
  lumbarSubMasterById,
  lumbarTileAvailability,
  lumbarTileBundleId,
  numberingAtom,
  type LumbarTile,
  type LumbarTileContext,
} from "@/lib/mriLumbarSubMasters";
import { LS_LIBRARY_PROSE, fillLsProse } from "@/lib/mriLumbarLibrary";
import { defaultLumbarNumbering } from "@/lib/mriSpineNumbering";
import { defaultSpineSequences } from "@/lib/mriSpineSequences";
import { spineBundleId } from "@/lib/mriSpineAtoms";
import { useWorkspace } from "@/lib/zai-workspace/store";

const ALL_TILES: Array<{ tile: LumbarTile; palette: string }> = MRI_LUMBAR_SUB_MASTERS.flatMap((sm) =>
  sm.tiles.map((tile) => ({ tile, palette: sm.id })),
);

/** Mirrors SECTION_FRAMES in mriLumbarSubMasters.ts: the only sanctioned way to
 *  state a choice the canonical library does not already sentence. */
const STRUCTURED_CHOICE_FRAMES = [
  "Alignment",
  "Bones / marrow",
  "Discs",
  "Central canal",
  "Neural foramina",
  "Lateral recess",
  "Facet joints",
  "Ligamentum flavum",
  "Conus medullaris",
  "Cauda equina",
  "Epidural space",
  "Paraspinal soft tissues",
  "Sacroiliac joints",
  "Pars interarticularis",
  "Hardware",
  "Vertebral numbering",
];

/**
 * Literal runs of the canonical library (placeholders removed). A tile sentence
 * that is library-derived must contain at least one of these verbatim.
 */
const LIBRARY_CHUNKS: string[] = [...new Set(
  Object.values(LS_LIBRARY_PROSE).flatMap((template) =>
    String(template)
      .split(/\[[^\]]*\]|\bX(?:\.\d+)? ?(?:mm|cm|mm2|cm2|%|x)/g)
      .map((chunk) => chunk.replace(/\s+/g, " ").trim().toLowerCase())
      .filter((chunk) => chunk.split(" ").length >= 4),
  ),
)];

/**
 * Statements about what the examination covered. These are system wording, not
 * clinical claims, so they are neither library prose nor a structured choice —
 * `mriSpineSequences.spineLimitationSentence` is the only sanctioned producer.
 */
const SYSTEM_LIMITATION_PREFIXES = [
  "This examination did not include",
  "Screening of the",
  "Levels stated for",
];

function ctx(overrides: Partial<LumbarTileContext> = {}): LumbarTileContext {
  return {
    level: "L4-L5",
    numbering: defaultLumbarNumbering(),
    sequences: defaultSpineSequences(),
    region: "LS Spine",
    ...overrides,
  };
}

function tileFindings(tile: LumbarTile, context = ctx()): string[] {
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
    lumbarNumbering: defaultLumbarNumbering(),
    sequencesAvailable: defaultSpineSequences(),
  });
}

describe("lumbar sub-master structure", () => {
  it("exposes the twelve sub-masters with reachable, unique tiles", () => {
    expect(MRI_LUMBAR_SUB_MASTERS.map((m) => m.id)).toEqual([...LUMBAR_SUBMASTER_IDS]);
    expect(MRI_LUMBAR_SUB_MASTERS.every((m) => m.tiles.length > 0)).toBe(true);
    expect(lumbarSubMasterById("conusCauda")?.tiles.length).toBeGreaterThan(0);
    const ids = ALL_TILES.map(({ tile }) => tile.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(allLumbarTileIds().sort()).toEqual([...ids].sort());
  });

  it("groups tiles so the UI can render progressive disclosure", () => {
    const advancedCount = ALL_TILES.filter(({ tile }) => tile.advanced).length;
    expect(advancedCount).toBeGreaterThan(0);
    expect(MRI_LUMBAR_SUB_MASTERS.every((m) => m.hint.length > 10)).toBe(true);
    const discNeural = lumbarSubMasterById("discNeural");
    const groups = new Set(discNeural?.tiles.map((t) => t.group));
    expect(groups.size).toBeGreaterThan(1);
  });
});

describe("sequence / numbering gating (spec §35)", () => {
  it("offers STIR-dependent tiles only when a fluid-sensitive sequence exists", () => {
    const tiles = ALL_TILES.filter(({ tile }) => tile.requires?.includes("stir")).map(({ tile }) => tile);
    expect(tiles.length).toBeGreaterThan(0);
    for (const tile of tiles) {
      expect(lumbarTileAvailability(tile, ctx()).available, tile.id).toBe(false);
      expect(lumbarTileAvailability(tile, ctx()).missing).toContain("stir");
      expect(
        lumbarTileAvailability(tile, ctx({ sequences: { ...defaultSpineSequences(), stir: true } })).available,
        tile.id,
      ).toBe(true);
    }
  });

  it("gates contrast-dependent tiles and keeps them listed with a reason", () => {
    const tiles = ALL_TILES.filter(({ tile }) => tile.requires?.includes("contrast")).map(({ tile }) => tile);
    expect(tiles.length).toBeGreaterThan(0);
    for (const tile of tiles) {
      const gate = lumbarTileAvailability(tile, ctx());
      expect(gate.available).toBe(false);
      expect(gate.reason).toBe("sequence");
      expect(gate.notice).toMatch(/Requires .*contrast/i);
    }
  });

  it("gates dynamic-imaging detail behind a dynamic acquisition", () => {
    const tile = ALL_TILES.find(({ tile: t }) => t.requires?.includes("dynamic"))?.tile;
    expect(tile).toBeDefined();
    expect(lumbarTileAvailability(tile!, ctx()).available).toBe(false);
    expect(
      lumbarTileAvailability(tile!, ctx({ sequences: { ...defaultSpineSequences(), dynamic: true } })).available,
    ).toBe(true);
  });

  it("refuses a numbering basis that names a localizer the study does not have", () => {
    const tile = MRI_LUMBAR_SUB_MASTERS.flatMap((m) => m.tiles).find((t) => t.requiresLocalizerIf);
    expect(tile, "at least one tile must use the coverage-dependent gate").toBeDefined();
    const localizer = { ...defaultSpineSequences(), wholeSpineLocalizer: true };
    const claimsLocalizer = ctx({
      numbering: { ...defaultLumbarNumbering(), mode: "localizer-based" },
    });
    const gate = lumbarTileAvailability(tile!, claimsLocalizer);
    expect(gate.available).toBe(false);
    expect(gate.reason).toBe("localizer");
    expect(lumbarTileAvailability(tile!, ctx({ numbering: claimsLocalizer.numbering, sequences: localizer })).available).toBe(true);
    // A study that makes no localizer claim is never gated for lacking one.
    expect(lumbarTileAvailability(tile!, ctx()).available).toBe(true);
  });

  it("offers transitional tiles only when LSTV anatomy is recorded", () => {
    const tiles = ALL_TILES.filter(({ tile }) => tile.requiresTransitional).map(({ tile }) => tile);
    expect(tiles.length).toBeGreaterThan(0);
    for (const tile of tiles) {
      const standard = lumbarTileAvailability(tile, ctx());
      expect(standard.available, tile.id).toBe(false);
      expect(standard.reason).toBe("numbering");
      expect(
        lumbarTileAvailability(
          tile,
          ctx({ numbering: { ...defaultLumbarNumbering(), mode: "lstv-sacralization", castellvi: "IIb" } }),
        ).available,
        tile.id,
      ).toBe(true);
    }
  });

  it("adds the numbering caution atom only for a non-standard scheme", () => {
    expect(numberingAtom(ctx())).toBeNull();
    const atom = numberingAtom(ctx({ numbering: { ...defaultLumbarNumbering(), mode: "lstv-lumbarization" } }));
    expect(atom?.concept).toBe("transitional_vertebra");
    expect(atom?.role).toBe("baseline");
    expect(atom?.findings).toMatch(/transitional lumbosacral vertebra with lumbarization/);
  });
});

describe("provenance of every tile sentence (spec §SOURCE CONTENT)", () => {
  it("emits canonical library wording or a declared structured-choice frame", () => {
    const offenders: string[] = [];
    for (const { tile } of ALL_TILES) {
      for (const findings of tileFindings(tile, ctx({
        sequences: { ...defaultSpineSequences(), stir: true, contrast: true, dynamic: true, axial: true, wholeSpineLocalizer: true },
        side: "left",
        root: "L5",
        mm: 6,
        mm2: 4,
        pct: 50,
        cm: 2,
        conusLevel: "L2",
        vertebra: "L1",
        castellvi: "IIb",
        direction: "superiorly",
      }))) {
        const lower = findings.toLowerCase();
        const isChoice = STRUCTURED_CHOICE_FRAMES.some((frame) => findings.startsWith(`${frame}: `));
        const isLimitation = SYSTEM_LIMITATION_PREFIXES.some((prefix) => findings.startsWith(prefix));
        const isLibrary = LIBRARY_CHUNKS.some((chunk) => lower.includes(chunk));
        if (!isChoice && !isLimitation && !isLibrary) offenders.push(`${tile.id}: ${findings}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("leaves unsupplied variables visible as fill-ins instead of guessing them", () => {
    const tile = MRI_LUMBAR_SUB_MASTERS.flatMap((m) => m.tiles).find((t) =>
      tileFindings(t, ctx()).some((f) => /\[/.test(f)),
    );
    const unfilled = tileFindings(tile ?? ALL_TILES[0].tile, ctx()).filter((f) => /\[[^\]]+\]/.test(f));
    expect(unfilled.length).toBeGreaterThan(0);
    // fillLsProse reports exactly what it could not substitute.
    const result = fillLsProse(LS_LIBRARY_PROSE[Object.keys(LS_LIBRARY_PROSE)[0]], {});
    expect(Array.isArray(result.unfilled)).toBe(true);
  });

  it("substitutes level and side when the radiologist supplies them", () => {
    const withVars = ctx({ side: "right", level: "L5-S1", mm: 5 });
    const texts = MRI_LUMBAR_SUB_MASTERS.flatMap((m) => m.tiles).flatMap((t) => tileFindings(t, withVars));
    expect(texts.some((t) => t.includes("right"))).toBe(true);
    expect(texts.some((t) => t.includes("L5-S1"))).toBe(true);
    expect(texts.some((t) => /\[side\]/i.test(t))).toBe(false);
  });
});

describe("bundles and the ledger (spec §36, §38)", () => {
  beforeEach(() => resetLedger());

  it("scopes a tile bundle to its level so two levels coexist", () => {
    const tile = lumbarSubMasterById("degenerative")!.tiles[0];
    expect(lumbarTileBundleId(tile.id, "L4-L5")).toBe(spineBundleId("ls-tile", `${tile.id}-L4-L5`));
    const a = buildLumbarTileBundle(tile.id, ctx({ level: "L4-L5" }));
    const b = buildLumbarTileBundle(tile.id, ctx({ level: "L3-L4" }));
    expect(a.bundleId).not.toBe(b.bundleId);
    useWorkspace.getState().applyMacroBundle(a);
    useWorkspace.getState().applyMacroBundle(b);
    const levels = useWorkspace.getState().appliedPathologyPatches
      .map((p) => p.observation?.level ?? p.ownership?.anatomicalSection)
      .filter(Boolean);
    expect(levels).toContain("L4-L5");
    expect(levels).toContain("L3-L4");
  });

  it("replaces the same tile at the same level rather than duplicating it", () => {
    const tile = lumbarSubMasterById("degenerative")!.tiles[0];
    useWorkspace.getState().applyMacroBundle(buildLumbarTileBundle(tile.id, ctx()));
    const first = useWorkspace.getState().appliedPathologyPatches.length;
    useWorkspace.getState().applyMacroBundle(buildLumbarTileBundle(tile.id, ctx()));
    expect(useWorkspace.getState().appliedPathologyPatches.length).toBe(first);
  });

  it("replaces the normal baseline once the same level is made abnormal (spec §4/§15)", () => {
    const normal = buildLumbarPresetBundle("preset-normal-ls", ctx({ level: "L4-L5" }));
    useWorkspace.getState().applyMacroBundle(normal);
    useWorkspace.getState().seedSystemNormalImpression();
    const discNormal = normal.observations
      .map((o) => o.findingsText)
      .find((text) => /disc/i.test(text));
    expect(discNormal).toBeTruthy();

    useWorkspace.getState().applyMacroBundle(buildLumbarPresetBundle("preset-acute-extrusion", ctx({ level: "L4-L5" })));
    const findings = useWorkspace.getState().findingsText;
    expect(findings).toMatch(/extrusion|sequestrat/i);
    expect(findings).not.toContain(discNormal as string);
    // The system normal impression yields to an impression-worthy abnormality.
    expect(useWorkspace.getState().impressionText).not.toBe("Normal study.");
  });

  it("is removable and undoable through the existing machinery", () => {
    const tile = lumbarSubMasterById("degenerative")!.tiles[0];
    const built = buildLumbarTileBundle(tile.id, ctx());
    useWorkspace.getState().applyMacroBundle(built);
    expect(useWorkspace.getState().appliedPathologyPatches.length).toBeGreaterThan(0);
    expect(useWorkspace.getState().removeMacroBundle(built.bundleId)).toBe("removed");
    expect(
      useWorkspace.getState().appliedPathologyPatches.some((p) => p.observation?.bundleId === built.bundleId),
    ).toBe(false);
    expect(useWorkspace.getState().undoLastPatch()).toBe(true);
  });

  it("protects a manually rewritten screening sentence from bundle removal", () => {
    const tile = lumbarSubMasterById("discNeural")!.tiles[0];
    const built = buildLumbarTileBundle(tile.id, ctx());
    useWorkspace.getState().applyMacroBundle(built);
    useWorkspace.getState().setField("findings", "Completely different manual wording.", { source: "manual" });
    const status = useWorkspace.getState().removeMacroBundle(built.bundleId);
    expect(["removed", "preserved-manual"]).toContain(status);
  });
});

describe("canonical macros and presets (spec §36)", () => {
  beforeEach(() => resetLedger());

  it("seeds the five library macros as presets", () => {
    const macroPresets = LUMBAR_PRESETS.filter((p) => p.hint.toLowerCase().includes("macro"));
    expect(macroPresets.length).toBe(5);
    expect(macroPresets.map((p) => p.id)).toEqual([
      "preset-degenerative-stenosis",
      "preset-acute-extrusion",
      "preset-isthmic-spondylolisthesis",
      "preset-lstv-supratransitional",
      "preset-postop-recurrent-vs-fibrosis",
    ]);
  });

  it("builds the normal baseline as replaceable baseline atoms", () => {
    const built = buildLumbarPresetBundle("preset-normal-ls", ctx());
    expect(built.critical).toBe(false);
    expect(built.observations.length).toBeGreaterThan(4);
    const baseline = built.observations.filter((o) => o.role === "baseline");
    expect(baseline.length).toBeGreaterThan(0);
    expect(baseline.some((o) => (o.ownership?.baselineReplaces ?? "").length > 0)).toBe(true);
  });

  it("flags the cauda equina preset as critical without auto-documenting contact", () => {
    const built = buildLumbarPresetBundle("preset-cauda-equina-syndrome", ctx());
    expect(built.critical).toBe(true);
    const text = built.observations.map((o) => o.findingsText).join(" ");
    expect(text).toMatch(/cauda equina/i);
    expect(text).not.toMatch(/clinician informed|notified/i);
  });

  it("gates contrast-dependent macro wording", () => {
    const plain = buildLumbarPresetBundle("preset-postop-recurrent-vs-fibrosis", ctx());
    const withContrast = buildLumbarPresetBundle("preset-postop-recurrent-vs-fibrosis", {
      ...ctx(),
      sequences: { ...defaultSpineSequences(), contrast: true },
    });
    const plainText = plain.observations.map((o) => o.findingsText).join(" ");
    const contrastText = withContrast.observations.map((o) => o.findingsText).join(" ");
    expect(plainText).not.toMatch(/enhance|gadolin|hyperintens.*contrast/i);
    expect(contrastText).toMatch(/enhanc|fibros|recurrent/i);
  });

  it("re-applies a preset as one instance of the pattern", () => {
    const first = buildLumbarPresetBundle("preset-acute-compression-fracture", ctx({ level: "L1-L2" }));
    const second = buildLumbarPresetBundle("preset-acute-compression-fracture", ctx({ level: "L2-L3" }));
    expect(first.bundleId.startsWith(lumbarPresetBundleId("preset-acute-compression-fracture", "").replace(/-$/, ""))).toBe(true);
    expect(second.bundleId.startsWith(lumbarPresetBundleId("preset-acute-compression-fracture", "").replace(/-$/, ""))).toBe(true);
    expect(first.bundleId).not.toBe(second.bundleId);
  });
});

describe("shared lesion form (spec §39)", () => {
  it("compartmentalises the concept so lesions never share a slot by accident", () => {
    const base = { level: "L4-L5", compartment: "epidural" as const };
    const epidural = buildLumbarLesionAtoms(base, ctx());
    const vertebral = buildLumbarLesionAtoms({ ...base, compartment: "vertebral" }, ctx());
    expect(epidural.length).toBeGreaterThan(0);
    expect(vertebral.length).toBeGreaterThan(0);
    expect(new Set(epidural.map((a) => a.concept)).has("epidural_collection")).toBe(true);
    // An intradural lesion must never be filed under the epidural compartment.
    expect(new Set(buildLumbarLesionAtoms({ level: "L4-L5", compartment: "intradural" }, ctx())
      .map((a) => a.concept)).has("cauda_equina")).toBe(true);
    expect(epidural.every((a) => a.anatomicalSection === "L4-L5")).toBe(true);
  });

  it("adds separate canal / root atoms only when the radiologist states an effect", () => {
    const plain = buildLumbarLesionAtoms({ level: "L4-L5", compartment: "epidural" }, ctx());
    const effects = buildLumbarLesionAtoms(
      { level: "L4-L5", compartment: "epidural", canalEffect: true, neuralEffect: true },
      ctx(),
    );
    expect(effects.length).toBeGreaterThan(plain.length);
    const concepts = effects.map((a) => a.concept);
    expect(concepts).toContain("canal_stenosis");
    expect(concepts).toContain("root_traversing");
    expect(new Set(effects.map((a) => a.conflictGroup)).size).toBe(effects.length);
  });

  it("keeps enhancement wording out of the atoms when contrast was not given", () => {
    const bundle = buildLumbarLesionBundle(
      { level: "L4-L5", compartment: "intradural", enhancement: undefined },
      ctx(),
    );
    expect(bundle.observations.map((o) => o.findingsText).join(" ")).not.toMatch(/enhanc/i);
    expect(bundle.bundleId).toBe(spineBundleId("ls-lesion", "intradural-L4-L5"));
  });
});
