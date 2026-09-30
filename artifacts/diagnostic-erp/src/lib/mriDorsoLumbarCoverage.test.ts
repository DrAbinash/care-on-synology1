/**
 * mriDorsoLumbarCoverage.test.ts — coverage is authoritative, and the junction
 * has one identity (dorso-lumbar spec §4, §5, §6, §12, §13).
 *
 * The failure these tests exist to prevent is a Dorso-Lumbar report that reads
 * as if T1 to S1 had been acquired, or that records the thoracolumbar junction
 * twice — once from each half of the examination — because the ledger keys slots
 * by region + concept + level + laterality.
 */

import { describe, expect, it } from "vitest";

import {
  DORSOLUMBAR_NUMBERING_MODES,
  JUNCTION_LEDGER_REGION,
  JUNCTION_LEVEL,
  canonicalDorsoLumbarLevel,
  defaultDorsoLumbarState,
  dorsolumbarApLevels,
  dorsolumbarCaudaCovered,
  dorsolumbarConusCovered,
  dorsolumbarCordCovered,
  dorsolumbarCoverageSummary,
  dorsolumbarDomains,
  dorsolumbarFullLevelSequence,
  dorsolumbarLevelDomain,
  dorsolumbarLevelKeyStrings,
  dorsolumbarLevelKeys,
  dorsolumbarNeedsConsistencyCheck,
  dorsolumbarNumberingBanner,
  dorsolumbarNumberingCaution,
  dorsolumbarNeuralStructure,
  dorsolumbarStrandedLevels,
  type DorsoLumbarState,
} from "@/lib/mriDorsoLumbarCoverage";
import { defaultLumbarNumbering } from "@/lib/mriSpineNumbering";

function state(overrides: Partial<DorsoLumbarState> = {}): DorsoLumbarState {
  return defaultDorsoLumbarState(overrides);
}

describe("coverage envelope (spec §4)", () => {
  it("composes the thoracic and lumbar resolvers rather than replacing them", () => {
    const sequence = dorsolumbarFullLevelSequence(defaultLumbarNumbering());
    expect(sequence[0]!.key).toBe("T1-T2");
    expect(sequence.map((s) => s.key)).toContain(JUNCTION_LEVEL);
    expect(sequence.map((s) => s.key)).toContain("L1-L2");
    expect(sequence.map((s) => s.key)).toContain("L5-S1");
    // The bridge appears exactly once in the whole sequence.
    expect(sequence.filter((s) => s.key === JUNCTION_LEVEL).length).toBe(1);
    expect(sequence.find((s) => s.key === JUNCTION_LEVEL)?.domain).toBe("junction");
  });

  it("generates levels only inside the acquired bounds", () => {
    const lower = state({ superior: "T10-T11", inferior: "L3-L4" });
    const keys = dorsolumbarLevelKeyStrings(lower);
    expect(keys).toEqual(["T10-T11", "T11-T12", "T12-L1", "L1-L2", "L2-L3", "L3-L4"]);
    // Nothing above the field of view, nothing below it.
    expect(keys).not.toContain("T8-T9");
    expect(keys).not.toContain("L4-L5");
    expect(dorsolumbarCoverageSummary(lower)).toMatch(/T10-T11 to L3-L4/);
  });

  it("supports a lower-thoracic-to-sacrum study without hard-coding it", () => {
    const wide = state({ superior: "T8-T9", inferior: "L5-S1" });
    expect(dorsolumbarLevelKeys(wide)[0]!.key).toBe("T8-T9");
    expect(dorsolumbarLevelKeys(wide).at(-1)!.key).toBe("L5-S1");
    const narrow = state({ superior: "T11-T12", inferior: "L1-L2" });
    expect(dorsolumbarLevelKeyStrings(narrow)).toEqual(["T11-T12", "T12-L1", "L1-L2"]);
  });

  it("resolves a bound named by vertebra, and yields nothing when inverted", () => {
    expect(dorsolumbarLevelKeyStrings(state({ superior: "T9", inferior: "L2" }))[0]).toBe("T9-T10");
    expect(dorsolumbarLevelKeys(state({ superior: "L4-L5", inferior: "T8-T9" }))).toEqual([]);
  });

  it("reports the domains present in one place", () => {
    const domains = dorsolumbarDomains(state({ superior: "T11-T12", inferior: "L2-L3" }));
    expect(domains.thoracic.map((k) => k.key)).toEqual(["T11-T12"]);
    expect(domains.junction.map((k) => k.key)).toEqual([JUNCTION_LEVEL]);
    expect(domains.lumbar.map((k) => k.key)).toEqual(["L1-L2", "L2-L3"]);
  });

  it("never claims a level outside coverage but keeps the observation for review", () => {
    const wide = state({ superior: "T1-T2", inferior: "L5-S1" });
    const rows = [
      { observation: { level: "D8-D9" } },
      { observation: { level: "D12-L1" } },
      { observation: { level: "L4-L5" } },
      { ownership: { anatomicalSection: "dorsal spine" } },
      { observation: { level: "C3-C4" } },
    ];
    expect(dorsolumbarStrandedLevels(rows, wide)).toEqual([]);
    const narrowed = state({ superior: "T10-T11", inferior: "L2-L3" });
    const warnings = dorsolumbarStrandedLevels(rows, narrowed);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/T8-T9/);
    expect(warnings[0]).toMatch(/never renumbers/);
    // The observations themselves are untouched by the resolver.
    expect(rows[0]!.observation!.level).toBe("D8-D9");
  });
});

