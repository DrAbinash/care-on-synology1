/**
 * X-ray LS sub-master catalog tests (spec §2–§15, §17, §18, §20). The catalog is
 * content, so the tests are contracts: every tile must be reachable only through
 * a view/coverage/numbering gate that can support it, every supersession string
 * must be a sentence the normal baseline can actually emit, every section must be
 * a §17 section, and no MRI conclusion may be reachable from a plain-film tile.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  LS_FINDINGS_SECTIONS,
  LS_SUBMASTER_IDS,
  XRAY_LS_PRESETS,
  XRAY_LS_SUB_MASTERS,
  buildLsTilePatch,
  isLsSectionName,
  lsCriticalTileIds,
  lsPresetAvailability,
  lsPresetById,
  lsPresetIsCritical,
  lsSectionOrder,
  lsSubMasterById,
  lsTileAvailability,
  type LsPreset,
  type LsTile,
} from "./xrayLsSubMasters";
import { LS_BASELINE_CONTRACTS, LS_NORMAL_SENTENCES } from "./xrayLsNormalAtoms";
import { buildLsNormalAtomSpecs } from "./xrayLsNormalAtoms";
import { parseXrayLsViews } from "./xrayLsViews";
import { UNSET_LS_NUMBERING, parseLsNumberingFromText, type LsNumbering } from "./xrayLsNumbering";
import { LS_ATOM_SOURCE, applyLsTemplate, lsBundleId, unfilledLsTokens } from "./xrayLsAtoms";
import { lsLevelsInText, normalizeLsLevel } from "./xrayLsLevels";
import { detectCriticalFindings } from "./criticalResults";
import {
  isXrayCervicalReportingContext,
  isXrayLsReportingContext,
  buildReportingStudyContext,
} from "./reportingStudyContext";
import { filterRegionNamesForModality, resolveAutoStudyRegion } from "./studyRegion";
import { emptyViewerMeasurementsState } from "./structuredViewerMeasurements";
import { useWorkspace } from "./zai-workspace/store";

const LIVE_PROTOCOL =
  "AP and lateral views of the lumbar spine (with flexion-extension views where indicated).";

const FULL_SERIES = [
  "AP lumbar radiograph.",
  "Lateral lumbar radiograph.",
  "Right oblique views.",
  "Left oblique views.",
  "Flexion view.",
  "Extension view.",
  "Spot L5-S1 view.",
  "The L5-S1 junction is adequately visualized.",
  "The posterior elements are adequately visualized.",
  "T12-L1 is included in the field of view.",
  "The sacroiliac joints are adequately visualized.",
  "No significant rotation.",
  "No motion artifact.",
].join(" ");

const STANDARD_5: LsNumbering = {
  basis: "standard",
  lumbarTypeCount: 5,
  designatedL5Position: 5,
  evidence: null,
  castellvi: null,
};

const ALL_TILES: LsTile[] = XRAY_LS_SUB_MASTERS.flatMap((sm) => sm.tiles);
const TILE_BY_ID = new Map<string, LsTile>(ALL_TILES.map((t) => [t.id, t]));

/** A template that fills every token the catalog uses. */
const FULL_TEMPLATE = {
  level: "L4-L5",
  upperLevel: "L4",
  lowerLevel: "L5",
  laterality: "right" as const,
  view: "lateral" as const,
  mm: "4.5",
  percent: "30",
  degrees: "28",
  grade: "II",
  direction: "anterolisthesis" as const,
};

describe("catalog shape (spec §3)", () => {
  it("carries the twelve sub-masters in the specification's order", () => {
    expect(XRAY_LS_SUB_MASTERS.map((sm) => sm.id)).toEqual(LS_SUBMASTER_IDS);
    expect(LS_SUBMASTER_IDS).toEqual([
      "routine",
      "degenerative",
      "listhesis",
      "trauma",
      "deformity",
      "transitional",
      "infection",
      "tumor",
      "postoperative",
      "dynamic",
      "sacroiliac",
      "advanced",
    ]);
  });

  it("labels each palette with the spec's own names", () => {
    const labels = Object.fromEntries(XRAY_LS_SUB_MASTERS.map((sm) => [sm.id, sm.label]));
    expect(labels.degenerative).toBe("Degenerative");
    expect(labels.listhesis).toBe("Listhesis / Pars");
    expect(labels.trauma).toBe("Trauma");
    expect(labels.transitional).toBe("Transitional");
    expect(labels.sacroiliac).toBe("Sacroiliac");
  });

  it("has unique ids, groups and non-empty prose for every tile", () => {
    expect(new Set(ALL_TILES.map((t) => t.id)).size).toBe(ALL_TILES.length);
    for (const tile of ALL_TILES) {
      expect(tile.label.trim().length).toBeGreaterThan(2);
      expect(tile.group.trim()).not.toBe("");
      expect(tile.atoms.length).toBeGreaterThan(0);
      for (const atom of tile.atoms) {
        expect(atom.findings.trim().length).toBeGreaterThan(10);
        // LS owns its concept ids, except where an existing shared spine concept
        // already declares ls spine + XR and is reused instead of duplicated.
        // posterior_elements is #778's one canonical posterior-element concept for
        // radiography and MR, so the lumbosacral baseline emits that id rather than
        // registering an ls_ twin that would claim the same alias twice.
        expect(
          /^ls_/.test(atom.concept) ||
            atom.concept === "adjacent_segment_degeneration" ||
            atom.concept === "posterior_elements",
          `${tile.id}/${atom.concept}`,
        ).toBe(true);
      }
    }
    expect(ALL_TILES.length).toBeGreaterThan(70);
  });

  it("resolves palettes by id and keeps every tile reachable", () => {
    expect(lsSubMasterById("trauma")?.tiles.length).toBeGreaterThan(5);
    expect(lsSubMasterById("nope")).toBeUndefined();
    for (const tile of ALL_TILES) {
      const owner = XRAY_LS_SUB_MASTERS.find((sm) => sm.tiles.includes(tile));
      expect(owner?.tiles.find((t) => t.id === tile.id)).toBe(tile);
    }
  });
});

