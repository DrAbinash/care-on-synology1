/**
 * mriBrainVascularPresets.ts — the canonical vascular macros and structured presets
 * (mra/mrv spec §16, §17, §15).
 *
 * A preset in CARE is a set of EDITABLE observations pushed through the existing
 * bundle machinery — never a finished report — so every preset here is assembled from
 * the same tiles and atoms the palettes use, in the §17 Findings order, and applied
 * through `applyMacroBundle` / `removeMacroBundle` / undo like any other tile.
 *
 * §16's last line is the rule that shapes this file: "Do not silently generate
 * unsupported diagnoses from preset selection." A preset is ONE click, which makes it a
 * louder route to an unsupported conclusion than a palette tile is, and the palette's
 * technique gate does not run on a preset. So every tile a preset names is filtered
 * through the same `tileAvailable` test the panel uses, against the study's actual
 * sequences and stated acquisitions: a preset writes what the angiogram can carry, and
 * `dropped` says what it refused. No preset names a gated diagnosis tile at all — the
 * stenosis preset is descriptive, the dissection preset has no stage, the moyamoya
 * preset is the pattern, and the AVM preset cannot claim temporal drainage.
 *
 * The exception is deliberate: the two §16 canonical macros (intracranial saccular
 * aneurysm, dural venous sinus thrombosis) are quoted line by line from
 * `mriBrainVascularProse.ts`, which the prose guard asserts verbatim against the
 * clinical content library. Selecting that macro IS the radiologist action the safety
 * rules ask for, so the macro is seeded whole, each line placed on the slot that owns
 * the statement.
 *
 * Pure functions only — no store, no React.
 */

import type { BrainAtomSpec } from "./mriBrainAtoms";
import { brainAtomsToPatches, brainBundleId } from "./mriBrainAtoms";
import type { BrainPreset, BrainPresetContext, BrainSubMasterId } from "./mriBrainSubMasters";
import { brainSubMasterById, tileAvailable } from "./mriBrainSubMasters";
import {
  ANEURYSM_MACRO_FINDINGS,
  ANEURYSM_MACRO_IMPRESSION,
  CVST_MACRO_FINDINGS,
  CVST_MACRO_IMPRESSIONS,
  INTRACRANIAL_MRA_FINDINGS_ORDER,
  MRA_NECK_FINDINGS_ORDER,
  MRA_SCREENING_PROSE,
  MRV_FINDINGS_ORDER,
  VASCULAR_FINDINGS_SECTIONS,
  VASCULAR_LIBRARY_PROSE,
} from "./mriBrainVascularProse";
import type { VascularTreeModule } from "./mriBrainVascularSubMasters";
import { VASCULAR_TREE_NORMALS } from "./mriBrainVascularSubMasters";
import { vascularGate, type VascularGateFeature } from "./mriBrainVascularTechnique";

/** §17 order per module, as data: each module's Findings sections in report order. */
export const VASCULAR_FINDINGS_ORDERS: Record<VascularTreeModule, readonly string[]> = {
  mra: INTRACRANIAL_MRA_FINDINGS_ORDER.map((key) => VASCULAR_FINDINGS_SECTIONS[key]),
  mraNeck: MRA_NECK_FINDINGS_ORDER.map((key) => VASCULAR_FINDINGS_SECTIONS[key]),
  mrv: MRV_FINDINGS_ORDER.map((key) => VASCULAR_FINDINGS_SECTIONS[key]),
};

/**
 * Put atoms in the module's §17 Findings order.
 *
 * The Findings composer keeps ledger insertion order, so for this phase ordering the
 * atoms IS the composition rule — expressed against the same arrays the spec guard test
 * reads, rather than as a second text assembly. Sections the order does not name (the
 * screening subsection, say) fall to the end, and the sort is stable so nothing is
 * shuffled arbitrarily.
 */
