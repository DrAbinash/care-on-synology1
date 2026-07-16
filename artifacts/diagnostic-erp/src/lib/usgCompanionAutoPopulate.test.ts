import { describe, it, expect } from "vitest";
import {
  buildAutoPopulatePlan, blockStatus, deriveProvenance, countEdits, measurementLine,
  type AutoPopulateInputs,
} from "./usgCompanionAutoPopulate";

const base = (over: Partial<AutoPopulateInputs> = {}): AutoPopulateInputs => ({
  measurementItems: [],
  techniqueText: null,
  normalsText: null,
  recommendationText: null,
  ruleImpressionLines: [],
  current: { technique: "", findings: "", impression: [], recommendation: "" },
  ...over,
});

const meas = (label: string, value: string, confidence = "high", extra = {}) => ({
  key: label.toLowerCase(), label, value, unit: null, confidence, source: "dicom_sr", present: true, ...extra,
});

describe("buildAutoPopulatePlan", () => {
  it("is not eligible with no measurements and no normals", () => {
    const p = buildAutoPopulatePlan(base());
    expect(p.eligible).toBe(false);
    expect(p.blocks).toHaveLength(0);
  });

  it("populates technique/normals/measurements/recommendation, leaving impression blank without a rule", () => {
    const p = buildAutoPopulatePlan(base({
      techniqueText: "High-resolution ultrasound of the abdomen was performed.",
      normalsText: "Liver is normal in size and echotexture.",
      recommendationText: "Clinical correlation is advised.",
      measurementItems: [meas("CBD", "4 mm"), meas("GB Wall", "2 mm")],
    }));
    expect(p.eligible).toBe(true);
    const sections = p.blocks.map((b) => `${b.section}:${b.kind}`);
    expect(sections).toContain("technique:template");
    expect(sections).toContain("findings:template");
    expect(sections.filter((s) => s === "findings:machine")).toHaveLength(2);
    expect(sections).toContain("recommendation:protocol");
    expect(p.blocks.some((b) => b.section === "impression")).toBe(false);
    expect(p.skipped.some((s) => s.section === "impression" && /never invented/i.test(s.reason))).toBe(true);
  });

  it("populates impression ONLY from rule lines when impression is empty", () => {
    const p = buildAutoPopulatePlan(base({
      normalsText: "N",
      ruleImpressionLines: ["Severe fatty infiltration of liver."],
    }));
    const impr = p.blocks.filter((b) => b.section === "impression");
    expect(impr).toHaveLength(1);
    expect(impr[0].kind).toBe("rule");
    expect(impr[0].text).toBe("Severe fatty infiltration of liver.");
  });

  it("never overwrites a written technique or impression", () => {
    const p = buildAutoPopulatePlan(base({
      techniqueText: "auto technique",
      normalsText: "N",
      ruleImpressionLines: ["auto impression"],
      current: { technique: "my technique", findings: "", impression: ["my impression"], recommendation: "" },
    }));
    expect(p.blocks.some((b) => b.section === "technique")).toBe(false);
    expect(p.blocks.some((b) => b.section === "impression")).toBe(false);
    expect(p.skipped.some((s) => s.section === "technique")).toBe(true);
  });

  it("skips low-confidence measurements (leaves them blank with a reason)", () => {
    const p = buildAutoPopulatePlan(base({
      normalsText: "N",
      measurementItems: [meas("BPD", "78 mm", "high"), meas("HC", "280 mm", "low")],
    }));
    const machine = p.blocks.filter((b) => b.kind === "machine");
    expect(machine).toHaveLength(1);
    expect(machine[0].label).toBe("BPD");
    expect(p.skipped.some((s) => s.label === "HC" && /low-confidence/i.test(s.reason))).toBe(true);
  });

  it("does not re-add normals/recommendation already present (re-run safe)", () => {
    const p = buildAutoPopulatePlan(base({
      normalsText: "Liver is normal.",
      recommendationText: "Correlate clinically.",
      measurementItems: [meas("CBD", "4 mm")],
      current: { technique: "", findings: "Liver is normal.", impression: [], recommendation: "Correlate clinically." },
    }));
    expect(p.blocks.some((b) => b.id === "findings-normals")).toBe(false);
    expect(p.blocks.some((b) => b.section === "recommendation")).toBe(false);
    expect(p.blocks.some((b) => b.kind === "machine")).toBe(true);
  });

  it("measurementLine formats label:value unit", () => {
    expect(measurementLine("BPD", "78", "mm")).toBe("BPD: 78 mm");
    expect(measurementLine("GA", "32w")).toBe("GA: 32w");
  });
});

describe("provenance status", () => {
  const block = { id: "m", section: "findings" as const, kind: "machine" as const, text: "BPD: 78 mm", label: "BPD", value: "78 mm" };

  it("present when text is verbatim in the field", () => {
    expect(blockStatus(block, { technique: "", findings: "BPD: 78 mm", impression: [], recommendation: "" })).toBe("present");
  });
  it("edited when the label lingers with a changed value", () => {
    expect(blockStatus(block, { technique: "", findings: "BPD: 80 mm (corrected)", impression: [], recommendation: "" })).toBe("edited");
  });
  it("removed when neither text nor label remain", () => {
    expect(blockStatus(block, { technique: "", findings: "Normal study.", impression: [], recommendation: "" })).toBe("removed");
  });
  it("deriveProvenance + countEdits reflect edits", () => {
    const blocks = [block, { id: "n", section: "findings" as const, kind: "template" as const, text: "Liver is normal." }];
    const cur = { technique: "", findings: "BPD: 80 mm\nLiver is normal.", impression: [], recommendation: "" };
    const prov = deriveProvenance(blocks, cur);
    expect(prov.find((p) => p.id === "m")?.status).toBe("edited");
    expect(prov.find((p) => p.id === "n")?.status).toBe("present");
    expect(countEdits(blocks, cur)).toBe(1);
  });
});
