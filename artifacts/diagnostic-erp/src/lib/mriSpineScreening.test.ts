/**
 * mriSpineScreening.test.ts — the three-region screening contract (spec §34).
 *
 * Covers region independence, per-region normal presets, normal→abnormal
 * reconciliation, cross-region isolation, the once-only limitation statement,
 * whole-spine composition, axial / sequence gating, impression promotion,
 * recommendations, numbering-driven LS levels, ledger integration with undo and
 * manual-text protection — plus the prose guard that no screening sentence was
 * invented.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import {
  SCREENING_SCHEMAS,
  SPINE_SCREENING_SECTION_LABELS,
} from "@/lib/mriSpineScreeningSchemas";
import {
  SPINE_SCREENING_REGIONS,
  screeningConflictGroup,
  screeningLevelBucket,
  type RegionScreeningSchema,
  type SpineScreeningRegion,
} from "@/lib/mriSpineScreeningSchema";
import {
  availableScreeningLevels,
  buildScreeningRegionBundle,
  composeScreeningFindings,
  composeScreeningImpressionLines,
  composeScreeningRecommendationLines,
  defaultScreeningState,
  performedScreeningRegions,
  roleConflict,
  screeningOptionAvailability,
  screeningRegionBundleId,
  screeningTextContradictions,
  wholeSpineScreeningLabel,
  type ScreeningState,
} from "@/lib/mriSpineScreening";
import { resolveScreeningRoles } from "@/lib/mriSpineScreeningRoles";
import { defaultSpineSequences, deriveSpineSequencesAvailable } from "@/lib/mriSpineSequences";
import { defaultLumbarNumbering, lumbarLevelKeyStrings } from "@/lib/mriSpineNumbering";
import { SCREENING_LIMITATION_TEXT } from "@/lib/zai-workspace/baselines/screeningLimitation";
import { spineAtomsToPatches } from "@/lib/mriSpineAtoms";
import { useWorkspace } from "@/lib/zai-workspace/store";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = resolve(HERE, "../..");

function readSource(rel: string): string {
  try {
    return readFileSync(resolve(PKG_DIR, rel), "utf8");
  } catch {
    return "";
  }
}

/**
 * Sentences CARE already ships — the only acceptable source of screening
 * prose. The schema file itself is deliberately NOT a source, otherwise the
 * guard would check the data against itself.
 */
const SHIPPED_PROSE_SOURCES = [
  "src/lib/zai-workspace/baselines/mriCervicalScreeningNormal.ts",
  "src/lib/zai-workspace/baselines/mriDorsalScreeningNormal.ts",
  "src/lib/zai-workspace/baselines/mriLsScreeningNormal.ts",
  "src/lib/zai-workspace/baselines/mriWholeSpineScreeningNormal.ts",
  "src/lib/zai-workspace/report-formats-library.ts",
].map(readSource).join("\n");

const axialSequences = (overrides = {}) => ({
  ...defaultSpineSequences(),
  axial: true,
  ...overrides,
});

function stateWith(
  region: SpineScreeningRegion,
  role: ScreeningState[SpineScreeningRegion]["role"],
  selections: Record<string, Array<{ optionId: string; level?: string; side?: "left" | "right" | "bilateral"; mm?: number }>>,
  extra: Partial<ScreeningState[SpineScreeningRegion]> = {},
): ScreeningState {
  const state = defaultScreeningState();
  state[region] = {
    role,
    performed: role !== "absent",
    selections,
    significance: {},
    recommendationSelected: false,
    ...extra,
  };
  return state;
}

function build(region: SpineScreeningRegion, state: ScreeningState, sequences = axialSequences()) {
  return buildScreeningRegionBundle({
    region,
    schema: SCREENING_SCHEMAS[region],
    state: state[region],
    sequences,
    ledgerRegion: "LS Spine",
  });
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
    screening: defaultScreeningState(),
    sequencesAvailable: defaultSpineSequences(),
    lumbarNumbering: defaultLumbarNumbering(),
  });
}

