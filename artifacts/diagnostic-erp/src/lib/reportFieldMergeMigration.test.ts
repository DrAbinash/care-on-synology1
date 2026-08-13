/**
 * Regression tests — automated insertions route through canonical merge + provenance.
 */
import { describe, expect, it } from "vitest";
import {
  mergeReportFieldContentWithProvenance,
  normalizeForDedupe,
  provenanceVisualKind,
  type InsertSource,
} from "./reportFieldMerge";

function mergeTwice(
  field: "technique" | "findings" | "impression" | "recommendation",
  first: { text: string; source: InsertSource },
  second: { text: string; source: InsertSource },
) {
  const a = mergeReportFieldContentWithProvenance({
    field,
    existing: "",
    incoming: first.text,
    source: first.source,
  });
  return mergeReportFieldContentWithProvenance({
    field,
    existing: a.text,
    incoming: second.text,
    source: second.source,
    existingProvenance: a.provenance,
  });
}

describe("canonical merge — per-source provenance", () => {
  it("voice/manual dictation append", () => {
    const r = mergeReportFieldContentWithProvenance({
      field: "findings",
      existing: "Baseline finding.",
      incoming: "Additional typed line.",
      source: "manual",
    });
    const key = normalizeForDedupe("Additional typed line.");
    expect(r.provenance[key]).toEqual(["manual"]);
  });

  it("protocol insertion", () => {
    const r = mergeReportFieldContentWithProvenance({
      field: "technique",
      existing: "",
      incoming: "MRI performed on 3T scanner.",
      source: "protocol",
    });
    expect(r.provenance[normalizeForDedupe("MRI performed on 3T scanner.")]).toEqual(["protocol"]);
  });

  it("structured quick-finding dialog output", () => {
    const r = mergeReportFieldContentWithProvenance({
      field: "findings",
      existing: "",
      incoming: "Disc bulge at L4-L5 with annular tear.",
      source: "quick-findings",
    });
    expect(provenanceVisualKind(r.provenance[normalizeForDedupe(r.text)]!)).toBe("quick-findings");
  });

  it("companion autopopulate", () => {
    const r = mergeReportFieldContentWithProvenance({
      field: "findings",
      existing: "",
      incoming: "Liver measures 14 cm.",
      source: "companion",
    });
    expect(r.provenance[normalizeForDedupe("Liver measures 14 cm.")]).toEqual(["companion"]);
  });

  it("Chocolate Box macro tile", () => {
    const r = mergeReportFieldContentWithProvenance({
      field: "findings",
      existing: "",
      incoming: "Chronic small vessel ischemic changes.",
      source: "macro",
    });
    expect(r.provenance[normalizeForDedupe(r.text)]).toEqual(["macro"]);
  });

  it("LegacyBox / comparison template impression", () => {
    const r = mergeReportFieldContentWithProvenance({
      field: "impression",
      existing: "",
      incoming: "Compared with prior study dated 2024-01-01.",
      source: "template",
    });
    expect(r.provenance[normalizeForDedupe(r.text)]).toEqual(["template"]);
  });

  it("learned quick-finding recommendation", () => {
    const r = mergeReportFieldContentWithProvenance({
      field: "recommendation",
      existing: "",
      incoming: "Clinical correlation advised.",
      source: "quick-findings",
    });
    expect(r.provenance[normalizeForDedupe(r.text)]).toEqual(["quick-findings"]);
  });

  it("copilot companion measurement line", () => {
    const r = mergeReportFieldContentWithProvenance({
      field: "findings",
      existing: "",
      incoming: "Aorta: 3.2 cm.",
      source: "companion",
    });
    expect(r.provenance[normalizeForDedupe("Aorta: 3.2 cm.")]).toEqual(["companion"]);
  });

  it("ghost-text ai-draft acceptance", () => {
    const r = mergeReportFieldContentWithProvenance({
      field: "impression",
      existing: "Degenerative changes.",
      incoming: "No acute infarct.",
      source: "ai-draft",
    });
    expect(r.provenance[normalizeForDedupe("No acute infarct.")]).toEqual(["ai-draft"]);
  });
});

describe("canonical merge — cross-tool dedupe unions provenance", () => {
  it("quick-select + quick-findings duplicate unions sources", () => {
    const sentence = "Disc desiccation at L4-L5.";
    const r = mergeTwice(
      "findings",
      { text: sentence, source: "quick-select" },
      { text: sentence, source: "quick-findings" },
    );
    expect(r.text).toBe(sentence);
    expect(r.provenance[normalizeForDedupe(sentence)]).toEqual(["quick-select", "quick-findings"]);
    expect(provenanceVisualKind(r.provenance[normalizeForDedupe(sentence)]!)).toBe("merged");
  });

  it("protocol + companion exact duplicate unions provenance", () => {
    const sentence = "MRI performed on 3T scanner.";
    const r = mergeTwice(
      "technique",
      { text: sentence, source: "protocol" },
      { text: sentence, source: "companion" },
    );
    expect(r.text).toBe(sentence);
    const key = normalizeForDedupe(sentence);
    expect(r.provenance[key]).toEqual(["protocol", "companion"]);
  });
});