describe("sections follow the report order (spec §17)", () => {
  it("every atom names a declared section", () => {
    for (const tile of ALL_TILES) {
      for (const atom of tile.atoms) {
        expect(isLsSectionName(atom.anatomicalSection)).toBe(true);
      }
    }
  });

  it("orders numbering before discs and hardware after the SI joints", () => {
    expect(lsSectionOrder("technique / views")).toBeLessThan(lsSectionOrder("numbering"));
    expect(lsSectionOrder("numbering")).toBeLessThan(lsSectionOrder("disc spaces"));
    expect(lsSectionOrder("disc spaces")).toBeLessThan(lsSectionOrder("pars interarticularis"));
    expect(lsSectionOrder("sacroiliac joints")).toBeLessThan(lsSectionOrder("hardware"));
    expect(lsSectionOrder("unknown section")).toBe(LS_FINDINGS_SECTIONS.length);
    expect(isLsSectionName("canal stenosis")).toBe(false);
  });
});

describe("library pattern coverage", () => {
  it("grades disc-space reduction the way library §6 enumerates it", () => {
    const grades = [
      ["dg-disc-mild", "mild"],
      ["dg-disc-moderate", "moderate"],
      ["dg-disc-severe", "severe"],
    ] as const;
    for (const [id, severity] of grades) {
      const tile = TILE_BY_ID.get(id);
      expect(tile, id).toBeDefined();
      expect(tile!.atoms[0].severity, id).toBe(severity);
      // One disc is one observation: the grades share a concept, so selecting a
      // different grade replaces rather than stacking three lines.
      expect(tile!.atoms[0].concept).toBe("ls_disc_narrowing");
    }
    expect(lsSectionOrder("disc spaces")).toBeLessThan(lsSectionOrder("pars interarticularis"));
  });
});

describe("baseline supersession contracts cannot drift", () => {
  const baselineSentences = new Set<string>([
    ...Object.values(LS_BASELINE_CONTRACTS),
    ...Object.values(LS_NORMAL_SENTENCES),
  ]);

  it("only supersedes a sentence the normal baseline can emit", () => {
    for (const tile of ALL_TILES) {
      for (const atom of tile.atoms) {
        const replaces = atom.baselineReplaces;
        if (replaces === undefined || replaces === "") continue;
        expect(baselineSentences.has(replaces)).toBe(true);
      }
    }
  });

  it("the one-click normal emits exactly the sentences the tiles supersede", () => {
    const built = new Set(
      buildLsNormalAtomSpecs(parseXrayLsViews(FULL_SERIES), STANDARD_5).map((a) => a.findings),
    );
    expect(built.has(LS_BASELINE_CONTRACTS.alignment)).toBe(true);
    expect(built.has(LS_BASELINE_CONTRACTS.vertebrae)).toBe(true);
    expect(built.has(LS_BASELINE_CONTRACTS.discs)).toBe(true);
    expect(built.has(LS_BASELINE_CONTRACTS.posteriorElements)).toBe(true);
    expect(built.has(LS_BASELINE_CONTRACTS.noFracture)).toBe(true);
    expect(built.has(LS_BASELINE_CONTRACTS.noHardware)).toBe(true);
    expect(built.has(LS_BASELINE_CONTRACTS.siPreserved)).toBe(true);
    expect(built.has(LS_BASELINE_CONTRACTS.junctionAdequate)).toBe(true);
  });
});

