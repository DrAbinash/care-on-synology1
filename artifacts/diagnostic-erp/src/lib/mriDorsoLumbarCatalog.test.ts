/**
 * mriDorsoLumbarCatalog.test.ts — what the billed examination actually is
 * (dorso-lumbar spec §24) and which canvas it therefore opens.
 *
 * The clinic's catalog export is the only place the purchased examination is
 * recorded, so these tests are the audit trail: each assertion names the row it
 * came from. They exist because an earlier revision claimed catalog evidence it
 * had never seen (`MRI039 / MRI DORSOLUMBAR SPINE`), and because the canvas
 * gates answered "dorsal" for a dorso-lumbar booking, which opened a
 * thoracic-only editor over a study that also covers the junction and lumbar
 * spine.
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  CATALOG_EVIDENCE_DATE,
  CATALOG_EVIDENCE_SOURCE,
  CONFIRMED_CATALOG_ROWS,
  DEDICATED_COMPONENT_ROLE,
  HEURISTIC_NAME_ALIASES,
  RETIRED_CATALOG_ASSERTIONS,
  compositionSummary,
  dorsolumbarRolesAreOneComposition,
  isDorsoLumbarDedicated,
  resolveStudyComposition,
} from "@/lib/mriDorsoLumbarCatalog";
import {
  offeredScreeningRegions,
  resolveScreeningRoles,
  screeningRolesSummary,
} from "@/lib/mriSpineScreeningRoles";
import { isMriDorsalReportingContext, isMriDorsoLumbarReportingContext } from "@/lib/mriSpineCanvasRegions";
import { isMriLumbarReportingContext } from "@/lib/mriLumbarRegions";
import { spineSegmentFromRegion } from "@/lib/reportingStudyContext";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { defaultScreeningState } from "@/lib/mriSpineScreening";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = resolve(HERE, "../..");
const SEED_PATH = resolve(PKG_DIR, "../../scripts/src/import-test-catalog.ts");

function row(code: string) {
  const found = CONFIRMED_CATALOG_ROWS.find((r) => r.code === code);
  if (!found) throw new Error(`no catalog row under ${CATALOG_EVIDENCE_SOURCE}: ${code}`);
  return found;
}

/** Every .ts/.tsx file under `dir`, as POSIX paths relative to the package. */
function walkSourceFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkSourceFiles(full, base));
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(relative(base, full).replace(/\\/g, "/"));
    }
  }
  return out;
}

/**
 * The MRI codes the repository's own catalog seed generates, as
 * `code -> "NAME|price"`. Codes are `MRI` + a zero-padded index into the
 * alphabetical `MRI_TESTS` list, which is exactly how the clinic's test catalog
 * was built.
 */
function readSeedCodes(): Map<string, string> {
  const src = readFileSync(SEED_PATH, "utf8");
  const block = src.match(/const MRI_TESTS: \[string, number\]\[\] = \[([\s\S]*?)\n\];/);
  if (!block) throw new Error("MRI_TESTS list not found in the catalog seed");
  const items = [...block[1].matchAll(/^\s*\["(.+?)",\s*(\d+)\]/gm)];
  return new Map(items.map((m, i) => [`MRI${String(i + 1).padStart(3, "0")}`, `${m[1]}|${m[2]}`]));
}

