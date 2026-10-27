/**
 * mriDorsoLumbarJunction.test.ts — the junction rule is enforced at the ledger
 * boundary, not inside the canvas (dorso-lumbar spec §6, plus the hard
 * requirement that no non-UI write path may create a second T12-L1 identity).
 *
 * The ledger identifies a slot by region + concept + level + laterality, and a
 * patch's own region wins over the study's reporting region. So a thoracic-domain
 * atom and a lumbar-domain atom describing the same bridge finding would both
 * survive as separate observations, and a reversed spelling ("L1-T12") normalizes
 * differently again. Canonicalization therefore runs in `observationFromPending`,
 * which every write path goes through — presets, macros, quick-select, AI
 * proposals, imported observations and restored drafts.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  JUNCTION_LEDGER_REGION,
  JUNCTION_LEVEL,
  canonicalDorsoLumbarLevel,
  defaultDorsoLumbarState,
  dorsolumbarFullLevelSequence,
  dorsolumbarLevelDomain,
  dorsolumbarLevelKeyStrings,
  dorsolumbarLevelKeys,
  dorsolumbarNeedsConsistencyCheck,
  dorsolumbarNumberingBanner,
  dorsolumbarNumberingCaution,
  dorsolumbarStrandedLevels,
  type DorsoLumbarState,
} from "@/lib/mriDorsoLumbarCoverage";
import {
  canonicalizeDorsoLumbarOwnership,
  dorsolumbarJunctionSlot,
  dorsolumbarJunctionWarnings,
} from "@/lib/mriDorsoLumbarJunction";
import { displayLevel, normalizeLevel } from "@/lib/observationSlot";
import { spineAtomsToPatches, type SpineAtomSpec } from "@/lib/mriSpineAtoms";
import { defaultLumbarNumbering, lumbarLevelKeys } from "@/lib/mriSpineNumbering";
import { defaultSpineSequences } from "@/lib/mriSpineSequences";
import { defaultScreeningState } from "@/lib/mriSpineScreening";
import { useWorkspace } from "@/lib/zai-workspace/store";

const SYSTEM_NORMAL_PATCH_ID = "system-normal-study";

function resetLedger(composition: string) {
  useWorkspace.setState({
    appliedPathologyPatches: [],
    patchUndoStack: [],
    lastPatchSnapshot: null,
    findingsText: "",
    impressionText: "",
    recommendationText: "",
    fieldProvenance: {},
    canalApProvenance: {},
    impressionOrderFrozen: false,
    lumbarNumbering: defaultLumbarNumbering(),
    sequencesAvailable: defaultSpineSequences(),
    screening: defaultScreeningState(),
    studyComposition: composition as never,
    studyCompositionProvenance: "catalog-code",
    studyCompositionOverridden: false,
  });
}

/** The junction rows currently in the ledger, whatever region spelled them. */
function junctionRows() {
  return useWorkspace.getState().appliedPathologyPatches
    .filter((p) => p.id !== SYSTEM_NORMAL_PATCH_ID)
    .filter((p) => dorsolumbarLevelDomain(p.observation?.level ?? "") === "junction");
}

function atomsFor(level: string, label: string, concept = "cord_compression"): SpineAtomSpec[] {
  return [{
    concept,
    conflictGroup: concept,
    anatomicalSection: level,
    level,
    findings: `${label} at the junction.`,
  }];
}

function bundle(region: string, level: string, label: string, bundleId: string) {
  return spineAtomsToPatches(region, bundleId, atomsFor(level, label));
}

describe("canonicalization (spec §6)", () => {
  it("rewrites the bridge onto one identity only inside a dorso-lumbar composition", () => {
    const fromLumbarSide = canonicalizeDorsoLumbarOwnership(
      { region: "LS Spine", level: "L1-T12", anatomicalSection: "L1-T12" },
      "dorsolumbar-dedicated",
    );
    expect(fromLumbarSide.changed).toBe(true);
    expect(fromLumbarSide.region).toBe(JUNCTION_LEDGER_REGION);
    expect(fromLumbarSide.level).toBe(JUNCTION_LEVEL);
    expect(fromLumbarSide.junction).toBe(true);

    const untouched = canonicalizeDorsoLumbarOwnership(
      { region: "LS Spine", level: "L1-T12", anatomicalSection: "L1-T12" },
      "ls-dedicated",
    );
    expect(untouched.changed).toBe(false);
    expect(untouched.region).toBe("LS Spine");
    expect(untouched.level).toBe("L1-T12");
  });

  it("keeps ordinary thoracic and lumbar levels where they belong", () => {
    expect(canonicalizeDorsoLumbarOwnership({ region: "Dorsal Spine", level: "T8-T9" }, "dorsolumbar-dedicated"))
      .toMatchObject({ region: "Dorsal Spine", level: "D8-D9", junction: false });
    expect(canonicalizeDorsoLumbarOwnership({ region: "LS Spine", level: "L3-L4" }, "dorsolumbar-dedicated"))
      .toMatchObject({ region: "LS Spine", level: "L3-L4", junction: false });
    expect(canonicalizeDorsoLumbarOwnership({ region: "LS Spine", level: "L5-T" }, "dorsolumbar-dedicated"))
      .toMatchObject({ region: "LS Spine", level: "L5-T", junction: false });
  });

  it("names the canonical junction slot", () => {
    expect(dorsolumbarJunctionSlot()).toEqual({
      region: JUNCTION_LEDGER_REGION,
      level: JUNCTION_LEVEL,
      storedLevel: normalizeLevel(JUNCTION_LEVEL),
    });
  });
});

