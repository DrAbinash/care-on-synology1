/**
 * Guards the spec's hardest rule for the dorsal canvas: seeded prose must be
 * VERBATIM from docs/clinical-libraries/mri-dorsal-clinical-content-library.md
 * and the composer may only substitute level / laterality / measurement /
 * direction / choice variables — never invent clinical sentences (spec §SOURCE
 * CONTENT, §36).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DX_ALIGN,
  DX_BONE,
  DX_CANAL,
  DX_DISC,
  DX_LIBRARY_PROSE,
  DX_MACRO_LINES,
  DX_POSTERIOR,
  DX_SOFT,
  DX_CONUS_UNCONFIRMED,
  fillDxProse,
} from "./mriDorsalLibrary";
import { isUnfilledSpineProse } from "./mriSpineProse";

const HERE = dirname(fileURLToPath(import.meta.url));
const LIBRARY_PATH = resolve(
  HERE,
  "../../../../docs/clinical-libraries/mri-dorsal-clinical-content-library.md",
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

describe("MRI dorsal canonical clinical library", () => {
  it("is readable from the repository", () => {
    expect(library.length).toBeGreaterThan(4000);
    expect(library).toContain("Ossification of the ligamentum flavum (OLF)");
  });

  it("contains every seeded dorsal prose entry verbatim", () => {
    const offenders: string[] = [];
    for (const [id, text] of Object.entries(DX_LIBRARY_PROSE)) {
      if (!library.includes(normalize(text))) offenders.push(`${id}: ${text}`);
    }
    expect(offenders, `Invented or drifted prose:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("exposes the six clinical sections plus the five macro impression blocks", () => {
    expect(Object.keys(DX_LIBRARY_PROSE).length).toBeGreaterThan(55);
    expect(DX_ALIGN.normal).toContain("Thoracic kyphosis is within normal limits");
    expect(DX_BONE.normal).toContain("marrow signal intensities are maintained");
    expect(DX_DISC.normal).toContain("Intervertebral disc heights and T2 signal intensities");
    expect(DX_CANAL.normal).toContain("Central canal is patent throughout");
    expect(DX_POSTERIOR.normal).toContain("costovertebral joint spaces are patent bilaterally");
    expect(DX_SOFT.normal).toContain("paraspinal soft tissues, mediastinal structures, pleural spaces");
    expect(Object.keys(DX_MACRO_LINES)).toHaveLength(5);
    expect(DX_MACRO_LINES.tuberculousSpondylodiscitis.impression).toHaveLength(3);
  });

  it("has no cervical-specific or lumbar-specific anatomy in the dorsal vocabulary", () => {
    const banned = /uncovertebral|lateral recess|isthmic|sacralization|Castellvi|LSTV/i;
    const hits = Object.entries(DX_LIBRARY_PROSE).filter(([, text]) => banned.test(text));
    expect(hits.map(([id]) => id)).toEqual([]);
  });
});

describe("fillDxProse — dorsal dialect substitution", () => {
  it("fills a disc level and an AP measurement", () => {
    const r = fillDxProse(DX_DISC.centralProtrusion, { level: "T8-T9", mm: 5 });
    expect(r.unfilled).toHaveLength(0);
    expect(r.text).toBe(
      "Central disc protrusion at T8-T9 measuring approximately 5 mm in AP dimension, indenting the ventral thecal sac.",
    );
  });

  it("fills a craniocaudal extent using the library's own connective word", () => {
    expect(fillDxProse(DX_CANAL.opll, { level: "T4", level2: "T7" }).text).toContain(
      "along the dorsal aspect of T4 through T7",
    );
    expect(fillDxProse(DX_SOFT.perimedullaryFlowVoids, { level: "T6", level2: "T12" }).text).toContain(
      "from T6 to T12",
    );
  });

  it("fills a paired-vertebra listhesis slot", () => {
    const r = fillDxProse(DX_ALIGN.anterolisthesis, { level: "T12", level2: "L1", mm: 4 });
    expect(r.unfilled).toHaveLength(0);
    expect(r.text).toContain("anterolisthesis of T12 on L1 measuring approximately 4 mm");
  });

  it("fills laterality and severity-independent foraminal wording", () => {
    const r = fillDxProse(DX_POSTERIOR.foraminalNarrowing, { level: "T11-T12", side: "left" });
    expect(r.text).toBe(
      "Neural foraminal narrowing at T11-T12 on the left secondary to lateral disc protrusion and costovertebral osteophytes.",
    );
  });

  it("fills a height-loss percentage and a single vertebra", () => {
    const r = fillDxProse(DX_BONE.acuteCompressionFracture, { vertebra: "T12", pct: 35 });
    expect(r.unfilled).toHaveLength(0);
    expect(r.text).toContain("the T12 vertebral body with approximately 35% anterior height loss");
  });

  it("keeps the conus termination level a required fill-in", () => {
    expect(fillDxProse(DX_CANAL.conusTerminates).unfilled.length).toBeGreaterThan(0);
    expect(fillDxProse(DX_CANAL.conusTerminates, { conusLevel: "T12-L1" }).text).toBe(
      "Conus medullaris terminates normally at T12-L1.",
    );
    expect(isUnfilledSpineProse(DX_CONUS_UNCONFIRMED)).toBe(true);
  });

  it("only fills a with/without choice when the radiologist states it", () => {
    const pending = fillDxProse(DX_CANAL.macroCordFlatteningWithOrWithout);
    expect(pending.text).toContain("[with / without] intrinsic T2 hyperintensity");
    expect(pending.unfilled.map((u) => u.raw)).toContain("[with / without]");
    // The line names a level too, so an unanswered level is reported beside it
    // rather than left to print as the library's example vertebrae.
    expect(pending.unfilled.map((u) => u.raw)).toContain("[T10-T11]");
    const chosen = fillDxProse(DX_CANAL.macroCordFlatteningWithOrWithout, { level: "T10-T11", choice: "without" });
    expect(chosen.unfilled).toHaveLength(0);
    expect(chosen.text).toContain("T10-T11, without intrinsic T2 hyperintensity");
  });

  it("never drops library wording when a variable is missing", () => {
    const r = fillDxProse(DX_BONE.dish);
    expect(r.unfilled).toHaveLength(1);
    expect(r.text.startsWith("Continuous bridging ossification along the anterior longitudinal ligament")).toBe(true);
    expect(isUnfilledSpineProse(r.text)).toBe(true);
  });

  it("fills macro bare measurements in order", () => {
    const r = fillDxProse(DX_SOFT.macroColdAbscess, { cm: 8, cm2: 6, cm3: 4 });
    expect(r.text).toContain("measuring 8 x 6 x 4 cm");
    const partial = fillDxProse(DX_SOFT.macroColdAbscess, { cm: 8 });
    expect(partial.text).toContain("measuring X x X x X cm");
  });

  it("resolves the schmorl endplate face from the direction variable", () => {
    const r = fillDxProse(DX_BONE.schmorl, { direction: "superior", vertebra: "T11" });
    expect(r.unfilled).toHaveLength(0);
    expect(r.text).toBe(
      "Schmorl's node (intraosseous disc herniation) involving the superior endplate of T11 with surrounding reactive marrow edema.",
    );
  });
});
