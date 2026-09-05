import { describe, expect, it } from "vitest";
import { shouldInsertOnAction, shouldStageOnAction } from "./aiDraftBinding";
import { materializeStagedProposals, stageShadowProposal } from "./stagedAiProposals";

describe("one AI Accept culture", () => {
  it("Accept/Edit stage for Composer review (workspace)", () => {
    expect(shouldStageOnAction("accept")).toBe(true);
    expect(shouldStageOnAction("edit")).toBe(true);
    expect(shouldStageOnAction("ignore")).toBe(false);
    expect(shouldStageOnAction("reject")).toBe(false);
  });

  it("legacy insert helper still identifies Accept/Edit (non-workspace)", () => {
    expect(shouldInsertOnAction("accept")).toBe(true);
  });

  it("staging does not bypass review — materialize only after Apply", () => {
    const staged = stageShadowProposal([], {
      findingKey: "f0",
      text: "Small disc bulge at L4-L5.",
    });
    expect(staged).toHaveLength(1);
    // Staging alone leaves editor empty until materialize (Apply).
    expect(materializeStagedProposals("", [])).toBe("");
    expect(materializeStagedProposals("", staged)).toContain("disc bulge");
  });

  it("restaging same findingKey replaces prior proposal", () => {
    let staged = stageShadowProposal([], { findingKey: "f0", text: "A" });
    staged = stageShadowProposal(staged, { findingKey: "f0", text: "B" });
    expect(staged).toHaveLength(1);
    expect(staged[0].text).toBe("B");
  });
});