describe("junction identity (spec §6)", () => {
  it("collapses every spelling of the bridge onto one level and one owner", () => {
    for (const spelling of ["T12-L1", "D12-L1", "T12L1", "D12L1", "L1-T12", "L1-D12", "T12 - L1", "tls", "TL"]) {
      const canonical = canonicalDorsoLumbarLevel(spelling);
      expect(canonical, spelling).not.toBeNull();
      expect(canonical!.key, spelling).toBe(JUNCTION_LEVEL);
      expect(canonical!.ledgerLevel, spelling).toBe("D12-L1");
      expect(canonical!.ledgerRegion, spelling).toBe(JUNCTION_LEDGER_REGION);
      expect(canonical!.domain, spelling).toBe("junction");
      expect(canonical!.junction, spelling).toBe(true);
    }
  });

  it("keeps every other level on its own region and identity", () => {
    expect(canonicalDorsoLumbarLevel("T8-T9")).toMatchObject({ key: "T8-T9", ledgerRegion: "Dorsal Spine", domain: "thoracic" });
    expect(canonicalDorsoLumbarLevel("D8-D9")).toMatchObject({ key: "T8-T9", ledgerLevel: "D8-D9", domain: "thoracic" });
    expect(canonicalDorsoLumbarLevel("L3-L4")).toMatchObject({ key: "L3-L4", ledgerRegion: "LS Spine", domain: "lumbar" });
    expect(canonicalDorsoLumbarLevel("L1-L2")).toMatchObject({ domain: "lumbar", ledgerRegion: "LS Spine" });
    expect(canonicalDorsoLumbarLevel("T11-T12")).toMatchObject({ domain: "thoracic", junction: false });
    expect(canonicalDorsoLumbarLevel("brain")).toBeNull();
    expect(canonicalDorsoLumbarLevel("")).toBeNull();
  });

  it("assigns the domain by anatomy, including transitional lumbar keys", () => {
    expect(dorsolumbarLevelDomain("T8-T9")).toBe("thoracic");
    expect(dorsolumbarLevelDomain("D12-L1")).toBe("junction");
    expect(dorsolumbarLevelDomain("L5-T")).toBe("lumbar");
    expect(dorsolumbarLevelDomain("L6-S1")).toBe("lumbar");
    expect(dorsolumbarLevelDomain("C4-C5")).toBeNull();
    expect(dorsolumbarLevelDomain("")).toBeNull();
  });
});