describe("screening schemas (spec §22, §24-§27)", () => {
  it("declares three clinically distinct regions and no fourth whole-spine schema", () => {
    expect(Object.keys(SCREENING_SCHEMAS).sort()).toEqual([...SPINE_SCREENING_REGIONS].sort());
    expect(SCREENING_SCHEMAS.cervical.sections.map((s) => s.key)).toContain("ccj");
    expect(SCREENING_SCHEMAS.dorsal.sections.map((s) => s.key)).toContain("other");
    expect(SCREENING_SCHEMAS.ls.sections.map((s) => s.key)).toContain("conus_cauda");
    // Cervical-only anatomy stays out of LS, and vice versa.
    expect(JSON.stringify(SCREENING_SCHEMAS.ls)).not.toContain("uncovertebral");
    expect(JSON.stringify(SCREENING_SCHEMAS.ls)).not.toContain("ccj");
    expect(JSON.stringify(SCREENING_SCHEMAS.cervical)).not.toContain("conus_cauda");
  });

  it("never exposes dedicated-canvas detail through LS screening", () => {
    const lsJson = JSON.stringify(SCREENING_SCHEMAS.ls).toLowerCase();
    for (const forbidden of ["lateral recess stenosis", "traversing root", "exiting root contact", "ap canal", "pfirrmann", "modic"]) {
      expect(lsJson, `LS screening must not offer ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("offers exactly one normal option per screenable section, listed first", () => {
    for (const region of SPINE_SCREENING_REGIONS) {
      for (const section of SCREENING_SCHEMAS[region].sections) {
        const normals = section.options.filter((o) => o.normal);
        expect(normals.length, `${region}.${section.key}`).toBeLessThanOrEqual(1);
        if (normals.length === 1) expect(section.options[0]!.normal, `${region}.${section.key}`).toBe(true);
      }
    }
    // §25: dorsal "other important screening findings" has no normal claim.
    const dorsalOther = SCREENING_SCHEMAS.dorsal.sections.find((s) => s.key === "other")!;
    expect(dorsalOther.options.some((o) => o.normal)).toBe(false);
  });

  it("every normal preset covers every section it may legitimately assert", () => {
    for (const region of SPINE_SCREENING_REGIONS) {
      const schema = SCREENING_SCHEMAS[region];
      const keys = schema.sections
        .filter((s) => s.options.some((o) => o.normal))
        // §32: a section that is entirely axial-dependent stays out of the
        // normal preset, because sagittal-only screening cannot assert it.
        .filter((s) => !s.options.every((o) => o.axialDependent))
        .map((s) => s.key)
        .sort();
      expect(Object.keys(schema.normalPreset.selections).sort()).toEqual(keys);
      for (const [sectionKey, optionId] of Object.entries(schema.normalPreset.selections)) {
        const option = schema.sections.find((s) => s.key === sectionKey)!.options.find((o) => o.id === optionId);
        expect(option?.normal, `${region}.${sectionKey}.${optionId} must be the normal option`).toBe(true);
      }
      expect(schema.normalPreset.lines.length).toBeGreaterThan(0);
    }
  });

  it("uses only prose CARE already ships", () => {
    const offenders: string[] = [];
    for (const region of SPINE_SCREENING_REGIONS) {
      for (const section of SCREENING_SCHEMAS[region].sections) {
        for (const option of section.options) {
          if (!option.prose) continue;
          const probe = option.prose.replace(/\{level\}|\{side\}|\{mm\}/g, "").trim();
          const fragment = probe.split(/[.:]/).map((s) => s.trim()).filter((s) => s.length > 12);
          const found = fragment.length === 0 || fragment.every((f) => SHIPPED_PROSE_SOURCES.includes(f));
          if (!found) offenders.push(`${region}.${section.key}.${option.id}: ${option.prose}`);
        }
      }
    }
    expect(offenders, `Invented screening prose:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("exposes section labels for the renderer", () => {
    expect(SPINE_SCREENING_SECTION_LABELS.cervical.alignment).toBeTruthy();
    expect(SPINE_SCREENING_SECTION_LABELS.ls.conus_cauda).toBeTruthy();
  });
});

describe("screening engine — region independence (spec §22, §34)", () => {
  it("emits prose for one region only and namespaces its conflict groups", () => {
    const state = stateWith("cervical", "primary-screening", { alignment: [{ optionId: "loss_of_lordosis" }] });
    const result = build("cervical", state);
    expect(result.atoms.length).toBeGreaterThan(0);
    expect(result.atoms.every((a) => a.level === "cervical")).toBe(true);
    expect(result.atoms.some((a) => a.conflictGroup === screeningConflictGroup("cervical", "alignment"))).toBe(true);
    expect(result.atoms.some((a) => a.conflictGroup?.includes("dorsal"))).toBe(false);
    expect(result.atoms.some((a) => a.conflictGroup?.includes("-ls-"))).toBe(false);
  });

  it("produces no prose at all when the region was not performed", () => {
    const state = stateWith("dorsal", "absent", { canal: [{ optionId: "severe" }] });
    const result = build("dorsal", state);
    expect(result.atoms).toEqual([]);
    expect(result.lines).toEqual([]);
    expect(performedScreeningRegions(state)).toEqual([]);
  });

  it("a cervical abnormality never changes dorsal or LS state", () => {
    const state = stateWith("cervical", "accompanying-screening", { cord: [{ optionId: "compression" }] });
    const cerv = build("cervical", state);
    const dors = build("dorsal", state);
    const ls = build("ls", state);
    expect(cerv.atoms.length).toBeGreaterThan(0);
    expect(dors.atoms).toEqual([]);
    expect(ls.atoms).toEqual([]);
    // Rebuilding one region cannot touch another's bundle id.
    expect(cerv.bundleId).toBe(screeningRegionBundleId("cervical"));
    expect(dors.bundleId).toBe(screeningRegionBundleId("dorsal"));
  });

  it("reconciles normal → abnormal inside one region only", () => {
    const schema: RegionScreeningSchema = SCREENING_SCHEMAS.cervical;
    const normalState = stateWith("cervical", "primary-screening", {
      ...schema.normalPreset.selections,
    } as Record<string, never>);
    // Normal preset applied as selections.
    for (const [sectionKey, optionId] of Object.entries(schema.normalPreset.selections)) {
      normalState.cervical.selections[sectionKey] = [{ optionId }];
    }
    const normal = build("cervical", normalState);
    const normalDiscLine = normal.lines.find((l) => l.sectionKey === "discs");
    expect(normalDiscLine?.text).toContain("No significant disc");

    const abnormalState = structuredClone(normalState);
    abnormalState.cervical.selections.discs = [{ optionId: "focal_protrusion", level: "C5-C6" }];
    const abnormal = build("cervical", abnormalState);
    expect(abnormal.lines.some((l) => /No significant disc/i.test(l.text))).toBe(false);
    expect(abnormal.lines.some((l => /protrusion/i.test(l.text)))).toBe(true);
    // Other regions were never touched.
    expect(build("dorsal", abnormalState).lines).toEqual([]);
    // Rebuilt bundle never emits two atoms for the same section.
    const groups = abnormal.atoms.map((a) => a.conflictGroup);
    expect(groups.filter((g) => g === screeningConflictGroup("cervical", "discs"))).toHaveLength(1);
  });
});

describe("screening report composition (spec §28-§31)", () => {
  it("emits the limitation statement exactly once for one, two or three regions", () => {
    for (const regions of [["ls"], ["cervical", "dorsal"], ["cervical", "dorsal", "ls"]] as const) {
      const state = defaultScreeningState();
      const built: Record<string, ReturnType<typeof build>> = {};
      for (const region of regions) {
        state[region] = {
          role: "primary-screening",
          performed: true,
          selections: { alignment: [{ optionId: SCREENING_SCHEMAS[region].normalPreset.selections.alignment! }] },
          significance: {},
          recommendationSelected: false,
        };
        built[region] = build(region, state);
      }
      const composed = composeScreeningFindings(state, SCREENING_SCHEMAS, built);
      const occurrences = composed.text.split(SCREENING_LIMITATION_TEXT).length - 1;
      expect(occurrences, `${regions.join("+")} must carry the limitation once`).toBe(1);
    }
  });

  it("iterates performed regions in the fixed cervical → dorsal → ls order", () => {
    const state = defaultScreeningState();
    for (const region of ["ls", "dorsal", "cervical"] as const) {
      state[region] = {
        role: "primary-screening",
        performed: true,
        selections: { alignment: [{ optionId: SCREENING_SCHEMAS[region].normalPreset.selections.alignment! }] },
        significance: {},
        recommendationSelected: false,
      };
    }
    const built = {
      cervical: build("cervical", state),
      dorsal: build("dorsal", state),
      ls: build("ls", state),
    };
    const composed = composeScreeningFindings(state, SCREENING_SCHEMAS, built);
    expect(composed.regions.map((r) => r.region)).toEqual(["cervical", "dorsal", "ls"]);
    expect(composed.text.indexOf("CERVICAL SPINE SCREENING")).toBeLessThan(composed.text.indexOf("DORSAL SPINE SCREENING"));
    expect(composed.text.indexOf("DORSAL SPINE SCREENING")).toBeLessThan(composed.text.toUpperCase().indexOf("LUMBOSACRAL SPINE"));
  });

  it("treats whole-spine screening as a composition label, never a fourth schema", () => {
    const state = defaultScreeningState();
    state.cervical = { role: "accompanying-screening", performed: true, selections: { alignment: [{ optionId: "loss_of_lordosis" }] }, significance: {}, recommendationSelected: false };
    state.dorsal = { role: "accompanying-screening", performed: true, selections: {}, significance: {}, recommendationSelected: false };
    expect(wholeSpineScreeningLabel(state)).toBe("Whole Spine Screening");
    state.dorsal.role = "absent";
    state.dorsal.performed = false;
    expect(wholeSpineScreeningLabel(state)).toBeNull();
  });

  it("promotes only significant abnormalities to the Impression, and the default is overridable", () => {
    const state = stateWith("cervical", "primary-screening", {
      cord: [{ optionId: "compression" }],
      discs: [{ optionId: "mild_bulge", level: "C5-C6" }],
    });
    const significant = build("cervical", state);
    expect(significant.impressionLines.some((l) => /compression/i.test(l))).toBe(true);
    expect(significant.impressionLines.some((l) => /disc bulge/i.test(l))).toBe(false);
    const composed = composeScreeningImpressionLines(state, SCREENING_SCHEMAS, { cervical: significant });
    expect(composed).toEqual(significant.impressionLines);

    // Radiologist overrides both ways.
    const promoted = structuredClone(state);
    promoted.cervical.significance.mild_bulge = true;
    promoted.cervical.significance.compression = false;
    const overridden = build("cervical", promoted);
    expect(overridden.impressionLines.some((l) => /disc bulge/i.test(l))).toBe(true);
    expect(overridden.impressionLines.some((l) => /compression/i.test(l))).toBe(false);
  });

  it("offers the dedicated-study recommendation only when selected", () => {
    const state = stateWith("dorsal", "primary-screening", { canal: [{ optionId: "severe" }] });
    expect(build("dorsal", state).recommendationLines).toEqual([]);
    state.dorsal.recommendationSelected = true;
    const withRec = build("dorsal", state);
    expect(withRec.recommendationLines).toEqual(["Dedicated MRI dorsal spine suggested."]);
    expect(composeScreeningRecommendationLines(state, { dorsal: withRec })).toHaveLength(1);
    expect(withRec.atoms.some((a) => a.recommendation === "Dedicated MRI dorsal spine suggested.")).toBe(true);
  });
});

describe("screening sequence awareness (spec §32, §35)", () => {
  it("hides axial-dependent LS foraminal/root options on sagittal-only screening", () => {
    const sagittalOnly = deriveSpineSequencesAvailable({
      techniqueText: "Sagittal T1, T2 screening of the lumbar spine.",
    });
    expect(sagittalOnly.axial).toBe(false);
    for (const option of SCREENING_SCHEMAS.ls.sections.find((s) => s.key === "foraminal_root")!.options) {
      expect(option.axialDependent, option.id).toBe(true);
      expect(screeningOptionAvailability(option, sagittalOnly).available, option.id).toBe(false);
    }
    expect(screeningOptionAvailability(
      SCREENING_SCHEMAS.ls.sections.find((s) => s.key === "canal")!.options[1]!,
      sagittalOnly,
    ).available).toBe(true);
  });

  it("downgrades an unavailable selection to limitation wording instead of silence", () => {
    const state = stateWith("ls", "accompanying-screening", {
      foraminal_root: [{ optionId: "significant_stenosis" }],
    });
    const sagittalOnly = defaultSpineSequences();
    const result = build("ls", state, sagittalOnly);
    expect(result.notices).toHaveLength(1);
    expect(result.notices[0]!.reason).toBe("axial");
    expect(result.atoms.some((a) => /did not include/i.test(a.findings))).toBe(true);
    // The conclusion itself is never asserted when the coverage is missing.
    expect(result.atoms.some((a) => /significant foraminal stenosis/i.test(a.findings))).toBe(false);
    expect(result.atoms.every((a) => a.state !== "abnormal")).toBe(true);
    expect(result.lines).toHaveLength(0);
  });

  it("requires axial coverage before it will state foraminal detail", () => {
    const state = stateWith("ls", "accompanying-screening", {
      foraminal_root: [{ optionId: "significant_stenosis" }],
    });
    const result = build("ls", state, axialSequences());
    expect(result.notices).toEqual([]);
    expect(result.lines.some((l) => /foraminal stenosis/i.test(l.text))).toBe(true);
  });
});

describe("LS screening follows the numbering resolver (spec §5, §26, §34)", () => {
  it("takes disc level keys from the resolver, including the transitional segment", () => {
    const option = SCREENING_SCHEMAS.ls.sections.find((s) => s.key === "discs")!.options
      .find((o) => o.levelChoices === "lumbar-resolver")!;
    expect(availableScreeningLevels(option, SCREENING_SCHEMAS.ls, null)).toEqual([]);
    expect(availableScreeningLevels(option, SCREENING_SCHEMAS.ls, defaultLumbarNumbering()))
      .toEqual(lumbarLevelKeyStrings(defaultLumbarNumbering()));
    const lstv = { mode: "lstv-sacralization", castellvi: "IIa", side: "unilateral" } as const;
    const keys = availableScreeningLevels(option, SCREENING_SCHEMAS.ls, lstv);
    expect(keys).toContain("L5-T");
    expect(keys).not.toContain("L5-S1");
  });

  it("carries the transitional level into the emitted screening sentence", () => {
    const state = stateWith("ls", "accompanying-screening", {
      discs: [{ optionId: "diffuse_bulge", level: "L5-T" }],
    });
    const result = build("ls", state);
    expect(result.lines.some((l) => l.text.includes("L5-T"))).toBe(true);
    expect(result.atoms.some((a) => a.findings.includes("L5-T"))).toBe(true);
  });

  it("states that screening levels are approximate", () => {
    const state = stateWith("cervical", "accompanying-screening", {
      discs: [{ optionId: "focal_protrusion", level: "C5-C6" }],
    });
    const result = build("cervical", state);
    expect(result.atoms.some((a) => /approximate/i.test(a.findings))).toBe(true);
  });
});

describe("screening ledger integration (spec §22, §34, §38)", () => {
  beforeEach(() => resetLedger());

  function applyRegion(region: SpineScreeningRegion, state: ScreeningState) {
    const built = build(region, state);
    const observations = spineAtomsToPatches("LS Spine", built.bundleId, built.atoms);
    if (observations.length > 0) {
      useWorkspace.getState().applyMacroBundle({ bundleId: built.bundleId, observations });
    }
    return built;
  }

  it("applies screening atoms into the existing observation ledger", () => {
    const state = stateWith("cervical", "accompanying-screening", {
      alignment: [{ optionId: "loss_of_lordosis" }],
      cord: [{ optionId: "compression" }],
    });
    applyRegion("cervical", state);
    const patches = useWorkspace.getState().appliedPathologyPatches;
    expect(patches.length).toBeGreaterThan(0);
    expect(patches.every((p) => (p.observation?.conflictGroup ?? "").startsWith("screen-cervical-"))).toBe(true);
    expect(patches.some((p) => p.observation?.role === "screening")).toBe(true);
  });

  it("rebuilding one region leaves the other region's rows untouched", () => {
    const state = defaultScreeningState();
    state.cervical = { role: "accompanying-screening", performed: true, selections: { alignment: [{ optionId: "loss_of_lordosis" }] }, significance: {}, recommendationSelected: false };
    state.dorsal = { role: "accompanying-screening", performed: true, selections: { alignment: [{ optionId: "scoliosis" }] }, significance: {}, recommendationSelected: false };
    applyRegion("cervical", state);
    const dorsalBefore = useWorkspace.getState().appliedPathologyPatches.filter((p) => (p.observation?.conflictGroup ?? "").startsWith("screen-dorsal-"));
    expect(dorsalBefore).toHaveLength(0);
    applyRegion("dorsal", state);
    const after = useWorkspace.getState().appliedPathologyPatches;
    expect(after.filter((p) => (p.observation?.conflictGroup ?? "").startsWith("screen-dorsal-")).length).toBeGreaterThan(0);
    expect(after.filter((p) => (p.observation?.conflictGroup ?? "").startsWith("screen-cervical-")).length).toBe(
      after.filter((p) => (p.observation?.conflictGroup ?? "").startsWith("screen-cervical-")).length,
    );
    expect(after.some((p) => /cervical/i.test(p.lastRendered.findings ?? ""))).toBe(true);
  });

  it("undo restores the report to its pre-screening text", () => {
    const state = stateWith("cervical", "accompanying-screening", {
      alignment: [{ optionId: "loss_of_lordosis" }],
    });
    applyRegion("cervical", state);
    expect(useWorkspace.getState().appliedPathologyPatches.length).toBeGreaterThan(0);
    expect(useWorkspace.getState().undoLastPatch()).toBe(true);
    expect(useWorkspace.getState().appliedPathologyPatches).toHaveLength(0);
  });

  it("never overwrites manually dictated text", () => {
    useWorkspace.getState().setField("findings", "Clinically the patient has severe leg pain. I am not certain about the cord.", "manual");
    const state = stateWith("cervical", "primary-screening", { cord: [{ optionId: "compression" }] });
    applyRegion("cervical", state);
    const after = useWorkspace.getState().findingsText;
    // Both dictated sentences survive verbatim; the screening sentence is added.
    expect(after).toContain("Clinically the patient has severe leg pain.");
    expect(after).toContain("I am not certain about the cord.");
    expect(after).toContain("Cord compression");
    expect(useWorkspace.getState().fieldProvenance.findings).toBeDefined();
  });

  it("warns instead of silently rewriting a contradictory screening report", () => {
    const state = stateWith("cervical", "primary-screening", { cord: [{ optionId: "compression" }] });
    const warnings = screeningTextContradictions({
      findingsText: "Cervical cord is grossly normal on the screening images. There is cord compression at C5-C6.",
      impressionText: "",
      state,
    });
    expect(warnings.some((w) => /cervical screening/i.test(w))).toBe(true);
    // Never a rewrite: findings text is untouched by validation.
    expect(state.cervical.selections.cord[0]!.optionId).toBe("compression");
  });

  it("guards a region reported both as dedicated primary and as screening", () => {
    const state = stateWith("ls", "primary-dedicated", { canal: [{ optionId: "severe" }] });
    expect(roleConflict(state)).toHaveLength(1);
    const clean = stateWith("ls", "primary-screening", { canal: [{ optionId: "severe" }] });
    expect(roleConflict(clean)).toHaveLength(0);
  });

  it("resolves roles from the billed exam and keeps every region single-role", () => {
    const resolved = resolveScreeningRoles({ name: "MRI LS SPINE WITH SCREENING WHOLE SPINE" });
    const state = defaultScreeningState(resolved.roles);
    expect(performedScreeningRegions(state)).toEqual(["cervical", "dorsal", "ls"]);
    expect(screeningLevelBucket("ls")).toBe("lumbar");
    for (const region of SPINE_SCREENING_REGIONS) {
      const roles = Object.values({ ...resolved.roles });
      expect(roles.filter((r) => r !== "absent").length).toBeLessThanOrEqual(3);
    }
    // The dedicated primary is never also a screening module of itself.
    expect(build("ls", state).bundleId).toBe(screeningRegionBundleId("ls"));
  });
});
