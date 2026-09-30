/**
 * mriDorsoLumbarLibrary.test.ts — the dorso-lumbar seeds are the library's own
 * words, and the library's generic placeholders fill correctly.
 *
 * The binding rule is that seeded prose must be verbatim from
 * `docs/clinical-libraries/mri-dorsolumbar-clinical-content-library.md`: the
 * composer may substitute level, side, measurement and degree, but may never
 * invent a clinical sentence. This file reads the library from disk and asserts
 * every entry still appears in it, so an edit that quietly re-words a sentence
 * fails here rather than reaching a report.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DL_ALIGN,
  DL_BONE,
  DL_CANAL,
  DL_COVER,
  DL_CONUS_UNCONFIRMED,
  DL_JUNCTION,
  DL_LIBRARY_PROSE,
  DL_MACROS,
  DL_SCREENING_LIMITATION,
  DORSOLUMBAR_PROSE_DIALECT,
  fillDlProse,
} from "@/lib/mriDorsoLumbarLibrary";

const HERE = dirname(fileURLToPath(import.meta.url));
const LIBRARY_PATH = resolve(HERE, "../../../../docs/clinical-libraries/mri-dorsolumbar-clinical-content-library.md");

function library(): string {
  return readFileSync(LIBRARY_PATH, "utf8").replace(/\*\*/g, "").replace(/\s+/g, " ").toLowerCase();
}

describe("canonical dorso-lumbar library", () => {
  it("is readable from the repository", () => {
    expect(library().length).toBeGreaterThan(2000);
    expect(library()).toContain("thoracolumbar junction burst fracture");
  });

  it("contains every seeded prose entry verbatim", () => {
    const text = library();
    for (const [key, value] of Object.entries(DL_LIBRARY_PROSE)) {
      expect(text, `${key} is not library wording`).toContain(value.replace(/\s+/g, " ").toLowerCase().trim());
    }
  });

  it("keeps the sections the library defines", () => {
    expect(DL_COVER.limitedCoverage).toMatch(/Limited superior\/inferior coverage/);
    expect(DL_ALIGN.normal).toMatch(/dorsal, thoracolumbar and lumbar/);
    expect(DL_BONE.normal).toMatch(/within the imaged coverage/);
    expect(DL_CANAL.cordNormal).toMatch(/Visualized thoracic spinal cord/);
    expect(DL_JUNCTION.conusNormal).toMatch(/when adequately covered/);
    expect(DL_SCREENING_LIMITATION).toBe("SCREENING STUDIES ARE LIMITED PLANAR & LIMITED SEQUENCE.");
  });

  it("holds no cervical-specific anatomy and no invented lumbar-only wording", () => {
    const joined = Object.values(DL_LIBRARY_PROSE).join(" ").toLowerCase();
    expect(joined).not.toMatch(/uncovertebral/);
    expect(joined).not.toMatch(/foramen ovale/);
  });
});

describe("fillDlProse — generic library placeholders", () => {
  it("fills a named level and the paired level in the same sentence", () => {
    const one = fillDlProse(DL_CANAL.canalNarrowing, { level: "T11-T12" });
    expect(one.text).toBe("Central canal narrowing at T11-T12.");
    expect(one.unfilled).toEqual([]);

    const span = fillDlProse(
      "Associated pre/paravertebral soft-tissue component extends from [level] to [level].",
      { level: "T12-L1", level2: "L2-L3" },
    );
    expect(span.text).toBe(
      "Associated pre/paravertebral soft-tissue component extends from T12-L1 to L2-L3.",
    );
  });

  it("fills a two-vertebra listhesis slot and its measurement", () => {
    const filled = fillDlProse(DL_ALIGN.listhesis, { vertebra: "L1", vertebra2: "L2", mm: 5 });
    expect(filled.text).toBe("Anterolisthesis / retrolisthesis of L1 over L2, measuring 5 mm.");
    expect(filled.unfilled).toEqual([]);
  });

  it("fills [levels] from a level pair and reports what is missing", () => {
    expect(fillDlProse("involving [levels]", { level: "T12-L1", level2: "L1-L2" }).text)
      .toBe("involving T12-L1 and L1-L2");
    const missing = fillDlProse(DL_ALIGN.scoliosis, { side: "right" });
    expect(missing.text).toContain("[level]");
    expect(missing.unfilled.map((u) => u.raw)).toContain("[level]");
  });

  it("fills each bracketed question separately instead of positionally", () => {
    const burst = fillDlProse(DL_MACROS.thoracolumbarBurst.findings, {
      vertebra: "T12",
      pct: 45,
      mm: 6,
      degree: "severe",
      slotValues: {
        "present/suspected/not identified": "present",
        "cord/conus": "conus",
        "presence/absence": "presence",
      },
    });
    expect(burst.text).toContain("Acute burst fracture of the T12 vertebral body with approximately 45% height loss");
    expect(burst.text).toContain("projects approximately 6 mm into the spinal canal");
    expect(burst.text).toContain("complex abnormality is present on the available sequences");
    expect(burst.text).toContain("There is severe canal compromise with conus compression and presence of intrinsic T2/STIR signal abnormality");
    expect(burst.unfilled).toEqual([]);
  });

  it("leaves every unstated question visible rather than guessing it", () => {
    const bare = fillDlProse(DL_MACROS.thoracolumbarBurst.findings, {});
    expect(bare.text).toContain("[T12/L1]");
    expect(bare.text).toContain("[X]%");
    expect(bare.text).toContain("[degree]");
    expect(bare.text).toContain("[cord/conus]");
    expect(bare.unfilled.length).toBeGreaterThanOrEqual(6);
  });

  it("accepts thoracic, junction, lumbar and transitional levels in one dialect", () => {
    for (const level of ["T8-T9", "T12-L1", "L3-L4", "L5-S1", "L5-T", "D8-D9"]) {
      expect(DORSOLUMBAR_PROSE_DIALECT.discLevelRe.test(level), level).toBe(true);
    }
    for (const vertebra of ["T12", "L1", "L6", "S1", "D8"]) {
      expect(DORSOLUMBAR_PROSE_DIALECT.vertebraRe.test(vertebra), vertebra).toBe(true);
    }
  });

  it("keeps the conus level a required fill-in", () => {
    expect(DL_CONUS_UNCONFIRMED).toBe("[T12/L1]");
    const unfilled = fillDlProse("Conus medullaris terminates at [T12/L1].", { level: "T11-T12" });
    expect(unfilled.text).toContain("[T12/L1]");
    const stated = fillDlProse("Conus medullaris terminates at [T12/L1].", {
      level: "T11-T12",
      slotValues: { "T12/L1": "L1" },
    });
    expect(stated.text).toBe("Conus medullaris terminates at L1.");
  });
});
