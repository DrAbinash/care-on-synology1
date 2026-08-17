import { describe, expect, it } from "vitest";
import { serializeFieldPath } from "./fieldPath";
import { generateFromValues } from "./generate";
import { applyFieldValue } from "./mutex";
import { MRI_LS_SPINE_CARE_STANDARD } from "./lsSpineFormat";
import { allNormalFindingsMap } from "./adapter";
import type { FormatField, StructuredFormatDoc } from "./types";
import { emptyFormatDoc } from "./types";

function tinyMultiSelectDoc(combineMode: FormatField["combineMode"]): StructuredFormatDoc {
  const doc = emptyFormatDoc();
  doc.sections = [{
    id: "align",
    label: "Alignment",
    headingVisible: true,
    required: false,
    collapsedByDefault: false,
    contributesTo: ["findings"],
    defaultText: "Normal alignment.",
    normalText: "Normal alignment.",
    fields: [{
      id: "findings",
      label: "Findings",
      type: "multi_select",
      combineMode,
      options: [
        { id: "a", label: "A", value: "a", outputSentence: "Alpha is seen." },
        { id: "b", label: "B", value: "b", outputSentence: "Beta is seen." },
        { id: "c", label: "C", value: "c", outputSentence: "Gamma is seen." },
      ],
    }],
  }];
  return doc;
}

describe("structured format engine", () => {
  it("expands lumbar disc repeating group to five findingsMap keys", () => {
    const map = allNormalFindingsMap(MRI_LS_SPINE_CARE_STANDARD);
    expect(Object.keys(map)).toContain("L1-L2");
    expect(Object.keys(map)).toContain("L5-S1");
    expect(map["L4-L5"]?.normal).toBe(true);
    expect(map["Alignment & Curvature"]?.text).toMatch(/lordosis/i);
  });

  it("tokens fill {level} and {severity} in generated findings", () => {
    let values = {};
    values = applyFieldValue(
      MRI_LS_SPINE_CARE_STANDARD,
      values,
      { sectionId: "discs", groupItemId: "l4-5", fieldId: "disc-morphology" },
      "bulge",
    );
    values = applyFieldValue(
      MRI_LS_SPINE_CARE_STANDARD,
      values,
      { sectionId: "discs", groupItemId: "l4-5", fieldId: "severity" },
      "mild",
    );
    const gen = generateFromValues(MRI_LS_SPINE_CARE_STANDARD, values);
    expect(gen.findingsMap["L4-L5"]?.normal).toBe(false);
    expect(gen.findingsMap["L4-L5"]?.text.toLowerCase()).toContain("l4-l5");
    expect(gen.findingsMap["L4-L5"]?.text.toLowerCase()).toContain("mild");
    expect(gen.findingsMap["L4-L5"]?.text.toLowerCase()).toContain("bulge");
    expect(gen.findingsMap["L3-L4"]?.normal).toBe(true);
  });

  it("normal at a level clears abnormal morphology at that level only", () => {
    let values = {};
    values = applyFieldValue(
      MRI_LS_SPINE_CARE_STANDARD,
      values,
      { sectionId: "discs", groupItemId: "l4-5", fieldId: "disc-morphology" },
      "bulge",
    );
    values = applyFieldValue(
      MRI_LS_SPINE_CARE_STANDARD,
      values,
      { sectionId: "discs", groupItemId: "l3-4", fieldId: "disc-morphology" },
      "protrusion",
    );
    values = applyFieldValue(
      MRI_LS_SPINE_CARE_STANDARD,
      values,
      { sectionId: "discs", groupItemId: "l4-5", fieldId: "disc-normal" },
      "normal",
    );
    expect(values[serializeFieldPath({ sectionId: "discs", groupItemId: "l4-5", fieldId: "disc-morphology" })]).toBeUndefined();
    expect(values[serializeFieldPath({ sectionId: "discs", groupItemId: "l3-4", fieldId: "disc-morphology" })]).toBe("protrusion");
  });

  it("selecting abnormal clears Normal in the same level", () => {
    let values = {};
    values = applyFieldValue(
      MRI_LS_SPINE_CARE_STANDARD,
      values,
      { sectionId: "discs", groupItemId: "l4-5", fieldId: "disc-normal" },
      "normal",
    );
    values = applyFieldValue(
      MRI_LS_SPINE_CARE_STANDARD,
      values,
      { sectionId: "discs", groupItemId: "l4-5", fieldId: "disc-morphology" },
      "extrusion",
    );
    expect(values[serializeFieldPath({ sectionId: "discs", groupItemId: "l4-5", fieldId: "disc-normal" })]).toBeUndefined();
  });

  it("multi_select combineMode: separate_sentences vs conjunction", () => {
    const sep = generateFromValues(
      tinyMultiSelectDoc("separate_sentences"),
      { "align::findings": ["a", "b", "c"] },
    );
    expect(sep.findingsMap.Alignment?.text).toBe("Alpha is seen. Beta is seen. Gamma is seen.");

    const conj = generateFromValues(
      tinyMultiSelectDoc("conjunction"),
      { "align::findings": ["a", "b", "c"] },
    );
    expect(conj.findingsMap.Alignment?.text).toBe("Alpha is seen, Beta is seen, and Gamma is seen.");
  });

  it("impressionWeight 0 does not create candidates; high weight surfaces first", () => {
    let values = {};
    values = applyFieldValue(
      MRI_LS_SPINE_CARE_STANDARD,
      values,
      { sectionId: "discs", groupItemId: "l4-5", fieldId: "disc-morphology" },
      "bulge",
    );
    values = applyFieldValue(
      MRI_LS_SPINE_CARE_STANDARD,
      values,
      { sectionId: "alignment", fieldId: "alignment-status" },
      "loss-of-lordosis",
    );
    const gen = generateFromValues(MRI_LS_SPINE_CARE_STANDARD, values);
    expect(gen.impressionCandidates.length).toBeGreaterThan(0);
    expect(gen.impressionCandidates[0]!.weight).toBeGreaterThanOrEqual(
      gen.impressionCandidates[gen.impressionCandidates.length - 1]!.weight,
    );
    expect(gen.impressionCandidates.every((c) => c.weight > 0)).toBe(true);
  });
});
