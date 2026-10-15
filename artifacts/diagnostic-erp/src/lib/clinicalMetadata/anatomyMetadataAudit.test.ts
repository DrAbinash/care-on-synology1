/**
 * Regression tests for the C3 clinical-anatomy metadata audit.
 *
 * Two jobs, and they are deliberately separated:
 *
 *  1. On SYNTHETIC fixtures, prove every rule actually fires. An audit that
 *     reports nothing looks identical to an audit that cannot find anything, so
 *     each guard is shown failing on a crafted defect and silent on a clean one.
 *  2. On the REAL catalogue, assert relationships rather than snapshots, and pin
 *     the one known invalid entry so a NEW one fails CI while a fix does not.
 *
 * The real catalogue is incomplete by design and must not be made red for it:
 * missing optional metadata is a WARNING, and only genuinely contradictory
 * metadata is an ERROR. Nothing here touches a database, composes a report, or
 * reads a patient record.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_QUICK_SELECT_TILES } from "@/lib/zai-workspace/quick-select-tiles.data";
import { CLINICAL_CONTENT_PACKS } from "@/lib/conceptCanon/contentPacks";
import { SECTION_ORDER } from "@/lib/findingsCompose";
import {
  auditClinicalMetadata, buildCoverageBaseline, diffAgainstBaseline, measureOrderingFeasibility,
  RADIOLOGY_READINESS_SCOPES,
  type AuditContentPack, type AuditManifest, type AuditSeedBatch, type AuditTile,
} from "./anatomyMetadataAudit";
import { loadAuditInput, REPO_ROOT, seededQuickFindings } from "./auditDataSources";
import { parseQuickFindingInserts } from "./radiologyQuickFindingsSql";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = REPO_ROOT;
const BASELINE = path.join(HERE, "coverage-baseline.json");

// ─────────────────────────────────────────────────────────────────────────────
// real data, assembled once — by the same module the CLI report uses
// ─────────────────────────────────────────────────────────────────────────────

const realManifests = () => loadAuditInput().manifests as AuditManifest[];
const realSeedBatches = (): AuditSeedBatch[] => seededQuickFindings();

function realAudit() {
  return auditClinicalMetadata(loadAuditInput());
}

// ─────────────────────────────────────────────────────────────────────────────
// synthetic fixtures — tiny, and named for what they are testing
// ─────────────────────────────────────────────────────────────────────────────

const tile = (over: Partial<AuditTile>): AuditTile => ({
  id: "t1", label: "Test finding", field: "findings", sentence: "A sentence.", ...over,
});

const pack = (concept: string, aliases: string[] = []): AuditContentPack => ({
  concept, aliases, regions: ["brain"], modalities: ["MR"],
});

const obs = (over: Partial<AuditManifest["observations"][number]>): AuditManifest["observations"][number] => ({
  concept: "c1", field: "findings", anatomicalSection: "c1", renderedText: "The normal sentence.", ...over,
});

const cleanManifest: AuditManifest = {
  name: "MRI Test — Standard Normal", revision: "r1", modality: "MR", bodyPart: "Test",
  observations: [obs({}), obs({ concept: "c2", anatomicalSection: "c2", renderedText: "Another normal." })],
};

const cleanTile: AuditTile = tile({
  scopeModality: "MR", scopeBodyPart: "Test", concept: "c1",
  anatomicalSection: "", // left blank on purpose: this is the honest current state
  conflictGroup: "c1",
});

const cleanPacks = [pack("c1"), pack("c2")];

/** Run the audit on a minimal clean world, with pieces replaced per test. */
function world(over: Partial<Parameters<typeof auditClinicalMetadata>[0]> = {}) {
  return auditClinicalMetadata({
    tiles: [cleanTile],
    packs: cleanPacks,
    manifests: [cleanManifest],
    ...over,
  });
}

const rulesFired = (r: ReturnType<typeof world>): string[] => [...new Set(r.findings.map((f) => f.rule))];

