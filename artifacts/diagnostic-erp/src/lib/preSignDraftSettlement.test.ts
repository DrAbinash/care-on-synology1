/**
 * preSignDraftSettlement.test.ts — P1-5: the Impression Refresh and the
 * Confirm & Sign must validate the SAME revision of the report.
 *
 * THE BUG CLASS UNDER GUARD
 *   The sign dialog's "Refresh Impression now" and the gate that runs after the
 *   dialog closes both read one authority: the workspace store. Step 6b of the
 *   gauntlet then re-saves the refreshed report, and step 7 builds the signed
 *   payload from that same store. What 6b never did was read the answer.
 *
 *   `saveDraft` answers `null` when the server did not accept this editor's
 *   revision — the P0-2 refusal (another console moved the row), offline, a
 *   signed row, a transport error — and an id whose ack no longer covers the
 *   newest text when the store moved while the request was in flight. In both
 *   cases step 7 signed anyway, so the artifact that went to the PDF, the
 *   WhatsApp link and the PACS archive was a revision the server never held, and
 *   the draft row was a different one. With TOAST_LIMIT at 1 the "Report
 *   finalized & signed" toast then evicted the save's own explanation, so the
 *   radiologist was told the report was signed and never told it had not saved.
 *
 *   This is the one place P0-2's protection was swallowed: the second console's
 *   refusal is loud everywhere except immediately before a signature.
 *
 * WHAT MUST NOT CHANGE
 *   A PARTIAL save (narrative committed, structured_json did not) still returns
 *   an id and must still sign. draftSaveOutcome.ts already rules that blocking
 *   navigation over a partial save strands the radiologist on a study that is in
 *   fact saved; blocking a SIGNATURE over measurements that did not persist
 *   would be the same mistake with a worse outcome, and the signed narrative is
 *   on the server either way. Test 4 pins that.
 *
 * WHY A PURE PREDICATE PLUS A SOURCE CONTRACT
 *   Same reason as draftSaveOutcome.ts and finalizeDialogResult.contract.test.ts:
 *   this package has no DOM harness, so the hook cannot be executed. The
 *   decision is extracted so it can be run over the real outcome matrix, and the
 *   wire is pinned mechanically. Test 6 is the positive control — without it a
 *   broken reader would slice an empty string and every needle below would pass
 *   vacuously.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  clinicalTextsPersistedAck,
  draftSaveOutcome,
  preSignNarrativeSettled,
  type ClinicalTextsAtSave,
} from "./draftSaveOutcome";

const here = dirname(fileURLToPath(import.meta.url));
/** Line endings are normalised because this repo is checked out with
 *  core.autocrlf=true on the Windows dev box (CRLF in the working tree) and LF
 *  in CI. Without this a multi-line needle passes on one and fails on the other. */
const read = (rel: string): string => readFileSync(join(here, rel), "utf8").replace(/\r\n/g, "\n");

const finalizeHook = read("../hooks/radiology-workspace/useStudyFinalize.ts");

/** The five narrative fields one save-draft request carries. Synthetic text:
 *  no real report, no real patient, nothing read from a server. */
const TEXTS = (over: Partial<ClinicalTextsAtSave> = {}): ClinicalTextsAtSave => ({
  clinicalHistoryText: "Synthetic history: two weeks of mechanical low back pain.",
  techniqueText: "Synthetic technique: MRI lumbar spine without contrast.",
  findingsText: "L4-L5: A broad-based disc bulge is present.",
  impressionText: "L4-L5 disc bulge without neural compression.",
  recommendationText: "Please correlate with clinical findings.",
  ...over,
});

/** Everything after the dialog resolves — the gauntlet's signing half. */
const afterConfirm = (): string => {
  const at = finalizeHook.indexOf("if (!result.confirmed) return;");
  return at < 0 ? "" : finalizeHook.slice(at);
};

