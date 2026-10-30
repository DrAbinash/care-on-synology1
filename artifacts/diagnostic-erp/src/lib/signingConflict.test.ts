/**
 * signingConflict.test.ts — P0-2, second pass: a signature may not be the thing
 * that resolves a save conflict.
 *
 * THE DEFECT, MEASURED IN THE TREE AT `8da2bb6a` (PR #1242)
 *   The conflict latch `useDraftPersistence` installs on an HTTP 409 blocks saves
 *   that carry `opts?.silent === true`. The first step of the Confirm & Sign
 *   gauntlet is
 *
 *       if (useWorkspace.getState().isDirty) {
 *         const savedId = await saveDraft();     // no options at all
 *         if (savedId) effectiveDraftId = savedId;
 *       }
 *
 *   — a NON-silent save. So on a study whose conflict the radiologist has not
 *   decided yet, clicking Confirm & Sign performs the very write the latch exists
 *   to withhold: the client's re-read after the refusal has already handed it the
 *   other session's revision, that revision matches, the save succeeds, the latch
 *   clears, and the signature is built. Nothing asked. `grep -c conflict
 *   useStudyFinalize.ts` is 0 — the signing path has never heard of the state.
 *
 *   The write is not a lost update (the server's CAS still ran), which is exactly
 *   why it matters: it is *silent in the interface*. The radiologist pressed
 *   "Confirm & Sign" believing they were signing text they had just reviewed, and
 *   the app used that click to decide a conflict they were never shown. Owner's
 *   requirement 5 is "never allow … to resolve a conflict automatically", and
 *   requirement B is "if there is an unresolved conflict, stop signing".
 *
 * WHAT THIS FILE PINS
 *   1. the decision, as a pure predicate over the real states — including that a
 *      study with NO conflict signs normally, and that a conflict on a DIFFERENT
 *      study must not freeze this one;
 *   2. the one sentence the owner dictated, byte for byte, and only once;
 *   3. the wire: the gauntlet must ask that predicate BEFORE it saves, and must
 *      write nothing and sign nothing when it refuses.
 *
 * No DOM harness exists in this package, so 3 is a source contract in the
 * established style (`finalizeDialogResult.contract.test.ts`,
 * `preSignDraftSettlement.test.ts`). Test 6 is its positive control: a reader
 * that sliced an empty string would otherwise pass every needle below.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SIGNING_CONFLICT_MESSAGE,
  signingConflictDecision,
} from "./draftSaveOutcome";

const HOOK = readFileSync(
  new URL("../hooks/radiology-workspace/useStudyFinalize.ts", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");

/**
 * The whole signing path: the finalize callback's entry, through its synchronous
 * guards, up to the point it starts writing. The guards live before
 * `startFinalize()` by this file's own documented convention — "it refuses the
 * click without ever arming the finalization lifecycle" — so a conflict refusal
 * belongs there too, and the slice has to be wide enough to see both.
 */
function signingPath(src: string): string {
  const start = src.indexOf("const templateIncompatibility = ");
  const arm = src.indexOf("useWorkspace.getState().startFinalize()");
  expect(start, "the synchronous guard region must still be readable").toBeGreaterThan(0);
  expect(arm, "the gauntlet must still arm the finalization lifecycle").toBeGreaterThan(start);
  const end = src.indexOf("// 2. Validate", arm);
  expect(end, "the gauntlet must still validate after saving").toBeGreaterThan(arm);
  return src.slice(start, end);
}

describe("the decision — a conflict that has not been decided stops a signature", () => {
  it("signs when this study has no unresolved conflict", () => {
    expect(signingConflictDecision({ studyId: 4201, conflictLatchedStudyId: null })).toEqual({
      proceed: true,
    });
  });

  it("refuses, and says the one sentence the owner dictated, when this study is latched", () => {
    const d = signingConflictDecision({ studyId: 4201, conflictLatchedStudyId: 4201 });
    expect(d.proceed, "a signing click must not be the thing that resolves a conflict").toBe(false);
    expect(d.message).toBe(SIGNING_CONFLICT_MESSAGE);
    expect(SIGNING_CONFLICT_MESSAGE).toBe(
      "This report was changed in another session. Your current text is preserved. Review before saving again.",
    );
  });

  it("does not freeze an unrelated study — the latch is per-study", () => {
    expect(
      signingConflictDecision({ studyId: 4201, conflictLatchedStudyId: 9999 }).proceed,
    ).toBe(true);
  });

  it("refuses when the study identity is unknown but a conflict is latched", () => {
    // Worst case is signing over a conflict we cannot attribute, so an unknown
    // key errs toward refusing. The radiologist loses one click, not a report.
    const d = signingConflictDecision({ studyId: null, conflictLatchedStudyId: 4201 });
    expect(d.proceed).toBe(false);
  });

  it("carries no second message — one refusal, one sentence", () => {
    const d = signingConflictDecision({ studyId: 4201, conflictLatchedStudyId: 4201 });
    expect((d.message ?? "").split(" — ").length, "no stacked clauses").toBe(1);
    expect(d.message).not.toMatch(/failed|error/i);
  });
});

describe("the wire — the gauntlet asks before it writes", () => {
  it("positive control: the reader really sliced the signing path", () => {
    const slice = signingPath(HOOK);
    expect(slice.length).toBeGreaterThan(200);
    expect(slice).toContain("if (useWorkspace.getState().isDirty)");
  });

  it("consults the conflict decision before the pre-sign save", () => {
    const slice = signingPath(HOOK);
    const decision = slice.indexOf("signingConflictDecision(");
    const save = slice.indexOf("await saveDraft(");
    const arm = slice.indexOf("startFinalize()");
    expect(decision, "the signing path never asks about an unresolved conflict").toBeGreaterThan(-1);
    expect(save).toBeGreaterThan(-1);
    expect(decision, "asking AFTER the save is asking too late").toBeLessThan(save);
    expect(decision, "a conflict refusal belongs with the synchronous guards, before the lifecycle is armed")
      .toBeLessThan(arm);
  });

  it("writes nothing, signs nothing, and says why in the one sentence", () => {
    const slice = signingPath(HOOK);
    const refusal = slice.slice(slice.indexOf("signingConflictDecision("), slice.indexOf("startFinalize()"));
    expect(refusal).toMatch(/return;/);
    expect(refusal, "the refusal must carry the dictated sentence, not a paraphrase")
      .toMatch(/conflictGate\.message|SIGNING_CONFLICT_MESSAGE/);
    expect(refusal).toMatch(/toast\(/);
  });

  it("the latch is read, not re-derived — no second conflict state invented here", () => {
    expect(HOOK).toMatch(/conflictLatched|hasUnresolvedSaveConflict/);
    expect(HOOK.match(/signingConflictDecision\(/g) ?? []).toHaveLength(1);
  });
});
