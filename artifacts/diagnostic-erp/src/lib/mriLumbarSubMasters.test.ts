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

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
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
  lumbarPresetAvailability,
  lumbarPresetById,
  lumbarSubMasterById,
  lumbarTileAvailability,
  lumbarTileBundleId,
  numberingAtom,
  type LumbarTile,
  type LumbarTileContext,
} from "@/lib/mriLumbarSubMasters";
import { LS_LIBRARY_PROSE, fillLsProse } from "@/lib/mriLumbarLibrary";
import { defaultLumbarNumbering, lumbarApCanalLevels, lumbarLevelKeyStrings, lumbarRootSuggestion, numberingCautionSentence, type LumbarNumberingState } from "@/lib/mriSpineNumbering";
import { defaultSpineSequences } from "@/lib/mriSpineSequences";
import { availableScreeningLevels } from "@/lib/mriSpineScreening";
import { SCREENING_SCHEMAS } from "@/lib/mriSpineScreeningSchemas";
import { spineBundleId } from "@/lib/mriSpineAtoms";
import { useWorkspace } from "@/lib/zai-workspace/store";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = resolve(HERE, "../..");

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

  /**
   * Both foraminal sentences were written for one side — "Severe LEFT neural
   * foraminal stenosis…" and "Severe RIGHT … complete loss of perineural fat" —
   * so a right foramen was reported as a left one and a left as a right. The side
   * is now the radiologist's, and the exiting root follows the selected level
   * through the resolver that already knew it (L4 at L4-L5, L5 at L5-S1).
   */
  it("reports a foraminal stenosis on the side that was selected", () => {
    const text = (tileId: string, level: string, side: "right" | "left") =>
      buildLumbarTileBundle(tileId, ctx({ level, side }))
        .observations.map((o) => o.findingsText ?? "")
        .join(" ");

    expect(text("dn-fat-loss", "L4-L5", "right")).toContain("Severe right neural foraminal stenosis at L4-L5");
    expect(text("dn-fat-loss", "L4-L5", "left")).toContain("Severe left neural foraminal stenosis at L4-L5");
    expect(text("dn-fat-loss", "L4-L5", "left")).toContain("exiting left L4 nerve root");

    expect(text("dn-exiting-root", "L5-S1", "left")).toContain("Severe left neural foraminal stenosis at L5-S1");
    expect(text("dn-exiting-root", "L5-S1", "right")).toContain("Severe right neural foraminal stenosis at L5-S1");
    expect(text("dn-exiting-root", "L5-S1", "right")).toContain("exiting right L5 nerve root");

    // A different level gets a different root: the letter is derived, never copied
    // from the reference report.
    expect(text("dn-exiting-root", "L3-L4", "right")).toContain("at L3-L4");
    expect(text("dn-exiting-root", "L3-L4", "right")).toContain("exiting right L3 nerve root");
  });

  it("refuses a foraminal tile until the side is chosen", () => {
    const withStir = ctx({ sequences: { ...defaultSpineSequences(), stir: true } });
    for (const [tileId, base] of [
      ["dn-fat-loss", ctx()],
      ["dn-exiting-root", ctx()],
      ["si-sacroiliitis", withStir],
    ] as const) {
      const tile = ALL_TILES.find((t) => t.tile.id === tileId)!.tile;
      expect(lumbarTileAvailability(tile, base).available, tileId).toBe(false);
      expect(lumbarTileAvailability(tile, base).notice, tileId).toMatch(/side/i);
      for (const side of ["right", "left", "bilateral"] as const) {
        expect(lumbarTileAvailability(tile, { ...base, side }).available, `${tileId} ${side}`).toBe(true);
      }
    }
  });