describe("prose integrity", () => {
  it("renders every tile without leaving a bracket token behind", () => {
    for (const tile of ALL_TILES) {
      const patch = buildLsTilePatch(tile, "Lumbar Spine", FULL_TEMPLATE);
      for (const observation of patch.observations) {
        expect(unfilledLsTokens(observation.findingsText)).toEqual([]);
        expect(unfilledLsTokens(observation.incoming.impression ?? "")).toEqual([]);
      }
    }
  });

  it("keeps spacing and punctuation clean in the seeded prose", () => {
    for (const tile of ALL_TILES) {
      for (const atom of tile.atoms) {
        expect(atom.findings).not.toMatch(/\s{2,}/);
        expect(atom.findings).toMatch(/[.!]$/);
        if (atom.impression) expect(atom.impression).not.toMatch(/\s{2,}/);
      }
    }
  });

  it("never reaches an MRI-only conclusion from a plain-film tile", () => {
    // spec §1: radiography may not generate canal, root, disc-signal or marrow
    // conclusions. The allowed appearances are explicit disclaimers.
    const forbidden = [
      /canal stenosis/i,
      /cauda equina syndrome/i,
      /nerve root compression/i,
      /root compression/i,
      /disc desiccation/i,
      /modic/i,
      /pfirrmann/i,
      /myelopathy/i,
      /cord (?:compression|signal)/i,
      /marrow edema/i,
      /thecal sac/i,
    ];
    const text = ALL_TILES.flatMap((t) => t.atoms)
      .map((a) => `${a.findings} ${a.impression ?? ""} ${a.recommendation ?? ""}`)
      .join("\n");
    for (const re of forbidden) {
      expect(text).not.toMatch(re);
    }
  });

  it("forbids the diagnostic leaps the library calls out", () => {
    const atoms = ALL_TILES.flatMap((t) => t.atoms);
    // A disclaimer may NAME a diagnosis in order to refuse it; the assertion is
    // that no tile ever asserts one.
    const asserted = atoms
      .filter((a) => !/_disclaimer|^ls_not_assessable$|^ls_etiology_disclaimer$/.test(a.concept))
      .map((a) => `${a.findings} ${a.impression ?? ""}`)
      .join("\n");
    const disclaimers = atoms
      .filter((a) => /_disclaimer/.test(a.concept))
      .map((a) => a.findings)
      .join("\n");

    // spec §12: transitional anatomy is not Bertolotti syndrome.
    expect(asserted).not.toMatch(/bertolotti/i);
    // spec §13: nonspecific sclerosis is not axial spondyloarthritis.
    expect(asserted).not.toMatch(/axial spondyloarthritis|ankylosing spondylitis|sacroiliitis/i);
    expect(disclaimers).toMatch(/is not labelled as inflammatory sacroiliitis/i);
    // spec §6: straightening is not attributed to muscle spasm.
    expect(asserted).not.toMatch(/muscle spasm|antalgic/i);
    // spec §15: only a convincing lucency may be called concerning for loosening.
    const equivocal = TILE_BY_ID.get("po-lucency-equivocal");
    expect(equivocal?.atoms[0].findings).toContain("not diagnostic of loosening");
    expect(equivocal?.atoms[0].findings).not.toMatch(/concerning for loosening/);
    // spec §14: a lesion is never called metastasis from a plain film.
    expect(asserted).not.toMatch(/metastat|myeloma/i);
    // spec §7: no nerve-root or canal conclusion is asserted.
    expect(asserted).not.toMatch(/root compression|cauda equina|canal stenosis/i);
  });

  it("keeps instability a radiologist selection with no threshold in the prose", () => {
    const numbers = ALL_TILES.flatMap((t) => t.atoms)
      .map((a) => `${a.findings} ${a.impression ?? ""}`)
      .join(" ");
    // spec §9: no hard-coded instability threshold (4 mm / 10 degrees).
    expect(numbers).not.toMatch(/\d+\s*mm\s*(?:of|or more)?\s*(?:translation|instability)/i);
    expect(numbers).not.toMatch(/\b(?:10|15)\s*(?:degrees|°)[^.]{0,30}unstable/i);
    const unstable = TILE_BY_ID.get("dy-instability");
    expect(unstable?.atoms[0].findings).toContain("The reporting radiologist interprets");
  });

  it("supports laterality wherever the prose names a side", () => {
    for (const tile of ALL_TILES) {
      for (const atom of tile.atoms) {
        if (/\[side\]|\[Side\]/.test(atom.findings) || /\[side\]|\[Side\]/.test(atom.impression ?? "")) {
          expect(atom.supportsLaterality).toBe(true);
        }
      }
    }
  });
});

