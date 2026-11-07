import { describe, expect, it } from "vitest";
import { buildTrackedChanges, materializeAcceptedText } from "./trackedChanges";
import type { ComposerDraftOutput } from "./types";

/**
 * The audit item: "Composer review diff is whole-field, never per sentence", with the
 * sentence loop at `trackedChanges.ts:58-65` reduced to a `break` and a `void pSet`.
 * The dead loop is gone; what is pinned here is the contract that replaces the claim —
 * one change per field, carrying the whole field — and the reason per-sentence changes
 * must not be introduced without also changing the merge below.
 */

const draft = (findings: string, impression = "", recommendation = ""): ComposerDraftOutput => ({
  findings,
  impression,
  recommendation,
  unresolvedQuestions: [],
  warnings: [],
});

function changesFor(originals: { findings: string; impression: string; recommendation: string }, out: ComposerDraftOutput) {
  return buildTrackedChanges({
    jobId: 7,
    model: "test-model",
    originalFindings: originals.findings,
    originalImpression: originals.impression,
    originalRecommendation: originals.recommendation,
    draft: out,
  });
}

describe("Composer tracked changes are one whole-field decision per section", () => {
  const originals = {
    findings: "L4-5 disc bulge. Mild canal stenosis. No sepsis.",
    impression: "Disc bulge.",
    recommendation: "",
  };
  const proposed = draft(
    "L4-5 disc bulge with severe canal stenosis. No sepsis.",
    "L4-5 disc bulge with severe canal stenosis.",
    "Neurology referral.",
  );
  const changes = changesFor(originals, proposed);

  it("emits exactly one change for each field that differs, and none for a field that does not", () => {
    expect(changes.filter((c) => c.field === "FINDINGS")).toHaveLength(1);
    expect(changes.filter((c) => c.field === "IMPRESSION")).toHaveLength(1);
    expect(changes.filter((c) => c.field === "RECOMMENDATION")).toHaveLength(1);
    expect(changes.filter((c) => c.field === "FINDINGS").map((c) => c.changeType)).toEqual(["REPLACE"]);
  });

  it("carries the WHOLE proposed field, so accepting it cannot lose a sentence", () => {
    const findings = changes.find((c) => c.field === "FINDINGS")!;
    expect(findings.originalText).toBe(originals.findings);
    expect(findings.proposedText).toBe(proposed.findings);
    // The defect this pins: a supplemental sentence-level ADD would put a fragment in
    // proposedText, and `materializeAcceptedText` assigns the field from it — accepting
    // that one change would delete every sentence it did not mention.
    const merged = materializeAcceptedText({
      currentFindings: originals.findings,
      currentImpression: originals.impression,
      currentRecommendation: originals.recommendation,
      changes: changes.map((c) => ({ ...c, reviewState: "ACCEPTED" as const })),
    });
    expect(merged.findings).toBe(proposed.findings);
    expect(merged.impression).toBe(proposed.impression);
    expect(merged.recommendation).toBe(proposed.recommendation);
  });

  it("adds a field that had nothing before, and changes nothing when the text is identical", () => {
    const added = changesFor({ ...originals, recommendation: "" }, draft(originals.findings, originals.impression, "Clinical correlation."));
    const rec = added.filter((c) => c.field === "RECOMMENDATION");
    expect(rec).toHaveLength(1);
    expect(rec[0].changeType).toBe("ADD");
    expect(changesFor(originals, draft(originals.findings, originals.impression, originals.recommendation))).toEqual([]);
  });

  it("never emits the same field twice for one rewrite", () => {
    const many = changesFor(
      { findings: "Sentence one. Sentence two. Sentence three.", impression: "", recommendation: "" },
      draft("Sentence one changed. Sentence two. Sentence three changed again. Sentence four added."),
    );
    expect(many.filter((c) => c.field === "FINDINGS")).toHaveLength(1);
    expect(many.filter((c) => c.field === "FINDINGS")[0].proposedText).toContain("Sentence four added.");
  });
});
