/**
 * Guards the spec's hardest rule: seeded lumbar prose must be VERBATIM from
 * docs/clinical-libraries/mri-lumbar-clinical-content-library.md, and the
 * composer may only substitute level / side / measurement / direction
 * variables — never invent clinical sentences.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  LS_ALIGN,
  LS_BONE,
  LS_CANAL,
  LS_DISC,
  LS_FORAMEN,
  LS_POSTERIOR,
  LS_POSTOP,
  LS_SOFT_TISSUE,
  LS_MACRO_LINES,
  LS_LIBRARY_PROSE,
  fillLsProse,
  isUnfilledProse,
} from "./mriLumbarLibrary";

const HERE = dirname(fileURLToPath(import.meta.url));
const LIBRARY_PATH = resolve(
  HERE,
  "../../../../docs/clinical-libraries/mri-lumbar-clinical-content-library.md",
);

/** Library emphasis markers and typographic quotes are presentation only. */
function normalize(s: string): string {
  return s
    .replace(/\*\*/g, "")
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const library = normalize(readFileSync(LIBRARY_PATH, "utf8"));

describe("MRI lumbar canonical clinical library", () => {
  it("is readable from the repository", () => {
    expect(library.length).toBeGreaterThan(4000);
    expect(library).toContain("Lumbosacral transitional vertebra (LSTV)");
  });

  it("contains every seeded prose entry verbatim", () => {
    const offenders: string[] = [];
    for (const [id, text] of Object.entries(LS_LIBRARY_PROSE)) {
      if (!library.includes(normalize(text))) offenders.push(`${id}: ${text}`);
    }
    expect(offenders, `Invented or drifted prose:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("exposes the eight clinical sections plus the five macros", () => {
    expect(Object.keys(LS_LIBRARY_PROSE).length).toBeGreaterThan(70);
    expect(LS_ALIGN.normal).toContain("Lumbar lordosis is well preserved");
    expect(LS_BONE.normal).toContain("Vertebral body heights and marrow signal intensities");
    expect(LS_DISC.normal).toContain("Intervertebral disc heights and signal intensities");
    expect(LS_CANAL.normal).toContain("Central canal is patent throughout");
    expect(LS_FORAMEN.normal).toContain("patent bilaterally at all levels");
    expect(LS_POSTERIOR.facetNormal).toContain("Facet joints demonstrate normal alignment");
    expect(LS_SOFT_TISSUE.normal).toContain("paraspinal musculature and psoas muscles");
    expect(LS_POSTOP.normal).toContain("Expected post-surgical changes");
    expect(Object.keys(LS_MACRO_LINES)).toHaveLength(5);
    expect(LS_MACRO_LINES.macro1.impression).toHaveLength(3);
  });

  it("substitutes level, side and measurement variables only", () => {
    const r = fillLsProse(LS_DISC.paracentralExtrusion, {
      level: "L5-S1",
      mm: 7,
      mm2: 5,
      root: "S1",
      side: "right",
    });
    expect(r.unfilled).toHaveLength(0);
    // Everything except the supplied variables is the library's own wording.
    expect(r.text).toBe(
      "Right paracentral disc extrusion at L5-S1 measuring 7 mm (AP) x 5 mm (transverse), "
      + "extending inferiorly into the right lateral recess and compressing the descending right S1 nerve root.",
    );
  });

  it("fills bracketed measurements from the unit that follows them", () => {
    expect(fillLsProse(LS_CANAL.mildStenosis, { level: "L3-L4", mm: 8 }).text).toBe(
      "Mild central canal stenosis at L3-L4 with effacement of the ventral CSF space (AP diameter = 8 mm).",
    );
    expect(fillLsProse(LS_BONE.acuteFracture, { vertebra: "L1", pct: 30 }).text).toContain("approximately 30%");
    expect(fillLsProse(LS_SOFT_TISSUE.psoasAbscess, { side: "left", cm: 4, cm2: 3 }).text).toContain(
      "Psoas muscle abscess on the left measuring 4 x 3 cm",
    );
  });

  it("resolves the listhesis paired-level group from two supplied vertebrae", () => {
    const r = fillLsProse(LS_ALIGN.anterolisthesisDegenerative, {
      level: "L4",
      level2: "L5",
      mm: 5,
    });
    expect(r.text).toContain("anterolisthesis of L4 on L5 measuring approximately 5 mm");
    expect(r.unfilled).toHaveLength(0);
  });

  it("resolves a Castellvi grade without inventing a laterality", () => {
    const r = fillLsProse(LS_ALIGN.lstv, { castellvi: "IIa" });
    expect(r.text).toContain("(Castellvi Type IIa)");
    expect(r.unfilled).toHaveLength(0);
  });

  it("leaves unknown placeholders visible instead of guessing", () => {
    const r = fillLsProse(LS_POSTERIOR.synovialCyst, { side: "left" });
    expect(r.text).toContain("the left [L4-L5] facet joint");
    expect(r.unfilled.map((u) => u.raw)).toContain("[L4-L5]");
    expect(isUnfilledProse(r.text)).toBe(true);
  });

  it("never drops library words when nothing is supplied", () => {
    const r = fillLsProse(LS_ALIGN.lordosisReversal);
    expect(r.unfilled).toHaveLength(1);
    expect(r.text.startsWith("Reversal of lumbar lordosis with kyphotic angulation apex at")).toBe(true);
  });

  it("keeps the conus level a required fill-in", () => {
    expect(fillLsProse(LS_ALIGN.conusNormal).unfilled.length).toBeGreaterThan(0);
    expect(fillLsProse(LS_ALIGN.conusNormal, { conusLevel: "L1" }).text).toBe(
      "Conus medullaris terminates normally at the L1 level.",
    );
  });

  it("fills bare macro measurements", () => {
    expect(fillLsProse(LS_MACRO_LINES.macro1.l4l5, { mm: 7 }).text).toContain("(AP diameter 7 mm)");
    expect(fillLsProse(LS_MACRO_LINES.macro3.alignment, { mm: 6 }).text).toContain(
      "Grade 1 anterolisthesis of L5 on S1 measuring approximately 6 mm.",
    );
    expect(fillLsProse(LS_MACRO_LINES.macro2.l5s1, { mm: 8, mm2: 6 }).text).toContain(
      "Right paracentral disc extrusion measuring 8 mm (AP) x 6 mm (transverse) with inferior migration of",
    );
  });
});
