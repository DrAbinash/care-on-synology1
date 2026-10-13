/**
 * PR E PRIORITY 4 — the anatomy chips in the Reporting Tools rail navigate a tile strip that
 * the rail never mounts.
 *
 * Measured in a real browser on the synthetic whole-spine screening study: the Quick Insert pane
 * renders `findings-anatomy-chips-bar` with 14 chips, visible, while `findings-anatomy-strip` —
 * the component that renders the findings tiles those chips select — does not exist in the DOM in
 * any state. Clicking `L1-L2` therefore changes a piece of state nothing visible consumes, and the
 * radiologist gets no tile for the level they asked for. All 14 chips behave that way, and the
 * pane's `qs-tile-*` count is the same 6 before and after any chip click because those six belong
 * to the Impression and Recommendation strips, not to Findings.
 *
 * The strip's other mount site is `ReportCanvas.tsx`, inside the `{false && (` block that retires
 * the legacy inline assistance — so the component is dead UI everywhere, not merely off-screen.
 *
 * Source contracts, because this repo has no component-render harness. The behaviour is proven in
 * the browser: the same probe that measured zero tiles for fourteen chips measures the seeded
 * tiles per chip once the strip is mounted.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { groupByAnatomy } from "../../../lib/findingsAnatomyGroups";
import { tileMatchesAnatomy } from "../FindingsAnatomyChips";
import { DEFAULT_QUICK_SELECT_TILES, lookupTilesForContext } from "../../../lib/zai-workspace/quick-select-library";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "../../../.."); // artifacts/diagnostic-erp
const repoRoot = resolve(pkgRoot, "../..");
const read = (abs: string) => readFileSync(abs, "utf8").replace(/\r\n/g, "\n");

const RAIL = resolve(pkgRoot, "src/components/radiology/workspace/ReportingToolsRail.tsx");
const CANVAS = resolve(pkgRoot, "src/components/radiology/workspace/ReportCanvas.tsx");
const STRIP = resolve(pkgRoot, "src/components/radiology/FindingsAnatomyStrip.tsx");
const SEED = resolve(repoRoot, "migrations/zz_add_whole_spine_screening_quick_findings.sql");

/** The `quick-insert` pane's `quick-select` branch, bounded on its own JSX delimiters rather than
 *  a character budget — a longer comment above it must not silently empty the slice. */
function quickSelectBranch(src: string): string {
  const start = src.indexOf('quickInsertSource === "quick-select"');
  expect(start, "the quick-select branch is gone from the rail").toBeGreaterThan(-1);
  const open = src.indexOf("?", start);
  const close = src.indexOf(") : null}", open);
  expect(open).toBeGreaterThan(start);
  expect(close, "the quick-select branch does not close where this test expects").toBeGreaterThan(open);
  return src.slice(open, close);
}

/** One element's props, sliced from its own opening tag to its first closing `/>`. */
function elementSource(branch: string, tag: string): string {
  const start = branch.indexOf(`<${tag}`);
  expect(start, `<${tag}> is not in the quick-select branch`).toBeGreaterThan(-1);
  const end = branch.indexOf("/>", start);
  expect(end).toBeGreaterThan(start);
  return branch.slice(start, end);
}