describe("the ledger boundary (hard requirement 1)", () => {
  beforeEach(() => resetLedger("dorsolumbar-dedicated"));

  it("cannot be given two junction identities through a macro path", () => {
    // No canvas, no panel: two programmatic bundles, one per domain, and the
    // second uses a reversed spelling as well as a different ledger region.
    useWorkspace.getState().applyMacroBundle({
      bundleId: "dl-thoracic-side",
      observations: bundle("Dorsal Spine", "T12-L1", "Thoracic-side finding", "b1"),
    });
    useWorkspace.getState().applyMacroBundle({
      bundleId: "dl-lumbar-side",
      observations: bundle("LS Spine", "L1-T12", "Lumbar-side finding", "b2"),
    });

    const rows = junctionRows();
    expect(rows.length, "T12-L1 must occupy exactly one slot").toBe(1);
    // The ledger stores normalized levels; the junction reads back as T12-L1.
    expect(rows[0]!.observation?.level).toBe(normalizeLevel(JUNCTION_LEVEL));
    expect(displayLevel(rows[0]!.observation?.level ?? "")).toBe(JUNCTION_LEVEL);
    expect(rows[0]!.observation?.region).toBe(JUNCTION_LEDGER_REGION);
    expect(dorsolumbarJunctionWarnings(useWorkspace.getState().appliedPathologyPatches, "dorsolumbar-dedicated"))
      .toEqual([]);
  });

  it("still allows two different concepts at the junction", () => {
    useWorkspace.getState().applyMacroBundle({
      bundleId: "dl-a",
      observations: spineAtomsToPatches("Dorsal Spine", "dl-a",
        atomsFor(JUNCTION_LEVEL, "Cord compression", "cord_compression")),
    });
    useWorkspace.getState().applyMacroBundle({
      bundleId: "dl-b",
      observations: spineAtomsToPatches("Dorsal Spine", "dl-b",
        [{
          concept: "conus_medullaris",
          conflictGroup: "conus_signal",
          anatomicalSection: JUNCTION_LEVEL,
          level: JUNCTION_LEVEL,
          findings: "Intrinsic conus T2 signal change.",
        }]),
    });
    const junction = junctionRows();
    expect(junction.length).toBe(2);
    expect(new Set(junction.map((p) => p.observation?.concept)).size).toBe(2);
  });

  it("proves the guarantee comes from the rule, not the fixtures", () => {
    // Same two bundles with no dorso-lumbar composition: the ledger really does
    // split them into two junction-shaped observations under two regions.
    resetLedger("unknown");
    useWorkspace.getState().applyMacroBundle({ bundleId: "c1", observations: bundle("Dorsal Spine", "T12-L1", "Thoracic-side finding", "c1") });
    useWorkspace.getState().applyMacroBundle({ bundleId: "c2", observations: bundle("LS Spine", "L1-T12", "Lumbar-side finding", "c2") });
    const rows = junctionRows();
    expect(rows.length).toBe(2);
    expect(new Set(rows.map((p) => p.observation?.region))).toEqual(new Set(["Dorsal Spine", "LS Spine"]));
    // and the levels really were two different stored identities
    expect(new Set(rows.map((p) => p.observation?.level))).toEqual(new Set(["D12-L1", "L1-D12"]));
  });

  it("flags a junction row that predates canonicalization instead of rewriting it", () => {
    useWorkspace.setState({
      appliedPathologyPatches: [{
        id: "legacy-row",
        ownership: { anatomicalSection: "L1-T12", conflictGroup: "legacy", concept: "cord_compression", baselineReplaces: "" },
        templates: { findings: "Recorded before the composition was recognised." },
        lastRendered: { findings: "Recorded before the composition was recognised." },
        source: "structured-template",
        observation: {
          id: "legacy-row", region: "LS Spine", anatomicalSection: "L1-T12", concept: "cord_compression",
          conceptSource: "explicit", conflictGroup: "legacy", level: "L1-D12", laterality: "", state: "", severity: "",
          measurement: "", slotKey: "legacy", source: "structured-template", baselineReplaces: "",
          specificity: "region", role: "finding", supportsLaterality: false,
        },
        replacedBaseline: { findings: [], impression: [] },
        protected: false,
      }],
    });
    const warnings = dorsolumbarJunctionWarnings(useWorkspace.getState().appliedPathologyPatches, "dorsolumbar-dedicated");
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/owns the thoracolumbar junction once/);
    // Reported, never silently repaired.
    expect(useWorkspace.getState().appliedPathologyPatches[0]!.observation?.region).toBe("LS Spine");
    // A dedicated dorsal study is not affected by this check at all.
    expect(dorsolumbarJunctionWarnings(useWorkspace.getState().appliedPathologyPatches, "dorsal-dedicated")).toEqual([]);
  });
});

