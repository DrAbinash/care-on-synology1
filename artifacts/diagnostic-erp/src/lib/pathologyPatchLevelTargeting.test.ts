/**
 * Level-targeted replacement on a sub-headed report.
 *
 * A spine report is authored as one sentence per disc level under a
 * "Disc Level Analysis" heading. Two failures were measured on the real
 * rendered page before this existed: a tile naming L4-L5 deleted the
 * "no disc herniation" wording from ALL FIVE levels, and the same click ate
 * the L4-L5 row out of the canal-diameter table.
 */
import { describe, expect, it } from "vitest";
import { applyPathologyPatch } from "./pathologyPatch";
import { provenanceFromText } from "./reportFieldMerge";

const LEVELS = ["L1-L2", "L2-L3", "L3-L4", "L4-L5", "L5-S1"];

const FINDINGS = [
  "Alignment:",
  "Normal lumbar lordosis maintained. No scoliosis or listhesis.",
  "",
  "Disc Level Analysis:",
  ...LEVELS.map((l) => `${l}: Normal disc height and signal, no disc herniation and a patent neural foramen.`),
  "",
  "Canal Diameter:",
  "| Level | AP Canal (mm) |",
  ...LEVELS.map((l) => `| ${l} | — |`),
].join("\n");

const herniation = (level: string) => applyPathologyPatch({
  existing: {
    clinicalHistory: "Low back pain.",
    technique: "MRI lumbo-sacral spine on 3T.",
    findings: FINDINGS,
    impression: "Normal MRI lumbo-sacral spine.",
    recommendation: "Clinical correlation.",
  },
  incoming: {
    findings: `Broad-based disc bulge at ${level} with posterocentral-right paracentral protrusion causing indentation on the thecal sac.`,
    impression: `Disc herniation at ${level} causing indentation on the thecal sac.`,
  },
  // Exactly what the "Disc herniation L4-L5" Quick Select tile carries: a
  // concept and a conflict group, and no declared level.
  ownership: { concept: "disc_contour", conflictGroup: "disc bulge" },
  provenance: { findings: provenanceFromText(FINDINGS, "template") },
  source: "quick-select",
});

describe("level-targeted pathology overlay", () => {
  it("replaces the named level and leaves the other four normals intact", () => {
    const { narrative, replacedSentences } = herniation("L4-L5");
    expect(replacedSentences).toEqual([
      "L4-L5: Normal disc height and signal, no disc herniation and a patent neural foramen.",
    ]);
    for (const level of LEVELS.filter((l) => l !== "L4-L5")) {
      expect(narrative.findings).toContain(
        `${level}: Normal disc height and signal, no disc herniation and a patent neural foramen.`,
      );
    }
    // The clicked level's contradiction is gone, its replacement is present.
    expect(narrative.findings).not.toMatch(/L4-L5: Normal disc height/);
    expect(narrative.findings).toContain("Broad-based disc bulge at L4-L5");
  });

  it("keeps every canal-diameter row, including the affected level", () => {
    const { narrative } = herniation("L4-L5");
    expect(narrative.findings).toContain("| Level | AP Canal (mm) |");
    for (const level of LEVELS) {
      expect(narrative.findings, `${level} canal row`).toContain(`| ${level} | — |`);
    }
  });

  it("keeps headings and the rest of the document", () => {
    const { narrative } = herniation("L4-L5");
    expect(narrative.findings).toContain("Alignment:");
    expect(narrative.findings).toContain("Disc Level Analysis:");
    expect(narrative.findings).toContain("Canal Diameter:");
    expect(narrative.findings).toContain("Normal lumbar lordosis maintained.");
    expect(narrative.findings).toContain("No scoliosis or listhesis.");
  });

  it("targets by the level named in the tile even when another level is worded alike", () => {
    const { narrative, replacedSentences } = herniation("L1-L2");
    expect(replacedSentences).toHaveLength(1);
    expect(narrative.findings).toContain("Broad-based disc bulge at L1-L2");
    expect(narrative.findings).toContain(
      "L4-L5: Normal disc height and signal, no disc herniation and a patent neural foramen.",
    );
  });
});
