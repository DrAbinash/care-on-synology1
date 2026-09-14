import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");

function read(rel: string) {
  return readFileSync(resolve(root, rel), "utf8");
}

describe("AI Draft placement in reporting workspace", () => {
  it("AiDraftPanel supports an in-flow rail variant (not only floating)", () => {
    const src = read("components/ai/AiDraftPanel.tsx");
    expect(src).toContain('variant?: "floating" | "rail"');
    expect(src).toContain('variant === "rail"');
    expect(src).toContain('data-testid="ai-draft-panel"');
    expect(src).toContain("data-variant={variant}");
  });

  it("Orient CopilotRail embeds AiDraftPanel as rail variant", () => {
    const src = read("components/radiology/zai-workspace/copilot-rail.tsx");
    expect(src).toContain('from "@/components/ai/AiDraftPanel"');
    expect(src).toContain('variant="rail"');
    expect(src).toContain("onStageAiProposal");
    expect(src).toContain("<SectionTitle>AI Draft</SectionTitle>");
  });

  it("ReportingWorkspace wires AI Draft into Orient and does not float it bottom-right", () => {
    const src = read("pages/RadiologyReportingWorkspace.tsx");
    expect(src).toContain("aiDraftStudyInstanceUid=");
    expect(src).toContain("onStageAiProposal={stageAiProposal}");
    expect(src).not.toMatch(/<AiDraftPanel[\s\S]*?composerReviewOnly/);
    expect(src).not.toContain('fixed bottom-4 right-4');
  });
});