describe("the rail's quick-select pane hosts both halves of the anatomy pathway", () => {
  const rail = read(RAIL);
  const branch = quickSelectBranch(rail);

  it("keeps the chip navigation it already had", () => {
    expect(branch).toContain("<FindingsAnatomyChips");
  });

  it("mounts the tile strip the chips select into", () => {
    expect(branch, "the chips navigate a strip that is not mounted in this pane")
      .toContain("<FindingsAnatomyStrip");
  });

  it("puts the tiles under the chips, not above them", () => {
    const chips = branch.indexOf("<FindingsAnatomyChips");
    const strip = branch.indexOf("<FindingsAnatomyStrip");
    expect(chips).toBeGreaterThan(-1);
    expect(strip).toBeGreaterThan(-1);
    expect(strip).toBeGreaterThan(chips);
  });

  it("feeds both halves the SAME catalogue and the SAME active-anatomy state", () => {
    // One source of truth. A chip that selects a different array than the strip renders would put
    // the pane back to showing tiles for the wrong anatomy.
    const chips = elementSource(branch, "FindingsAnatomyChips");
    const strip = elementSource(branch, "FindingsAnatomyStrip");
    for (const [label, src] of [["chips", chips], ["strip", strip]] as const) {
      expect(src, `${label} lost the shared catalogue`).toContain("findings={catalogQuickFindings}");
      expect(src, `${label} lost the shared selection`).toContain("activeAnatomy={activeFindingsAnatomy}");
      expect(src, `${label} lost the shared study identity`).toContain("selectedStudyTabId={studySetup.selectedStudyTabId}");
      expect(src).toContain("selectedStudyTabName={studySetup.matchedStudyRegion}");
    }
  });

  it("writes through the finding path the pane already uses, so no second engine appears", () => {
    const strip = elementSource(branch, "FindingsAnatomyStrip");
    expect(strip).toContain("onToggle={handleQuickToggle}");
    expect(strip).toContain("onFindingClick={(f) => studySetup.handleFindingClick(f, selectedQuickIds, handleQuickToggle)}");
    expect(strip).toContain("selectedIds={selectedQuickIds}");
    expect(strip).toContain("blockedIds={blockedQuickFindingIds}");
    expect(strip).toContain("disabled={contentLocked}");
  });

  it("imports the strip it mounts", () => {
    // Anchored at line start: a commented-out import keeps the same characters and would satisfy an
    // unanchored pattern, which is how this assertion first survived a mutation that deleted it.
    expect(rail, "the rail mounts a strip it does not import")
      .toMatch(/\nimport FindingsAnatomyStrip from "@\/components\/radiology\/FindingsAnatomyStrip";/);
  });

  it("counts one live mount and leaves the retired canvas block retired", () => {
    const count = (s: string) => (s.match(/<FindingsAnatomyStrip\b/g) || []).length;
    expect(count(read(RAIL)), "the rail must mount the strip exactly once").toBe(1);
    // Un-retiring that canvas block would resurrect dozens of superseded controls alongside the
    // strip. That is a different change, and this test exists to notice if it happens by accident.
    const canvas = read(CANVAS);
    expect(count(canvas)).toBe(1);
    expect(canvas).toContain("{false && (");
  });
});

/**
 * Why this fix needs no data migration. The chips are `groupByAnatomy(findings)` keys and the strip
 * renders `anatomyGroups.find(([k]) => k === activeAnatomy)`, so a chip label is by construction a
 * key the strip can resolve. The alternative — tagging `anatomicalSection` onto the admin Quick
 * Select tiles to make `tileMatchesAnatomy` match — would duplicate this catalogue in a second
 * store that lives in localStorage, and would still miss every clinic-authored finding.
 */
