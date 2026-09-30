import { describe, it, expect } from "vitest";
import { detectClinicalSignificance } from "./clinicalSignificance";
import { computeSnapshotHashes, dedupeObservations, hashText } from "./snapshot";
import { validateComposerOutput } from "./validateOutput";
import { buildTrackedChanges, materializeAcceptedText } from "./trackedChanges";
import { deterministicComposeFromSnapshot } from "./deterministicCompose";
import { parseComposerSnapshot, type ComposerInputSnapshot } from "./types";

describe("clinicalSignificance — deterministic", () => {
  it("flags laterality change", () => {
    const r = detectClinicalSignificance("right foraminal stenosis", "left foraminal stenosis");
    expect(r.significant).toBe(true);
    expect(r.reasons.some((x) => /Laterality/i.test(x))).toBe(true);
  });

  it("flags spinal level change", () => {
    const r = detectClinicalSignificance("L4-5 disc bulge", "L3-4 disc bulge");
    expect(r.significant).toBe(true);
    expect(r.reasons.some((x) => /Spinal level/i.test(x))).toBe(true);
  });

  it("flags measurement change", () => {
    const r = detectClinicalSignificance("lesion measures 5 mm", "lesion measures 15 mm");
    expect(r.significant).toBe(true);
  });

  it("flags negation/polarity change", () => {
    const r = detectClinicalSignificance("no significant disc bulge", "significant disc bulge present");
    expect(r.significant).toBe(true);
  });

  it("is quiet for pure rephrase without tokens", () => {
    const r = detectClinicalSignificance(
      "Mild degenerative changes are noted.",
      "There are mild degenerative changes.",
    );
    expect(r.significant).toBe(false);
  });

  // mra/mrv §21: AI may propose a vascular observation; it may not finalise a vascular
  // diagnosis. Each pair below is the exact escalation the spec forbids, and each one has
  // to arrive as a clinically-significant change the radiologist must accept by name.
  it("flags an added vascular conclusion (§21)", () => {
    const escalations: Array<[string, string]> = [
      ["The intracranial arteries are normal.", "There is an aneurysm at the ACom region."],
      ["Non-visualization of the right MCA M1.", "Occlusion of the right MCA M1."],
      [
        "Segmental flow gap in the right transverse sinus.",
        "Occlusive dural venous sinus thrombosis of the right transverse sinus.",
      ],
      [
        "Moyamoya pattern of the terminal ICAs.",
        "Findings are diagnostic of Moyamoya disease.",
      ],
      ["Unruptured aneurysm of the ACom region.", "Ruptured aneurysm of the ACom region."],
      [
        "Eccentric crescentic T1 hyperintense signal in the left cervical ICA.",
        "Acute dissection of the left cervical ICA.",
      ],
    ];
    for (const [before, after] of escalations) {
      const r = detectClinicalSignificance(before, after);
      expect(r.significant, `${before} → ${after}`).toBe(true);
      expect(
        r.reasons.some((x) => /Vascular conclusion/i.test(x)),
        `${before} → ${after}`,
      ).toBe(true);
    }
  });

  it("stays quiet when the vascular conclusion was already in the report", () => {
    const r = detectClinicalSignificance(
      "Occlusion of the left MCA M1.",
      "There is occlusion of the left MCA M1.",
    );
    expect(r.reasons).toEqual([]);
    expect(r.significant).toBe(false);
  });

  it("flags a stenosis percentage the report did not carry (§21)", () => {
    const r = detectClinicalSignificance(
      "Focal luminal narrowing of the left carotid bulb.",
      "Severe (70%) stenosis of the left carotid bulb.",
    );
    expect(r.significant).toBe(true);
    expect(r.reasons.some((x) => /added: 70/i.test(x))).toBe(true);
    expect(r.reasons.some((x) => /Vascular conclusion/i.test(x))).toBe(false);
  });
});

describe("snapshot immutability / hashing", () => {
  it("same content → same revision", () => {
    const snap: ComposerInputSnapshot = parseComposerSnapshot({
      findings: "L4-5 bulge",
      impression: "Disc bulge",
      recommendation: "",
      observations: [{ concept: "bulge", findingsText: "L4-5 diffuse disc bulge", source: "quick-select", level: "L4-L5" }],
    });
    const a = computeSnapshotHashes(snap);
    const b = computeSnapshotHashes({ ...snap });
    expect(a.reportRevision).toBe(b.reportRevision);
    expect(a.inputHash).toBe(b.inputHash);
  });

  it("edit changes revision", () => {
    const a = computeSnapshotHashes(parseComposerSnapshot({ findings: "L4-5", impression: "", recommendation: "", observations: [] }));
    const b = computeSnapshotHashes(parseComposerSnapshot({ findings: "L3-4", impression: "", recommendation: "", observations: [] }));
    expect(a.reportRevision).not.toBe(b.reportRevision);
  });

  it("dedupes identical observations", () => {
    const out = dedupeObservations([
      { concept: "bulge", findingsText: "L4-5 bulge", level: "L4-L5", source: "quick-select" },
      { concept: "bulge", findingsText: "L4-5 bulge", level: "L4-L5", source: "macro" },
    ]);
    expect(out).toHaveLength(1);
  });
});

