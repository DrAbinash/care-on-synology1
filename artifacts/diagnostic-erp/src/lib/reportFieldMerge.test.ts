import { describe, expect, it } from "vitest";
import {
  mergeReportFieldContent,
  mergeTechnique,
  mergeSentences,
  normalizeForDedupe,
} from "./reportFieldMerge";

describe("normalizeForDedupe", () => {
  it("ignores case and punctuation", () => {
    expect(normalizeForDedupe("MRI Brain, 3T.")).toBe(normalizeForDedupe("mri brain 3t"));
  });
});

describe("mergeTechnique", () => {
  it("removes exact duplicate technique", () => {
    const a = "MRI study performed on a 3T scanner.";
    expect(mergeTechnique(a, a)).toBe(a);
  });

  it("removes duplicate with punctuation/case differences", () => {
    const a = "MRI study performed on a 3T scanner.";
    const b = "mri study performed on a 3t scanner";
    expect(mergeTechnique(a, b)).toBe(a);
  });

  it("merges equivalent 3T wording without duplication", () => {
    const existing = "MRI study performed on a 3T scanner using multiplanar multisequence acquisition.";
    const incoming = "Multiplanar multisequence MRI was performed on a 3 Tesla scanner.";
    const out = mergeTechnique(existing, incoming);
    expect(out).toBe(existing); // same concepts, no new line
  });

  it("retains complementary technique information", () => {
    const existing = "MRI performed on 3T scanner.";
    const incoming = "T1, T2, FLAIR, DWI and SWI sequences obtained.";
    const out = mergeTechnique(existing, incoming);
    expect(out).toContain("3T");
    expect(out).toContain("T1");
    expect(out).toContain("SWI");
  });
});

describe("mergeSentences (findings/impression)", () => {
  it("removes exact duplicate finding", () => {
    const a = "Disc desiccation at L4-L5.";
    expect(mergeSentences(a, a)).toBe(a);
  });

  it("prefers more informative finding when safe", () => {
    const existing = "Disc desiccation at L4-L5.";
    const incoming = "Disc desiccation with diffuse bulge at L4-L5.";
    const out = mergeSentences(existing, incoming);
    expect(out).toContain("diffuse bulge");
    expect(out.split("\n").length).toBe(1);
  });

  it("preserves laterality differences", () => {
    const existing = "Disc bulge at L4-L5 on the left.";
    const incoming = "Disc bulge at L4-L5 on the right.";
    const out = mergeSentences(existing, incoming);
    expect(out).toContain("left");
    expect(out).toContain("right");
  });

  it("preserves severity differences", () => {
    const existing = "Mild disc bulge at L4-L5.";
    const incoming = "Severe disc bulge at L4-L5.";
    const out = mergeSentences(existing, incoming);
    expect(out).toContain("Mild");
    expect(out).toContain("Severe");
  });

  it("removes duplicate impression", () => {
    const a = "Normal MRI brain.";
    expect(mergeSentences(a, a)).toBe(a);
  });
});

describe("mergeReportFieldContent — source order equivalence", () => {
  it("quick-select then quick-findings ≈ reverse", () => {
    const qs = "MRI performed on 3T scanner.";
    const qf = "T1, T2, FLAIR sequences obtained.";
    const a = mergeReportFieldContent({ field: "technique", existing: qs, incoming: qf, source: "quick-findings" });
    const b = mergeReportFieldContent({ field: "technique", existing: qf, incoming: qs, source: "quick-select" });
    expect(normalizeForDedupe(a)).toContain("3t");
    expect(normalizeForDedupe(b)).toContain("3t");
    expect(normalizeForDedupe(a)).toContain("flair");
    expect(normalizeForDedupe(b)).toContain("flair");
  });
});
