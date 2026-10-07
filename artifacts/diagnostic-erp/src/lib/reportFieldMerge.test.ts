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

  it("B-02A: paraphrased 3T wording is kept as a second statement, not folded", () => {
    // This test asserted the opposite — one line, "same concepts, no new line" —
    // which is the merge engine deciding that two sentences describing the same
    // scanner are the same acquisition record. They are not provably the same
    // wording, and the field it writes is read back by
    // `deriveSpineSequencesAvailable`, so a fold here is a derived-state change.
    // Dedupe now needs identity under normalization; near-misses both stand.
    const existing = "MRI study performed on a 3T scanner using multiplanar multisequence acquisition.";
    const incoming = "Multiplanar multisequence MRI was performed on a 3 Tesla scanner.";
    const out = mergeTechnique(existing, incoming);
    expect(out.split("\n")).toHaveLength(2);
    expect(out).toContain(existing);
    expect(out).toContain(incoming);
  });

  it("B-02A: two paraphrased MRI technique paragraphs both survive, T1/T2/STIR included", () => {
    const a = "Multiplanar, multisequence MRI of the lumbosacral spine was performed including T1, T2 and STIR sequences.";
    const b = "MRI of the lumbosacral spine was performed using multiplanar multisequence acquisition with T1, T2, and STIR.";
    const out = mergeTechnique(a, b);
    const sentences = out.split(/(?<=[.!?])\s+/).filter(Boolean);
    expect(sentences).toHaveLength(2);
    expect(out).toContain(a);
    expect(out).toContain(b);
    // Neither wording was edited into the other: STIR appears twice because both
    // producers said STIR, which is exactly what the old rule "collapsed".
    expect(out.match(/STIR/g)).toHaveLength(2);
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

  it("B-02: a longer restatement is kept as its own sentence; the existing one is never rewritten", () => {
    // This test used to assert the opposite — one line, the "more informative"
    // sentence winning — which is the merge engine deciding that "Disc
    // desiccation at L4-L5." implies "Disc desiccation with diffuse bulge at
    // L4-L5.". It does not: the second claims a bulge nobody stated. Subset
    // containment is not identity, so both statements now stand, each with its
    // own source, and the radiologist (or the QC layer) reconciles them.
    const existing = "Disc desiccation at L4-L5.";
    const incoming = "Disc desiccation with diffuse bulge at L4-L5.";
    const out = mergeSentences(existing, incoming);
    expect(out.split("\n")).toContain(existing);
    expect(out.split("\n")).toContain(incoming);
    expect(out.split("\n").length).toBe(2);
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

/**
 * Measurement safety. A merge that quietly turns a measured 12.6 mm into 12 mm
 * is not a formatting change — the decimal is the difference between a disc that
 * is watched and one that is operated on, and the merged text still reads like a
 * measurement somebody took.
 */
describe("mergeSentences — measurement precision is clinical detail", () => {
  it("does not collapse 12.6 mm into 12 mm", () => {
    const existing = "Thecal sac measured 12.6 mm at L4-L5.";
    const incoming = "Thecal sac measured 12 mm at L4-L5.";
    const out = mergeSentences(existing, incoming);
    expect(out).toContain("12.6 mm");
    expect(out).toContain("12 mm");
  });

  it("keeps a decimal when the AI paraphrase drops it", () => {
    const existing = "Anteroposterior diameter 8.7 mm.";
    const incoming = "Anteroposterior diameter 8 mm.";
    const out = mergeSentences(existing, incoming);
    expect(out).toContain("8.7 mm");
    expect(out.split("\n").length).toBe(2);
  });

  it("still dedupes an identical measurement", () => {
    const a = "Thecal sac measured 12.6 mm at L4-L5.";
    expect(mergeSentences(a, a)).toBe(a);
  });

  it("treats a unit change as a conflict, not a restatement", () => {
    const existing = "Lesion measured 12 mm.";
    const incoming = "Lesion measured 12 cm.";
    const out = mergeSentences(existing, incoming);
    expect(out).toContain("12 mm");
    expect(out).toContain("12 cm");
  });

  it("preserves the level a measurement belongs to", () => {
    const existing = "Canal diameter 12.6 mm at L4-L5.";
    const incoming = "Canal diameter 12.6 mm at L5-S1.";
    const out = mergeSentences(existing, incoming);
    expect(out).toContain("L4-L5");
    expect(out).toContain("L5-S1");
  });

  it("never downgrades precision: the measured figure is never replaced by a rounded restatement", () => {
    // The clinical point of this test has always been "12.6 mm must not become
    // 12 mm". B-02 changes how that is guaranteed. Before, the rounded sentence
    // was quietly DISCARDED by the subsequence fold; now nothing is discarded and
    // nothing is rewritten — the precise line stays exactly as written and the
    // rounded restatement arrives as its own visible sentence, which is the safe
    // direction: a duplicate is reviewable, a silently chosen number is not.
    const existing = "Canal 12.6 mm and foramen 4.1 mm at L4-L5.";
    const incoming = "Canal 12.6 mm and foramen 4 mm at L4-L5.";
    const out = mergeSentences(existing, incoming);
    expect(out.split("\n")).toContain(existing);
    expect(out).toContain("4.1 mm");
    expect(out.split("\n")).toHaveLength(2);
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

  it("B-02A: technique attribution is unioned only over provably identical sentences", () => {
    // The intent of the old "technique concept near-dup" test was that dropping a
    // duplicate must not lose its source. It proved that by folding a paraphrase
    // onto the existing sentence and unioning the two sources onto text its
    // producer never wrote — Quick Findings ended up owning a Quick Select
    // sentence because the two used similar words. Attribution can only follow
    // identity, so the paraphrase keeps its own source and the genuine duplicate
    // case (below) is the one that unions.
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
    expect(second.provenance[normalizeForDedupe(existing)]).toEqual(["quick-select"]);
    expect(second.provenance[normalizeForDedupe(incoming)]).toEqual(["quick-findings"]);
    expect(formatProvenanceHover(second.provenance[normalizeForDedupe(existing)]!))
      .toBe("Source: Quick Select");

    const dup = mergeReportFieldContentWithProvenance({
      field: "technique",
      existing,
      incoming: existing.replace("3T", "3t"),
      source: "quick-findings",
      existingProvenance: first.provenance,
    });
    expect(dup.text).toBe(existing);
    expect(dup.provenance[normalizeForDedupe(existing)]).toEqual(["quick-select", "quick-findings"]);
    expect(formatProvenanceHover(dup.provenance[normalizeForDedupe(existing)]!))
      .toBe("Merged: Quick Select + Quick Findings");
  });

  it("B-02: a near-merge keeps each sentence's own provenance instead of laundering it", () => {
    // Before, the longer sentence replaced the shorter one and the two sources
    // were unioned onto it — so a Quick Select insert could end up attributed to
    // a manual sentence it had merely resembled. Provenance may be unioned only
    // over text that is provably the same statement (the exact-duplicate case
    // above still does that), so each sentence now carries its own source.
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
    expect(second.text.split("\n")).toHaveLength(2);
    expect(second.provenance[normalizeForDedupe("Disc desiccation at L4-L5.")])
      .toEqual(["quick-select"]);
    expect(second.provenance[normalizeForDedupe("Disc desiccation with diffuse bulge at L4-L5.")])
      .toEqual(["quick-findings"]);
    expect(formatProvenanceHover(second.provenance[normalizeForDedupe("Disc desiccation at L4-L5.")!]!))
      .toBe("Source: Quick Select");
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
