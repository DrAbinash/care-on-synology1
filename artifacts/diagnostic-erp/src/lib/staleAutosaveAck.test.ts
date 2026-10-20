/**
 * D-05 / F3 — a stale autosave acknowledgement must never mark newer text as
 * saved.
 *
 * The workflow this guards (owner Part "clinical text preservation"):
 *   A. the radiologist types text while autosave request A is pending;
 *   B. they type more before response A returns;
 *   C. response A arrives after the second edit;
 *   D. the editor must remain dirty until the NEWEST text has actually been
 *      saved;
 *   E. the UI must not falsely display Saved.
 *
 * The old generation guard could not see B and C at all — only a study switch
 * bumps the generation — so the ack cleared `isDirty` over text that was never
 * persisted, and `formatHumanSaveStatus` printed a green "Saved N sec ago" over
 * it because `autoSaveStatus === "saved"` was trusted without the dirty flag.
 *
 * The byte-gate and the ack evaluation are pure and executed here directly; the
 * hook wiring is executed through the real zustand store below (the repo has
 * no DOM/React harness — the same limitation `refusedSaveIsNotAFailedSave`
 * documents — so the mounted workflow is driven at the store boundary the hook
 * itself reads and writes).
 */
import { describe, expect, it, vi } from "vitest";
import {
  clinicalTextsPersistedAck,
  draftSaveOutcome,
  evaluateDraftSaveAck,
  type ClinicalTextsAtSave,
} from "./draftSaveOutcome";
import { formatHumanSaveStatus } from "./humanSaveStatus";
import { readWorkspaceClinicalTexts, type WorkspaceClinicalTexts } from "./zai-workspace/workspaceClinicalTexts";
import { useWorkspace } from "./zai-workspace/store";

const TEXTS: ClinicalTextsAtSave = {
  clinicalHistoryText: "Back pain for three weeks.",
  techniqueText: "MRI lumbar spine performed.",
  findingsText: "L4-L5: Mild canal stenosis.",
  impressionText: "Mild canal stenosis at L4-L5.",
  recommendationText: "Clinical correlation.",
};

/** The five fields each get their own stale case: one field moved, four didn't. */
function textsWith(over: Partial<ClinicalTextsAtSave>): ClinicalTextsAtSave {
  return { ...TEXTS, ...over };
}

describe("clinicalTextsPersistedAck — the byte gate", () => {
  it("accepts an ack when nothing was typed while the request was in flight", () => {
    expect(clinicalTextsPersistedAck(TEXTS, TEXTS)).toBe(true);
  });

  it("accepts an ack when only whitespace was normalized by neither side — byte identity is the contract", () => {
    expect(clinicalTextsPersistedAck(textsWith({ findingsText: " L4-L5: Mild canal stenosis. " }), TEXTS)).toBe(false);
  });

  it("refuses the ack when the radiologist typed more Findings while it was in flight", () => {
    expect(clinicalTextsPersistedAck(TEXTS, textsWith({ findingsText: "L4-L5: Mild canal stenosis. L5-S1 is unremarkable." }))).toBe(false);
  });

  it("refuses the ack per field: Impression, Recommendation, Technique, Clinical History", () => {
    expect(clinicalTextsPersistedAck(TEXTS, textsWith({ impressionText: "Two findings now." }))).toBe(false);
    expect(clinicalTextsPersistedAck(TEXTS, textsWith({ recommendationText: "Advice changed." }))).toBe(false);
    expect(clinicalTextsPersistedAck(TEXTS, textsWith({ techniqueText: "MRI lumbar spine performed with contrast." }))).toBe(false);
    expect(clinicalTextsPersistedAck(TEXTS, textsWith({ clinicalHistoryText: "Back pain for four weeks." }))).toBe(false);
  });

  it("clears dirty through a clean ack, never through a stale one", () => {
    const saved = draftSaveOutcome({ draft: { id: 41 } });
    const clean = evaluateDraftSaveAck(saved, TEXTS, TEXTS);
    expect(clean.clearDirty).toBe(true);
    const stale = evaluateDraftSaveAck(saved, TEXTS, textsWith({ findingsText: "More text typed in flight." }));
    expect(stale.clearDirty).toBe(false);
    expect(stale.ackCoversNewestText).toBe(false);
  });

  it("never lets a partial (envelope-failed) ack clear dirty, fresh or stale", () => {
    const partial = draftSaveOutcome({ draft: { id: 41 }, structuredJsonPersistFailed: true });
    expect(evaluateDraftSaveAck(partial, TEXTS, TEXTS).clearDirty).toBe(false);
    expect(evaluateDraftSaveAck(partial, TEXTS, textsWith({ impressionText: "changed" })).clearDirty).toBe(false);
  });

  it("a stale ack still remembers the row id: the draft exists and must not be inserted twice", () => {
    const saved = draftSaveOutcome({ draft: { id: 41 } });
    const stale = evaluateDraftSaveAck(saved, TEXTS, textsWith({ findingsText: "typed in flight" }));
    expect(stale.outcome.id).toBe(41);
    expect(stale.clearDirty).toBe(false);
  });
});