describe("transitional anatomy does not move the bridge (hard requirement 2)", () => {
  const junctionOf = (state: DorsoLumbarState) => dorsolumbarLevelKeys(state).filter((k) => k.domain === "junction").map((k) => k.key);

  it("sacralized L5 changes the lumbar tail only", () => {
    const base = defaultDorsoLumbarState({ superior: "T11-T12", inferior: "L5-S1" });
    const sacralized = defaultDorsoLumbarState({
      superior: "T11-T12",
      inferior: "L5-T",
      lumbar: { ...defaultLumbarNumbering(), mode: "lstv-sacralization", castellvi: "IIIb", side: "bilateral" },
    });
    expect(junctionOf(base)).toEqual([JUNCTION_LEVEL]);
    expect(junctionOf(sacralized)).toEqual([JUNCTION_LEVEL]);
    expect(dorsolumbarLevelKeyStrings(sacralized)).not.toContain("L5-S1");
    expect(lumbarLevelKeys(sacralized.lumbar).at(-1)!.key).toBe("L5-T");
    // The bridge is untouched, so no junction finding is re-labelled.
    expect(canonicalDorsoLumbarLevel("T12-L1")!.key).toBe(JUNCTION_LEVEL);
  });

  it("lumbarized S1 adds a lumbar-type segment only", () => {
    const lumbarized = defaultDorsoLumbarState({
      superior: "T12-L1",
      inferior: "L6-S1",
      lumbar: { ...defaultLumbarNumbering(), mode: "lstv-lumbarization" },
    });
    expect(junctionOf(lumbarized)).toEqual([JUNCTION_LEVEL]);
    expect(dorsolumbarLevelKeyStrings(lumbarized)).toEqual(["D12-L1", "L1-L2", "L2-L3", "L3-L4", "L4-L5", "L5-L6", "L6-S1"]);
  });

  it("uncertain enumeration preserves uncertainty instead of renumbering upward", () => {
    const uncertain = defaultDorsoLumbarState({ numbering: "uncertain" });
    expect(junctionOf(uncertain)).toEqual([JUNCTION_LEVEL]);
    expect(dorsolumbarNumberingCaution(uncertain)).toMatch(/uncertain on this examination/);
    expect(dorsolumbarNeedsConsistencyCheck(uncertain)).toBe(true);
    expect(dorsolumbarNumberingBanner(uncertain)).toMatch(/require review before finalization/);
    // A review warning lists the affected levels; it never renames them.
    const rows = [{ observation: { level: "D12-L1" } }];
    const narrowed = defaultDorsoLumbarState({ superior: "T11-T12", inferior: "L1-L2" });
    expect(dorsolumbarStrandedLevels(rows, narrowed)).toEqual([]);
    expect(rows[0]!.observation!.level).toBe("D12-L1");
  });

  it("whole-spine-confirmed numbering adds no caveat", () => {
    const confirmed = defaultDorsoLumbarState({ numbering: "localizer-confirmed", wholeSpineLocalizer: true });
    expect(junctionOf(confirmed)).toEqual([JUNCTION_LEVEL]);
    expect(dorsolumbarNumberingCaution(confirmed)).not.toMatch(/reduced certainty|numbered from|uncertain/);
    expect(dorsolumbarNeedsConsistencyCheck(confirmed)).toBe(false);
  });

  it("keeps the four concepts modelled separately", () => {
    const state = defaultDorsoLumbarState({
      numbering: "thoracolumbar-landmark",
      lumbar: { ...defaultLumbarNumbering(), mode: "lstv-sacralization", castellvi: "IIa", side: "unilateral" },
    });
    // junction identity
    expect(canonicalDorsoLumbarLevel("T12-L1")!.junction).toBe(true);
    // lumbar numbering + transitional anatomy
    expect(state.lumbar.mode).toBe("lstv-sacralization");
    expect(dorsolumbarFullLevelSequence(state.lumbar).at(-1)!.key).toBe("L5-T");
    // numbering confidence
    expect(dorsolumbarNeedsConsistencyCheck(state)).toBe(true);
    // and none of those changed the bridge
    expect(dorsolumbarFullLevelSequence(state.lumbar).filter((k) => k.domain === "junction").map((k) => k.key))
      .toEqual([JUNCTION_LEVEL]);
  });
});
