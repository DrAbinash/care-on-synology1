import { describe, it, expect } from "vitest";
import { materializeAcceptedText, AI_COMPOSE_STATUS_STYLE, type TrackedChange } from "./types";

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