describe("view / coverage / numbering gating", () => {
  const live = parseXrayLsViews(LIVE_PROTOCOL);
  const full = parseXrayLsViews(FULL_SERIES);

  it("blocks a pars tile when the posterior elements were never recorded", () => {
    const pars = TILE_BY_ID.get("ls-pars-defect")!;
    const blocked = lsTileAvailability(pars, live, {}, STANDARD_5);
    expect(blocked.ok).toBe(false);
    // The lateral was performed, so the block is the adequacy dimension, and the
    // gate says so in the reason the canvas shows (spec §7).
    expect(blocked.reason).toContain("posterior elements are not recorded as adequately visualized");
    expect(lsTileAvailability(pars, full, {}, STANDARD_5).ok).toBe(true);
  });

  it("requires an oblique projection for the unilateral pars tile", () => {
    const unilateral = TILE_BY_ID.get("ls-pars-defect-unilateral")!;
    const lateralOnly = parseXrayLsViews(
      "Lateral lumbar radiograph. The posterior elements are adequately visualized.",
    );
    expect(lsTileAvailability(unilateral, lateralOnly, {}, STANDARD_5).ok).toBe(false);
    expect(lsTileAvailability(unilateral, lateralOnly, {}, STANDARD_5).reason).toContain("oblique");
    expect(lsTileAvailability(unilateral, full, {}, STANDARD_5).ok).toBe(true);
  });

  it("requires the side oblique for a foraminal tile", () => {
    const foraminal = TILE_BY_ID.get("dg-foraminal-narrowing")!;
    const leftOnly = parseXrayLsViews("AP and lateral views. Left oblique views.");
    const blocked = lsTileAvailability(foraminal, leftOnly, { laterality: "right" }, STANDARD_5);
    expect(blocked.ok).toBe(false);
    expect(blocked.missing).toContain("right oblique");
    expect(lsTileAvailability(foraminal, leftOnly, { laterality: "left" }, STANDARD_5).ok).toBe(true);
    expect(lsTileAvailability(foraminal, full, { laterality: "bilateral" }, STANDARD_5).ok).toBe(true);
    // Rotation limits the oblique assessment even when the view exists.
    const rotated = parseXrayLsViews(
      FULL_SERIES.replace("No significant rotation.", "Patient rotation limits assessment."),
    );
    expect(lsTileAvailability(foraminal, rotated, { laterality: "right" }, STANDARD_5).ok).toBe(false);
  });

  it("closes every dynamic tile on neutral films", () => {
    const dynamicTiles = XRAY_LS_SUB_MASTERS.find((sm) => sm.id === "dynamic")!.tiles.filter(
      (t) => t.dynamicGate,
    );
    expect(dynamicTiles.length).toBeGreaterThan(3);
    for (const tile of dynamicTiles) {
      const availability = lsTileAvailability(tile, live, FULL_TEMPLATE, STANDARD_5);
      expect(availability.ok).toBe(false);
      expect(availability.reason ?? availability.missing.join(" ")).toMatch(/flexion|extension/);
    }
    expect(lsTileAvailability(TILE_BY_ID.get("dy-instability")!, full, FULL_TEMPLATE, STANDARD_5).ok).toBe(true);
  });

  it("requires lumbosacral coverage for junction-dependent tiles", () => {
    const unknownCoverage = parseXrayLsViews("AP lumbar radiograph. Lateral lumbar radiograph.");
    expect(
      lsTileAvailability(TILE_BY_ID.get("ls-anterolisthesis")!, unknownCoverage, FULL_TEMPLATE, STANDARD_5).ok,
    ).toBe(true); // a listhesis needs the lateral, not the junction
    const highGrade = TILE_BY_ID.get("ls-high-grade")!;
    expect(
      lsTileAvailability(highGrade, unknownCoverage, FULL_TEMPLATE, STANDARD_5).ok,
    ).toBe(false);
    expect(lsTileAvailability(highGrade, full, FULL_TEMPLATE, STANDARD_5).ok).toBe(true);
  });

  it("gates T12-L1 statements on the upper junction being included", () => {
    const outOfView = parseXrayLsViews("AP lumbar radiograph. T12-L1 is not included in the field of view.");
    expect(
      lsTileAvailability(TILE_BY_ID.get("dg-disc-narrowing")!, outOfView, { level: "T12-L1" }, STANDARD_5).ok,
    ).toBe(true); // the tile is level-agnostic; the validator is what objects
    const t12Tile = TILE_BY_ID.get("rt-coverage-t12l1-out")!;
    expect(lsTileAvailability(t12Tile, outOfView, {}, STANDARD_5).ok).toBe(true);
  });

  it("refuses an SI abnormality without an AP that shows the joints", () => {
    const lateralOnly = parseXrayLsViews("Lateral lumbar radiograph.");
    expect(
      lsTileAvailability(TILE_BY_ID.get("si-sclerosis")!, lateralOnly, FULL_TEMPLATE, STANDARD_5).ok,
    ).toBe(false);
    expect(
      lsTileAvailability(TILE_BY_ID.get("si-sclerosis")!, live, FULL_TEMPLATE, STANDARD_5).ok,
    ).toBe(false); // AP exists, adequacy does not
    expect(
      lsTileAvailability(TILE_BY_ID.get("si-sclerosis")!, full, FULL_TEMPLATE, STANDARD_5).ok,
    ).toBe(true);
    // A preserved statement is allowed on the projection alone.
    expect(
      lsTileAvailability(TILE_BY_ID.get("si-preserved")!, live, {}, STANDARD_5).ok,
    ).toBe(true);
  });

  it("blocks every level-bearing tile until the numbering basis is established", () => {
    // spec §4 is the highest-priority requirement in this feature.
    const gated = ALL_TILES.filter((t) => t.requiresNumbering);
    expect(gated.length).toBeGreaterThan(40);
    for (const tile of gated) {
      const availability = lsTileAvailability(tile, full, FULL_TEMPLATE, UNSET_LS_NUMBERING);
      expect(availability.ok).toBe(false);
      expect(availability.reason).toContain("Establish the numbering basis");
      expect(availability.missing).toContain("numbering basis (not established)");
    }
    for (const tile of gated) {
      expect(lsTileAvailability(tile, full, FULL_TEMPLATE, STANDARD_5).ok).toBe(true);
    }
  });

  it("leaves coverage and disclaimer tiles open on any study", () => {
    const open = ALL_TILES.filter((t) => !t.requiresNumbering && !t.requires && !t.requiresAny && !t.requiresAdequate && !t.parsGate && !t.dynamicGate && !t.requiresJunction && !t.requiresSiJoints && !t.foraminalGate);
    expect(open.map((t) => t.id)).toContain("rt-coverage-bowel");
    expect(open.map((t) => t.id)).toContain("si-inflammation-disclaimer");
    expect(open.map((t) => t.id)).toContain("ad-not-assessed");
    for (const tile of open) {
      expect(lsTileAvailability(tile, parseXrayLsViews(""), {}, UNSET_LS_NUMBERING).ok).toBe(true);
    }
  });
});