describe("numbering and LSTV (spec §5)", () => {
  it("remaps the lumbar tail without disturbing the bridge", () => {
    const sacralized = state({
      superior: "T11-T12",
      inferior: "L5-T",
      lumbar: { ...defaultLumbarNumbering(), mode: "lstv-sacralization", castellvi: "IIb", side: "bilateral" },
    });
    expect(dorsolumbarLevelKeyStrings(sacralized)).toEqual(["T11-T12", "T12-L1", "L1-L2", "L2-L3", "L3-L4", "L4-L5", "L5-T"]);
    expect(dorsolumbarLevelKeys(sacralized).at(-1)!.transitional).toBe(true);
    expect(dorsolumbarLevelKeys(sacralized).some((k) => k.key === "L5-S1")).toBe(false);
    expect(dorsolumbarNumberingBanner(sacralized)).toMatch(/transitional lumbar anatomy/);
    expect(dorsolumbarNumberingCaution(sacralized)).toMatch(/lumbosacral transitional vertebra/);
    expect(dorsolumbarNeedsConsistencyCheck(sacralized)).toBe(true);

    const lumbarized = state({
      inferior: "L6-S1",
      lumbar: { ...defaultLumbarNumbering(), mode: "lstv-lumbarization" },
    });
    expect(dorsolumbarLevelKeys(lumbarized).map((k) => k.key)).toContain("L6-S1");
  });

  it("offers the six numbering bases and words the reduced-certainty cases", () => {
    expect(DORSOLUMBAR_NUMBERING_MODES.map((m) => m.id)).toEqual([
      "localizer-confirmed",
      "cervicothoracic-landmark",
      "thoracolumbar-landmark",
      "standard-morphology",
      "manual",
      "uncertain",
    ]);
    const localizer = state({ numbering: "localizer-confirmed", wholeSpineLocalizer: true });
    // No numbering caveat when a localizer confirms the levels — but the
    // acquired range is still stated, because coverage is a separate fact from
    // how the levels were counted.
    const caution = dorsolumbarNumberingCaution(localizer);
    expect(caution).not.toMatch(/reduced certainty|numbered from|uncertain/);
    expect(caution).toMatch(/Acquired coverage extends from/);
    expect(dorsolumbarNeedsConsistencyCheck(localizer)).toBe(false);
    expect(dorsolumbarNumberingBanner(localizer)).not.toMatch(/certainty reduced/);

    expect(dorsolumbarNumberingCaution(state({ numbering: "uncertain" }))).toMatch(/uncertain on this examination/);
    expect(dorsolumbarNumberingCaution(state({ numbering: "manual", designationNote: "lowest rib-bearing vertebra taken as T12" })))
      .toMatch(/stated by the reporting radiologist \(lowest rib-bearing/);
    expect(dorsolumbarNumberingCaution(state({ numbering: "thoracolumbar-landmark" })))
      .toMatch(/last rib-bearing vertebra/);
    expect(dorsolumbarNumberingCaution(state({ numbering: "standard-morphology" })))
      .toMatch(/standard vertebral morphology/);
    // Coverage is always stated, so a limited field of view is visible in prose.
    expect(dorsolumbarNumberingCaution(state({ superior: "T10-T11", inferior: "L2-L3" })))
      .toMatch(/from T10-T11 to L2-L3/);
  });
});

describe("cord → conus → cauda (spec §12)", () => {
  it("names the structure that is actually present at the level", () => {
    const covered = state({ superior: "T8-T9", inferior: "L5-S1" });
    expect(dorsolumbarNeuralStructure("T8-T9", covered)).toBe("cord");
    expect(dorsolumbarNeuralStructure("T12-L1", covered)).toBe("conus");
    expect(dorsolumbarNeuralStructure("L3-L4", covered)).toBe("cauda");
    expect(dorsolumbarNeuralStructure("brain", covered)).toBe("unknown");
  });

  it("falls back to the cord at the bridge when the conus is not covered", () => {
    const stopsAbove = state({ superior: "T8-T9", inferior: "T11-T12" });
    expect(dorsolumbarConusCovered(stopsAbove)).toBe(false);
    expect(dorsolumbarCaudaCovered(stopsAbove)).toBe(false);
    expect(dorsolumbarCordCovered(stopsAbove)).toBe(true);
    expect(dorsolumbarNeuralStructure("T12-L1", stopsAbove)).toBe("cord");
    expect(isDorsoLumbarLevelAcquiredSafe(JUNCTION_LEVEL, stopsAbove)).toBe(false);
  });

  it("covers the conus when the bridge or the first lumbar disc is acquired", () => {
    expect(dorsolumbarConusCovered(state({ superior: "T11-T12", inferior: "L1-L2" }))).toBe(true);
    expect(dorsolumbarConusCovered(state({ superior: "T8-T9", inferior: "T11-T12" }))).toBe(false);
    expect(dorsolumbarCaudaCovered(state({ superior: "T8-T9", inferior: "T12-L1" }))).toBe(false);
    expect(dorsolumbarCaudaCovered(state({ superior: "T8-T9", inferior: "L1-L2" }))).toBe(true);
  });
});

describe("measurements share the level source (spec §13)", () => {
  it("offers AP rows at exactly the acquired levels", () => {
    const s = state({ superior: "T10-T11", inferior: "L3-L4" });
    expect(dorsolumbarApLevels(s)).toEqual(dorsolumbarLevelKeyStrings(s));
    expect(dorsolumbarApLevels(s)).not.toContain("T1-T2");
    expect(dorsolumbarApLevels(s)).not.toContain("L4-L5");
  });
});

// Local helpers, so a resolver bug cannot agree with itself.
function isDorsoLumbarLevelAcquiredSafe(level: string, s: DorsoLumbarState): boolean {
  return dorsolumbarLevelKeys(s).some((k) => k.key === canonicalDorsoLumbarLevel(level)?.key);
}
