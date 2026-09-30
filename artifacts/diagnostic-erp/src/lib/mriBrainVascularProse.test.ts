/**
 * mriBrainVascularProse.test.ts — the canonical clinical source stays canonical
 * (mra/mrv spec §1, §14, §16, §17).
 *
 * Two separate promises are checked here. First, that every sentence copied out of
 * the clinical library (and the two sentences the specification itself dictates for
 * basic screening) is still byte-identical to its source, so an implementer cannot
 * quietly reword clinical terminology. Second, that where the library states a
 * conclusion the acquisition cannot support, the strong clause lives only in the
 * interpretation half — no observation half may carry "diagnostic of …" wording that
 * a palette tile would emit automatically.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ANEURYSM_MACRO_FINDINGS,
  ANEURYSM_MACRO_IMPRESSION,
  CVST_MACRO_FINDINGS,
  CVST_MACRO_IMPRESSIONS,
  INTRACRANIAL_MRA_FINDINGS_ORDER,
  MRA_SCREENING_PROSE,
  MRA_NECK_FINDINGS_ORDER,
  MRV_FINDINGS_ORDER,
  VASCULAR_FINDINGS_SECTIONS,
  VASCULAR_LIBRARY_PROSE,
  VASCULAR_PROSE_SPLITS,
  VASCULAR_PROSE_SOURCE,
  vascularSplitFor,
  vascularUntracedProseWords,
} from "@/lib/mriBrainVascularProse";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) =>
  readFileSync(path.resolve(HERE, rel), "utf8").replace(/\r\n/g, "\n");

/** Markdown bold is markup, not clinical wording — strip it before comparing. */
const LIBRARY = read("../../../../docs/clinical-libraries/mri-brain-mra-mrv-clinical-content-library.md").replace(
  /\*\*/g,
  "");
const SPEC = read("../../../../docs/tasks/mri-brain-mra-mrv-submaster-v3.md");

describe("mriBrainVascularProse — the library is quoted, not rewritten", () => {
  it("keeps every canonical sentence verbatim in the clinical library", () => {
    for (const [key, text] of Object.entries(VASCULAR_LIBRARY_PROSE)) {
      expect(LIBRARY, key).toContain(text);
    }
  });

  it("covers all three library sections plus both supplied macros verbatim", () => {
    expect(LIBRARY).toContain(VASCULAR_LIBRARY_PROSE.mraIntracranialNormal);
    expect(LIBRARY).toContain(VASCULAR_LIBRARY_PROSE.mraNeckNormal);
    expect(LIBRARY).toContain(VASCULAR_LIBRARY_PROSE.mrvNormal);
    for (const line of ANEURYSM_MACRO_FINDINGS) expect(LIBRARY).toContain(line);
    expect(LIBRARY).toContain(ANEURYSM_MACRO_IMPRESSION);
    for (const line of CVST_MACRO_FINDINGS) expect(LIBRARY).toContain(line);
    for (const line of CVST_MACRO_IMPRESSIONS) expect(LIBRARY).toContain(line);
  });

  it("uses the two sentences the specification dictates for screening", () => {
    // §14 types these wrapped across lines; whitespace is not part of the wording.
    const spec = SPEC.replace(/\s+/g, " ");
    expect(spec).toContain(MRA_SCREENING_PROSE.normal);
    expect(spec).toContain(MRA_SCREENING_PROSE.limitation);
  });

  it("imports nothing, so the guard can read its own source text", async () => {
    const self = read("./mriBrainVascularProse.ts");
    expect(self).not.toMatch(/^\s*import\s/m);
    // The exported source path is the file this test actually reads.
    expect(read("./mriBrainVascularProse.ts")).toContain(VASCULAR_PROSE_SOURCE);
    expect(LIBRARY).not.toBe("");
  });
});