describe("tile patches", () => {
  it("compile to reversible bundles keyed by tile id", () => {
    const patch = buildLsTilePatch(TILE_BY_ID.get("dg-disc-narrowing")!, "Lumbar Spine", FULL_TEMPLATE);
    expect(patch.bundleId).toBe("xlsb-tile-dg-disc-narrowing");
    expect(patch.observations.every((o) => o.bundleId === patch.bundleId)).toBe(true);
    expect(patch.observations[0].findingsText).toBe("Reduced disc-space height at L4-L5.");
    expect(patch.observations[0].incoming.impression).toBe("Disc-space narrowing at L4-L5.");
    expect(patch.observations[0].ownership.baselineReplaces).toBe(LS_BASELINE_CONTRACTS.discs);
  });

  it("keep a multi-atom tile atomic with sequential ids", () => {
    const patch = buildLsTilePatch(TILE_BY_ID.get("ls-isthmic")!, "Lumbar Spine", FULL_TEMPLATE);
    expect(patch.observations.length).toBeGreaterThan(1);
    expect(patch.observations.map((o) => o.id)).toEqual([
      `${patch.bundleId}-0`,
      `${patch.bundleId}-1`,
    ]);
  });
});

describe("presets (spec §6, §19)", () => {
  it("have unique ids, a valid home palette and a working builder", () => {
    const ids = XRAY_LS_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of XRAY_LS_PRESETS) {
      expect(LS_SUBMASTER_IDS).toContain(preset.subMasterId);
      const built = preset.build({
        ctx: parseXrayLsViews(FULL_SERIES),
        numbering: STANDARD_5,
        region: "Lumbar Spine",
        level: "L4-L5",
        upperLevel: "L4",
        lowerLevel: "L5",
        laterality: "right",
        percent: "30",
        mm: "4.5",
        degrees: "28",
        grade: "II",
        direction: "anterolisthesis",
      });
      expect(built.bundleId).toMatch(
        preset.id === "ls-normal" ? /^xlsb-normal-ls$/ : /^xlsb-preset-/,
      );
      expect(built.observations.length).toBeGreaterThan(0);
      expect(built.observations.every((o) => o.bundleId === built.bundleId)).toBe(true);
    }
  });

  it("offer the normal study first", () => {
    expect(XRAY_LS_PRESETS[0].id).toBe("ls-normal");
    expect(XRAY_LS_PRESETS[1].id).toBe("ls-normal-concise");
  });

  it("the one-click normal follows the coverage and numbering state", () => {
    const built = lsPresetById("ls-normal")!.build({
      ctx: parseXrayLsViews(LIVE_PROTOCOL),
      numbering: UNSET_LS_NUMBERING,
    });
    expect(built.bundleId).toBe("xlsb-normal-ls");
    expect(built.observations.some((o) => o.findingsText.includes("not established"))).toBe(true);
    expect(built.observations.some((o) => o.findingsText === LS_NORMAL_SENTENCES.parsNotAssessed)).toBe(true);
  });

  it("mark the critical patterns the seeded knowledge pack names", () => {
    const criticals = XRAY_LS_PRESETS.filter(lsPresetIsCritical).map((p) => p.id);
    // xr.lumbar_spine criticalFindings: unstable spondylolisthesis/instability on
    // flexion-extension, and burst fracture.
    expect(criticals).toContain("ls-dynamic-instability");
    expect(criticals).toContain("ls-burst-fracture");
    expect(criticals).toContain("ls-fracture-dislocation");
    expect(criticals).toContain("ls-postop-failure");
    expect(criticals).toContain("ls-destructive-disc");
    expect(criticals).not.toContain("ls-normal");
    expect(criticals.every((id) => lsPresetById(id)!.criticalPattern)).toBe(true);
  });

  it("are gated exactly like their tiles", () => {
    const instability: LsPreset = lsPresetById("ls-dynamic-instability")!;
    expect(
      lsPresetAvailability(instability, parseXrayLsViews(LIVE_PROTOCOL), FULL_TEMPLATE, STANDARD_5).ok,
    ).toBe(false);
    expect(
      lsPresetAvailability(instability, parseXrayLsViews(FULL_SERIES), FULL_TEMPLATE, UNSET_LS_NUMBERING).ok,
    ).toBe(false);
    expect(
      lsPresetAvailability(instability, parseXrayLsViews(FULL_SERIES), FULL_TEMPLATE, STANDARD_5).ok,
    ).toBe(true);
    // The normal preset carries no gate: it is always available.
    expect(lsPresetAvailability(lsPresetById("ls-normal")!, parseXrayLsViews(""), {}, UNSET_LS_NUMBERING).ok).toBe(
      true,
    );
  });

  it("expose the critical tiles for the canvas highlight", () => {
    const criticals = lsCriticalTileIds();
    expect(criticals).toContain("tr-burst-suspicion");
    expect(criticals).toContain("tr-fracture-dislocation");
    expect(criticals).toContain("dy-instability");
    expect(criticals).toContain("po-breakage");
    expect(criticals).toContain("po-lucency-convincing");
    expect(criticals).toContain("ls-high-grade");
    expect(criticals).toContain("tu-multifocal");
    expect(criticals).toContain("in-disc-endplate");
    expect(criticals.every((id) => TILE_BY_ID.get(id)?.criticalPattern)).toBe(true);
  });

  it("give a critical tile a high severity and an actionable impression", () => {
    for (const id of lsCriticalTileIds()) {
      const tile = TILE_BY_ID.get(id)!;
      const withSeverity = tile.atoms.filter((a) => a.severity === "high");
      expect(withSeverity.length).toBeGreaterThan(0);
      expect(withSeverity[0].impression?.trim().length).toBeGreaterThan(5);
    }
  });

  it("recommend cross-sectional imaging where radiography reaches its limit", () => {
    const burst = TILE_BY_ID.get("tr-burst-suspicion")!;
    expect(burst.atoms[0].recommendation).toMatch(/CT|MRI/);
    const dysraphism = TILE_BY_ID.get("ad-sacral-tract")!;
    expect(dysraphism.atoms[0].recommendation).toMatch(/MRI/);
    // spec §10: a plain film is not asked to grade the canal.
    expect(burst.atoms[0].findings).toContain("cannot be assessed on radiography");
  });
});

