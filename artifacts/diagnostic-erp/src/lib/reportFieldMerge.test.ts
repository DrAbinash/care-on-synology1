import { describe, expect, it } from "vitest";
import {
  mergeReportFieldContent,
  mergeReportFieldContentWithProvenance,
  mergeTechnique,
  mergeSentences,
  normalizeForDedupe,
  reconcileProvenanceAfterManualEdit,
  fuzzySentenceSimilarity,
  formatProvenanceHover,
  provenanceVisualKind,
  provenanceFromText,
  type FieldProvenanceMap,
} from "./reportFieldMerge";
import { applyPathologyPatch, isProtectedManualSentence } from "./pathologyPatch";
import { buildPreviewHtml } from "./radiologyReportPreviewHtml";

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

  it("collapses two paraphrased MRI technique paragraphs into one", () => {
    const a = "Multiplanar, multisequence MRI of the lumbosacral spine was performed including T1, T2 and STIR sequences.";
    const b = "MRI of the lumbosacral spine was performed using multiplanar multisequence acquisition with T1, T2, and STIR.";
    const out = mergeTechnique(a, b);
    expect(out.split(/[.!?]\s+/).filter(Boolean).length).toBe(1);
    expect(out.toLowerCase()).toMatch(/lumbosacral|ls spine|t1/);
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

describe("provenance — Quick Select / Quick Findings / merged", () => {
  it("attributes Quick Select insertions", () => {
    const r = mergeReportFieldContentWithProvenance({
      field: "technique",
      existing: "",
      incoming: "MRI performed on 3T scanner.",
      source: "quick-select",
    });
    const key = normalizeForDedupe("MRI performed on 3T scanner.");
    expect(r.provenance[key]).toEqual(["quick-select"]);
    expect(formatProvenanceHover(r.provenance[key]!)).toBe("Source: Quick Select");
    expect(provenanceVisualKind(r.provenance[key]!)).toBe("quick-select");
  });

  it("attributes Quick Findings insertions", () => {
    const r = mergeReportFieldContentWithProvenance({
      field: "findings",
      existing: "",
      incoming: "Disc desiccation at L4-L5.",
      source: "quick-findings",
    });
    const key = normalizeForDedupe("Disc desiccation at L4-L5.");
    expect(r.provenance[key]).toEqual(["quick-findings"]);
    expect(formatProvenanceHover(r.provenance[key]!)).toBe("Source: Quick Findings");
    expect(provenanceVisualKind(r.provenance[key]!)).toBe("quick-findings");
  });

  it("unions sources when complementary content is merged", () => {
    const first = mergeReportFieldContentWithProvenance({
      field: "technique",
      existing: "",
      incoming: "MRI performed on 3T scanner.",
      source: "quick-select",
    });
    const second = mergeReportFieldContentWithProvenance({
      field: "technique",
      existing: first.text,
      incoming: "T1, T2, FLAIR sequences obtained.",
      source: "quick-findings",
      existingProvenance: first.provenance,
    });
    expect(second.text).toContain("3T");
    expect(second.text).toContain("FLAIR");
    const qsKey = normalizeForDedupe("MRI performed on 3T scanner.");
    const qfKey = normalizeForDedupe("T1, T2, FLAIR sequences obtained.");
    expect(second.provenance[qsKey]).toEqual(["quick-select"]);
    expect(second.provenance[qfKey]).toEqual(["quick-findings"]);
  });

  it("deduplication does not lose source attribution (exact duplicate)", () => {
    const sentence = "Disc desiccation at L4-L5.";
    const first = mergeReportFieldContentWithProvenance({
      field: "findings",
      existing: "",
      incoming: sentence,
      source: "quick-select",
    });
    const second = mergeReportFieldContentWithProvenance({
      field: "findings",
      existing: first.text,
      incoming: sentence,
      source: "quick-findings",
      existingProvenance: first.provenance,
    });
    expect(second.text).toBe(sentence);
    const key = normalizeForDedupe(sentence);
    expect(second.provenance[key]).toEqual(["quick-select", "quick-findings"]);
    expect(formatProvenanceHover(second.provenance[key]!)).toBe(
      "Merged: Quick Select + Quick Findings",
    );
    expect(provenanceVisualKind(second.provenance[key]!)).toBe("merged");
  });

  it("deduplication does not lose source attribution (technique concept near-dup)", () => {
    const existing = "MRI study performed on a 3T scanner using multiplanar multisequence acquisition.";
    const incoming = "Multiplanar multisequence MRI was performed on a 3 Tesla scanner.";
    const first = mergeReportFieldContentWithProvenance({
      field: "technique",
      existing: "",
      incoming: existing,
      source: "quick-select",
    });
    const second = mergeReportFieldContentWithProvenance({
      field: "technique",
      existing: first.text,
      incoming,
      source: "quick-findings",
      existingProvenance: first.provenance,
    });
    expect(second.text).toBe(existing);
    const key = normalizeForDedupe(existing);
    expect(second.provenance[key]).toContain("quick-select");
    expect(second.provenance[key]).toContain("quick-findings");
  });

  it("near-merge keeps unioned provenance on the informative sentence", () => {
    const first = mergeReportFieldContentWithProvenance({
      field: "findings",
      existing: "",
      incoming: "Disc desiccation at L4-L5.",
      source: "quick-select",
    });
    const second = mergeReportFieldContentWithProvenance({
      field: "findings",
      existing: first.text,
      incoming: "Disc desiccation with diffuse bulge at L4-L5.",
      source: "quick-findings",
      existingProvenance: first.provenance,
    });
    expect(second.text.split("\n").length).toBe(1);
    expect(second.text).toContain("diffuse bulge");
    const key = normalizeForDedupe(second.text);
    expect(second.provenance[key]).toEqual(["quick-select", "quick-findings"]);
  });
});

describe("provenance — manual edits remain safe", () => {
  it("inherits provenance for lightly edited owned sentences via fuzzy match", () => {
    const text = "Disc desiccation at L4-L5.\nNo cord compression.";
    const provenance: FieldProvenanceMap = {
      [normalizeForDedupe("Disc desiccation at L4-L5.")]: ["quick-select"],
      [normalizeForDedupe("No cord compression.")]: ["quick-findings"],
    };
    const edited = "Disc desiccation with annular tear at L4-L5.\nNo cord compression.";
    const next = reconcileProvenanceAfterManualEdit(text, edited, provenance);
    expect(edited).toContain("annular tear");
    expect(next[normalizeForDedupe("Disc desiccation with annular tear at L4-L5.")]).toEqual(["manual", "quick-select"]);
    expect(next[normalizeForDedupe("No cord compression.")]).toEqual(["quick-findings"]);
  });

  it("new typed content is manual", () => {
    const next = reconcileProvenanceAfterManualEdit("", "Manually typed finding.", {});
    expect(next[normalizeForDedupe("Manually typed finding.")]).toEqual(["manual"]);
    expect(formatProvenanceHover(["manual"])).toBe("Source: Manual");
  });
});

describe("provenance never leaks into Preview/PDF/print/report text", () => {
  it("clinical merge result is plain text without provenance markers", () => {
    const r = mergeReportFieldContentWithProvenance({
      field: "findings",
      existing: "Normal ventricles.",
      incoming: "No acute infarct.",
      source: "quick-findings",
      existingProvenance: provenanceFromText("Normal ventricles.", "quick-select"),
    });
    expect(r.text).not.toMatch(/Source:|Merged:|quick-select|quick-findings|provenance/i);
    expect(r.text).not.toContain("<");
    expect(r.text).toBe("Normal ventricles.\nNo acute infarct.");
  });

  it("buildPreviewHtml only receives plain field strings", () => {
    const findings = "Disc desiccation at L4-L5.";
    const technique = "MRI performed on 3T scanner.";
    const html = buildPreviewHtml({
      patientName: "Test Patient",
      age: "45",
      sex: "M",
      accessionNumber: "A1",
      referringDoctor: "Dr X",
      studyDate: "2026-01-01",
      studyName: "MRI LS Spine",
      technique,
      clinicalHistory: "Back pain",
      findingsMap: {},
      rawFindings: findings,
      useStructured: false,
      impression: ["Degenerative disc disease."],
      recommendation: "Clinical correlation.",
      imageRefs: [],
    });
    expect(html).toContain(findings);
    expect(html).toContain(technique);
    expect(html).not.toMatch(/Source:\s*Quick Select/i);
    expect(html).not.toMatch(/Source:\s*Quick Findings/i);
    expect(html).not.toMatch(/Merged:\s*Quick Select/i);
    expect(html).not.toMatch(/data-provenance|data-editor-only|provenance-legend|provenance-map/i);
    expect(html).not.toContain("bg-sky-500");
    expect(html).not.toContain("bg-emerald-500");
  });
});

describe("structured-template provenance (P1)", () => {
  it("tags generated findings as Structured", () => {
    const r = mergeReportFieldContentWithProvenance({
      field: "findings",
      existing: "",
      incoming: "Mild diffuse disc bulge is seen at L4-L5.",
      source: "structured-template",
    });
    const key = normalizeForDedupe(r.text);
    expect(r.provenance[key]).toEqual(["structured-template"]);
    expect(provenanceVisualKind(r.provenance[key]!)).toBe("structured-template");
  });

  it("impression candidates are visually distinct and do not overwrite AI-only sentences", () => {
    const ai = mergeReportFieldContentWithProvenance({
      field: "impression",
      existing: "",
      incoming: "No acute infarct.",
      source: "ai-draft",
    });
    const next = mergeReportFieldContentWithProvenance({
      field: "impression",
      existing: ai.text,
      incoming: "L4-L5 degenerative disc disease with diffuse disc bulge.",
      source: "structured-template-candidate",
      existingProvenance: ai.provenance,
    });
    expect(next.text).toContain("No acute infarct");
    expect(next.text).toContain("diffuse disc bulge");
    expect(provenanceVisualKind(
      next.provenance[normalizeForDedupe("L4-L5 degenerative disc disease with diffuse disc bulge.")]!,
    )).toBe("structured-candidate");
  });

  it("overlapping structured + AI wording unions sources instead of duplicating", () => {
    const sentence = "Loss of lumbar lordosis.";
    const first = mergeReportFieldContentWithProvenance({
      field: "findings",
      existing: "",
      incoming: sentence,
      source: "ai-draft",
    });
    const second = mergeReportFieldContentWithProvenance({
      field: "findings",
      existing: first.text,
      incoming: sentence,
      source: "structured-template",
      existingProvenance: first.provenance,
    });
    expect(second.text).toBe(sentence);
    expect(second.provenance[normalizeForDedupe(sentence)]).toEqual([
      "structured-template",
      "ai-draft",
    ]);
  });
});

describe("fuzzy provenance for lightly edited owned blocks", () => {
  it("scores similar sentences above threshold", () => {
    const base = "Basal ganglia are unremarkable.";
    const edited = "Basal ganglia are largely unremarkable.";
    expect(fuzzySentenceSimilarity(base, edited)).toBeGreaterThanOrEqual(0.65);
  });

  it("allows pathology replace when baseline was lightly edited", () => {
    const baseline = "Basal ganglia are unremarkable.";
    const edited = "Basal ganglia are largely unremarkable.";
    expect(isProtectedManualSentence(edited, { [normalizeForDedupe(edited)]: ["manual"] }, { baselineReplaces: baseline })).toBe(false);
  });

  it("protects radiologist authorship annotations even when they still match the baseline lightly", () => {
    const baseline = "Ventricular system and cisternal spaces are normal in size and configuration. No midline shift.";
    const edited = "Ventricular system and cisternal spaces are normal in size — kept manual. No midline shift.";
    expect(isProtectedManualSentence(edited, { [normalizeForDedupe(edited)]: ["manual", "quick-select"] }, { baselineReplaces: baseline })).toBe(true);
  });

  it("protects radiologist rewrite of a QS chip that has no baselineReplaces", () => {
    const edited = "Few punctate T2/FLAIR hyperintense white matter lesions in bilateral periventricular and deep white matter, Fazekas grade 1 — radiologist rewrite. No confluent lesions.";
    expect(isProtectedManualSentence(edited, { [normalizeForDedupe(edited)]: ["manual", "quick-select"] })).toBe(true);
  });

  it("replaces lightly edited owned normal without ambiguous block", () => {
    const baseline = "Basal ganglia are unremarkable in signal intensity.";
    const edited = "Basal ganglia are largely unremarkable in signal intensity.";
    const result = applyPathologyPatch({
      existing: {
        clinicalHistory: "",
        technique: "",
        findings: `${edited}\nVentricles are normal.`,
        impression: "Normal MRI brain.",
        recommendation: "",
      },
      incoming: {
        findings: "Acute intraparenchymal hemorrhage in the right basal ganglia.",
        impression: "Acute right basal ganglia hemorrhage.",
      },
      ownership: {
        anatomicalSection: "basal ganglia",
        conflictGroup: "hemorrhage",
        baselineReplaces: baseline,
      },
      provenance: {
        findings: provenanceFromText(edited, "manual"),
      },
      source: "quick-select",
    });
    expect(result.ambiguous).toBe(false);
    expect(result.narrative.findings.toLowerCase()).toContain("hemorrhage");
    expect(result.narrative.findings).toContain("Ventricles are normal.");
  });
});