describe("the re-save's own answer decides whether a signature may be built", () => {
  it("settles on a clean re-save: what is signed is what was persisted", () => {
    const sent = TEXTS();
    expect(
      preSignNarrativeSettled({
        savedDraftId: draftSaveOutcome({ success: true, draft: { id: 4201 } }).id,
        sent,
        liveNow: TEXTS(),
      }),
    ).toBe(true);
  });

  it("does not settle when the server refused the revision, even though the text never moved", () => {
    // The P0-2 conflict, offline, a signed row and a transport error all reach
    // the caller the same way: `null`. Nothing was written, so the store and the
    // row are two different revisions of one study.
    const sent = TEXTS();
    expect(draftSaveOutcome(null).id).toBeNull();
    expect(
      preSignNarrativeSettled({ savedDraftId: draftSaveOutcome(null).id, sent, liveNow: TEXTS() }),
    ).toBe(false);
    // Control: the identical texts WITH an id settle. The id is what decides
    // this case, not the text comparison — without this the assertion above
    // would also pass on a predicate that only ever compares text.
    expect(
      preSignNarrativeSettled({ savedDraftId: 4201, sent, liveNow: TEXTS() }),
    ).toBe(true);
  });

  it("does not settle when the store moved while the request was in flight", () => {
    // The Impression the radiologist refreshed in the dialog was saved; the
    // derived-impression effect rewrote it again before the ack landed. The
    // signed payload would carry a sentence no save ever carried.
    const sent = TEXTS();
    const moved = TEXTS({ impressionText: "L4-L5 disc bulge. L5-S1 annular tear." });
    expect(clinicalTextsPersistedAck(sent, moved)).toBe(false);
    expect(
      preSignNarrativeSettled({ savedDraftId: 4201, sent, liveNow: moved }),
    ).toBe(false);
  });

  it("still settles on a partial save — a signature is not blocked over measurements", () => {
    // draftSaveOutcome keeps the id on a partial save on purpose: the narrative
    // committed. The signed body is built from the narrative, so it is on the
    // server, and refusing here would strand a report that is in fact saved.
    const partial = draftSaveOutcome({
      success: true,
      draft: { id: 4202 },
      structuredJsonPersistFailed: true,
    });
    expect(partial.id).toBe(4202);
    expect(partial.clearDirty).toBe(false);
    expect(
      preSignNarrativeSettled({ savedDraftId: partial.id, sent: TEXTS(), liveNow: TEXTS() }),
    ).toBe(true);
  });

  it("one field of difference is one field unsaved — all five are compared", () => {
    const sent = TEXTS();
    const eachChanged: Array<ClinicalTextsAtSave> = [
      TEXTS({ clinicalHistoryText: `${sent.clinicalHistoryText} No fever.` }),
      TEXTS({ techniqueText: `${sent.techniqueText} Sagittal T2 only.` }),
      TEXTS({ findingsText: `${sent.findingsText} No marrow signal change.` }),
      TEXTS({ impressionText: `${sent.impressionText} No acute infarction.` }),
      TEXTS({ recommendationText: `${sent.recommendationText} Review in six weeks.` }),
    ];
    expect(eachChanged).toHaveLength(5);
    for (const liveNow of eachChanged) {
      expect(preSignNarrativeSettled({ savedDraftId: 4203, sent, liveNow })).toBe(false);
    }
    // Control: a byte-identical copy settles, so the five refusals above are the
    // comparison working and not a predicate that always says no.
    expect(preSignNarrativeSettled({ savedDraftId: 4203, sent, liveNow: TEXTS() })).toBe(true);
  });
});