/** Every rule id the audit module can emit, read straight out of its source. */
const rulesIn = (src: string): string[] =>
  [...new Set([...src.matchAll(/push\(\s*"(C3-R[0-9a-z]+)"/g)].map((m) => m[1]!))].sort();

describe("C3 audit — every guard fires on the defect it names", () => {
  it("T1 — a findings tile with no concept is an error, and a clean one is silent", () => {
    const bad = world({ tiles: [tile({ scopeModality: "MR", scopeBodyPart: "Test", sentence: "No concept here." })] });
    const err = bad.findings.filter((f) => f.rule === "C3-R01");
    expect(err).toHaveLength(1);
    expect(err[0]!.severity).toBe("ERROR");
    expect(rulesFired(world())).not.toContain("C3-R01");
  });

  it("T1b — a recommendation tile without a concept is NOT an error", () => {
    // The audit ranks findings. Firing here would alarm on a tile that carries
    // no anatomical responsibility at all — a false positive by construction.
    const r = world({ tiles: [tile({ field: "recommendation", scopeModality: "MR", scopeBodyPart: "Test", category: "critical", sentence: "Refer." })] });
    expect(rulesFired(r)).not.toContain("C3-R01");
  });

  it("T2 — a missing anatomicalSection is reported as a coverage warning, never an error", () => {
    const r = world();
    const f = r.findings.filter((x) => x.rule === "C3-R03");
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("WARNING");
    expect(r.counts.ERROR).toBe(0);
    expect(r.tiles[0]!.anatomicalSection.status).toBe("MISSING");
  });

  it("T3 — an unrecognised anatomicalSection is UNKNOWN, not silently mapped", () => {
    const r = world({ tiles: [tile({ ...cleanTile, anatomicalSection: "mca" })] });
    const rec = r.tiles[0]!;
    expect(rec.anatomicalSection.status).toBe("UNKNOWN");
    expect(rec.anatomicalSection.value).toBe("mca");
    expect(r.findings.some((f) => f.rule === "C3-R04" && f.severity === "REQUIRES_RADIOLOGIST_REVIEW")).toBe(true);
    // A recognised section from the examination's own baseline is PRESENT.
    const known = world({ tiles: [tile({ ...cleanTile, anatomicalSection: "c1" })] });
    expect(known.tiles[0]!.anatomicalSection.status).toBe("PRESENT");
  });

  it("T3b — a template token in a section is UNKNOWN, not a value", () => {
    const r = world({ tiles: [tile({ ...cleanTile, anatomicalSection: "{level}" })] });
    expect(r.tiles[0]!.anatomicalSection.status).toBe("UNKNOWN");
  });

  it("T4 — a duplicated canonical concept is an error", () => {
    const r = world({ packs: [pack("c1"), pack("c1"), pack("c2")] });
    const f = r.findings.filter((x) => x.rule === "C3-R05");
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("ERROR");
    expect(rulesFired(world())).not.toContain("C3-R05");
  });

  it("T5 — an alias claimed by two concepts is escalated, not resolved", () => {
    const r = world({ packs: [pack("c1", ["shared term"]), pack("c2", ["shared term"])] });
    const f = r.findings.filter((x) => x.rule === "C3-R06");
    expect(f.length).toBeGreaterThanOrEqual(1);
    expect(f[0]!.severity).toBe("REQUIRES_RADIOLOGIST_REVIEW");
    expect(f[0]!.detail).toMatch(/claimed by/);
  });

  it("T6 — an impossible spinal level is an error, a real one passes", () => {
    const bad = world({ manifests: [cleanManifest, {
      ...cleanManifest, name: "MRI LS Spine — Bad",
      observations: [obs({ level: "L7-L9", renderedText: "x" })],
    }] });
    const f = bad.findings.filter((x) => x.rule === "C3-R08");
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("ERROR");
    const good = world({ manifests: [{ ...cleanManifest, observations: [obs({ level: "L4-L5", renderedText: "x" })] }] });
    expect(rulesFired(good)).not.toContain("C3-R08");
  });

  it("T7 — an unrecognised laterality value is an error", () => {
    const r = world({ manifests: [{ ...cleanManifest, observations: [obs({ laterality: "leftish", renderedText: "x" })] }] });
    const f = r.findings.filter((x) => x.rule === "C3-R09");
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("ERROR");
  });

  it("T8 — a baseline target that exists nowhere is flagged, but only when a baseline can be checked", () => {
    const dangling = world({ tiles: [tile({ ...cleanTile, baselineReplaces: "A sentence no baseline renders." })] });
    const f = dangling.findings.filter((x) => x.rule === "C3-R10");
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("WARNING");
    expect(dangling.tiles[0]!.baselineReplaces.status).toBe("UNKNOWN");

    // The same tile for an examination that has NO baseline is unprovable, and
    // must not be reported as a defect — this was a false positive in review.
    const uncheckable = world({
      tiles: [tile({ scopeModality: "CT", scopeBodyPart: "Chest", concept: "c1", baselineReplaces: "Whatever." })],
    });
    expect(rulesFired(uncheckable)).not.toContain("C3-R10");
    expect(uncheckable.tiles[0]!.baselineReplaces.status).toBe("UNKNOWN");

    const matching = world({ tiles: [tile({ ...cleanTile, baselineReplaces: "The normal sentence." })] });
    expect(matching.tiles[0]!.baselineReplaces.status).toBe("PRESENT");
    expect(rulesFired(matching)).not.toContain("C3-R10");
  });

  it("T9 — two observations claiming one slot is duplicate baseline ownership", () => {
    const r = world({ manifests: [{
      ...cleanManifest,
      observations: [obs({ concept: "dup", level: "L4-L5" }), obs({ concept: "dup", level: "L4-L5" })],
    }] });
    const f = r.findings.filter((x) => x.rule === "C3-R22");
    expect(f).toHaveLength(1);
    expect(f[0]!.detail).toMatch(/same slot/);
  });

  it("T10 — one concept split across conflict groups is inconsistent", () => {
    const r = world({ tiles: [
      tile({ ...cleanTile, conflictGroup: "group a" }),
      tile({ id: "t2", label: "Second", scopeModality: "MR", scopeBodyPart: "Test", concept: "c1", conflictGroup: "group b" }),
    ] });
    const f = r.findings.filter((x) => x.rule === "C3-R23");
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("WARNING");
  });

  it("T11 — a multi-sentence tile stays one observation", () => {
    const r = world({ tiles: [tile({ ...cleanTile, sentence: "First sentence. Second sentence. Third." })] });
    expect(r.tiles).toHaveLength(1);
    const f = r.findings.filter((x) => x.rule === "C3-R13");
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("INFORMATIONAL");
    expect(f[0]!.detail).toMatch(/3 sentences/);
  });

  it("T12 — an unscoped tile keeps its modality UNKNOWN rather than being guessed", () => {
    const r = world({ tiles: [tile({ id: "u", label: "Generic", sentence: "Shared line." })] });
    const rec = r.tiles[0]!;
    expect(rec.modality).toBe("(any)");
    expect(rec.anatomicalSection.status).not.toBe("PRESENT");
    // …and the examination it belongs to is reported as having no owned baseline.
    expect(r.findings.some((f) => f.rule === "C3-R20" && f.subject.includes("(any)"))).toBe(true);
  });

  it("T11b/placeholder — an unrecognised Quick Select token is an error, a known one is not", () => {
    const bad = world({ tiles: [tile({ ...cleanTile, sentence: "Findings of {kidney} extent." })] });
    const f = bad.findings.filter((x) => x.rule === "C3-R11");
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("ERROR");
    // {side} and {severity} are what the parameter contract resolves, so a tile
    // using them is fine and must not be flagged (it was, once — a false alarm).
    expect(rulesFired(world({ tiles: [tile({ ...cleanTile, properties: "side", sentence: "{side} lesion of {severity} degree." })] })))
      .not.toContain("C3-R11");
  });

  it("T20 — incomplete metadata alone never produces an error", () => {
    // Sparse by design: a concept the canon does not declare, no section, no
    // conflict group, no baseline, no manifest for the exam. The brief forbids
    // making today's incomplete catalogue fail CI, so every one of these is a
    // warning or a note — the only error-level rule is a findings tile that
    // carries no concept at all, which is a different defect (T1).
    const sparse = world({
      tiles: [tile({ scopeModality: "MR", scopeBodyPart: "Test", concept: "unlisted", sentence: "A bare sentence." })],
      packs: [],
      manifests: [],
    });
    expect(sparse.counts.ERROR).toBe(0);
    expect(sparse.counts.WARNING + sparse.counts.INFORMATIONAL).toBeGreaterThan(0);
  });
});

describe("C3 audit — the guards the first pass left untested", () => {
  /** A parsed seed INSERT block, as the SQL reader would hand it over. */
  const batch = (over: Partial<AuditSeedBatch> = {}): AuditSeedBatch => ({
    file: "0000_synthetic.sql", rowCount: 4,
    columns: ["study_type", "label", "finding_text"],
    populated: {}, ...over,
  });

  it("C3-R02 — a concept no content pack declares is a warning, not a silent pass", () => {
    const r = world({ tiles: [tile({ ...cleanTile, concept: "not_a_concept" })] });
    const f = r.findings.filter((x) => x.rule === "C3-R02");
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("WARNING");
    expect(r.tiles[0]!.concept.status).toBe("UNKNOWN");
    expect(rulesFired(world())).not.toContain("C3-R02");
  });

  it("C3-R07 — a concept repeating in one baseline is graded by whether anything distinguishes it", () => {
    const collide = world({ manifests: [{
      ...cleanManifest,
      observations: [obs({ concept: "dup" }), obs({ concept: "dup" })],
    }] });
    const f = collide.findings.filter((x) => x.rule === "C3-R07");
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("WARNING");

    // Same concept, different level: legitimate, and the note says what an
    // ordering key must therefore use.
    const distinct = world({ manifests: [{
      ...cleanManifest,
      observations: [obs({ concept: "dup", level: "C5-C6" }), obs({ concept: "dup", level: "C6-C7" })],
    }] });
    const g = distinct.findings.filter((x) => x.rule === "C3-R07");
    expect(g).toHaveLength(1);
    expect(g[0]!.severity).toBe("INFORMATIONAL");
    expect(g[0]!.detail).toMatch(/\(concept, level\)/);
    expect(rulesFired(world())).not.toContain("C3-R07");
  });

  it("C3-R10a — a findings tile with no conflict group cannot see its own rival", () => {
    const r = world({ tiles: [tile({ ...cleanTile, conflictGroup: "" })] });
    const f = r.findings.filter((x) => x.rule === "C3-R10a");
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("WARNING");
    expect(rulesFired(world())).not.toContain("C3-R10a");
  });

  it("C3-R11b — an unfilled measurement blank is recorded, not treated as a token error", () => {
    const r = world({ tiles: [tile({ ...cleanTile, sentence: "The ventricle measures ___ mm." })] });
    const f = r.findings.filter((x) => x.rule === "C3-R11b");
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("INFORMATIONAL");
    // A measured sentence with a real number must not be flagged.
    expect(rulesFired(world({ tiles: [tile({ ...cleanTile, sentence: "The ventricle measures 8 mm." })] })))
      .not.toContain("C3-R11b");
  });

  it("C3-R15 — prose that names a level with no level metadata goes to the radiologist", () => {
    const r = world({ tiles: [tile({ ...cleanTile, sentence: "Disc desiccation at C5-C6." })] });
    const f = r.findings.filter((x) => x.rule === "C3-R15");
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("REQUIRES_RADIOLOGIST_REVIEW");
    expect(r.tiles[0]!.level.status).toBe("UNKNOWN");
    expect(rulesFired(world())).not.toContain("C3-R15");
  });

  it("C3-R17/18/19 — a seeded batch says which anatomy columns it does not even name", () => {
    const r = world({ seedBatches: [batch({
      columns: ["study_type", "label", "finding_text", "anatomical_section", "conflict_group"],
      rowCount: 4, populated: { anatomical_section: 1, conflict_group: 0 },
    })] });
    const by = (rule: string) => r.findings.filter((x) => x.rule === rule);
    expect(by("C3-R17")).toHaveLength(1); // no concept column at all
    expect(by("C3-R17")[0]!.severity).toBe("INFORMATIONAL");
    expect(by("C3-R18")[0]!.detail).toMatch(/^3\/4 seeded rows carry no anatomical_section$/);
    expect(by("C3-R19")[0]!.detail).toMatch(/4 rows declare no conflict_group/);
  });

  it("C3-R18 — rows inserted without ever naming the column read differently from empty ones", () => {
    const r = world({ seedBatches: [batch({ rowCount: 5, populated: {} })] });
    const f = r.findings.filter((x) => x.rule === "C3-R18");
    expect(f).toHaveLength(1);
    expect(f[0]!.detail).toMatch(/all 5 rows are inserted without ever naming anatomical_section/);
    // A fully-populated batch contributes nothing. The catalogue tile in the same
    // world still reports its own honest missing section (C3-R03), which is not
    // this batch's doing, so the assertion is scoped to `seed/` subjects.
    const quiet = world({ seedBatches: [batch({
      columns: ["study_type", "label", "concept", "anatomical_section"], rowCount: 2,
      populated: { anatomical_section: 2 },
    })] });
    expect(quiet.findings.filter((f) => f.subject.startsWith("seed/"))).toEqual([]);
  });

  it("C3-R16 — a template token stored as a section is a question, not a verdict", () => {
    const r = world({ seedBatches: [batch({ rowCount: 9, populated: { anatomical_section: 8, __template_section_tokens: 1 } })] });
    const f = r.findings.filter((x) => x.rule === "C3-R16");
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("REQUIRES_RADIOLOGIST_REVIEW");
    expect(f[0]!.detail).toMatch(/clinical decision/);
  });

  it("C3-R24 — a requested examination with no catalogue says so instead of printing nothing", () => {
    const r = world({ requestedScopes: [{ modality: "MR", bodyPart: "Test" }, { modality: "CT", bodyPart: "Temporal Bone" }] });
    const f = r.findings.filter((x) => x.rule === "C3-R24");
    expect(f).toHaveLength(1); // MR/Test exists in the fixture, CT/Temporal Bone does not
    expect(f[0]!.subject).toBe("scope/CT/Temporal Bone");
    expect(f[0]!.severity).toBe("INFORMATIONAL");
    const row = r.coverage.find((c) => c.scope === "CT/Temporal Bone");
    expect(row, "the absent scope still gets a row, so a reader can tell 0 from unchecked").toMatchObject({ tiles: 0 });
    // Matching is spelling-insensitive, so a differently-cased request for a scope
    // that does have tiles must not produce a phantom zero.
    expect(rulesFired(world({ requestedScopes: [{ modality: "mr", bodyPart: "test" }] })))
      .not.toContain("C3-R24");
  });

  it("every rule the audit can emit has at least one assertion naming it", () => {
    // C3-R14 shipped for a whole pass unable to fire (`Set.length` instead of
    // `Set.size`) and nothing noticed, because no test asked after it. A rule
    // with no test is indistinguishable from a rule that does not exist.
    const src = readFileSync(path.join(HERE, "anatomyMetadataAudit.ts"), "utf8");
    const tests = readFileSync(path.join(HERE, "anatomyMetadataAudit.test.ts"), "utf8");
    const rules = rulesIn(src);
    expect(rules.length).toBeGreaterThanOrEqual(20);
    const untested = rules.filter((r) => !tests.includes(`"${r}"`));
    expect(untested, `rules nothing asserts: ${untested.join(", ")}`).toEqual([]);
  });

  it("the rule set itself is pinned — a rule cannot quietly disappear", () => {
    // The test above proves no rule is untested; it cannot prove no rule was
    // *deleted*, because a removed rule simply stops appearing in the source.
    // This pins the identity of the ruleset in both directions.
    const src = readFileSync(path.join(HERE, "anatomyMetadataAudit.ts"), "utf8");
    expect(rulesIn(src)).toEqual([
      "C3-R01", "C3-R02", "C3-R03", "C3-R04", "C3-R05", "C3-R06", "C3-R07", "C3-R08",
      "C3-R09", "C3-R10", "C3-R10a", "C3-R11", "C3-R11b", "C3-R13", "C3-R14", "C3-R15",
      "C3-R16", "C3-R17", "C3-R18", "C3-R19", "C3-R20", "C3-R21", "C3-R22", "C3-R23",
      "C3-R24",
    ]);
  });
});
describe("C3 audit — seed SQL reader is honest about its own denominator", () => {
  it("parses multi-row VALUES and stops before ON CONFLICT", () => {
    const sql = [
      "INSERT INTO radiology_quick_findings (study_type, label, finding_text, anatomical_section, sort_order) VALUES",
      "  ('Brain', 'A', 'text one', 'Parenchyma', 1),",
      "  ('Brain', 'B', 'text, with a comma and a ; semicolon', '', 2)",
      "ON CONFLICT (study_type, label) DO NOTHING;",
    ].join("\n");
    const b = parseQuickFindingInserts(sql, "x.sql")!;
    expect(b.rowCount).toBe(2);
    expect(b.populated.__unparsedRows ?? 0).toBe(0);
    expect(b.populated.anatomical_section).toBe(1);
    expect(b.columns).toContain("anatomical_section");
  });

  it("counts a template token stored in anatomical_section", () => {
    const b = parseQuickFindingInserts(
      "INSERT INTO radiology_quick_findings (study_type, label, anatomical_section) VALUES ('LS Spine','Disc','{level}') ON CONFLICT DO NOTHING;",
      "y.sql",
    )!;
    expect(b.populated.__template_section_tokens).toBe(1);
  });

  it("reports rows it cannot parse instead of dropping them silently", () => {
    const b = parseQuickFindingInserts(
      "INSERT INTO radiology_quick_findings (study_type, label) VALUES ('One','Two','Extra') ON CONFLICT DO NOTHING;",
      "z.sql",
    )!;
    expect(b.rowCount).toBe(0);
    expect(b.populated.__unparsedRows).toBeGreaterThan(0);
    const r = world({ seedBatches: [b] });
    // The specific branch, not just the rule: a batch that parses no rows at all
    // also raises C3-R21, and accepting either text let a mutation that ignores
    // the parser's own `__unparsedRows` count survive.
    const f = r.findings.filter((x) => x.rule === "C3-R21");
    expect(f.map((x) => x.detail).join(" |")).toMatch(/did not parse/);
  });

  it("every real migration row parses — the coverage figures depend on it", () => {
    const batches = realSeedBatches();
    expect(batches.length).toBeGreaterThanOrEqual(5);
    for (const b of batches) {
      expect(b.populated.__unparsedRows ?? 0, `${b.file} has rows the parser dropped`).toBe(0);
    }
    const total = batches.reduce((s, b) => s + b.rowCount, 0);
    expect(total).toBeGreaterThan(300);
  });
});

describe("C3 ordering feasibility — Phase F, measured", () => {
  const audit = realAudit();
  const f = measureOrderingFeasibility(audit);

  it("the three buckets partition every findings tile", () => {
    expect(f.findingsTiles).toBe(audit.tiles.filter((t) => t.field === "findings").length);
    expect(f.safeRankKey + f.needsClinicalMapping + f.noOrderingKey).toBe(f.findingsTiles);
    // A tile can only be safely ranked where the examination actually has a
    // baseline to rank against, so the safe bucket can never exceed the tiles
    // whose section is known.
    const sectionKnown = audit.coverage.reduce((s, c) => s + c.sectionKnown, 0);
    expect(f.safeRankKey).toBeLessThanOrEqual(sectionKnown);
    console.log(`  feasibility: ${JSON.stringify(f)}`);
  });

  it("a rank key is only safe when the concept, the section and a baseline all exist", () => {
    const safe = measureOrderingFeasibility(world({
      tiles: [tile({ ...cleanTile, anatomicalSection: "c1" })],
    }));
    expect(safe).toMatchObject({ findingsTiles: 1, safeRankKey: 1, needsClinicalMapping: 0, noOrderingKey: 0 });

    // Same tile, section spelled something the baseline does not declare: the
    // concept is known but its placement is not, which is a mapping question.
    const unmapped = measureOrderingFeasibility(world({
      tiles: [tile({ ...cleanTile, anatomicalSection: "not a section" })],
    }));
    expect(unmapped).toMatchObject({ safeRankKey: 0, needsClinicalMapping: 1 });

    // No baseline manifest for the examination at all: even a section that names
    // itself cannot be ordered, because nothing approves the sequence.
    const noBaseline = measureOrderingFeasibility(world({
      tiles: [tile({ scopeModality: "CT", scopeBodyPart: "Chest", concept: "c1", anatomicalSection: "c1" })],
    }));
    expect(noBaseline).toMatchObject({ safeRankKey: 0, needsClinicalMapping: 1, examsWithOwnedBaseline: 0 });
  });

  it("a conflict group holding both a normal and an abnormal tile is listed, not merged", () => {
    const r = world({ tiles: [
      tile({ ...cleanTile, id: "n1", category: "normal", conflictGroup: "ventricles", anatomicalSection: "c1" }),
      tile({ id: "a1", label: "Dilated", category: "abnormal", scopeModality: "MR", scopeBodyPart: "Test", concept: "c2", conflictGroup: "ventricles" }),
    ] });
    expect(measureOrderingFeasibility(r).conflictGroupsHoldingBothANormalAndAnAbnormal).toEqual(["ventricles"]);
    // The clean fixture has one normal-ish group and no abnormal tile, so it is
    // silent — the measure cannot fire as background noise.
    expect(measureOrderingFeasibility(world()).conflictGroupsHoldingBothANormalAndAnAbnormal).toEqual([]);
  });

  it("two tiles retiring the same baseline sentence are counted as competing", () => {
    const r = world({ tiles: [
      tile({ ...cleanTile, id: "t9", label: "First", baselineReplaces: "The normal sentence." }),
      tile({ id: "t10", label: "Second", scopeModality: "MR", scopeBodyPart: "Test", concept: "c1", conflictGroup: "c1", baselineReplaces: "The normal sentence." }),
    ] });
    expect(measureOrderingFeasibility(r).tilesSharingOneBaselineTarget).toBe(2);
    expect(measureOrderingFeasibility(world()).tilesSharingOneBaselineTarget).toBe(0);
  });
});


describe("C3 audit — the real catalogue, described not judged", () => {
  const result = realAudit();

  it("records the measured inventory", () => {
    console.log(`\n### C3 metadata inventory @ ${result.totals.tiles} tiles / ${result.totals.manifests} manifests`);
    console.log(`  severity: ${JSON.stringify(result.counts)}`);
    for (const c of result.coverage) {
      console.log(`  ${c.scope.padEnd(22)} tiles=${String(c.tiles).padStart(3)} concept=${c.conceptResolves} sectionKnown=${c.sectionKnown} mapManifest=${c.mappedToManifestConcept} unresolved=${c.unresolvedPlacement}`);
    }
    expect(result.totals.tiles).toBe(DEFAULT_QUICK_SELECT_TILES.length);
  });

  it("every findings tile carries a concept that resolves to a content pack", () => {
    const findings = result.tiles.filter((t) => t.field === "findings");
    expect(findings.length).toBeGreaterThan(80);
    const unresolved = findings.filter((t) => t.concept.status !== "PRESENT");
    // A short, named list: the concepts the canon does not declare. If a new one
    // appears this fails, which is the point. `subdural_hematoma` is NOT here —
    // contentPacks.ts:296 declares it, so SDH and "Subdural hematoma" both
    // resolve. `schmorl` is, because the packs declare `schmorl_node` and
    // `ls_schmorl_node`, neither of which a bare `schmorl` maps to.
    expect(unresolved.map((t) => `${t.label}<${t.concept.value}>`).sort()).toEqual([
      "Glioma recurrence<glioma>",
      "Schmorl node L1<schmorl>",
      "Vertebral hemangioma L1<hemangioma>",
    ].sort());
  });

  it("anatomical section coverage on findings tiles is still a minority", () => {
    const findings = result.tiles.filter((t) => t.field === "findings");
    const known = findings.filter((t) => t.anatomicalSection.status === "PRESENT").length;
    // Documents the gap C2 hit. This must RISE before anatomical ordering is
    // safe; it is asserted as a ceiling so the test does not freeze the number.
    expect(known).toBeLessThan(findings.length * 0.1);
  });

  it("baseline manifests fully populate their own sections, and carry a revision", () => {
    expect(result.manifests.length).toBe(10);
    for (const m of result.manifests) {
      expect(m.observationsWithoutSection).toBe(0);
      expect(m.revision).not.toBe("(none)");
      expect(m.sectionsInOrder.length).toBeGreaterThan(0);
      expect(m.modality).toBe("MR");
    }
  });

  it("no baseline manifest exists outside MR — CT/US/XR/MG have none to order by", () => {
    const modalities = [...new Set(result.manifests.map((m) => m.modality))];
    expect(modalities).toEqual(["MR"]);
    const noBaseline = result.findings.filter((f) => f.rule === "C3-R20");
    expect(noBaseline.length).toBeGreaterThan(3);
  });

  it("the Findings Library section vocabulary does not agree with the baselines", () => {
    const f = result.findings.find((x) => x.rule === "C3-R14");
    expect(f, "SECTION_ORDER and the baseline section vocabularies diverge").toBeDefined();
    expect(f!.severity).toBe("WARNING");
    expect(f!.detail).toMatch(/only \d+ agree/);
  });

  it("five of the eleven readiness examinations have no Quick Select catalogue at all", () => {
    // Measured, not asserted as a goal: an absent catalogue is a coverage gap for
    // the next milestone to plan around, and the direction of travel must never
    // make CI red, so this is a floor on what is missing rather than a pin of the
    // exact list.
    const zero = result.coverage.filter((c) => c.tiles === 0);
    const requested = new Set(RADIOLOGY_READINESS_SCOPES.map((s) => `${s.modality}/${s.bodyPart}`));
    expect(zero.length).toBeGreaterThanOrEqual(4);
    for (const c of zero) expect(requested.has(c.scope), `${c.scope} is not a requested scope`).toBe(true);
    console.log(`  readiness scopes with no findings tile: ${zero.map((c) => c.scope).sort().join(", ")}`);
    expect(result.findings.filter((f) => f.rule === "C3-R24")).toHaveLength(zero.length);
  });

  it("exactly one known invalid entry exists, and nothing else is an error", () => {
    // The register is deliberately one-directional: a NEW error fails CI, while
    // FIXING the duplicate concept does not.
    const REGISTER = new Set(["C3-R05|contentPacks/craniocervical_junction"]);
    const errors = result.findings.filter((f) => f.severity === "ERROR");
    const unexpected = errors.filter((f) => !REGISTER.has(`${f.rule}|${f.subject}`));
    expect(unexpected.map((f) => `${f.rule} ${f.subject} ${f.detail}`)).toEqual([]);
  });
});

describe("C3 audit — determinism, and the snapshot's guards", () => {
  it("T19 — the same data always yields identical output, whatever order it arrives in", () => {
    const a = realAudit();
    const b = realAudit();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));

    const tiles = [...DEFAULT_QUICK_SELECT_TILES].reverse() as unknown as AuditTile[];
    const packs = [...CLINICAL_CONTENT_PACKS].reverse() as unknown as AuditContentPack[];
    const manifests = realManifests().reverse();
    const c = auditClinicalMetadata({
      tiles, packs, manifests,
      seedBatches: realSeedBatches().slice().reverse(),
      librarySectionOrder: [...SECTION_ORDER].reverse(),
      requestedScopes: [...RADIOLOGY_READINESS_SCOPES].reverse(),
    });
    expect(JSON.stringify(c.findings)).toBe(JSON.stringify(a.findings));
    expect(JSON.stringify(c.coverage)).toBe(JSON.stringify(a.coverage));
  });

  it("T18 — the emitted snapshot carries no clinical sentence and no patient field", () => {
    const snapshot = buildCoverageBaseline(realAudit(), { revision: "test" });
    const json = JSON.stringify(snapshot);
    const sentenceLike = (DEFAULT_QUICK_SELECT_TILES as Array<{ sentence: string }>)
      .map((t) => t.sentence)
      .filter((s) => s.length > 25)
      .filter((s) => json.includes(s));
    expect(sentenceLike, "a full clinical sentence leaked into the coverage snapshot").toEqual([]);
    // Keys are where PHI would appear if the audit ever read a study row.
    // `name` is deliberately absent: it holds a report-format catalogue title
    // ("MRI Brain — Standard Normal"), not a person.
    const keys = new Set<string>();
    (function walk(v: unknown): void {
      if (Array.isArray(v)) for (const x of v) walk(x);
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { keys.add(k); walk(x); }
    })(snapshot);
    for (const k of [...keys].sort()) {
      expect(k.toLowerCase(), `snapshot key "${k}" could carry patient data`)
        .not.toMatch(/patient|mrn|dob|birth|accession|phone|email|uhid|hospital_?no/);
    }
  });

  it("T17 — the audit needs no database: nothing in it references one", () => {
    for (const f of ["anatomyMetadataAudit.ts", "radiologyQuickFindingsSql.ts"]) {
      const src = readFileSync(path.join(HERE, f), "utf8");
      expect(src, `${f} reaches a database`).not.toMatch(/@workspace\/db|from "pg"|DATABASE_URL/);
      expect(src, `${f} should import nothing from the app`).not.toMatch(/^import .* from "@\//m);
    }
    expect(existsSync(path.join(HERE, "coverage-baseline.json"))).toBe(true);
  });

  it("T15 — nothing in the reporting path imports the audit, so composition cannot change", () => {
    const src = readFileSync(path.join(REPO, "artifacts/diagnostic-erp/src/lib/pathologyPatch.ts"), "utf8");
    expect(src).not.toMatch(/clinicalMetadata/);
    const store = readFileSync(path.join(REPO, "artifacts/diagnostic-erp/src/lib/zai-workspace/store.ts"), "utf8");
    expect(store).not.toMatch(/clinicalMetadata/);

    // The stronger claim, checked by walking the app: the audit modules are
    // imported only by their own folder. `auditDataSources.ts` reads the file
    // system, so an accidental import from a component would also break the
    // browser build — not just the invariant.
    const dir = path.join(REPO, "artifacts/diagnostic-erp/src");
    const walk = (d: string): string[] => {
      const out: string[] = [];
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) out.push(...walk(p));
        else if (/\.tsx?$/.test(e.name)) out.push(p);
      }
      return out;
    };
    const importers = walk(dir).filter((f) => {
      if (f.startsWith(HERE)) return false;
      const text = readFileSync(f, "utf8");
      return /from ["'][^"']*clinicalMetadata|import\(["'][^"']*clinicalMetadata/.test(text);
    });
    expect(importers.map((f) => path.relative(REPO, f))).toEqual([]);
  });

  it("T16 — the audit reports on prose without producing any", () => {
    const r = world({ tiles: [tile({ ...cleanTile, sentence: "{side} lesion." })] });
    // Every detail string is diagnostic text about metadata, never a clinical
    // sentence the audit invented for a report.
    for (const f of r.findings) {
      expect(f.detail).not.toMatch(/\b(no evidence of|unremarkable|is seen\.|are normal)/i);
    }
  });
});