/* ─────────────────── workspace behaviour (spec §17, §19, §20) ─────────────────── */

const LS_REGION = "X-Ray Lumbar Spine";

const ctxFull = () => parseXrayLsViews(FULL_SERIES);

function resetWorkspace(technique = FULL_SERIES) {
  useWorkspace.setState({
    findingsText: "",
    impressionText: "",
    recommendationText: "",
    techniqueText: technique,
    clinicalHistoryText: "",
    fieldProvenance: {},
    appliedPathologyPatches: [],
    voiceComposerObservations: [],
    voiceComposerTranscriptHistory: [],
    lastPatchSnapshot: null,
    confirmOverwriteOpen: false,
    pendingPathologyPatch: null,
    isFinalized: false,
    isDirty: false,
    impressionNeedsRefresh: false,
    selectedObservationId: null,
    structuredViewerMeasurements: emptyViewerMeasurementsState(),
    ownershipReviewWarnings: [],
    ledgerHydrationWarning: null,
    appliedFormatReportTitle: null,
    appliedFormatName: null,
    activeAnchor: null,
    reportingContext: buildReportingStudyContext({
      modality: "CR",
      studyDescription: "XRAY LS SPINE AP/LAT",
      regions: [LS_REGION],
      source: "billed",
    }),
  });
}

const findings = () => useWorkspace.getState().findingsText;
const impression = () => useWorkspace.getState().impressionText;

function applyTile(tileId: string, template: Parameters<typeof buildLsTilePatch>[2] = {}): LsTile {
  const t = TILE_BY_ID.get(tileId);
  if (!t) throw new Error(`unknown tile ${tileId}`);
  useWorkspace.getState().applyMacroBundle(buildLsTilePatch(t, LS_REGION, template));
  return t;
}

function applyPreset(id: string, numbering: LsNumbering = STANDARD_5) {
  const preset = lsPresetById(id);
  if (!preset) throw new Error(`unknown preset ${id}`);
  return useWorkspace
    .getState()
    .applyMacroBundle(
      preset.build({
        region: LS_REGION,
        ctx: ctxFull(),
        numbering,
        level: "L4-L5",
        upperLevel: "L4",
        lowerLevel: "L5",
        mm: "4.5",
        percent: "30",
        degrees: "28",
        grade: "II",
        direction: "anterolisthesis",
        laterality: "right",
      }),
    );
}

describe("impression, staleness and manual protection (spec §17)", () => {
  beforeEach(() => resetWorkspace());

  it("composes the impression from accepted ledger observations", () => {
    applyPreset("ls-normal");
    applyTile("ls-anterolisthesis", { upperLevel: "L4", lowerLevel: "L5", direction: "anterolisthesis" });
    expect(impression()).toMatch(/Anterolisthesis of L4 over L5/i);
  });

  it("writes the numbering basis into Findings and reads it back from the prose", () => {
    applyPreset("ls-normal");
    // The resolver has no schema: the report text IS the persisted numbering
    // state, so a reopened study must re-derive the same basis.
    const parsed = parseLsNumberingFromText(`${findings()}\n${impression()}`);
    expect(parsed.basis).toBe("standard");
    expect(parsed.lumbarTypeCount).toBe(5);
  });

  it("keeps the numbering line alive beside the rest of the normal baseline", () => {
    applyPreset("ls-normal");
    // The ledger lets an incoming atom absorb any existing sentence that names
    // its own section, so the numbering line must never contain "vertebral
    // bodies" — otherwise the vertebra line silently deletes the study's
    // numbering basis and the report loses the reason its levels mean anything.
    expect(findings()).toMatch(/numbering is standard/i);
    expect(findings()).toMatch(/Vertebral body heights are preserved\./i);
  });

  it("marks the impression stale when linked findings are hand-edited, without overwriting", () => {
    applyTile("dg-disc-narrowing", { level: "L4-L5" });
    const before = impression();
    useWorkspace.getState().setField(
      "findings",
      `${findings()}\nAdditional dictated sentence about the lumbosacral junction.`,
      { source: "manual", replaceProvenance: false },
    );
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(true);
    expect(impression()).toBe(before);
    useWorkspace.getState().refreshImpressionFromLedger();
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(false);
    expect(impression()).toContain(before.trim());
  });

  it("protects ledger contributions against a wholesale manual rewrite", () => {
    applyTile("rt-straightening");
    useWorkspace.getState().setField("findings", "Only the radiologist dictated findings.", "manual");
    expect(useWorkspace.getState().appliedPathologyPatches.every((p) => p.protected)).toBe(true);
    expect(findings()).toBe("Only the radiologist dictated findings.");
  });

  it("keeps dictated text when a bundle is removed", () => {
    const built = buildLsTilePatch(TILE_BY_ID.get("dg-facet")!, LS_REGION, { level: "L4-L5" });
    useWorkspace.getState().applyMacroBundle(built);
    const dictated = "Dictated after review of the prior study.";
    useWorkspace.getState().setField("findings", `${findings()}\n${dictated}`, "manual");
    const outcome = useWorkspace.getState().removeMacroBundle(built.bundleId);
    expect(["preserved-manual", "removed", "no-op-unproven"]).toContain(outcome);
    expect(findings()).toContain(dictated);
  });

  it("undoes a whole tile in one step", () => {
    applyPreset("ls-normal");
    const afterNormal = findings();
    applyTile("in-disc-endplate", { level: "L4-L5" });
    expect(findings()).not.toBe(afterNormal);
    expect(useWorkspace.getState().undoLastPatch()).toBe(true);
    expect(findings()).toBe(afterNormal);
  });

  it("writes every observation through the structured-template source", () => {
    applyPreset("ls-degenerative-multilevel");
    expect(useWorkspace.getState().appliedPathologyPatches.length).toBeGreaterThan(0);
    for (const p of useWorkspace.getState().appliedPathologyPatches) {
      expect(p.observation?.source).toBe(LS_ATOM_SOURCE);
    }
  });
});

