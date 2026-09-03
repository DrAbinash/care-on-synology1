import { describe, it, expect } from "vitest";
import {
  materializeAcceptedText,
  AI_COMPOSE_STATUS_STYLE,
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
