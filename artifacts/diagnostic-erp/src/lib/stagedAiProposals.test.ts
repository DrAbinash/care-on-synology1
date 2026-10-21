import { describe, expect, it } from "vitest";
import {
  aiReportInsertKey,
  pendingReportInserts,
  shouldInsertOnAction,
  shouldStageOnAction,
} from "./aiDraftBinding";
import { materializeStagedProposals, proposalAddsNothing, stageShadowProposal } from "./stagedAiProposals";

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

const proposal = (findingKey: string, text: string) => ({
  id: findingKey,
  findingKey,
  text,
  source: "shadow_ai" as const,
});

describe("Apply is safe to press twice", () => {
  const sentence = "Small disc bulge at L4-L5 with no canal stenosis.";

  it("says a line once, however many times it is applied", () => {
    const once = materializeStagedProposals("Findings of the lumbar spine.", [proposal("f0", sentence)]);
    const twice = materializeStagedProposals(once, [proposal("f0", sentence)]);
    expect(once.split("Small disc bulge")).toHaveLength(2);
    expect(twice).toBe(once);
  });

  it("recognises text the report already carries under different spacing or punctuation", () => {
    const report = "L4-L5 disc bulge,   no stenosis";
    expect(materializeStagedProposals(report, [proposal("f0", "L4-L5 disc bulge, no stenosis.")])).toBe(report);
    expect(proposalAddsNothing(report, "L4-L5 disc bulge, no stenosis.")).toBe(true);
  });

  it("appends only the line that is new, when a proposal carries several", () => {
    const report = "Normal marrow signal.";
    const out = materializeStagedProposals(report, [
      proposal("f0", "Normal marrow signal.\nA 6 mm T2 hyperintense lesion in the right frontal lobe."),
    ]);
    expect(out).toBe(`${report}\nA 6 mm T2 hyperintense lesion in the right frontal lobe.`);
  });

  it("never claims a report says nothing, and never stages empty text", () => {
    expect(proposalAddsNothing("", "Anything.")).toBe(false);
    expect(proposalAddsNothing("x", "   ")).toBe(false);
    expect(materializeStagedProposals("Keep me.", [proposal("f0", "   \n  ")])).toBe("Keep me.");
  });
});

describe("pendingReportInserts — the study's queue, read off the server's rows", () => {
  it("takes only drafts the clinician sent to the report, in the order given", () => {
    const rows = [
      { id: 12, status: "approved", draftText: "already applied", aiResponse: null },
      { id: 11, status: "inserted", draftText: "queued sentence.", aiResponse: "raw model answer" },
      { id: 10, status: "draft", draftText: "never sent", aiResponse: null },
    ];
    expect(pendingReportInserts(rows)).toEqual([
      { findingKey: "ai-report-draft:11", text: "queued sentence.", draftId: 11 },
    ]);
  });

  it("prefers the radiologist's edited text and falls back to the model's answer", () => {
    const [edited] = pendingReportInserts([
      { id: 3, status: "inserted", draftText: " Edited by the clinician ", aiResponse: "model" },
    ]);
    const [rawOnly] = pendingReportInserts([
      { id: 4, status: "inserted", draftText: null, aiResponse: "model answer" },
    ]);
    expect(edited.text).toBe("Edited by the clinician");
    expect(rawOnly.text).toBe("model answer");
  });

  it("drops a queued row with no text, so an empty draft cannot reach a report", () => {
    expect(pendingReportInserts([{ id: 5, status: "inserted", draftText: "  ", aiResponse: "" }])).toEqual([]);
  });

  it("keys a proposal by the draft row, so re-offering it cannot stack a second copy", () => {
    expect(aiReportInsertKey(41)).toBe("ai-report-draft:41");
    let queue: ReturnType<typeof stageShadowProposal> = [];
    for (const pass of [1, 2, 3]) {
      queue = stageShadowProposal(queue, {
        findingKey: aiReportInsertKey(41),
        text: "One sentence, offered three times.",
        source: "shadow_ai",
        draftId: 41,
        id: `pass-${pass}`,
      });
    }
    expect(queue).toHaveLength(1);
  });
});