describe("the numbering basis survives every tile (spec §4)", () => {
  for (const tile of ALL_TILES) {
    it(`keeps a numbering basis after ${tile.id}`, () => {
      resetWorkspace();
      applyPreset("ls-normal");
      applyTile(tile.id, FULL_TEMPLATE);
      // The ledger lets an incoming atom absorb any existing sentence naming its
      // own section. Whatever a tile does to the wording, the report must never
      // lose the basis its levels were derived from — a report that names L4-L5
      // without saying how L was counted is the failure spec §4 exists to stop.
      const after = parseLsNumberingFromText(`${findings()}\n${impression()}`);
      expect(after.basis, `${tile.id} :: ${findings()}`).not.toBe("unset");
    });
  }
});

describe("critical results (spec §19)", () => {
  const criticalProse: Array<{ tile: string; template?: Parameters<typeof buildLsTilePatch>[2] }> = [
    { tile: "tr-fracture-dislocation", template: { level: "L2-L3" } },
    { tile: "tr-burst-suspicion", template: { level: "L1" } },
    { tile: "tr-retropulsion", template: { level: "L1" } },
    { tile: "ls-anterolisthesis", template: { upperLevel: "L4", lowerLevel: "L5", direction: "anterolisthesis" } },
    { tile: "ls-high-grade", template: { level: "L5-S1", direction: "anterolisthesis" } },
    { tile: "dy-instability", template: { level: "L4-L5" } },
    { tile: "in-disc-endplate", template: { level: "L4-L5" } },
    { tile: "in-multilevel-destruction", template: { level: "L3-L4" } },
    { tile: "tu-multifocal" },
    { tile: "tu-pathologic-fracture", template: { level: "L2" } },
    { tile: "po-breakage", template: { level: "L4-L5" } },
    { tile: "po-migration", template: { level: "L4-L5" } },
    { tile: "po-lucency-convincing", template: { level: "L4-L5" } },
    { tile: "po-cement-extrusion", template: { level: "L1" } },
  ];

  for (const { tile: tileId, template } of criticalProse) {
    it(`raises a critical for ${tileId}`, () => {
      resetWorkspace();
      applyTile(tileId, template ?? { level: "L4-L5" });
      expect(detectCriticalFindings(findings(), [impression()]).length, findings()).toBeGreaterThan(0);
    });
  }

  it("does not raise a critical on a normal lumbosacral film", () => {
    resetWorkspace();
    applyPreset("ls-normal");
    expect(detectCriticalFindings(findings(), [impression()])).toEqual([]);
  });

  it("never documents communication on its own", () => {
    resetWorkspace();
    applyTile("tr-fracture-dislocation", { level: "L2-L3" });
    expect(detectCriticalFindings(findings(), [impression()]).length).toBeGreaterThan(0);
    expect(useWorkspace.getState().criticalFindings).toEqual([]);
  });

  it("maps every declared critical tile onto prose the term table matches", () => {
    // lsCriticalTileIds() is the catalog's own declaration of what is urgent;
    // each one must actually fire, or the safety net is decoration.
    for (const id of lsCriticalTileIds()) {
      resetWorkspace();
      applyTile(id, {
        level: "L4-L5",
        upperLevel: "L4",
        lowerLevel: "L5",
        percent: "40",
        direction: "anterolisthesis",
      });
      expect(detectCriticalFindings(findings(), [impression()]), id).not.toEqual([]);
    }
  });
});