describe("validateComposerOutput — no invented pathology", () => {
  it("rejects unsupported hemorrhage in brain draft", () => {
    const snap: ComposerInputSnapshot = parseComposerSnapshot({
      findings: "Fazekas 2 white matter changes. Prominent ventricles.",
      impression: "",
      recommendation: "",
      observations: [
        { concept: "fazekas", findingsText: "Fazekas grade 2", source: "quick-select" },
        { concept: "ventricles", findingsText: "prominent ventricles/CSF spaces", source: "quick-select" },
      ],
    });
    const v = validateComposerOutput(snap, {
      findings: snap.findings,
      impression: "Acute hemorrhage and infarct with Fazekas 2.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    });
    expect(v.ok).toBe(false);
    expect(v.unsupportedMentions.length).toBeGreaterThan(0);
  });

  it("accepts grounded LS spine findings", () => {
    const snap: ComposerInputSnapshot = parseComposerSnapshot({
      findings: "No significant disc bulge.",
      impression: "",
      recommendation: "",
      observations: [
        { concept: "bulge", findingsText: "L4-5 diffuse disc bulge", source: "quick-select" },
        { concept: "desiccation", findingsText: "L5-S1 disc desiccation", source: "quick-select" },
      ],
    });
    const draft = deterministicComposeFromSnapshot(snap, "FULL_REPORT");
    const v = validateComposerOutput(snap, draft);
    expect(v.ok).toBe(true);
  });

  it("refuses a vascular diagnosis the observations never stated (§21)", () => {
    const snap: ComposerInputSnapshot = parseComposerSnapshot({
      findings:
        "Segmental flow gap in the right transverse sinus. The left MCA M1 is not visualized on the angiographic acquisition.",
      impression: "",
      recommendation: "",
      observations: [
        {
          concept: "mrv_vessel_transverse_sinus",
          findingsText: "Segmental flow gap in the right transverse sinus",
          source: "structured",
        },
        {
          concept: "mra_vessel_mca_m1",
          findingsText: "The left MCA M1 is not visualized on the angiographic acquisition",
          source: "structured",
        },
      ],
    });
    const v = validateComposerOutput(snap, {
      findings: snap.findings,
      impression:
        "Occlusive dural venous sinus thrombosis of the right transverse sinus with venous infarction, and left MCA M1 occlusion.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    });
    expect(v.ok).toBe(false);
    // A flow gap is not a thrombosis and non-visualisation is not an occlusion (§12, §18).
    expect(v.unsupportedMentions).toEqual(
      expect.arrayContaining(["thrombosis", "occlusion", "dural venous sinus"]),
    );
  });

  it("refuses moyamoya disease when only the pattern was recorded (§21)", () => {
    const snap: ComposerInputSnapshot = parseComposerSnapshot({
      findings: "Moyamoya pattern of the bilateral terminal ICAs with lenticulostriate collaterals.",
      impression: "",
      recommendation: "",
      observations: [
        {
          concept: "mra_moyamoya_pattern",
          findingsText: "Moyamoya pattern of the bilateral terminal ICAs",
          impressionText: "Moyamoya pattern of the bilateral terminal ICAs",
          source: "structured",
        },
      ],
    });
    const v = validateComposerOutput(snap, {
      findings: snap.findings,
      impression: "Moyamoya disease.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    });
    expect(v.unsupportedMentions).toContain("moyamoya disease");
  });

  it("accepts the vascular conclusion the radiologist already recorded", () => {
    const snap: ComposerInputSnapshot = parseComposerSnapshot({
      findings: "Occlusive thrombus within the superior sagittal sinus.",
      impression: "",
      recommendation: "",
      observations: [
        {
          concept: "mrv_vessel_sss",
          findingsText: "Occlusive thrombus within the superior sagittal sinus",
          // The conclusion the radiologist selected, which is what makes the impression
          // line a restatement rather than an invention.
          impressionText: "Occlusive dural venous sinus thrombosis of the superior sagittal sinus",
          source: "structured",
        },
      ],
    });
    const v = validateComposerOutput(snap, {
      findings: snap.findings,
      impression: "Occlusive dural venous sinus thrombosis of the superior sagittal sinus.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    });
    expect(v.unsupportedMentions).toEqual([]);
  });
});

describe("tracked changes — data not HTML", () => {
  it("builds REPLACE with clinical significance when level changes", () => {
    const changes = buildTrackedChanges({
      jobId: 1,
      model: "test",
      originalFindings: "L4-5 disc bulge",
      originalImpression: "",
      originalRecommendation: "",
      draft: {
        findings: "L3-4 disc bulge",
        impression: "Disc bulge at L3-4",
        recommendation: "",
        unresolvedQuestions: [],
        warnings: [],
      },
    });
    expect(changes.some((c) => c.field === "FINDINGS" && c.clinicalSignificance)).toBe(true);
    expect(changes.every((c) => c.source === "AI_COMPOSER")).toBe(true);
    expect(JSON.stringify(changes)).not.toMatch(/<span|style=/i);
  });

  it("materialize uses only ACCEPTED changes", () => {
    const text = materializeAcceptedText({
      currentFindings: "A",
      currentImpression: "B",
      currentRecommendation: "",
      changes: [
        {
          id: "1",
          source: "AI_COMPOSER",
          changeType: "REPLACE",
          field: "FINDINGS",
          originalText: "A",
          proposedText: "NEW",
          reviewState: "PENDING",
          clinicalSignificance: false,
          clinicalSignificanceReasons: [],
          createdAt: new Date().toISOString(),
        },
        {
          id: "2",
          source: "AI_COMPOSER",
          changeType: "REPLACE",
          field: "IMPRESSION",
          originalText: "B",
          proposedText: "IMP",
          reviewState: "ACCEPTED",
          clinicalSignificance: false,
          clinicalSignificanceReasons: [],
          createdAt: new Date().toISOString(),
        },
      ],
    });
    expect(text.findings).toBe("A");
    expect(text.impression).toBe("IMP");
  });
});

describe("hashText", () => {
  it("normalizes whitespace", () => {
    expect(hashText("a  b")).toBe(hashText("a b"));
  });
});