describe("the gauntlet asks the re-save before it builds the signed payload", () => {
  it("positive control: the reader really sliced the signing half of the gauntlet", () => {
    const slice = afterConfirm();
    expect(slice.length).toBeGreaterThan(2000);
    expect(slice).toContain("isFinalizeStudyIdentityIntact");
    expect(slice).toContain("const signed = useWorkspace.getState();");
    expect(slice).toContain("saveDraft({ silent: true })");
  });

  it("reads the re-save's answer instead of discarding it", () => {
    const slice = afterConfirm();
    expect(slice).toMatch(/const resavedDraftId = await saveDraft\(\{ silent: true \}\);/);
    // The old wiring — a bare await whose value nothing consumed.
    expect(slice).not.toMatch(/^\s*await saveDraft\(\{ silent: true \}\);\s*$/m);
  });

  it("compares the narrative across the re-save, on both sides of the request", () => {
    const slice = afterConfirm();
    expect(slice).toContain("preSignNarrativeSettled({");
    expect(slice).toMatch(/sent: narrativeBeforeResave,/);
    expect(slice).toMatch(/liveNow: readWorkspaceClinicalTexts\(\),/);
    // The id handed to the predicate must be the one the save resolved to, with
    // no coalescing: `?? 1` would turn a refusal into a settled save, and a
    // literal would settle every report that never saved at all.
    expect(slice).toMatch(/savedDraftId: resavedDraftId,/);
    expect(slice).not.toMatch(/resavedDraftId \?\?/);
    expect(slice).not.toMatch(/savedDraftId: \d/);
    // Both reads must be on the far side of the dialog and the near side of the
    // payload: a snapshot taken before the dialog would compare the wrong pair.
    const before = slice.indexOf("narrativeBeforeResave = readWorkspaceClinicalTexts()");
    expect(before).toBeGreaterThan(0);
    expect(before).toBeLessThan(slice.indexOf("preSignNarrativeSettled({"));
    expect(slice.indexOf("preSignNarrativeSettled({")).toBeLessThan(
      slice.indexOf("const signed = useWorkspace.getState();"),
    );
  });

  it("stops before the signed payload is assembled, and says nothing was signed", () => {
    const slice = afterConfirm();
    const guardAt = slice.indexOf("if (!preSignNarrativeSettled({");
    expect(guardAt).toBeGreaterThan(0);
    const signedAt = slice.indexOf("const signed = useWorkspace.getState();");
    expect(guardAt).toBeLessThan(signedAt);
    // The refusal arm, sliced to the payload read, must close the gauntlet.
    const arm = slice.slice(guardAt, signedAt);
    expect(arm).toContain("return;");
    expect(arm).toContain('variant: "destructive"');
    expect(arm).toContain("Not signed");
    // #862 — a refusal is not a failure. "Save failed" reports a loss that did
    // not happen and evicts the sentence that explains it.
    expect(arm).not.toContain("Save failed");
    // The remedy the message names has to be a real control: the top bar's Save
    // button calls saveDraft directly and is not silent, so its own answer is
    // the one the radiologist reads.
    expect(arm).toContain("top bar");
  });

  it("adds a gate; it does not move or weaken the ones already there", () => {
    const slice = afterConfirm();
    const identityAt = slice.indexOf("isFinalizeStudyIdentityIntact");
    const dependencyAt = slice.indexOf("useWorkspace.getState().impressionNeedsRefresh");
    const guardAt = slice.indexOf("if (!preSignNarrativeSettled({");
    // A-01 identity → 6a live dependency → 6b settlement → 7 payload. Each one
    // still refuses on its own terms; the new gate is last, not instead.
    expect(identityAt).toBeGreaterThan(0);
    expect(identityAt).toBeLessThan(dependencyAt);
    expect(dependencyAt).toBeLessThan(guardAt);
    expect(slice).toMatch(/if \(useWorkspace\.getState\(\)\.impressionNeedsRefresh && !result\.impressionReviewedAnyway\) \{/);
    expect(slice).toContain("impressionReviewedAnyway");
    // The dialog's own gate still clears only on a refresh that happened.
    const signDialog = read("../components/radiology/FinalizeSignDialog.tsx");
    expect(signDialog).toMatch(/const outcome = useWorkspace\.getState\(\)\.refreshImpressionFromLedger\(\);/);
    expect(signDialog).toMatch(/if \(outcome === undefined\) setImpressionRefreshed\(true\);/);
  });

  it("only settles a report it actually re-saved", () => {
    // A clean store needs no re-save and must not be refused for want of one:
    // step 1 already persisted it, and `isDirty` false is that acknowledgement.
    const slice = afterConfirm();
    expect(slice).toMatch(/if \(useWorkspace\.getState\(\)\.isDirty\) \{\s*const narrativeBeforeResave = readWorkspaceClinicalTexts\(\);/);
  });
});