describe("AI stays proposal-only (spec §19)", () => {
  it("AI prose creates no ledger observation and cannot finalize", () => {
    resetWorkspace();
    const before = useWorkspace.getState().appliedPathologyPatches.length;
    useWorkspace.getState().setField("findings", "Possible L4-L5 anterolisthesis.", { source: "ai-draft" });
    expect(useWorkspace.getState().appliedPathologyPatches.length).toBe(before);
    expect(useWorkspace.getState().isFinalized).toBe(false);
  });

  it("AI text does not overwrite a radiologist's manual impression", () => {
    resetWorkspace();
    useWorkspace.getState().setField("impression", "Clinical impression typed by the radiologist.", "manual");
    useWorkspace.getState().setFieldIfEmpty("impression", "AI suggestion", "ai-draft");
    expect(impression()).toBe("Clinical impression typed by the radiologist.");
  });

  it("never finalizes a suspected fracture or instability without a radiologist action", () => {
    resetWorkspace();
    useWorkspace.getState().setField("findings", "Suspicious lucency through the L2 pedicle.", { source: "ai-draft" });
    expect(useWorkspace.getState().isFinalized).toBe(false);
    expect(useWorkspace.getState().appliedPathologyPatches).toEqual([]);
  });
});

describe("study context and billed mapping (spec §20)", () => {
  it("accepts a billed CR lumbosacral study on its tab name", () => {
    expect(
      isXrayLsReportingContext({
        modality: "CR",
        region: "X-Ray Lumbar Spine",
        family: "spine",
        studyDescription: "XRAY LS SPINE AP/LAT",
      }),
    ).toBe(true);
  });

  it("rejects MRI / CT / US lumbar studies — the radiography canvas is modality-bound", () => {
    expect(isXrayLsReportingContext({ modality: "MR", region: "LS Spine", family: "spine" })).toBe(false);
    expect(isXrayLsReportingContext({ modality: "CT", region: "Lumbar Spine", family: "spine" })).toBe(false);
    expect(isXrayLsReportingContext({ modality: "US", region: "LS Spine", family: "spine" })).toBe(false);
  });

  it("does not hijack another spine segment or a distant body part", () => {
    expect(isXrayLsReportingContext({ modality: "CR", region: "X-Ray Cervical Spine", family: "spine" })).toBe(false);
    expect(isXrayLsReportingContext({ modality: "CR", region: "X-Ray Dorsal Spine", family: "spine" })).toBe(false);
    expect(isXrayLsReportingContext({ modality: "CR", region: "X-Ray Sacrum", family: "spine" })).toBe(false);
    expect(
      isXrayLsReportingContext({ modality: "CR", region: "X-Ray Whole Spine (Scoliosis)", family: "spine" }),
    ).toBe(false);
    expect(isXrayLsReportingContext({ modality: "CR", region: "X-Ray Knee", family: "unknown" })).toBe(false);
    // The cervical canvas must not claim a lumbar film either.
    expect(isXrayCervicalReportingContext({ modality: "CR", region: "X-Ray Lumbar Spine", family: "spine" })).toBe(false);
  });

  it("accepts a lumbar X-ray tab with no modality string", () => {
    expect(isXrayLsReportingContext({ region: "X-Ray Lumbar Spine" })).toBe(true);
    expect(isXrayLsReportingContext({ modality: "CR", studyDescription: "XR LS SPINE" })).toBe(true);
  });

  it("runs the billed name through the real resolver into the canvas predicate", () => {
    // Live catalog: XRAYLSPINE = "X-RAY LS SPINE LAT", XR028 = "XRAY LS SPINE AP/LAT".
    const SPINE_TABS = [
      "X-Ray Cervical Spine",
      "X-Ray Lumbar Spine",
      "X-Ray Dorsal Spine",
      "X-Ray Whole Spine (Scoliosis)",
      "X-Ray Chest PA",
    ];
    for (const billed of ["X-RAY LS SPINE LAT", "XRAY LS SPINE AP/LAT"]) {
      const resolved = resolveAutoStudyRegion({
        modality: "CR",
        billedTestName: billed,
        orderedRegionNames: filterRegionNamesForModality(SPINE_TABS, "CR"),
      });
      expect(resolved.region).toBe("X-Ray Lumbar Spine");
      // The tab the resolver picks is the tab the canvas predicate accepts.
      expect(isXrayLsReportingContext({ modality: "CR", region: resolved.region })).toBe(true);
    }
    // A dorsolumbar film is deliberately left for a manual choice.
    expect(
      resolveAutoStudyRegion({
        modality: "CR",
        billedTestName: "XRAY DL SPINE AP/LAT",
        orderedRegionNames: filterRegionNamesForModality(SPINE_TABS, "CR"),
      }).region,
    ).toBeNull();
  });

  it("names lumbosacral bundles with their own prefix", () => {
    expect(lsBundleId("tile", "dg-facet")).toBe("xlsb-tile-dg-facet");
    expect(lsBundleId("normal", "ls")).toBe("xlsb-normal-ls");
  });

  it("keeps the template renderer honest about unknown levels", () => {
    expect(applyLsTemplate("Narrowing at [level].", { level: "l4-5" })).toBe("Narrowing at L4-L5.");
    expect(applyLsTemplate("Narrowing at [level].", { level: "C5-C6" })).toBe("Narrowing at C5-C6.");
    expect(normalizeLsLevel("C4")).toBeNull();
    expect(normalizeLsLevel("L9")).toBeNull();
    // A space-joined pair is one level, and prose that only mentions a level
    // still yields it — the level extractor, not the normalizer, reads a range.
    expect(normalizeLsLevel("l5 s1")).toBe("L5-S1");
    expect(lsLevelsInText("L5 6 mm translation, L4-L5 disc narrowed.")).toEqual(["L5", "L4-L5"]);
  });
});
