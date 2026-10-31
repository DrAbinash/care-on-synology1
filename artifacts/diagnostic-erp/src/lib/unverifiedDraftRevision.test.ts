/**
 * §2B — a console that cannot say WHICH saved version it is editing.
 *
 * THE HOLE
 *   P0-2 gave every draft row a server-derived revision, and `saveDraft` names it
 *   so the route can refuse overwriting a report that moved. But the token is only
 *   ever as good as the read that produced it, and the old rule for a row whose
 *   token this console did not have was "send no `expectedRevision`" — which is not
 *   a guarded save. `decideDraftRevision(expected == null)` answers
 *   `{ proceed: true, guarded: false }`: the write happens, unrefused, whatever
 *   another window wrote in between. So the guard had a bypass built into its own
 *   fallback, and the more uncertain the client was, the less protected the report
 *   was. `radiologyDraftId.ts` returns `{ unverified: true, id }` for that row now,
 *   and the caller refuses.
 *
 * WHAT THIS FILE PINS
 *   1. the refusal names the fact that is actually missing, in the chip and at the
 *      signature — not "changed in another session", which the owner has already
 *      been burned by chasing (the same wrong-reason class as `refused` vs
 *      `conflict` in `humanSaveStatus.ts`);
 *   2. a refusal is still a refusal: it does not read as "Save failed";
 *   3. signing stays stopped while the study is latched, whichever reason latched
 *      it — the click must not become the thing that resolves the uncertainty;
 *   4. a genuinely NEW draft is untouched: no row, no token, ordinary creation.
 *
 * No DOM harness in this package, so the hook side is
 * `useDraftPersistence.behavior.test.ts` (real React, real store, fake transport)
 * and this file stays pure functions.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SIGNING_CONFLICT_MESSAGE,
  SIGNING_UNVERIFIED_REVISION_MESSAGE,
  signingConflictDecision,
} from "./draftSaveOutcome";
import {
  formatHumanSaveStatus,
  saveStatusDotClass,
  type HumanSaveStatusInput,
} from "./humanSaveStatus";
import { draftIdentityForSave, type RadiologyDraftRow } from "./radiologyDraftId";

const NOW = Date.parse("2026-10-31T09:00:00.000Z");
const base: Omit<HumanSaveStatusInput, "autoSaveStatus"> = {
  lastSavedAt: null,
  nowMs: NOW,
  isDirty: true,
  isOnline: true,
  hasOfflineCopy: false,
};
const chip = (autoSaveStatus: HumanSaveStatusInput["autoSaveStatus"]) =>
  formatHumanSaveStatus({ ...base, autoSaveStatus });

describe("the chip says which fact is missing, and never a loss", () => {
  it("is amber and names the unverified revision", () => {
    const s = chip("unverified");
    expect(s?.label).toBe("Not saved — version unverified");
    expect(s?.tone).toBe("amber");
    expect(saveStatusDotClass(s!.tone)).toBe(saveStatusDotClass("amber"));
  });

  it("does not claim a failed save, and does not claim another session", () => {
    const s = chip("unverified");
    expect((s?.label ?? "").toLowerCase()).not.toContain("fail");
    expect(s?.label).not.toMatch(/another (window|session)/i);
    // …and the conflict chip keeps its own distinct words. Two refusals that read
    // identically send the radiologist to the wrong place to fix them.
    expect(chip("conflict")?.label).toBe("Not saved — other window");
    expect(chip("unverified")?.label).not.toBe(chip("conflict")?.label);
  });

  it("is not mistaken for a saved report", () => {
    // A settled save under a dirty editor must not go green over an unverified
    // refusal; and "Saved" must not be what an unverified save says.
    expect(chip("unverified")?.tone).not.toBe("green");
    expect(
      formatHumanSaveStatus({ ...base, autoSaveStatus: "unverified", isDirty: false, lastSavedAt: NOW - 1000 })
        ?.label,
    ).toBe("Not saved — version unverified");
  });

  it("sits below 'Saving…' and above 'Save failed', so a request in flight still wins", () => {
    const src = readSource("humanSaveStatus.ts");
    const saving = src.indexOf('input.autoSaveStatus === "saving"');
    const unverified = src.indexOf('input.autoSaveStatus === "unverified"');
    const error = src.indexOf('input.autoSaveStatus === "error"');
    expect(saving).toBeGreaterThan(-1);
    expect(unverified).toBeGreaterThan(saving);
    expect(unverified).toBeLessThan(error);
  });
});

describe("signing stops at the same gate, in its own words", () => {
  it("refuses an unverified latch without blaming another session", () => {
    const d = signingConflictDecision({
      studyId: 4201,
      conflictLatchedStudyId: 4201,
      latchReason: "unverified",
    });
    expect(d.proceed, "a signing click must not be what spends an unverified revision").toBe(false);
    expect(d.message).toBe(SIGNING_UNVERIFIED_REVISION_MESSAGE);
    expect(d.message).not.toMatch(/another (window|session)/i);
    expect(d.message).not.toMatch(/failed|error/i);
  });

  it("keeps the dictated conflict sentence for a conflict", () => {
    const d = signingConflictDecision({
      studyId: 4201,
      conflictLatchedStudyId: 4201,
      latchReason: "conflict",
    });
    expect(d.message).toBe(SIGNING_CONFLICT_MESSAGE);
  });

  it("treats a latch with no stated reason as the conflict it always was", () => {
    // The reason travelled with the latch only in §2B. A caller that has not
    // adopted it yet must not end up able to sign over a latched study.
    const d = signingConflictDecision({ studyId: 4201, conflictLatchedStudyId: 4201 });
    expect(d.proceed).toBe(false);
    expect(d.message).toBe(SIGNING_CONFLICT_MESSAGE);
  });
});

describe("the identity decision keeps new drafts on the ordinary path", () => {
  it("a study with no row and no token is a creation, not a refusal", () => {
    expect(draftIdentityForSave({
      proven: null, existingDraft: null, draftReadSucceeded: true,
    })).toEqual({ unverified: false, id: undefined, expectedRevision: "absent" });
  });

  it("a row this console proved for itself carries its own token", () => {
    const row: Pick<RadiologyDraftRow, "id" | "revision"> = {
      id: 7, revision: `dr1:${"9".repeat(32)}`,
    };
    expect(draftIdentityForSave({
      proven: null, existingDraft: row, draftReadSucceeded: false,
    })).toEqual({ unverified: false, id: 7, expectedRevision: row.revision });
  });
});

/** Read the shipped source without a second import path — see the ordering pin. */
function readSource(name: string): string {
  return readFileSync(new URL(`./${name}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
}