describe("C3 coverage baseline", () => {
  it("regenerates byte-identically, so a committed snapshot cannot drift silently", () => {
    const fresh = JSON.stringify(buildCoverageBaseline(realAudit(), { revision: "generated-from-working-tree" }), null, 2) + "\n";
    if (process.env.C3_WRITE_BASELINE === "1") {
      writeFileSync(BASELINE, fresh, "utf8");
      console.log(`wrote ${BASELINE} (${fresh.length} bytes)`);
      return;
    }
    const committed = readFileSync(BASELINE, "utf8").replace(/\r\n/g, "\n");
    // Git checks this out with CRLF on Windows, so line endings are normalised
    // before comparing — otherwise the byte-identity gate would fail on a fresh
    // Windows clone while the data it guards is unchanged.
    // The revision field is environmental; everything else must match exactly.
    expect(fresh.replace(/"sourceRevision": "[^"]*"/, '"sourceRevision": "X"'))
      .toBe(committed.replace(/"sourceRevision": "[^"]*"/, '"sourceRevision": "X"'));
  });

  it("the accepted baseline shows no deterioration", () => {
    const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
    expect(diffAgainstBaseline(baseline, realAudit())).toEqual([]);
  });

  it("the deterioration gate can actually fail", () => {
    const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
    const degraded = realAudit();
    // Lose a scope's worth of known sections and add a phantom error. The scope
    // is chosen by measurement, not by index: the first row is CT/Brain, which
    // legitimately has no sections to lose, so blanking it proves nothing.
    const rankableScope = degraded.coverage.findIndex((c) => c.sectionKnown > 0);
    expect(rankableScope, "the catalogue has a scope with a declared section to lose").toBeGreaterThanOrEqual(0);
    degraded.coverage = degraded.coverage.map((c, i) =>
      (i === rankableScope ? { ...c, sectionKnown: 0, conceptResolves: 0, withBaselineReplaces: 0 } : c));
    // Rankability is computed from the tile records, not the scope rows, so the
    // injected loss has to be made there too: strip the section from one tile the
    // baseline does declare, which is exactly the regression the gate is for.
    const rankable = degraded.tiles.findIndex((t) => t.anatomicalSection.status === "PRESENT");
    expect(rankable, "the catalogue has at least one tile with a baseline-declared section").toBeGreaterThanOrEqual(0);
    degraded.tiles = degraded.tiles.map((t, i) =>
      (i === rankable ? { ...t, anatomicalSection: { status: "MISSING" as const, value: "" } } : t));
    degraded.findings = [...degraded.findings, {
      rule: "C3-R05", severity: "ERROR", subject: "synthetic/regression", detail: "injected for the gate test",
    }];
    degraded.counts.ERROR += 1;
    const problems = diffAgainstBaseline(baseline, degraded);
    expect(problems.length).toBeGreaterThanOrEqual(2);
    // Each degradation is required by name. Asserting only a count would pass on
    // any two of them, which let an inverted section comparison survive: the
    // phantom error and the concept drop were still reported, and the test was
    // green while the gate had silently stopped watching anatomical sections.
    const text = problems.join("\n");
    expect(text).toMatch(/ERROR count rose/);
    expect(text).toMatch(/known anatomical sections fell/);
    expect(text).toMatch(/resolvable concepts fell/);
    expect(text).toMatch(/tiles that retire a baseline normal fell/);
    expect(text).toMatch(/safe anatomical rank key fell/);
  });
});
