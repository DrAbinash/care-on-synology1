/**
 * mriDorsoLumbarSubMasters.test.ts — the fourteen Dorso-Lumbar palettes are
 * palettes over ONE report state, gated by coverage, domain and sequences
 * (dorso-lumbar spec §3, §4, §8–§22, §30).
 *
 * The tests exist because the failure mode of this module is silent: a palette
 * copied from the dorsal and lumbar files would look complete, and would then
 * let a report call the conus "thoracic cord", offer a lateral recess at T8, or
 * describe a normal upper thoracic spine on a study that never covered it.
 */

import { describe, expect, it } from "vitest";

import {
  DORSOLUMBAR_PRESETS,
  DORSOLUMBAR_SUBMASTER_IDS,
  MRI_DORSOLUMBAR_SUB_MASTERS,
  allDorsoLumbarTileIds,
  buildDorsoLumbarLesionAtoms,
  buildDorsoLumbarPresetBundle,
  buildDorsoLumbarTileBundle,
  dorsoLumbarPaletteAvailability,
  dorsoLumbarPresetById,
  dorsoLumbarSubMasterById,
  dorsoLumbarTileAvailability,
  dorsoLumbarTileBundleId,
  dorsoLumbarTileById,
  withDorsoLumbarBaselineContract,
  DL_NORMAL_BY_CONCEPT,
  type DorsoLumbarTileContext,
} from "@/lib/mriDorsoLumbarSubMasters";
import { DL_ALIGN, DL_BONE, DL_CANAL, DL_MACROS, DL_JUNCTION } from "@/lib/mriDorsoLumbarLibrary";
import {
  JUNCTION_LEDGER_REGION,
  JUNCTION_LEVEL,
  defaultDorsoLumbarState,
} from "@/lib/mriDorsoLumbarCoverage";
import { defaultLumbarNumbering } from "@/lib/mriSpineNumbering";
import { defaultSpineSequences, type SpineSequencesAvailable } from "@/lib/mriSpineSequences";
import { buildCanonicalObservation } from "@/lib/observationSlot";

function seq(over: Partial<SpineSequencesAvailable> = {}): SpineSequencesAvailable {
  return { ...defaultSpineSequences(), t1: true, t2: true, stir: true, axial: true, ...over };
}

function ctx(over: Partial<DorsoLumbarTileContext> = {}): DorsoLumbarTileContext {
  const state = over.state ?? defaultDorsoLumbarState({ superior: "T8-T9", inferior: "L5-S1" });
  const level = over.level ?? "";
  const domain = level
    ? ({ "T8-T9": "thoracic", "T11-T12": "thoracic", "T12-L1": "junction", "L1-T12": "junction", "L3-L4": "lumbar", "L5-S1": "lumbar" } as const)[level as "T8-T9"] ?? ""
    : "";
  return {
    level,
    state,
    sequences: seq(),
    domain: domain as DorsoLumbarTileContext["domain"],
    ...over,
  };
}

const ALL_TILES = MRI_DORSOLUMBAR_SUB_MASTERS.flatMap((sub) => sub.tiles.map((tile) => ({ sub, tile })));