describe("catalog evidence (spec §24)", () => {
  it("records the export the evidence came from", () => {
    expect(CATALOG_EVIDENCE_SOURCE).toMatch(/2026-09-27/);
    expect(CONFIRMED_CATALOG_ROWS.length).toBeGreaterThan(8);
    const codes = CONFIRMED_CATALOG_ROWS.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const r of CONFIRMED_CATALOG_ROWS) {
      expect(r.code, r.code).toBe(r.code.toUpperCase());
      expect(r.name, r.code).toBe(r.name.toUpperCase());
      expect(r.price, r.code).toMatch(/^\d+\.\d\d$/);
    }
  });

  it("carries the evidence as a field on every row, not as a comment above the list", () => {
    for (const r of CONFIRMED_CATALOG_ROWS) {
      expect(r.evidenceSource, r.code).toBe(CATALOG_EVIDENCE_SOURCE);
      expect(r.evidenceDate, r.code).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    // A catalog-backed answer can be traced; a name-only inference admits it has
    // no evidence at all.
    const backed = resolveStudyComposition({ code: "MRI020", name: "MRI DL SPINE" });
    expect(backed.evidenceSource).toBe(CATALOG_EVIDENCE_SOURCE);
    expect(backed.evidenceDate).toBe(CATALOG_EVIDENCE_DATE);
    const alias = resolveStudyComposition({ name: "MRI DORSOLUMBAR SPINE" });
    expect(alias.evidenceSource).toBeNull();
    expect(alias.evidenceDate).toBeNull();
    expect(alias.evidenceBacked).toBe(false);
    for (const retired of RETIRED_CATALOG_ASSERTIONS) {
      expect(retired.evidenceSource, retired.code).toBe(CATALOG_EVIDENCE_SOURCE);
      expect(retired.retractedOn, retired.code).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("agrees with the repository's own catalog seed on every numbered code", () => {
    // scripts/src/import-test-catalog.ts is the generator behind the clinic's
    // test catalog, so it is a second, independent check that these rows were
    // read rather than imagined. Short legacy codes (MRID, MRIL) predate it and
    // are not compared.
    const seed = readSeedCodes();
    for (const r of CONFIRMED_CATALOG_ROWS.filter((row) => /^MRI\d{3}$/.test(row.code))) {
      expect(seed.get(r.code), r.code).toBe(`${r.name}|${Number(r.price)}`);
    }
    expect(seed.get("MRI020")).toBe("MRI DL SPINE|8500");
    expect(seed.get("MRI039")).toBe("MRI MAMMOGRAPHY B/L|15000");
    // No seed row spells a dorso-lumbar examination the way the retired claim did.
    expect([...seed.values()].some((v) => /DORSO|THORACOLUMBAR/i.test(v))).toBe(false);
  });

  it("keeps confirmed rows, aliases and retired assertions in separate lists", () => {
    const confirmedCodes = CONFIRMED_CATALOG_ROWS.map((r) => r.code);
    for (const retired of RETIRED_CATALOG_ASSERTIONS) {
      expect(confirmedCodes, `${retired.code} must not be claimed as evidence`).not.toContain(retired.code);
      expect(retired.reason.length).toBeGreaterThan(20);
    }
    // An alias is a name rule, never a code.
    for (const alias of HEURISTIC_NAME_ALIASES) {
      expect(alias.tokens.join(" ").length).toBeGreaterThan(4);
      expect(alias.key).toMatch(/^ALIAS-/);
    }
  });

  it("search guard: the fictional MRI039 dorso-lumbar mapping exists nowhere else", () => {
    // MRI039 may appear only in the retired list and in the tests that police
    // it. Any other file that names it has re-introduced a mapping to code that
    // never existed, which is how breast imaging ended up on a spine canvas.
    const srcDir = resolve(PKG_DIR, "src");
    const allowed = new Set([
      "lib/mriDorsoLumbarCatalog.ts",
      "lib/mriDorsoLumbarCatalog.test.ts",
    ]);
    const offenders = walkSourceFiles(srcDir)
      .filter((rel) => !allowed.has(rel))
      .filter((rel) => readFileSync(resolve(srcDir, rel), "utf8").includes("MRI039"));
    expect(offenders).toEqual([]);
  });
});

describe("resolveStudyComposition (spec §24)", () => {
  it("1. resolves MRI020 / MRI DL SPINE to the dedicated dorso-lumbar composition", () => {
    const byCode = resolveStudyComposition({ code: "MRI020", name: row("MRI020").name });
    expect(byCode.composition).toBe("dorsolumbar-dedicated");
    expect(byCode.provenance).toBe("catalog-code");
    expect(byCode.evidenceBacked).toBe(true);
    expect(isDorsoLumbarDedicated(byCode.composition)).toBe(true);

    // The same answer arrives when only the billed name is known.
    const byName = resolveStudyComposition({ name: "MRI DL SPINE" });
    expect(byName.composition).toBe("dorsolumbar-dedicated");
    expect(byName.provenance).toBe("catalog-name");
  });

  it("expresses dorso-lumbar as one composition, never as two screening regions", () => {
    const resolved = resolveStudyComposition({ code: "MRI020", name: "MRI DL SPINE" });
    expect(resolved.roles.dorsal).toBe(DEDICATED_COMPONENT_ROLE);
    expect(resolved.roles.ls).toBe(DEDICATED_COMPONENT_ROLE);
    expect(resolved.roles.cervical).toBe("absent");
    expect(dorsolumbarRolesAreOneComposition(resolved.roles)).toBe(true);
    // The screening panel must therefore offer nothing of its own domains.
    expect(offeredScreeningRegions(resolved.roles)).toEqual([]);
    expect(screeningRolesSummary(resolved.roles)).not.toMatch(/screening/);
  });

  it("2. still resolves MRID to the dedicated dorsal examination", () => {
    const resolved = resolveStudyComposition({ code: "MRID", name: "MRI DORSAL SPINE" });
    expect(resolved.composition).toBe("dorsal-dedicated");
    expect(resolved.roles).toEqual({ cervical: "absent", dorsal: "primary-dedicated", ls: "absent" });
    expect(offeredScreeningRegions(resolved.roles)).toEqual([]);
  });

  it("3. keeps MRI021 and MRISCREENINGDORSAL as dorsal screening", () => {
    for (const code of ["MRI021", "MRISCREENINGDORSAL"]) {
      const r = row(code);
      expect(r.name).toMatch(/DORSAL/);
      const resolved = resolveStudyComposition({ code, name: r.name });
      expect(resolved.composition, code).toBe("regional-screening");
      expect(resolved.roles.dorsal, code).toBe("primary-screening");
      expect(offeredScreeningRegions(resolved.roles), code).toEqual(["dorsal"]);
    }
  });

  it("resolves the other dedicated and combination rows by their catalog codes", () => {
    expect(resolveStudyComposition({ code: "MRIC", name: "MRI CERVICAL SPINE" }).composition).toBe("cervical-dedicated");
    expect(resolveStudyComposition({ code: "MRIL", name: "MRI LS SPINE" }).composition).toBe("ls-dedicated");
    expect(resolveStudyComposition({ code: "MRI062", name: "MRI WHOLE SPINE SCREENING" }).composition).toBe("whole-spine-screening");
    expect(resolveStudyComposition({ code: "MRICEWSS", name: row("MRICEWSS").name }).roles)
      .toEqual({ cervical: "primary-dedicated", dorsal: "accompanying-screening", ls: "accompanying-screening" });
    expect(resolveStudyComposition({ code: "MRI038", name: row("MRI038").name }).roles)
      .toEqual({ cervical: "accompanying-screening", dorsal: "accompanying-screening", ls: "primary-dedicated" });
  });

  it("6. resolves no clinical composition for the fictional MRI039 claim", () => {
    expect(RETIRED_CATALOG_ASSERTIONS.some((r) => r.code === "MRI039")).toBe(true);
    const resolved = resolveStudyComposition({ code: "MRI039", name: "MRI DORSOLUMBAR SPINE" });
    expect(resolved.composition).toBe("unknown");
    expect(resolved.roles).toEqual({ cervical: "absent", dorsal: "absent", ls: "absent" });
    expect(resolved.note).toMatch(/without evidence/);
    // The retired code may not survive as a spine mapping anywhere in the lib.
    const rolesSource = readFileSync(resolve(PKG_DIR, "src/lib/mriSpineScreeningRoles.ts"), "utf8");
    expect(rolesSource).not.toMatch(/MRI039/);
  });

  it("does not claim MRIDWSS as a catalog code", () => {
    expect(CONFIRMED_CATALOG_ROWS.some((r) => r.code === "MRIDWSS")).toBe(false);
    // The name rule survives; only the invented code is gone.
    const byName = resolveScreeningRoles({ name: "MRI DORSAL SPINE WITH WHOLE SPINE SCREENING" });
    expect(byName.roles.dorsal).toBe("primary-dedicated");
    expect(byName.roles.ls).toBe("accompanying-screening");
  });

  it("7. leaves unknown codes and speculative spellings unresolved", () => {
    const unknownCode = resolveStudyComposition({ code: "MRI999", name: "MRI SPINE" });
    expect(unknownCode.composition).toBe("unknown");
    expect(unknownCode.provenance).toBe("none");
    expect(unknownCode.roles).toEqual({ cervical: "absent", dorsal: "absent", ls: "absent" });

    // A bare "DL" with no catalog row behind it names nothing this code may assume.
    const bareDl = resolveScreeningRoles({ code: "MRI777", name: "MRI DL SOMETHING" });
    expect(bareDl.matchedKey).toBe("AMBIGUOUS_DORSOLUMBAR");
    expect(offeredScreeningRegions(bareDl.roles)).toEqual([]);

    // A single-word "LUMBAR" booking is lumbar, never dorso-lumbar.
    expect(resolveStudyComposition({ name: "MRI LUMBAR SPINE" }).composition).not.toBe("dorsolumbar-dedicated");
    expect(spineSegmentFromRegion("MRI LUMBAR SPINE")).toBe("lumbar");
  });

  it("resolves spelled-out dorso-lumbar wording as an alias and says so", () => {
    for (const name of ["MRI DORSOLUMBAR SPINE", "MRI DORSO LUMBAR SPINE", "MRI THORACOLUMBAR SPINE", "MRI THORACO-LUMBAR SPINE"]) {
      const resolved = resolveStudyComposition({ name });
      expect(resolved.composition, name).toBe("dorsolumbar-dedicated");
      expect(resolved.provenance, name).toBe("heuristic-alias");
      expect(resolved.evidenceBacked, name).toBe(false);
      expect(resolved.note, name).toMatch(/not from a catalog code/);
      expect(compositionSummary(resolved), name).toMatch(/inferred from the examination name/);
    }
  });

  it("surfaces a code whose printed name has moved on", () => {
    const resolved = resolveStudyComposition({ code: "MRI020", name: "MRI DORSAL SPINE" });
    expect(resolved.composition).toBe("dorsolumbar-dedicated");
    expect(resolved.note).toMatch(/Confirm the booking/);
  });
});

describe("canvas routing (spec §24)", () => {
  it("4. no longer routes MRI DL SPINE to the dorsal canvas", () => {
    const opts = { modality: "MR", region: "DL Spine" };
    expect(isMriDorsalReportingContext(opts)).toBe(false);
    expect(isMriLumbarReportingContext(opts)).toBe(false);
    expect(isMriDorsoLumbarReportingContext(opts)).toBe(true);
    expect(spineSegmentFromRegion("DL Spine")).toBe("dorsolumbar");

    const billed = { modality: "MR", region: "Dorso-Lumbar Spine" };
    expect(isMriDorsalReportingContext(billed)).toBe(false);
    expect(isMriLumbarReportingContext(billed)).toBe(false);
    expect(isMriDorsoLumbarReportingContext(billed)).toBe(true);
  });

  it("5. leaves dedicated dorsal and lumbar routing untouched", () => {
    for (const region of ["Dorsal Spine", "Thoracic Spine", "D Spine", "T Spine"]) {
      const opts = { modality: "MR", region };
      expect(isMriDorsalReportingContext(opts), region).toBe(true);
      expect(isMriLumbarReportingContext(opts), region).toBe(false);
      expect(isMriDorsoLumbarReportingContext(opts), region).toBe(false);
    }
    // "D Spine" / "T Spine" reach the dorsal canvas through the gate's own name
    // list; the segment classifier has never mapped them, and this phase does
    // not change that.
    expect(spineSegmentFromRegion("Dorsal Spine")).toBe("dorsal");
    expect(spineSegmentFromRegion("Thoracic Spine")).toBe("dorsal");
    for (const region of ["LS Spine", "Lumbar Spine", "Lumbosacral Spine"]) {
      const opts = { modality: "MR", region };
      expect(isMriLumbarReportingContext(opts), region).toBe(true);
      expect(isMriDorsalReportingContext(opts), region).toBe(false);
      expect(isMriDorsoLumbarReportingContext(opts), region).toBe(false);
      expect(spineSegmentFromRegion(region), region).toBe("lumbar");
    }
    // Cervical and whole-spine behaviour is unchanged too.
    expect(spineSegmentFromRegion("Cervical Spine")).toBe("cervical");
    expect(isMriDorsoLumbarReportingContext({ modality: "MR", region: "Cervical Spine" })).toBe(false);
    expect(isMriDorsoLumbarReportingContext({ modality: "MR", region: "Whole Spine" })).toBe(false);
    // Not an MRI at all.
    expect(isMriDorsoLumbarReportingContext({ modality: "CT", region: "DL Spine" })).toBe(false);
  });
});

describe("manual override (spec §24)", () => {
  it("8. lets the radiologist restate what was actually performed", () => {
    useWorkspace.setState({ screening: defaultScreeningState() });
    const billed = resolveStudyComposition({ code: "MRI020", name: "MRI DL SPINE" });
    useWorkspace.getState().replaceScreeningRoles(billed.roles);
    expect(useWorkspace.getState().screening.dorsal.role).toBe(DEDICATED_COMPONENT_ROLE);
    expect(useWorkspace.getState().screening.ls.role).toBe(DEDICATED_COMPONENT_ROLE);

    // The booking said dorso-lumbar; the scanner only covered the lumbar spine.
    useWorkspace.getState().setScreeningRegion("dorsal", { role: "absent" });
    useWorkspace.getState().setScreeningRegion("ls", { role: "primary-dedicated" });
    const roles = useWorkspace.getState().screening;
    expect(roles.dorsal.role).toBe("absent");
    expect(roles.ls.role).toBe("primary-dedicated");
    expect(dorsolumbarRolesAreOneComposition({
      cervical: roles.cervical.role,
      dorsal: roles.dorsal.role,
      ls: roles.ls.role,
    })).toBe(false);

    // Re-deriving from billing restores the catalog answer.
    useWorkspace.getState().replaceScreeningRoles(resolveStudyComposition({ code: "MRI020", name: "MRI DL SPINE" }).roles);
    expect(useWorkspace.getState().screening.dorsal.role).toBe(DEDICATED_COMPONENT_ROLE);
  });

  it("offers an accompanying cervical screening module alongside the dedicated composition", () => {
    const resolved = resolveStudyComposition({ code: "MRI020", name: "MRI DL SPINE" });
    const withCervical = { ...resolved.roles, cervical: "accompanying-screening" as const };
    expect(offeredScreeningRegions(withCervical)).toEqual(["cervical"]);
  });
});