describe("a chip label resolves to findings in the strip's own lookup", () => {
  it("selects by the chip's own string, not by a guess", () => {
    expect(read(STRIP)).toContain("anatomyGroups.find(([k]) => k === activeAnatomy)?.[1]");
  });

  it("seeds every level chip with at least one finding in the shipped catalogue", () => {
    const seed = read(SEED);
    // Column order is (study_type, label, finding_text, impression_text, anatomical_section,
    // conflict_group, …), so a section value is the string immediately before its slug — that
    // pins the SECTION column rather than any level text that happens to appear in a sentence.
    for (const [section, slug] of [
      ["L1-L2", "l1l2"], ["L2-L3", "l2l3"], ["L3-L4", "l3l4"], ["L4-L5", "l4l5"], ["L5-S1", "l5s1"],
    ]) {
      const rows = (seed.match(new RegExp(`'${section}', '${slug}'`, "g")) || []).length;
      expect(rows, `the shipped seed carries no ${section} anatomy section`).toBeGreaterThan(0);
    }
  });

  it("groups a level-tagged finding under exactly that level", () => {
    const findings = [
      { id: 1, anatomicalSection: "L1-L2", conflictGroup: "l1l2", label: "L1-L2 disc bulge", findingText: "a", sortOrder: 10 },
      { id: 2, anatomicalSection: "L4-L5", conflictGroup: "l4l5", label: "L4-L5 disc bulge", findingText: "b", sortOrder: 13 },
      { id: 3, anatomicalSection: "L4-L5", conflictGroup: "l4l5", label: "L4-L5 disc herniation", findingText: "c", sortOrder: 14 },
    ] as unknown as Parameters<typeof groupByAnatomy>[0];
    const groups = groupByAnatomy(findings);
    expect(groups.map(([k]) => k).sort()).toEqual(["L1-L2", "L4-L5"]);
    expect(groups.find(([k]) => k === "L1-L2")?.[1]).toHaveLength(1);
    expect(groups.find(([k]) => k === "L4-L5")?.[1]).toHaveLength(2);
    // A chip whose key resolves to nothing is the shape the pane is in today for every chip.
    expect(groups.find(([k]) => k === "L5-S1")).toBeUndefined();
  });
});

/**
 * The other half of the same pathway, measured rather than grepped.
 *
 * The chips auto-select their first group on mount (`FindingsAnatomyChips.tsx:42-51`), so a study
 * with Quick Findings ALWAYS has an active anatomy — and the Quick Select strip applies that
 * anatomy to its tiles. In a real browser on the synthetic whole-spine study that produced 56
 * tiles scoped by region, 0 tiles offered, and a header still printing "56 tiles", because
 * `tileMatchesAnatomy` read a tile with no `anatomicalSection` as a tile about a different
 * anatomy. Nothing in the product ever sets that field on a tile: not the shipped catalogue
 * (asserted below against the real one), not the admin editor, and not the content-pack route,
 * whose `findingToTile` maps every other field but that one.
 *
 * So "unknown anatomy" must not mean "excluded". Tiles that do declare a section still narrow —
 * that is what the chips are for.
 */
describe("an active anatomy chip keeps tiles that declare no anatomy", () => {
  const QUICK_STRIP = resolve(pkgRoot, "src/components/radiology/zai-workspace/quick-select-strip.tsx");
  const wholeSpine = {
    region: "Whole Spine",
    regions: ["Whole Spine"],
    family: "spine",
    spineSegment: "whole",
  } as unknown as Parameters<typeof lookupTilesForContext>[3];
  const scoped = lookupTilesForContext(DEFAULT_QUICK_SELECT_TILES, "findings", "MR", wholeSpine);

  it("the catalogue the chip is applied to is the one the strip is given", () => {
    expect(scoped.length, "a whole-spine MR study must have region-scoped findings tiles").toBeGreaterThan(0);
    // The premise of the tests below, stated as a measurement rather than assumed: not one tile
    // in the shipped catalogue declares the section the filter asks for.
    expect(scoped.filter((t) => (t.anatomicalSection ?? "").trim()).length).toBe(0);
  });

  it("the chip this component auto-selects offers every scoped tile, not none", () => {
    const offered = scoped.filter((t) => tileMatchesAnatomy(t.anatomicalSection, "L1-L2"));
    expect(offered.length).toBe(scoped.length);
  });

  it("a tile that does declare a section still narrows, in both directions", () => {
    expect(tileMatchesAnatomy("L1-L2", "L1-L2")).toBe(true);
    expect(tileMatchesAnatomy("L4-L5", "L1-L2")).toBe(false);
    expect(tileMatchesAnatomy("Screening — Cervical Spine", "L1-L2")).toBe(false);
    expect(tileMatchesAnatomy("Cervical Spine", null)).toBe(true);
  });

  it("the strip counts the tiles it offers, not the tiles the region holds", () => {
    const strip = read(QUICK_STRIP);
    expect(strip).toContain("{filtered.length} tiles");
    expect(strip).not.toContain("{scoped.length} tiles");
  });
});