describe("sequence / numbering gating (spec §35)", () => {
  it("offers STIR-dependent tiles only when a fluid-sensitive sequence exists", () => {
    const tiles = ALL_TILES.filter(({ tile }) => tile.requires?.includes("stir")).map(({ tile }) => tile);
    expect(tiles.length).toBeGreaterThan(0);
    for (const tile of tiles) {
      expect(lumbarTileAvailability(tile, ctx()).available, tile.id).toBe(false);
      expect(lumbarTileAvailability(tile, ctx()).missing).toContain("stir");
      expect(
        lumbarTileAvailability(tile, ctx({ sequences: { ...defaultSpineSequences(), stir: true }, side: "bilateral" })).available,
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

    useWorkspace.getState().applyMacroBundle(buildLumbarPresetBundle("preset-acute-extrusion", ctx({ level: "L4-L5", side: "left" })));
    const findings = useWorkspace.getState().findingsText;
    expect(findings).toMatch(/extrusion|sequestrat/i);
    // Left, because that is what was chosen. This preset printed "right" whatever
    // was clicked, and a preset that names a side now refuses until one is stated.
    expect(findings).toMatch(/on the left/);
    expect(findings).not.toMatch(/\bright\b/i);
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
    // A side is supplied because the post-op macro names one; without it the preset
    // refuses to write at all (see the side gate below), which would test nothing.
    const plain = buildLumbarPresetBundle("preset-postop-recurrent-vs-fibrosis", ctx({ side: "right" }));
    const withContrast = buildLumbarPresetBundle("preset-postop-recurrent-vs-fibrosis", {
      ...ctx({ side: "right" }),
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

describe("lumbar macro presets ask for the side they name (owner ruling 2026-10-26)", () => {
  const MACRO_PRESETS = [
    "preset-degenerative-stenosis",
    "preset-acute-extrusion",
    "preset-isthmic-spondylolisthesis",
    "preset-lstv-supratransitional",
    "preset-postop-recurrent-vs-fibrosis",
  ];

  // The LSTV macro's sentence names a Castellvi grade, which lives in the numbering
  // control. Every other macro answers from the level/side fields alone.
  const macroCtxFor = (id: string) =>
    id === "preset-lstv-supratransitional"
      ? { numbering: { ...defaultLumbarNumbering(), mode: "lstv-sacralization" as const, castellvi: "IIa" } }
      : {};

  const textOf = (id: string, overrides: Parameters<typeof ctx>[0] = {}) =>
    buildLumbarPresetBundle(id, ctx(overrides))
      .observations.map((o) => `${o.findingsText} ${o.impressionText ?? ""}`)
      .join(" ");

  it("refuses while the side select is empty, in the builder not only the panel", () => {
    for (const id of MACRO_PRESETS) {
      const preset = lumbarPresetById(id)!;
      expect(lumbarPresetAvailability(preset, ctx()).available, id).toBe(false);
      expect(buildLumbarPresetBundle(id, ctx()).observations, id).toEqual([]);
    }
  });

  it("prints the side that was chosen and not the one the reference report used", () => {
    for (const id of MACRO_PRESETS) {
      for (const side of ["right", "left"] as const) {
        const text = textOf(id, { side, ...macroCtxFor(id) });
        expect(text.length, id).toBeGreaterThan(0);
        expect(text, `${id} @ ${side}`).toMatch(new RegExp(`\\b${side}\\b`, "i"));
        const other = side === "right" ? "left" : "right";
        expect(text, `${id} @ ${side}`).not.toMatch(new RegExp(`\\b${other}\\b`, "i"));
      }
    }
  });

  it("refuses the LSTV macro until the Castellvi grade the sentence names is recorded", () => {
    // "Castellvi Type [I/II/III/IV]" used to print the bracket: the grade was never
    // read from the numbering control, and nothing checked the engine's own answer.
    expect(lumbarPresetAvailability(lumbarPresetById("preset-lstv-supratransitional")!, ctx({ side: "left" })).available).toBe(false);
    const recorded = ctx({ side: "left", numbering: { ...defaultLumbarNumbering(), mode: "lstv-sacralization", castellvi: "IIa" } });
    expect(lumbarPresetAvailability(lumbarPresetById("preset-lstv-supratransitional")!, recorded).available).toBe(true);
    const text = textOf("preset-lstv-supratransitional", { side: "left", numbering: recorded.numbering });
    expect(text).toContain("Castellvi Type IIa");
    expect(text).not.toMatch(/\[I\/II\/III\/IV\]/);
  });

  it("keeps the macro's own levels, which one panel level cannot answer", () => {
    const text = textOf("preset-degenerative-stenosis", { level: "L2-L3", side: "left" });
    expect(text).toContain("L4-L5 and L5-S1");
    expect(text).not.toMatch(/\[[LT\d]/);
  });

  it("derives the recess root from the level instead of baking S1 into an L3-L4 row", () => {
    const atL5S1 = buildLumbarPresetBundle("preset-acute-extrusion", ctx({ level: "L5-S1", side: "right" }))
      .observations.find((o) => /root compression/i.test(o.findingsText ?? ""));
    expect(atL5S1?.findingsText).toMatch(/S1/);

    const atL3L4 = buildLumbarPresetBundle("preset-acute-extrusion", ctx({ level: "L3-L4", side: "right" }))
      .observations.find((o) => /root compression/i.test(o.findingsText ?? ""));
    expect(atL3L4?.findingsText).toMatch(/at L3-L4/);
    expect(atL3L4?.findingsText).not.toMatch(/S1/);
    // The slot used to say L5-S1 while the sentence said the chosen level.
    expect(atL3L4?.level).toBe("L3-L4");
  });
});

describe("architecture guards (spec §43 binding tests)", () => {
  it("keeps hard-coded lumbar level arrays out of the UI layer", () => {
    const uiFiles = [
      "src/components/radiology/reporting-canvas/MriLumbarSubMasterPanel.tsx",
      "src/components/radiology/reporting-canvas/SpineScreeningPanel.tsx",
      "src/components/radiology/reporting-canvas/SpineApCanalMeasurements.tsx",
      "src/hooks/radiology-workspace/useWorkspaceClinicalUi.tsx",
    ];
    for (const rel of uiFiles) {
      const src = readFileSync(resolve(PKG_DIR, rel), "utf8");
      expect(src, `${rel} must read levels from the resolver`).not.toMatch(/"L1-L2"\s*,\s*"L2-L3"/);
      expect(src, `${rel} must not enumerate lumbar levels`).not.toMatch(/"L5-S1"\s*[\])]$/m);
    }
  });

  it("remaps every consumer at once when transitional anatomy is recorded", () => {
    const lstv: LumbarNumberingState = {
      ...defaultLumbarNumbering(),
      mode: "lstv-sacralization",
      castellvi: "IIIb",
      side: "bilateral",
    };
    const keys = lumbarLevelKeyStrings(lstv);
    expect(keys).toEqual(["L1-L2", "L2-L3", "L3-L4", "L4-L5", "L5-T"]);
    // Level rows, the AP table and LS screening all read the same array.
    expect(lumbarApCanalLevels(lstv)).toEqual(keys);
    const resolverOption = SCREENING_SCHEMAS.ls.sections
      .flatMap((s) => s.options)
      .find((o) => o.levelChoices === "lumbar-resolver");
    expect(resolverOption).toBeDefined();
    expect(availableScreeningLevels(resolverOption!, SCREENING_SCHEMAS.ls, lstv)).toEqual(keys);
    // Root assistance follows the transitional key instead of assuming L5-S1.
    expect(lumbarRootSuggestion("L5-T", lstv).uncertain).toBe(true);
    expect(numberingCautionSentence(lstv)).toMatch(/lowest mobile segment/);
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
