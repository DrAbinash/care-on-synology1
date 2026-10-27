import { describe, expect, it } from "vitest";
import {
  aiReportInsertKey,
  pendingReportInserts,
  shouldInsertOnAction,
  shouldStageOnAction,
  unfitReportInserts,
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

/**
 * The reader's half of the same rule the send door enforces. A draft stamped
 * `inserted` before the door checked text shape is still sitting in the study's
 * history, and Apply takes whatever it is given — so the queue has to refuse it, and
 * refuse it out loud rather than leave a draft that appears queued and never arrives.
 */
describe("pendingReportInserts / unfitReportInserts — chat never reaches the queue", () => {
  const CHAT =
    "Here is a draft report based on the information provided:\n"
    + "- No acute intracranial abnormality.\n"
    + "**Impression:** Normal MRI of the brain.";
  const PROSE = "No acute intracranial abnormality. The ventricles are normal in size.";

  const rows = [
    { id: 21, status: "inserted", draftText: PROSE, aiResponse: null },
    { id: 22, status: "inserted", draftText: CHAT, aiResponse: CHAT },
    { id: 23, status: "inserted", draftText: '{"impression": "Normal"}', aiResponse: null },
    // Not sent yet, so not this rule's business: it is a draft, not a queued row.
    { id: 24, status: "draft", draftText: CHAT, aiResponse: null },
  ];

  it("offers only the prose and reports each withheld row with the shape that caused it", () => {
    expect(pendingReportInserts(rows)).toEqual([
      { findingKey: "ai-report-draft:21", text: PROSE, draftId: 21 },
    ]);
    const withheld = unfitReportInserts(rows);
    expect(withheld.map((w) => w.draftId)).toEqual([22, 23]);
    expect(withheld[0].defects.map((d) => d.kind)).toEqual(
      expect.arrayContaining(["conversational", "markdown"]),
    );
    expect(withheld[1].defects.map((d) => d.kind)).toContain("structured");
  });

  it("takes the draft back once the clinician has cleaned it up", () => {
    // The correction path, read from the other side: this rule is about the text, not a
    // verdict on the draft, so the same row id becomes offerable the moment it holds
    // prose. Nothing here can decide that for them by editing their draft.
    const fixed = [{ id: 22, status: "inserted", draftText: "Normal MRI of the brain.", aiResponse: CHAT }];
    expect(pendingReportInserts(fixed)).toEqual([
      { findingKey: "ai-report-draft:22", text: "Normal MRI of the brain.", draftId: 22 },
    ]);
    expect(unfitReportInserts(fixed)).toEqual([]);
  });
});

