import { describe, it, expect } from "vitest";
import {
  materializeAcceptedText,
  AI_COMPOSE_STATUS_STYLE,
  composeStatusDisplay,
  isDeterministicComposeFallback,
  composeDegradedReason,
  DETERMINISTIC_FALLBACK_WARNING,
  computeSnapshotHashes,
  COMPOSER_MAX_SELECTED_KEY_IMAGES,
  type TrackedChange,
  type ComposerInputSnapshot,
} from "./types";

describe("client reportComposer materialize", () => {
  it("never embeds HTML from proposed text into materialize helpers", () => {
    const changes: TrackedChange[] = [
      {
        id: "1",
        source: "AI_COMPOSER",
        changeType: "REPLACE",
        field: "FINDINGS",
        originalText: "old",
        proposedText: "new clinical text",
        reviewState: "ACCEPTED",
        clinicalSignificance: false,
        clinicalSignificanceReasons: [],
        createdAt: new Date().toISOString(),
      },
    ];
    const out = materializeAcceptedText({
      currentFindings: "old",
      currentImpression: "",
      currentRecommendation: "",
      changes,
    });
    expect(out.findings).toBe("new clinical text");
    expect(out.findings).not.toMatch(/</);
  });

  it("has distinct compose status labels from overnight vision", () => {
    expect(AI_COMPOSE_STATUS_STYLE.READY.label).toBe("AI READY");
    expect(AI_COMPOSE_STATUS_STYLE.STALE_READY.label).toBe("AI STALE");
  });

  it("shows FALLBACK DRAFT instead of AI READY when deterministic fallback was used", () => {
    const ready = composeStatusDisplay("READY", { fallbackUsed: true, model: "deterministic" });
    expect(ready.label).toBe("FALLBACK DRAFT");
    expect(ready.isFallbackDraft).toBe(true);

    const aiReady = composeStatusDisplay("READY", { fallbackUsed: false, model: "qwen3:14b" });
    expect(aiReady.label).toBe("AI READY");
    expect(aiReady.isFallbackDraft).toBe(false);

    expect(isDeterministicComposeFallback({
      fallbackUsed: true,
      model: "deterministic",
      validation: { warnings: ["deterministic_fallback"] },
    })).toBe(true);
    expect(DETERMINISTIC_FALLBACK_WARNING).toMatch(/Local AI was not used/);
  });
});

describe("client selected-image snapshot hashing", () => {
  const base: ComposerInputSnapshot = {
    modality: "MR",
    region: "Brain",
    regions: ["Brain"],
    bodyPart: "BRAIN",
    family: "brain",
    protocol: "Plain",
    reportTitle: "MRI BRAIN PLAIN",
    clinicalHistory: "",
    technique: "",
    findings: "Fazekas grade 1.",
    impression: "Mild CSVD.",
    recommendation: "",
    observations: [],
    jobKindHint: "FULL_REPORT",
    aiMode: "TEXT_ONLY",
  };

  it("TEXT_ONLY default max selected images is 4", () => {
    expect(COMPOSER_MAX_SELECTED_KEY_IMAGES).toBe(4);
  });

  it("selected key images change inputHash but not reportRevision", async () => {
    const a = await computeSnapshotHashes({
      ...base,
      aiMode: "SELECTED_IMAGES",
      selectedKeyImages: [{ keyImageId: 1, caption: "FLAIR" }],
    });
    const b = await computeSnapshotHashes({
      ...base,
      aiMode: "SELECTED_IMAGES",
      selectedKeyImages: [{ keyImageId: 1, caption: "FLAIR updated" }],
    });
    expect(a.inputHash).not.toBe(b.inputHash);
    expect(a.reportRevision).toBe(b.reportRevision);
  });

  it("does not persist base64 in snapshot shape used for hashing", async () => {
    const snap: ComposerInputSnapshot = {
      ...base,
      aiMode: "SELECTED_IMAGES",
      selectedKeyImages: [{ keyImageId: 9, caption: "sagittal T2" }],
    };
    expect(JSON.stringify(snap)).not.toMatch(/data:image|base64,/i);
    const h = await computeSnapshotHashes(snap);
    expect(h.inputHash).toMatch(/^[a-f0-9]{32}$/);
  });
});

describe("the fallback reason the banner prints", () => {
  /**
   * `provenance.degradedReason` is the only trace of WHY a draft is mechanical that
   * reaches the browser — the job service stores `safeError: null` on the READY path.
   * The client prints the server's sentence verbatim and never substitutes a guess of
   * its own: the guess is what told an operator whose model had merely timed out to go
   * and configure a model that was already configured.
   */
  it("prints the server's sentence verbatim, trimmed", () => {
    const reason =
      "The local model did not answer within the compose timeout, so no AI wrote this draft.";
    expect(
      composeDegradedReason({
        validation: { provenance: { degradedReason: `  ${reason}  ` } },
      }),
    ).toBe(reason);
  });

  it("returns empty rather than inventing a reason", () => {
    // Empty is the signal the caller uses to fall back to its own generic wording, so
    // it must mean "the server wrote nothing" and nothing else.
    const jobs = [
      null,
      undefined,
      {},
      { validation: null },
      { validation: {} },
      { validation: { provenance: {} } },
      { validation: { provenance: { degradedReason: null } } },
      { validation: { provenance: { degradedReason: "   " } } },
      { validation: "READY" },
    ];
    for (const job of jobs) {
      expect(composeDegradedReason(job as never), JSON.stringify(job) ?? "null").toBe("");
    }
  });

  it("is a printer, not a classifier", () => {
    // If the server ever sends a bare code again the client shows it as-is. Adding a
    // translation table here would put a second copy of the server's reasons in the
    // ERP tree, free to drift from the code that knows what the adapter returned.
    expect(
      composeDegradedReason({ validation: { provenance: { degradedReason: "ollama_timeout" } } }),
    ).toBe("ollama_timeout");
  });
});
