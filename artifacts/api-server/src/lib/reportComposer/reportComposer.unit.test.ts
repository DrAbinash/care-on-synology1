import { describe, it, expect } from "vitest";
import { detectClinicalSignificance } from "./clinicalSignificance";
import { computeSnapshotHashes, dedupeObservations, hashText } from "./snapshot";
import { validateComposerOutput } from "./validateOutput";
import { buildTrackedChanges, materializeAcceptedText } from "./trackedChanges";
import { deterministicComposeFromSnapshot } from "./deterministicCompose";
import type { ComposerInputSnapshot } from "./types";

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
});

describe("snapshot immutability / hashing", () => {
  it("same content → same revision", () => {
    const snap: ComposerInputSnapshot = {
      findings: "L4-5 bulge",
      impression: "Disc bulge",
      recommendation: "",
      observations: [{ concept: "bulge", findingsText: "L4-5 diffuse disc bulge", source: "quick-select", level: "L4-L5" }],
    };
    const a = computeSnapshotHashes(snap);
    const b = computeSnapshotHashes({ ...snap });
    expect(a.reportRevision).toBe(b.reportRevision);
    expect(a.inputHash).toBe(b.inputHash);
  });

  it("edit changes revision", () => {
    const a = computeSnapshotHashes({ findings: "L4-5", impression: "", recommendation: "", observations: [] });
    const b = computeSnapshotHashes({ findings: "L3-4", impression: "", recommendation: "", observations: [] });
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
    const snap: ComposerInputSnapshot = {
      findings: "Fazekas 2 white matter changes. Prominent ventricles.",
      impression: "",
      recommendation: "",
      observations: [
        { concept: "fazekas", findingsText: "Fazekas grade 2", source: "quick-select" },
        { concept: "ventricles", findingsText: "prominent ventricles/CSF spaces", source: "quick-select" },
      ],
    };
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
    const snap: ComposerInputSnapshot = {
      findings: "No significant disc bulge.",
      impression: "",
      recommendation: "",
      observations: [
        { concept: "bulge", findingsText: "L4-5 diffuse disc bulge", source: "quick-select" },
        { concept: "desiccation", findingsText: "L5-S1 disc desiccation", source: "quick-select" },
      ],
    };
    const draft = deterministicComposeFromSnapshot(snap, "FULL_REPORT");
    const v = validateComposerOutput(snap, draft);
    expect(v.ok).toBe(true);
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
