import { describe, expect, it } from "vitest";
import { normalizeAiWorkspaceDraft } from "./aiClient";

describe("normalizeAiWorkspaceDraft", () => {
  it("maps fetchApi empty-body {} (HTTP 204) to null", () => {
    expect(normalizeAiWorkspaceDraft({})).toBeNull();
  });

  it("maps null/undefined/non-objects to null", () => {
    expect(normalizeAiWorkspaceDraft(null)).toBeNull();
    expect(normalizeAiWorkspaceDraft(undefined)).toBeNull();
    expect(normalizeAiWorkspaceDraft("x")).toBeNull();
  });

  it("rejects objects missing draft identity", () => {
    expect(normalizeAiWorkspaceDraft({ findings: [] })).toBeNull();
    expect(normalizeAiWorkspaceDraft({ draftId: 1 })).toBeNull();
  });

  it("normalizes missing findings/impression/evidence arrays", () => {
    const draft = normalizeAiWorkspaceDraft({
      draftId: 9,
      studyInstanceUid: "1.2.3",
      findings: [{ key: "f0", text: "Disc bulge" }],
    });
    expect(draft).not.toBeNull();
    expect(draft!.findings).toHaveLength(1);
    expect(draft!.findings[0]!.evidence).toEqual([]);
    expect(draft!.impression).toEqual([]);
    expect(draft!.measurements).toEqual([]);
    expect(draft!.provenance.modelVersion).toBe("unknown");
  });

  it("preserves a well-formed draft", () => {
    const draft = normalizeAiWorkspaceDraft({
      draftId: 3,
      studyInstanceUid: "uid",
      status: "shadow",
      degraded: false,
      qualityScore: 0.8,
      findings: [{ key: "f0", text: "Normal", evidence: [{ evidenceType: "image", confidence: 0.9 }] }],
      quarantinedCount: 0,
      measurements: [],
      impression: ["Normal study."],
      provenance: {
        modelVersion: "m1",
        promptVersion: "p1",
        rulesVersion: "r1",
        degraded: false,
        createdAt: "2026-01-01",
      },
    });
    expect(draft?.impression).toEqual(["Normal study."]);
    expect(draft?.findings[0]?.evidence[0]?.confidence).toBe(0.9);
    expect(draft?.provenance.modelVersion).toBe("m1");
  });
});