export function orderVascularAtoms(
  module: VascularTreeModule,
  atoms: readonly BrainAtomSpec[],
): BrainAtomSpec[] {
  const order = VASCULAR_FINDINGS_ORDERS[module];
  const rankOf = (atom: BrainAtomSpec) => {
    const rank = order.indexOf(atom.anatomicalSection ?? "");
    return rank < 0 ? order.length : rank;
  };
  return atoms
    .map((atom, index) => ({ atom, index, rank: rankOf(atom) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.atom);
}

type TileRef = [BrainSubMasterId, string];

/** The atoms of the named tiles that this study can carry, and the ids it could not. */
function availableTileAtoms(
  refs: readonly TileRef[],
  ctx: BrainPresetContext,
): { atoms: BrainAtomSpec[]; dropped: string[] } {
  const atoms: BrainAtomSpec[] = [];
  const dropped: string[] = [];
  for (const [subMasterId, tileId] of refs) {
    const tile = brainSubMasterById(subMasterId)?.tiles.find((t) => t.id === tileId);
    if (!tile) {
      dropped.push(tileId);
      continue;
    }
    const check = tileAvailable(tile, ctx.seq, ctx.vascular ?? undefined);
    if (!check.ok) {
      dropped.push(tileId);
      continue;
    }
    atoms.push(...tile.atoms);
  }
  return { atoms, dropped };
}

// ─── §16 canonical macros ────────────────────────────────────────────────

/**
 * Macro 1 — the supplied intracranial saccular aneurysm block, on the slots that own
 * each line: the Circle of Willis configuration, the aneurysm record (its Location,
 * Dimensions, Orientation and Thrombus/parenchyma lines travel together, so an edit
 * cannot separate a measurement from the sentence that explains it), and the statement
 * about the other vessels.
 */
export function aneurysmMacroAtoms(): BrainAtomSpec[] {
  const lines = ANEURYSM_MACRO_FINDINGS;
  return [
    {
      concept: "willis_configuration",
      conflictGroup: "willis-configuration",
      anatomicalSection: VASCULAR_FINDINGS_SECTIONS.circleOfWillis,
      findings: lines[0],
    },
    {
      concept: "mra_aneurysm_acom",
      conflictGroup: "acom-aneurysm",
      anatomicalSection: VASCULAR_FINDINGS_SECTIONS.circleOfWillis,
      findings: lines.slice(1, 5).join("\n"),
      impression: ANEURYSM_MACRO_IMPRESSION,
      severity: "urgent",
      baselineReplaces: VASCULAR_LIBRARY_PROSE.mraIntracranialNormal,
    },
    {
      concept: "mra_arterial",
      conflictGroup: "mra_arterial",
      anatomicalSection: VASCULAR_FINDINGS_SECTIONS.circleOfWillis,
      findings: lines[5],
      baselineReplaces: VASCULAR_LIBRARY_PROSE.mraIntracranialNormal,
      role: "baseline",
    },
  ];
}

/**
 * Macro 2 — the supplied dural venous sinus thrombosis block, one line per venous
 * territory: the sagittal sinus and its extension, the deep veins that stay patent, and
 * the parenchymal consequence, each carrying the impression line the macro pairs with it.
 */
export function cvstMacroAtoms(): BrainAtomSpec[] {
  const lines = CVST_MACRO_FINDINGS;
  return [
    {
      concept: "mrv_vessel_sss",
      conflictGroup: "sss-cvst",
      anatomicalSection: VASCULAR_FINDINGS_SECTIONS.duralSinuses,
      findings: lines[0],
      impression: CVST_MACRO_IMPRESSIONS[0],
      severity: "critical",
      baselineReplaces: VASCULAR_LIBRARY_PROSE.mrvNormal,
    },
    {
      concept: "mrv_vessel_transverse_sinus",
      conflictGroup: "transverse-sinus-cvst",
      anatomicalSection: VASCULAR_FINDINGS_SECTIONS.duralSinuses,
      findings: lines[1],
      laterality: "right",
      supportsLaterality: true,
    },
    {
      concept: "mrv_venous",
      conflictGroup: "mrv_venous",
      anatomicalSection: VASCULAR_FINDINGS_SECTIONS.deepVenousSystem,
      findings: lines[2],
      role: "baseline",
      baselineReplaces: VASCULAR_LIBRARY_PROSE.mrvNormal,
    },
    {
      concept: "venous_infarct",
      conflictGroup: "venous-infarct",
      anatomicalSection: VASCULAR_FINDINGS_SECTIONS.associatedBrain,
      findings: lines[3],
      impression: CVST_MACRO_IMPRESSIONS[1],
      severity: "critical",
    },
  ];
}

// ─── The preset table ────────────────────────────────────────────────────

type VascularPresetSpec = {
  id: string;
  label: string;
  /** Which §17 order the preset's Findings follow. */
  module: VascularTreeModule;
  tiles: readonly TileRef[];
  /** A canonical macro is gated only on its own domain having been acquired. */
  macroGate?: VascularGateFeature;
  macro?: () => BrainAtomSpec[];
  /**
   * §15: this preset writes one module's all-normal baseline. Those compose into a single
   * bundle (see `vascularNormalBundle`), because the ledger lets a later baseline block
   * supersede an earlier one's sentence.
   */
  normalBaseline?: boolean;
};

export const VASCULAR_PRESET_SPECS: readonly VascularPresetSpec[] = [
  // §15 — one normal baseline per vascular module, plus the screening baseline.
  { id: "vascular-normal-mra", label: "Normal dedicated intracranial MRA", module: "mra", tiles: [["mra", "mra-normal"]], normalBaseline: true },
  { id: "vascular-normal-mra-neck", label: "Normal dedicated MRA neck", module: "mraNeck", tiles: [["mraNeck", "neck-normal"]], normalBaseline: true },
  { id: "vascular-normal-mrv", label: "Normal dedicated MRV", module: "mrv", tiles: [["mrv", "mrv-normal"]], normalBaseline: true },
  {
    id: "vascular-normal-mra-screening",
    label: "Normal basic intracranial MRA screening",
    module: "mra",
    tiles: [],
    macroGate: "arterialAssessment",
    macro: () => [{
      concept: "mra_screening",
      conflictGroup: "mra-screening-normal",
      anatomicalSection: MRA_SCREENING_PROSE.sectionLabel,
      findings: MRA_SCREENING_PROSE.normal,
      baselineReplaces: VASCULAR_LIBRARY_PROSE.mraIntracranialNormal,
      role: "baseline",
    }, {
      // §14/§17: the screening subsection contributes its caveat exactly once.
      concept: "mra_screening_limitation",
      conflictGroup: "mra-screening-limitation",
      anatomicalSection: MRA_SCREENING_PROSE.sectionLabel,
      findings: MRA_SCREENING_PROSE.limitation,
      role: "baseline",
    }],
  },
  // §16 — the two supplied canonical macros.
  {
    id: "aneurysm-macro",
    label: "Intracranial saccular aneurysm (canonical macro)",
    module: "mra",
    tiles: [],
    macroGate: "aneurysmMorphology",
    macro: aneurysmMacroAtoms,
  },
  {
    id: "cvst-macro",
    label: "Dural venous sinus thrombosis (canonical macro)",
    module: "mrv",
    tiles: [],
    macroGate: "venousAssessment",
    macro: cvstMacroAtoms,
  },
  // §16 — structured presets, assembled from the descriptive rows of each module.
  { id: "mra-focal-stenosis", label: "Focal intracranial stenosis (descriptive, no grade)", module: "mra", tiles: [["mra", "mra-focal-narrowing"]] },
  { id: "mra-vessel-occlusion", label: "Intracranial vessel occlusion (suspected)", module: "mra", tiles: [["mra", "mra-suspected-occlusion"]] },
  { id: "mra-moyamoya-pattern", label: "Moyamoya-pattern vasculopathy", module: "mra", tiles: [["mra", "mra-moyamoya-pattern"]] },
  { id: "mra-avm-pattern", label: "AVM pattern (nidus and feeder)", module: "mra", tiles: [["mra", "mra-avm-nidus"]] },
  { id: "neck-carotid-stenosis", label: "Carotid stenosis (canonical appearance, no NASCET)", module: "mraNeck", tiles: [["mraNeck", "neck-stenosis-atherosclerotic"]] },
  { id: "neck-carotid-dissection", label: "Carotid dissection pattern (unstaged)", module: "mraNeck", tiles: [["mraNeck", "neck-dissection-pattern"]] },
  { id: "mrv-deep-venous-thrombosis", label: "Deep cerebral venous thrombosis", module: "mrv", tiles: [["mrv", "mrv-deep-venous-thrombosis"]] },
  { id: "mrv-transverse-hypoplasia", label: "Transverse sinus developmental hypoplasia / aplasia", module: "mrv", tiles: [["mrv", "mrv-transverse-hypoplasia"]] },
];

/**
 * The atoms a preset writes for THIS study, in §17 order, plus the tile ids it refused.
 * The canvas can show `dropped` instead of silently applying a shorter preset.
 */
export function vascularPresetAtomsFor(
  presetId: string,
  ctx: BrainPresetContext,
): { atoms: BrainAtomSpec[]; dropped: string[] } {
  const spec = VASCULAR_PRESET_SPECS.find((p) => p.id === presetId);
  if (!spec) return { atoms: [], dropped: [presetId] };
  const { atoms, dropped } = availableTileAtoms(spec.tiles, ctx);
  if (spec.macro) {
    const gate = spec.macroGate && ctx.vascular
      ? vascularGate(spec.macroGate, ctx.vascular.technique, ctx.vascular.brain)
      : null;
    if (gate && !gate.allowed) {
      return { atoms: [], dropped: [presetId] };
    }
    return { atoms: orderVascularAtoms(spec.module, [...atoms, ...spec.macro()]), dropped };
  }
  return { atoms: orderVascularAtoms(spec.module, atoms), dropped };
}

export const VASCULAR_BRAIN_PRESETS: readonly BrainPreset[] = VASCULAR_PRESET_SPECS.map(
  (spec): BrainPreset => ({
    id: spec.id,
    label: spec.label,
    subMasterId: spec.module as BrainSubMasterId,
    build: (ctx) => {
      const bundleId = brainBundleId("preset", spec.id);
      const region = ctx.region ?? "Brain";
      const { atoms } = vascularPresetAtomsFor(spec.id, ctx);
      return { bundleId, observations: brainAtomsToPatches(region, bundleId, atoms) };
    },
  }),
);

export function vascularBrainPresetById(id: string): BrainPreset | undefined {
  return VASCULAR_BRAIN_PRESETS.find((preset) => preset.id === id);
}

/**
 * §15 module baselines share ONE bundle id on purpose. The ledger treats a baseline block
 * as the report's normal prose, so a second baseline applied as its own bundle supersedes
 * the first one's sentence even when both rows stay in the ledger — which would leave a
 * combined MRA + MRA-neck + MRV report silently missing a normal statement (§2, §15).
 */
export const VASCULAR_NORMAL_BUNDLE_ID = brainBundleId("preset", "vascular-normal-baseline");

export function isVascularNormalPreset(id: string): boolean {
  return VASCULAR_PRESET_SPECS.some((spec) => spec.id === id && spec.normalBaseline);
}

/**
 * The baseline preset a tree-normal tile stands for, so the tile and the preset take the
 * same composed path — two bundles carrying module normals would leave the report with one
 * normal sentence and several normal rows.
 */
export function vascularNormalPresetIdForTile(tileId: string): string | null {
  return (
    VASCULAR_PRESET_SPECS.find(
      (spec) =>
        spec.normalBaseline && spec.tiles.some(([, id]) => id === tileId),
    )?.id ?? null
  );
}

/**
 * The normal preset whose baseline sentence the report currently carries, in §17 order.
 *
 * The SENTENCE decides, not the concept: once an abnormality supersedes a baseline, the
 * remainder normal occupies that same family slot, and matching by concept alone would let
 * a later baseline composition resurrect the all-normal sentence the report has already
 * disowned (§5, §15, §17).
 */
export function vascularNormalPresetIdsInReport(
  carried: Iterable<{ concept?: string | null; findings?: string }>,
): string[] {
  const rows = [...carried];
  return VASCULAR_PRESET_SPECS.filter((spec) => {
    if (!spec.normalBaseline) return false;
    const normal = VASCULAR_TREE_NORMALS[spec.module];
    return rows.some(
      (row) => row.concept === normal.concept && row.findings?.trim() === normal.sentence.trim(),
    );
  }).map((spec) => spec.id);
}

/**
 * Compose the module baselines the report should carry into one bundle. `presetIds` is the
 * set the radiologist has chosen, not what was chosen before, so removing one normal is a
 * plain subtraction rather than a second engine.
 */
export function vascularNormalBundle(
  presetIds: readonly string[],
  ctx: BrainPresetContext,
): { bundleId: string; observations: ReturnType<typeof brainAtomsToPatches> } {
  const region = ctx.region ?? "Brain";
  const atoms = VASCULAR_PRESET_SPECS.filter(
    (spec) => spec.normalBaseline && presetIds.includes(spec.id),
  ).flatMap((spec) => vascularPresetAtomsFor(spec.id, ctx).atoms);
  return {
    bundleId: VASCULAR_NORMAL_BUNDLE_ID,
    observations: brainAtomsToPatches(region, VASCULAR_NORMAL_BUNDLE_ID, atoms),
  };
}
