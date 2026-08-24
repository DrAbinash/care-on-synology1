/**
 * Client-side pre-deploy safety contracts (5, 6, 14).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { materializeAcceptedText, type TrackedChange } from "./types";
import { useWorkspace } from "@/lib/zai-workspace/store";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ERP_SRC = join(__dirname, "../..");

function readErp(rel: string): string {
  return readFileSync(join(ERP_SRC, rel), "utf8");
}

describe("pre-deploy safety contracts — client apply/undo (14)", () => {
  it("14. Accept All apply + one Undo restores exact prior Findings/Impression/Recommendation", () => {
    const store = useWorkspace.getState();
    store.setEditorContent({
      clinicalHistory: "",
      technique: "",
      findings: "Baseline findings.",
      impression: "Baseline impression.",
      recommendation: "Baseline recommendation.",
    });

    store.applyAiComposerAccepted({
      findings: "AI findings after accept all.",
      impression: "AI impression after accept all.",
      recommendation: "AI recommendation after accept all.",
    });

    expect(useWorkspace.getState().findingsText).toBe("AI findings after accept all.");
    expect(useWorkspace.getState().impressionText).toBe("AI impression after accept all.");
    expect(useWorkspace.getState().recommendationText).toBe("AI recommendation after accept all.");

    const undone = useWorkspace.getState().undoLastPatch();
    expect(undone).toBe(true);
    expect(useWorkspace.getState().findingsText).toBe("Baseline findings.");
    expect(useWorkspace.getState().impressionText).toBe("Baseline impression.");
    expect(useWorkspace.getState().recommendationText).toBe("Baseline recommendation.");
  });
});

describe("pre-deploy safety contracts — silent accept blocked (5)", () => {
  it("5. applyAccepted blocks when clinically significant changes remain PENDING", () => {
    const hook = readErp("hooks/useReportComposer.ts");
    expect(hook).toContain("significantPending");
    expect(hook).toContain("c.reviewState === \"PENDING\" && c.clinicalSignificance");
    expect(hook).toContain("Clinically significant edits pending");
    expect(hook).toContain('job.status === "STALE_READY"');
  });

  it("6. materializeAcceptedText ignores PENDING changes", () => {
    const pending: TrackedChange[] = [
      {
        id: "1",
        source: "AI_COMPOSER",
        changeType: "REPLACE",
        field: "FINDINGS",
        originalText: "old",
        proposedText: "must not appear",
        reviewState: "PENDING",
        clinicalSignificance: true,
        clinicalSignificanceReasons: [],
        createdAt: new Date().toISOString(),
      },
    ];
    const out = materializeAcceptedText({
      currentFindings: "old",
      currentImpression: "",
      currentRecommendation: "",
      changes: pending,
    });
    expect(out.findings).toBe("old");
  });
});