describe("mriBrainVascularProse — strong conclusions are separated out", () => {
  it("splits every library line exactly once", () => {
    const sources = VASCULAR_PROSE_SPLITS.map((s) => s.source);
    expect(new Set(sources).size).toBe(sources.length);
    for (const key of Object.keys(VASCULAR_LIBRARY_PROSE) as (keyof typeof VASCULAR_LIBRARY_PROSE)[]) {
      if (key.endsWith("Normal")) continue;
      expect(vascularSplitFor(key).source).toBe(key);
    }
  });

  it("keeps diagnosis-asserting wording out of every observation half", () => {
    const banned = [
      "diagnostic of",
      "moyamoya disease",
      "consistent with subacute",
      "consistent with acute",
      "nascet",
    ];
    for (const split of VASCULAR_PROSE_SPLITS) {
      const lower = split.observation.toLowerCase();
      for (const word of banned) {
        expect(lower, `${split.source}: ${word}`).not.toContain(word);
      }
    }
  });

  it("puts the conclusion in the interpretation half whenever the library states one", () => {
    const withInterpretation = VASCULAR_PROSE_SPLITS.filter((s) => s.interpretation);
    expect(withInterpretation.length).toBeGreaterThanOrEqual(8);
    expect(withInterpretation.map((s) => s.source)).toEqual(
      expect.arrayContaining([
        "icaTerminusOcclusion",
        "moyamoyaPattern",
        "carotidDissection",
        "cvstSagittal",
        "cvstTransverseFillingDefect",
        "mcaM1Stenosis",
        "carotidBulbStenosis",
        "avmPattern",
      ]),
    );
    expect(vascularSplitFor("moyamoyaPattern").interpretation).toBe("Moyamoya disease.");
    expect(vascularSplitFor("cvstTransverseFillingDefect").interpretation).toBe(
      "Consistent with subacute dural venous sinus thrombosis.",
    );
  });

  it("traces every clinical word of both halves back to the library line", () => {
    for (const split of VASCULAR_PROSE_SPLITS) {
      const source = VASCULAR_LIBRARY_PROSE[split.source];
      expect(
        vascularUntracedProseWords(split.observation, source),
        `${split.source} observation`,
      ).toEqual([]);
      if (split.interpretation) {
        expect(
          vascularUntracedProseWords(split.interpretation, source),
          `${split.source} interpretation`,
        ).toEqual([]);
      }
    }
  });

  it("shortens the observation exactly when a conclusion was removed", () => {
    for (const split of VASCULAR_PROSE_SPLITS) {
      const source = VASCULAR_LIBRARY_PROSE[split.source];
      if (split.interpretation) {
        expect(split.observation.length, split.source).toBeLessThan(source.length);
      } else {
        expect(split.observation, split.source).toBe(source);
      }
    }
  });
});

describe("mriBrainVascularProse — Findings order comes from the specification", () => {
  /** Parse the `N. Label` list directly under a §17 heading. */
  function specOrder(heading: string): string[] {
    const start = SPEC.indexOf(heading);
    expect(start, heading).toBeGreaterThan(-1);
    const lines: string[] = [];
    for (const line of SPEC.slice(start + heading.length).split("\n").slice(1)) {
      const match = /^\s*\d+\.\s+(.+?)\s*$/.exec(line);
      // The lists are contiguous inside §17, so the first non-item ends the list.
      if (!match) break;
      lines.push(match[1]!);
    }
    return lines;
  }

  function resolve(order: readonly (keyof typeof VASCULAR_FINDINGS_SECTIONS)[]): string[] {
    return order.map((key) => VASCULAR_FINDINGS_SECTIONS[key]);
  }

  /**
   * A section must name the same anatomy in the same position. Either side may add
   * a qualifier — the specification writes "Associated brain findings when
   * applicable", the report prints "Associated brain findings" — so neither string
   * is required to be the other's exact prefix.
   */
  function expectSameOrder(labels: string[], items: string[], heading: string): void {
    expect(labels, heading).toHaveLength(items.length);
    items.forEach((item, index) => {
      const label = labels[index]!.toLowerCase();
      const spec = item.toLowerCase();
      expect(
        spec.includes(label) || label.includes(spec),
        `${heading} position ${index + 1}: "${item}" vs "${labels[index]}"`,
      ).toBe(true);
    });
  }

  it("orders the dedicated intracranial MRA report as §17 states", () => {
    const items = specOrder("Dedicated intracranial MRA order:");
    expect(items.length).toBeGreaterThan(4);
    expectSameOrder(resolve(INTRACRANIAL_MRA_FINDINGS_ORDER), items, "intracranial MRA");
  });

  it("orders the MRA neck report as §17 states", () => {
    const items = specOrder("MRA neck order:");
    expect(items.length).toBeGreaterThan(4);
    expectSameOrder(resolve(MRA_NECK_FINDINGS_ORDER), items, "MRA neck");
  });

  it("orders the MRV report as §17 states", () => {
    const items = specOrder("MRV order:");
    expect(items.length).toBeGreaterThan(4);
    expectSameOrder(resolve(MRV_FINDINGS_ORDER), items, "MRV");
  });
});
