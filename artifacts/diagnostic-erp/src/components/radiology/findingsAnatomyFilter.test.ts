/**
 * The anatomy chip is a filter the radiologist applies, not a tab they land on.
 *
 * Measured in a real browser on the synthetic "MRI Brain Plain" study (wl 267 / SYNACC17) at
 * f96d92f1: 48 catalogue boxes are scoped to that study, and the wall offered 31, because the chip
 * bar auto-selected `anatomyGroups[0]` — "White Matter", three boxes — on mount and every other
 * section-declaring box was hidden behind a chip nothing had told the radiologist about. The
 * hidden set was the acute-stroke set: "Acute Infarct", "DWI restriction", "ADC restriction",
 * "Acute infarct (DWI)", "Midline shift", "Mass effect", "Hydrocephalus", "Cerebral Atrophy",
 * "Tumor", "Hemorrhage", both basal-ganglia hemorrhage boxes. The same rule hid 23 of 81 boxes on
 * MRI Cervical Spine, 6 of 61 on MRI LS Spine (including all three of L3-L4, L4-L5 and L5-S1 disc
 * bulge) and 55 of 153 on Whole Spine.
 *
 * Fixing it must not delete the filter: a radiologist working a multi-level spine study still wants
 * to narrow the wall to one level. So the default is "no filter" (`activeAnatomy === null`, which
 * both consumers already treat as show-all), an explicit "All" chip turns a filter back off, and a
 * second click on the lit chip clears it.
 *
 * `tileMatchesAnatomy` keeps its rule that a tile declaring no anatomy passes every chip, and gains
 * the placeholder case: a stored section of `{level}` names no anatomy, so it must neither print as
 * a chip label (an unresolved placeholder on a control is what the reporting rules refuse) nor sit
 * behind a chip it can never match.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { groupByAnatomy, unscopedAnatomySection } from "../../lib/findingsAnatomyGroups";
import { tileMatchesAnatomy } from "./FindingsAnatomyChips";

const here = dirname(fileURLToPath(import.meta.url));
const CHIPS = resolve(here, "FindingsAnatomyChips.tsx");
const src = readFileSync(CHIPS, "utf8").replace(/\r\n/g, "\n");

type Row = { anatomicalSection?: string | null; sortOrder: number; label: string };
const rows = (list: Array<[string | null, string, number]>): Row[] =>
  list.map(([anatomicalSection, label, sortOrder]) => ({ anatomicalSection, label, sortOrder }));

describe("unscopedAnatomySection — a placeholder names no anatomy", () => {
  it("treats empty and brace-placeholder sections as unscoped", () => {
    for (const s of ["", "   ", null, undefined, "{level}", " {side} ", "C{level}"]) {
      expect(unscopedAnatomySection(s), `${JSON.stringify(s)} must be unscoped`).toBe(true);
    }
  });

  it("keeps every real section scoped", () => {
    for (const s of ["L4-L5", "White Matter", "Screening — Vertebral Marrow", "C2-C3 to C6-C7", "Diffusion (DWI/ADC)"]) {
      expect(unscopedAnatomySection(s), `${s} is a real anatomy`).toBe(false);
    }
  });
});

describe("groupByAnatomy folds placeholder sections instead of chipping them", () => {
  it("never offers a chip whose label is an unresolved placeholder", () => {
    const groups = groupByAnatomy(rows([
      ["White Matter", "Fazekas grade 1", 10],
      ["{level}", "Disc Bulge", 20],
      ["L4-L5", "L4-L5 disc bulge", 30],
      ["", "Normal study", 40],
    ]));
    const labels = groups.map(([k]) => k);
    expect(labels.some((l) => l.includes("{"))).toBe(false);
    expect(labels).toContain("L4-L5");
    // The `{level}` box and the untitled one share the unscoped group.
    expect(groups.find(([k]) => k === "General")?.[1].map((r) => r.label).sort()).toEqual(["Disc Bulge", "Normal study"]);
  });
});

describe("tileMatchesAnatomy — the chip narrows real anatomy and nothing else", () => {
  it("offers every tile when no chip is selected", () => {
    for (const section of ["White Matter", "L4-L5", "{level}", "", undefined, null]) {
      expect(tileMatchesAnatomy(section, null), `${JSON.stringify(section)} at no filter`).toBe(true);
    }
  });

  it("keeps a placeholder tile reachable under any chip", () => {
    expect(tileMatchesAnatomy("{level}", "L4-L5")).toBe(true);
    expect(tileMatchesAnatomy("{side}", "White Matter")).toBe(true);
  });

  it("still narrows a tile that declares the anatomy it belongs to", () => {
    expect(tileMatchesAnatomy("L4-L5", "L4-L5")).toBe(true);
    expect(tileMatchesAnatomy("L3-L4", "L4-L5")).toBe(false);
    expect(tileMatchesAnatomy("Diffusion (DWI/ADC)", "White Matter")).toBe(false);
    expect(tileMatchesAnatomy("White Matter", "White Matter")).toBe(true);
  });
});

describe("the chip bar starts unfiltered and can be turned off again", () => {
  /** The mount effect, bounded by its own braces so a longer comment cannot empty the slice. */
  const mountEffect = () => {
    const start = src.indexOf("useEffect(() => {");
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf("\n  }, [", start);
    expect(end, "the mount effect does not close where this test expects").toBeGreaterThan(start);
    return src.slice(start, end);
  };

  it("does not select the first anatomy group on mount", () => {
    const effect = mountEffect();
    expect(effect, "the chip bar narrows the wall to its first group again").not.toMatch(/onAnatomyChange\(\s*(next|anatomyGroups\[0])/);
    expect(effect).not.toMatch(/anatomyGroups\[0\]!\[0\]/);
  });

  it("passes an untouched selection straight through", () => {
    expect(mountEffect()).toMatch(/if \(activeAnatomy === null\) return;/);
  });

  it("clears a selection that the current study tab does not have", () => {
    // A filter carried over from another tab can name a section with no rows here, which would
    // hide the whole wall — the failure mode this fix must not reintroduce.
    const effect = mountEffect();
    expect(effect).toContain("anatomyGroups.some(([k]) => k === activeAnatomy)");
    expect(effect).toContain("onAnatomyChange(null)");
  });

  it("offers an All control that clears the filter", () => {
    const all = src.slice(src.indexOf('data-testid="findings-anatomy-all"') - 900, src.indexOf('data-testid="findings-anatomy-all"'));
    expect(all).toContain("onAnatomyChange(null)");
    expect(all).toContain("aria-pressed={activeAnatomy === null}");
  });

  it("clicking the lit chip again clears it", () => {
    expect(src).toContain("onAnatomyChange(active ? null : section)");
  });
});