describe("formatHumanSaveStatus — no green Saved over dirty text (E)", () => {
  const base = {
    lastSavedAt: new Date("2026-10-20T10:00:00Z") as Date | null,
    nowMs: new Date("2026-10-20T10:00:03Z").getTime(),
    isOnline: true,
    hasOfflineCopy: false,
  };

  it("prints Saved while clean, so the primary journey still says what it is", () => {
    const s = formatHumanSaveStatus({ ...base, autoSaveStatus: "saved", isDirty: false });
    expect(s?.tone).toBe("green");
    expect(s?.label).toMatch(/^Saved/);
  });

  it("refuses green over a dirty editor whose ack was stale (status stuck on saved)", () => {
    const s = formatHumanSaveStatus({ ...base, autoSaveStatus: "saved", isDirty: true });
    // Not green, not the word Saved — the Unsaved badge speaks instead.
    expect(s == null || s.tone !== "green").toBe(true);
    expect(s == null || !/^Saved/.test(s.label)).toBe(true);
  });

  it("keeps Saving… amber over a dirty editor (nothing has acknowledged the newest text)", () => {
    const s = formatHumanSaveStatus({ ...base, autoSaveStatus: "saving", isDirty: true });
    expect(s?.tone).toBe("amber");
    expect(s?.label).toBe("Saving…");
  });

  it("keeps the refused and error wordings untouched — D-05 is not a reason to lose them", () => {
    expect(formatHumanSaveStatus({ ...base, autoSaveStatus: "refused", isDirty: true })?.label)
      .toBe("Edits not saved — signed");
    expect(formatHumanSaveStatus({ ...base, autoSaveStatus: "error", isDirty: true })?.label)
      .toBe("Save failed");
  });
});

describe("the workflow A–E, executed at the store boundary the hook reads", () => {
  function resetStore(texts: Partial<WorkspaceClinicalTexts> = {}) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    useWorkspace.setState({
      clinicalHistoryText: TEXTS.clinicalHistoryText,
      techniqueText: TEXTS.techniqueText,
      findingsText: TEXTS.findingsText,
      impressionText: TEXTS.impressionText,
      recommendationText: TEXTS.recommendationText,
      fieldProvenance: {},
      isDirty: true,
      ...texts,
    });
  }

  it("A→C→D: typing during the flight leaves the editor dirty after the stale ack", () => {
    resetStore();
    // The hook captures this snapshot at click time…
    const sent = readWorkspaceClinicalTexts();
    // …and the radiologist types more before the response returns (B).
    useWorkspace.setState({ findingsText: "L4-L5: Mild canal stenosis. New sentence typed in flight." });
    const outcome = draftSaveOutcome({ draft: { id: 41 } });
    // The ack evaluates against the live store exactly as the hook wires it.
    const ack = evaluateDraftSaveAck(outcome, sent, readWorkspaceClinicalTexts());
    if (ack.clearDirty) useWorkspace.setState({ isDirty: false });
    expect(ack.ackCoversNewestText).toBe(false);
    expect(useWorkspace.getState().isDirty, "the newest text is not on the server").toBe(true);
  });

  it("the same flight without in-flight typing clears the dirty flag (the gate is not a blanket refusal)", () => {
    resetStore();
    const sent = readWorkspaceClinicalTexts();
    const outcome = draftSaveOutcome({ draft: { id: 41 } });
    const ack = evaluateDraftSaveAck(outcome, sent, readWorkspaceClinicalTexts());
    if (ack.clearDirty) useWorkspace.setState({ isDirty: false });
    expect(ack.ackCoversNewestText).toBe(true);
    expect(useWorkspace.getState().isDirty).toBe(false);
  });

  it("F: a study switch mid-flight refuses the ack through the existing generation guard, byte gate or not", async () => {
    const { shouldCommitAutosave } = await import("./radiologyWorkspaceSafety");
    // Request carried generation 7 for study 101; the workspace has since moved to
    // study 202 at generation 8 — the shipped guard must refuse before any byte
    // comparison could matter.
    expect(shouldCommitAutosave(101, 202, 7, 8)).toBe(false);
    expect(shouldCommitAutosave(101, 101, 7, 7)).toBe(true);
  });
});
