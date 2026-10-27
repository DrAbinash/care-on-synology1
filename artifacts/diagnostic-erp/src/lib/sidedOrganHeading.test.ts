/**
 * A sided finding must be filed under its own organ's heading.
 *
 * Measured in a real browser on the clinic's ultrasound abdomen report, which is authored
 * as one section per organ ("Right Kidney:", then "Left Kidney:"): with the radiologist's
 * chosen side = left, the shipped "Renal calculus" box wrote
 *
 *   Right Kidney:
 *   Echogenic renal calculus in the left kidney with posterior acoustic shadowing.
 *
 * — a report that puts a left renal calculus in the right kidney, while the left kidney's
 * own normal line stayed behind calling it normal. The sentence carried the right side and
 * the section did not, because the placement walk read headings as uninteresting lines and
 * landed the first owned sentence in document order.
 */
import { describe, expect, it } from "vitest";
import { applyPathologyPatch } from "./pathologyPatch";
import { provenanceFromText } from "./reportFieldMerge";

const FINDINGS = [
  "Liver:",
  "Normal in size and echo texture. No focal lesion.",
  "",
  "Right Kidney:",
  "Normal size, position and echotexture.",
  "No calculus.",
  "No hydronephrosis.",
  "",
  "Left Kidney:",
  "Normal size, position and echotexture.",
  "No calculus.",
  "No hydronephrosis.",
].join("\n");

/** The shipped renal-calculus wording, with the radiologist's side substituted. */
const calculusLine = (side: "left" | "right") =>
  `Echogenic renal calculus in the ${side} kidney with posterior acoustic shadowing.`;

const applyCalculus = (side: "left" | "right") => applyPathologyPatch({
  existing: {
    clinicalHistory: "Renal colic.",
    technique: "Ultrasound of whole abdomen on convex transducer (3-6 MHz).",
    findings: FINDINGS,
    impression: "Normal ultrasound abdomen.",
    recommendation: "Clinical correlation.",
  },
  incoming: { findings: calculusLine(side), impression: `Renal calculus in the ${side} kidney.` },
  // Exactly what tile #397 carries — concept and conflict group — plus the side the
  // radiologist chose in the panel, which the store hands over as ownership.laterality.
  ownership: { concept: "renal", conflictGroup: "renal", laterality: side },
  provenance: { findings: provenanceFromText(FINDINGS, "template") },
  source: "quick-select",
});

/** The body lines sitting under one heading, in the printed order. */
function sectionOf(findings: string, heading: string): string[] {
  const lines = findings.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start < 0) return [];
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.trim()) break;
    if (/^[A-Z][^:]*:$/.test(line.trim())) break;
    out.push(line.trim());
  }
  return out;
}

describe("a sided finding is filed under the heading of the side it names", () => {
  it("puts a left renal calculus in the Left Kidney section", () => {
    const { narrative } = applyCalculus("left");
    const left = sectionOf(narrative.findings, "Left Kidney:");
    expect(left.join(" "), "the calculus sits under the kidney it says").toContain("left kidney");
    const right = sectionOf(narrative.findings, "Right Kidney:");
    expect(right.join(" "), "the right kidney is not made to carry the other side's stone")
      .not.toMatch(/calculus in the left kidney/i);
  });

  it("retires the chosen side's normal and keeps the other side's", () => {
    const { narrative, replacedSentences } = applyCalculus("left");
    expect(replacedSentences.join(" | "), "the left kidney's own normal is what was replaced")
      .toMatch(/Left Kidney|No calculus\./);
    const right = sectionOf(narrative.findings, "Right Kidney:");
    expect(right.join(" "), "the uninvolved kidney stays described as normal")
      .toMatch(/No calculus\./);
    const left = sectionOf(narrative.findings, "Left Kidney:");
    expect(left.join(" "), "the kidney with the stone is not still said to have none")
      .not.toMatch(/No calculus\./);
    expect(left.join(" "), "the rest of that kidney's description survives the click")
      .toMatch(/Normal size|No hydronephrosis\./);
  });

  it("does the same for the right side, so the rule is not a special case", () => {
    const { narrative } = applyCalculus("right");
    expect(sectionOf(narrative.findings, "Right Kidney:").join(" ")).toContain("right kidney");
    expect(sectionOf(narrative.findings, "Left Kidney:").join(" ")).toMatch(/No calculus\./);
  });

  it("leaves a finding that names no side alone: unchanged behaviour for every other organ", () => {
    const { narrative } = applyPathologyPatch({
      existing: {
        clinicalHistory: "",
        technique: "",
        findings: FINDINGS,
        impression: "",
        recommendation: "",
      },
      incoming: { findings: "Mild fatty liver with no focal lesion." },
      // No laterality declared — a liver claim owns the liver section, headings intact.
      ownership: { concept: "hepatic_steatosis", conflictGroup: "fatty" },
      provenance: { findings: provenanceFromText(FINDINGS, "template") },
      source: "quick-select",
    });
    expect(narrative.findings).toContain("Mild fatty liver with no focal lesion.");
    expect(sectionOf(narrative.findings, "Right Kidney:").join(" ")).toMatch(/No calculus\./);
    expect(sectionOf(narrative.findings, "Left Kidney:").join(" ")).toMatch(/No calculus\./);
  });
});