describe("palette shape (spec §3)", () => {
  it("has the fourteen palettes of the specification, in order", () => {
    expect(DORSOLUMBAR_SUBMASTER_IDS).toEqual([
      "routine",
      "degenerative",
      "canalNeural",
      "junction",
      "ossification",
      "trauma",
      "infection",
      "tumorMarrow",
      "intradural",
      "vascular",
      "postop",
      "deformity",
      "congenital",
      "advanced",
    ]);
    expect(MRI_DORSOLUMBAR_SUB_MASTERS.map((s) => s.id)).toEqual([...DORSOLUMBAR_SUBMASTER_IDS]);
    expect(dorsoLumbarSubMasterById("junction")?.label).toBe("Thoracolumbar Junction / Conus");
  });

  it("gives every tile a unique id, a label and a group", () => {
    const ids = allDorsoLumbarTileIds();
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(100);
    for (const { tile } of ALL_TILES) {
      expect(tile.id, tile.id).toMatch(/^dl[a-z]{1,3}-[a-z0-9-]+$/);
      expect(tile.label.length).toBeGreaterThan(3);
      expect(tile.group.length).toBeGreaterThan(0);
      expect(typeof tile.atoms).toBe("function");
    }
  });

  it("indexes every tile back to its own palette", () => {
    for (const { sub, tile } of ALL_TILES) {
      expect(dorsoLumbarTileById(tile.id)?.subMaster, tile.id).toBe(sub.id);
    }
    expect(dorsoLumbarTileById("dl-nope")).toBeNull();
  });

  it("never invents a concept the ledger cannot resolve", () => {
    // A tile whose concept is unknown to the canon would land in the ledger with
    // conceptSource "none" — prose that no validator, baseline or impression rule
    // can ever see. Every atom of every palette is therefore checked against the
    // real slot builder.
    const offenders: string[] = [];
    for (const { tile } of ALL_TILES) {
      for (const level of ["T8-T9", JUNCTION_LEVEL, "L3-L4"]) {
        const gate = dorsoLumbarTileAvailability(tile, ctx({ level }));
        if (!gate.available) continue;
        for (const atom of tile.atoms(ctx({ level }))) {
          const obs = buildCanonicalObservation({
            id: `${tile.id}-${level}`,
            region: "Dorsal Spine",
            concept: atom.concept,
            level: atom.level ?? level,
            findingsText: atom.findings,
          } as never);
          if (obs.conceptSource === "none") offenders.push(`${tile.id}: ${atom.concept}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("domain gating (spec §11, §12, §14, §15)", () => {
  it("refuses lumbar vocabulary at a thoracic level", () => {
    for (const id of ["dln-recess-left", "dln-cauda-crowding", "dla-pars", "dlg-facet-flavum", "dld-cauda-lesion"]) {
      const found = dorsoLumbarTileById(id)!;
      const gate = dorsoLumbarTileAvailability(found.tile, ctx({ level: "T8-T9" }));
      expect(gate.available, id).toBe(false);
      expect(gate.reason, id).toBe("domain");
      expect(gate.notice, id).toMatch(/thoracic anatomy at T8-T9/);
    }
  });

  it("refuses cord and costovertebral vocabulary at a lumbar level", () => {
    for (const id of ["dln-neural-flattening", "dln-myelomalacia", "dld-intramedullary", "dla-costovertebral", "dldf-hyperkyphosis"]) {
      const found = dorsoLumbarTileById(id)!;
      const gate = dorsoLumbarTileAvailability(found.tile, ctx({ level: "L3-L4" }));
      expect(gate.available, id).toBe(false);
      expect(gate.reason, id).toBe("domain");
    }
  });

  it("keeps the pars workflow out of thoracic levels even though it is a posterior element", () => {
    const pars = dorsoLumbarTileById("dla-pars")!;
    expect(pars.tile.domains).toEqual(["lumbar"]);
    expect(dorsoLumbarTileAvailability(pars.tile, ctx({ level: "T10-T11" })).available).toBe(false);
    expect(dorsoLumbarTileAvailability(pars.tile, ctx({ level: "L4-L5" })).available).toBe(true);
  });

  it("names the neural element from the level, not from the palette", () => {
    const compression = dorsoLumbarTileById("dln-neural-compression")!;
    const atCord = compression.tile.atoms(ctx({ level: "T8-T9" }))[0]!.findings;
    const atConus = compression.tile.atoms(ctx({ level: JUNCTION_LEVEL }))[0]!.findings;
    const atCauda = compression.tile.atoms(ctx({ level: "L3-L4" }))[0]!.findings;
    expect(atCord).toMatch(/Spinal cord: cord compression at T8-T9/);
    expect(atConus).toMatch(/Conus medullaris: conus compression at T12-L1/);
    expect(atCauda).toMatch(/Cauda equina: cauda compression at L3-L4/);
    // and the library's rule in prose: a conus finding is never called a cord finding
    expect(atConus).not.toMatch(/thoracic spinal cord/);
  });
});

describe("coverage gating (spec §4)", () => {
  it("refuses conus statements when the coverage stops above the junction", () => {
    const above = defaultDorsoLumbarState({ superior: "T6-T7", inferior: "T11-T12" });
    for (const id of ["dlj-conus-level", "dlj-conus-caliber-signal", "dln-conus-compression", "dlc-low-conus"]) {
      const found = dorsoLumbarTileById(id)!;
      const gate = dorsoLumbarTileAvailability(found.tile, ctx({ level: JUNCTION_LEVEL, state: above }));
      expect(gate.available, id).toBe(false);
      expect(gate.reason, id).toBe("coverage");
    }
  });

  it("refuses cauda statements when no lumbar segment was covered", () => {
    const thoracicOnly = defaultDorsoLumbarState({ superior: "T4-T5", inferior: "T11-T12" });
    const gate = dorsoLumbarTileAvailability(dorsoLumbarTileById("dln-cauda-crowding")!.tile,
      ctx({ level: "T10-T11", state: thoracicOnly }));
    // refused on domain first (a thoracic level is not lumbar anatomy)…
    expect(gate.available).toBe(false);
    // …and on coverage when a lumbar level is somehow asked for.
    const lumbarAsked = dorsoLumbarTileAvailability(dorsoLumbarTileById("dln-cauda-crowding")!.tile,
      ctx({ level: "L2-L3", state: thoracicOnly }));
    expect(lumbarAsked.available).toBe(false);
    expect(lumbarAsked.reason).toBe("coverage");
  });

  it("will not describe a level the examination never showed", () => {
    const short = defaultDorsoLumbarState({ superior: "T10-T11", inferior: "L2-L3" });
    const tile = dorsoLumbarTileById("dlg-disc-bulge")!.tile;
    const gate = dorsoLumbarTileAvailability(tile, ctx({ level: "L5-S1", state: short }));
    expect(gate.available).toBe(false);
    expect(gate.notice).toMatch(/L5-S1 is outside the acquired coverage/);
  });

  it("offers no normal upper-thoracic statement on a lower thoracic study", () => {
    const lower = defaultDorsoLumbarState({ superior: "T10-T11", inferior: "L5-S1" });
    const options = dorsoLumbarPaletteAvailability("routine", ctx({ level: "T10-T11", state: lower }));
    const cordTile = options.find((o) => o.tile.id === "dlr-cord-normal")!;
    // the cord sentence is offered only because the cord IS covered here; on a
    // lumbar-only study it is not.
    expect(cordTile.gate.available).toBe(true);
    const lumbarOnly = defaultDorsoLumbarState({ superior: "L1-L2", inferior: "L5-S1" });
    const denied = dorsoLumbarPaletteAvailability("routine", ctx({ level: "", state: lumbarOnly }))
      .find((o) => o.tile.id === "dlr-cord-normal")!;
    expect(denied.gate.available).toBe(false);
    expect(denied.gate.notice).toMatch(/No thoracic segment was covered/);
  });
});

describe("sequence gating (spec §22)", () => {
  it("refuses enhancement wording without contrast", () => {
    const noContrast = ctx({ level: "T11-T12", sequences: seq({ contrast: false }) });
    for (const id of ["dli-enhancement", "dltm-enhancement"]) {
      const gate = dorsoLumbarTileAvailability(dorsoLumbarTileById(id)!.tile, noContrast);
      expect(gate.available, id).toBe(false);
      expect(gate.reason, id).toBe("sequence");
      expect(gate.notice, id).toMatch(/Requires contrast/);
    }
  });

  it("refuses dynamic listhesis without dynamic imaging, and STIR edema without STIR", () => {
    const plain = ctx({ level: "L4-L5", sequences: seq({ dynamic: false, stir: false }) });
    expect(dorsoLumbarTileAvailability(dorsoLumbarTileById("dldf-dynamic-listhesis")!.tile, plain).available).toBe(false);
    expect(dorsoLumbarTileAvailability(dorsoLumbarTileById("dlt-marrow-edema")!.tile, plain).available).toBe(false);
  });

  it("refuses a statement that needs an extent the radiologist has not given", () => {
    const noExtent = ctx({ level: "T11-T12" });
    const tile = dorsoLumbarTileById("dldf-spanning-junction")!.tile;
    const gate = dorsoLumbarTileAvailability(tile, noExtent);
    expect(gate.available).toBe(false);
    expect(gate.reason).toBe("extent");
    expect(dorsoLumbarTileAvailability(tile, { ...noExtent, level2: "L1-L2" }).available).toBe(true);
  });

  it("refuses transitional-anatomy tiles when the numbering says standard", () => {
    const standard = ctx({ level: "L5-S1" });
    expect(dorsoLumbarTileAvailability(dorsoLumbarTileById("dlc-lstv")!.tile, standard).available).toBe(false);
    // Sacralization replaces L5-S1 with the transitional segment, so the tile is
    // offered at the level the resolver actually owns.
    const lstv = ctx({
      level: "L5-T",
      state: defaultDorsoLumbarState({
        inferior: "L5-T",
        lumbar: { ...defaultLumbarNumbering(), mode: "lstv-sacralization", castellvi: "IIa", side: "unilateral" },
      }),
    });
    const gate = dorsoLumbarTileAvailability(dorsoLumbarTileById("dlc-lstv")!.tile, lstv);
    expect(gate.available).toBe(true);
    const atoms = dorsoLumbarTileById("dlc-lstv")!.tile.atoms(lstv);
    expect(atoms[0]!.findings).toMatch(/lumbosacral transitional vertebra/i);
  });

  it("refuses to compile a tile that the gate has struck through", () => {
    const built = buildDorsoLumbarTileBundle("dli-enhancement", ctx({ level: "T11-T12", sequences: seq({ contrast: false }) }));
    expect(built.observations).toEqual([]);
    expect(built.notice).toMatch(/Requires contrast/);
  });
});

describe("one ledger, canonical junction (spec §6, §8)", () => {
  it("stamps a bridge tile into the canonical junction region", () => {
    for (const spelling of [JUNCTION_LEVEL, "L1-T12", "D12-L1"]) {
      const built = buildDorsoLumbarTileBundle("dlj-fracture", ctx({ level: spelling }));
      expect(built.notice, spelling).toBeNull();
      expect(built.observations.length, spelling).toBeGreaterThan(0);
      expect(built.bundleId, spelling).toBe(dorsoLumbarTileBundleId("dlj-fracture", JUNCTION_LEVEL));
      for (const patch of built.observations) {
        expect(patch.region, spelling).toBe(JUNCTION_LEDGER_REGION);
        expect(patch.level ?? JUNCTION_LEVEL, spelling).toBe(JUNCTION_LEVEL);
      }
    }
  });

  it("keeps a lumbar tile in the lumbar ledger region", () => {
    const built = buildDorsoLumbarTileBundle("dlg-facet-flavum", ctx({ level: "L4-L5" }));
    expect(built.observations.every((p) => p.region === "LS Spine")).toBe(true);
  });

  it("lets a study-wide tile inherit the reporting region rather than claiming one", () => {
    const built = buildDorsoLumbarTileBundle("dlr-alignment-normal", ctx({ level: "" }));
    expect(built.observations.every((p) => (p.region ?? "") === "")).toBe(true);
  });

  it("supersedes the matching normal statement when the abnormal one is applied", () => {
    const atoms = dorsoLumbarTileById("dln-canal-severe")!.tile.atoms(ctx({ level: "T9-T10" }));
    const [contracted] = withDorsoLumbarBaselineContract(atoms);
    expect(contracted!.baselineReplaces).toBe(DL_CANAL.noCanalCompromise);
    expect(contracted!.findings).not.toContain(DL_CANAL.noCanalCompromise);
    // normal atoms are themselves baselines, so they never displace each other
    const normal = dorsoLumbarTileById("dlr-canal-normal")!.tile.atoms(ctx({ level: "T9-T10" }));
    expect(normal[0]!.role).toBe("baseline");
    expect(withDorsoLumbarBaselineContract(normal)[0]!.baselineReplaces).toBeUndefined();
  });

  it("only lists normal statements that exist in the library", () => {
    const allowed = new Set([DL_ALIGN.normal, DL_ALIGN.curvesPreserved, DL_BONE.normal, DL_BONE.noFracture,
      DL_CANAL.cordNormal, DL_CANAL.noCanalCompromise, DL_JUNCTION.conusNormal]);
    for (const sentence of Object.values(DL_NORMAL_BY_CONCEPT)) {
      expect(allowed.has(sentence), sentence).toBe(true);
    }
  });
});

describe("starting presets (spec §8, §17, §18)", () => {
  it("normal baseline earns every neural sentence from coverage", () => {
    const full = buildDorsoLumbarPresetBundle("preset-normal-dorsolumbar", ctx({ state: defaultDorsoLumbarState({ superior: "T8-T9", inferior: "L5-S1" }) }));
    const texts = full.observations.map((o) => o.findingsText);
    expect(texts.some((t) => t.includes(DL_CANAL.cordNormal))).toBe(true);
    expect(texts.some((t) => t.includes(DL_JUNCTION.conusNormal))).toBe(true);

    // Coverage that stops below the conus: no cord sentence, no conus sentence.
    const lumbarOnly = buildDorsoLumbarPresetBundle("preset-normal-dorsolumbar",
      ctx({ state: defaultDorsoLumbarState({ superior: "L2-L3", inferior: "L5-S1" }) }));
    const lumbarTexts = lumbarOnly.observations.map((o) => o.findingsText);
    expect(lumbarTexts.some((t) => t.includes(DL_CANAL.cordNormal))).toBe(false);
    expect(lumbarTexts.some((t) => t.includes(DL_JUNCTION.conusNormal))).toBe(false);
    // and NOT two concatenated reports: one alignment line, one marrow line.
    expect(lumbarTexts.filter((t) => t.includes(DL_ALIGN.normal))).toHaveLength(1);
    expect(lumbarTexts.filter((t) => t.includes(DL_BONE.normal))).toHaveLength(1);
    // The library has no normal cauda sentence, so the baseline invents none.
    for (const text of [...texts, ...lumbarTexts]) {
      expect(text).not.toMatch(/cauda equina .*unremarkable/i);
    }
    // Every normal line is a library line, not software prose.
    const libraryLines = new Set([
      DL_ALIGN.normal, DL_ALIGN.curvesPreserved, DL_BONE.normal, DL_BONE.noFracture,
      DL_CANAL.cordNormal, DL_CANAL.noCanalCompromise, DL_JUNCTION.conusNormal,
    ]);
    for (const o of full.observations) {
      if (o.concept === "screening_limitation") continue;
      expect(libraryLines.has(o.findingsText), o.findingsText).toBe(true);
    }
  });

  it("refuses the junction presets when the bridge was not covered", () => {
    const above = ctx({ level: JUNCTION_LEVEL, state: defaultDorsoLumbarState({ superior: "T6-T7", inferior: "T11-T12" }) });
    for (const id of ["preset-thoracolumbar-burst", "preset-junction-spondylodiscitis"]) {
      const built = buildDorsoLumbarPresetBundle(id, above);
      expect(built.observations, id).toEqual([]);
      expect(built.notice, id).toMatch(/does not reach the thoracolumbar junction/);
    }
  });

  it("keeps the burst preset on the canonical library wording", () => {
    const built = buildDorsoLumbarPresetBundle("preset-thoracolumbar-burst",
      ctx({ level: JUNCTION_LEVEL, mm: 4, pct: 55, slotValues: { "present/suspected/not identified": "present", "cord/conus": "conus" } }));
    expect(built.critical).toBe(true);
    const fracture = built.observations.find((o) => o.concept === "compression_fracture" && o.findingsText)!;
    expect(fracture.findingsText).toContain("Focal kyphotic angulation at the thoracolumbar junction.");
    expect(fracture.findingsText).toContain("approximately 55% height loss");
    expect(fracture.region).toBe(JUNCTION_LEDGER_REGION);
    // The numbered summary is an Impression contribution, never Findings prose.
    const summary = built.observations.find((o) => o.sectionsOwned?.includes("impression") && !o.findingsText);
    expect(summary?.incoming.impression).toMatch(/^1\. Acute burst fracture/);
    expect(summary?.findingsText).toBe("");
    expect(built.observations.filter((o) => o.concept === "compression_fracture" && o.findingsText)).toHaveLength(1);
  });

  it("records a junction-crossing infection as ONE pathology object", () => {
    const built = buildDorsoLumbarPresetBundle("preset-junction-spondylodiscitis",
      ctx({ level: JUNCTION_LEVEL, level2: "L2-L3" }));
    const lesion = built.observations.filter((o) => o.concept === "spondylodiscitis" && o.findingsText);
    expect(lesion).toHaveLength(1);
    expect(lesion[0]!.findingsText).toContain(DL_MACROS.junctionSpondylodiscitis.findings.slice(0, 40));
    expect(lesion[0]!.findingsText).toMatch(/involve T12-L1 and L2-L3/);
    expect(lesion[0]!.findingsText).toMatch(/extends from T12-L1 to L2-L3/);
    // every atom of the lesion sits in the one canonical junction region
    expect(new Set(built.observations.map((o) => o.region))).toEqual(new Set([JUNCTION_LEDGER_REGION]));
    expect(built.critical).toBe(true);
    // etiology is never generated from the collection alone
    const summary = built.observations.find((o) => o.sectionsOwned?.includes("impression") && !o.findingsText);
    expect(summary?.incoming.impression).toMatch(/Tuberculous etiology .*radiologist-selected/);
  });

  it("has a preset for each of the three library starting patterns", () => {
    expect(DORSOLUMBAR_PRESETS.map((p) => p.id)).toEqual([
      "preset-normal-dorsolumbar",
      "preset-thoracolumbar-burst",
      "preset-junction-spondylodiscitis",
    ]);
    expect(dorsoLumbarPresetById("preset-normal-dorsolumbar")?.critical).toBeUndefined();
  });
});

describe("shared lesion form (spec §10, §18, §19)", () => {
  it("writes one lesion for a span that crosses the junction", () => {
    const atoms = buildDorsoLumbarLesionAtoms({
      compartment: "vertebral",
      level: "T12-L1",
      level2: "L2-L3",
      extensionToJunction: true,
      cmCraniocaudal: 4.5,
      canalEffect: true,
      neuralEffect: true,
    }, ctx({ level: "T12-L1" }));
    const lesion = atoms.filter((x) => x.concept === "bone_lesion");
    expect(lesion).toHaveLength(1);
    expect(lesion[0]!.findings).toMatch(/from T12-L1 to L2-L3, crossing the thoracolumbar junction/);
    expect(lesion[0]!.findings).toContain("4.5 cm craniocaudal");
    // the neural element named at the bridge is the conus, never the cord
    expect(atoms.some((x) => /conus/i.test(x.findings) && !/thoracic spinal cord/i.test(x.findings))).toBe(true);
  });

  it("names cord, conus or cauda according to where the lesion is", () => {
    const atCord = buildDorsoLumbarLesionAtoms({ compartment: "epidural", level: "T7-T8", neuralEffect: true }, ctx({ level: "T7-T8" }));
    const atConus = buildDorsoLumbarLesionAtoms({ compartment: "epidural", level: JUNCTION_LEVEL, neuralEffect: true }, ctx({ level: JUNCTION_LEVEL }));
    const atCauda = buildDorsoLumbarLesionAtoms({ compartment: "epidural", level: "L3-L4", neuralEffect: true }, ctx({ level: "L3-L4" }));
    expect(atCord.at(-1)!.concept).toBe("cord_compression");
    expect(atCord.at(-1)!.findings).toMatch(/Spinal cord: cord effect/);
    expect(atConus.at(-1)!.findings).toMatch(/Conus medullaris: conus effect/);
    expect(atCauda.at(-1)!.concept).toBe("cauda_equina");
    expect(atCauda.at(-1)!.findings).toMatch(/Cauda equina: cauda effect/);
  });

  it("replaces an enhancement claim with a limitation when no contrast was given", () => {
    const atoms = buildDorsoLumbarLesionAtoms(
      { compartment: "paravertebral", level: "L2-L3", enhancement: "rim" },
      ctx({ level: "L2-L3", sequences: seq({ contrast: false }) }),
    );
    expect(atoms.some((x) => x.concept === "screening_limitation" && /did not include contrast/i.test(x.findings))).toBe(true);
    expect(atoms.some((x) => /rim enhancement/i.test(x.findings))).toBe(false);
  });
});
