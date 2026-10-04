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

  it("replaces only the owned clause and keeps the rest of the level line", () => {
    const multiClause = FINDINGS.replace(
      "L4-L5: Normal disc height and signal, no disc herniation and a patent neural foramen.",
      "L4-L5: Normal disc height and signal, no disc herniation and a patent neural foramen. The L4-L5 facet joints are unremarkable.",
    );
    const patched = applyPathologyPatch({
      existing: {
        clinicalHistory: "Low back pain.",
        technique: "MRI lumbo-sacral spine on 3T.",
        findings: multiClause,
        impression: "Normal MRI lumbo-sacral spine.",
        recommendation: "Clinical correlation.",
      },
      incoming: {
        findings: "Broad-based disc bulge at L4-L5 with posterocentral-right paracentral protrusion.",
        impression: "Disc herniation at L4-L5.",
      },
      ownership: { concept: "disc_contour", conflictGroup: "disc bulge" },
      provenance: { findings: provenanceFromText(multiClause, "template") },
      source: "quick-select",
    });
    expect(patched.replacedSentences).toEqual([
      "L4-L5: Normal disc height and signal, no disc herniation and a patent neural foramen.",
    ]);
    // The unowned facet clause survives, and the line keeps its level prefix.
    expect(patched.narrative.findings).toContain(
      "L4-L5: The L4-L5 facet joints are unremarkable.",
    );
    expect(patched.narrative.findings).toContain("Broad-based disc bulge at L4-L5");
  });

  it("places a pure addition inside its own section, not at the end of the document", () => {
    const patched = applyPathologyPatch({
      existing: {
        clinicalHistory: "Low back pain.",
        technique: "MRI lumbo-sacral spine on 3T.",
        findings: FINDINGS,
        impression: "Normal MRI lumbo-sacral spine.",
        recommendation: "Clinical correlation.",
      },
      // Nothing in the normal document states the thecal sac at L4-L5, so this
      // is a pure addition — it must still land next to the L4-L5 wording.
      incoming: {
        findings: "Mild thecal sac indentation at L4-L5.",
        impression: "Mild thecal sac indentation at L4-L5.",
      },
      ownership: { concept: "thecal_sac", level: "L4-L5" },
      provenance: { findings: provenanceFromText(FINDINGS, "template") },
      source: "quick-select",
    });
    const f = patched.narrative.findings;
    const lines = f.split("\n");
    const row = (s: string) => lines.findIndex((l) => l.includes(s));
    // Pure addition: nothing in the normal document was contradicted.
    expect(patched.replacedSentences).toHaveLength(0);
    for (const level of LEVELS) {
      expect(f, `${level} normal wording`).toContain(`${level}: Normal disc height`);
    }
    expect(row("Mild thecal sac indentation at L4-L5.")).toBeGreaterThan(-1);
    expect(row("Mild thecal sac indentation at L4-L5.")).toBeGreaterThan(row("L4-L5: Normal disc height"));
    expect(row("Mild thecal sac indentation at L4-L5.")).toBeLessThan(row("L5-S1: Normal disc height"));
    expect(row("Mild thecal sac indentation at L4-L5.")).toBeLessThan(row("Canal Diameter:"));
    for (const level of LEVELS) {
      expect(f, `${level} canal row`).toContain(`| ${level} | — |`);
    }
  });
});
