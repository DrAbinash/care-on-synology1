import { describe, expect, it } from "vitest";
import { draftSaveOutcome } from "./draftSaveOutcome";

/**
 * The dirty flag is what re-arms the 30s autosave, so clearing it on a partial
 * save is what turns a recoverable write failure into permanent silent loss.
 * These pin that decision; the server contract behind it is pinned in
 * radiology-report-generator.formatState.test.ts.
 */

describe("draftSaveOutcome", () => {
  it("clears dirty and reports saved on a clean save", () => {
    const outcome = draftSaveOutcome({
      success: true,
      draft: { id: 101 },
      structuredJsonPersistFailed: false,
    });
    expect(outcome).toEqual({ id: 101, clearDirty: true, status: "saved", notice: "saved" });
  });

  it("keeps the study dirty when the envelope failed, but still returns the id", () => {
    const outcome = draftSaveOutcome({
      success: true,
      draft: { id: 101 },
      structuredJsonPersistFailed: true,
    });
    // id survives so the next save updates this row instead of inserting a
    // second draft, and so a partial save never blocks leaving the study —
    // the narrative text did commit.
    expect(outcome.id).toBe(101);
    expect(outcome.clearDirty).toBe(false);
    expect(outcome.status).toBe("error");
    expect(outcome.notice).toBe("partial");
  });

  it("reads the id from either response shape", () => {
    expect(draftSaveOutcome({ draft: { id: 7 } }).id).toBe(7);
    expect(draftSaveOutcome({ id: 9 }).id).toBe(9);
    expect(draftSaveOutcome({ draft: { id: 7 }, id: 9 }).id).toBe(7);
  });

  it("never clears dirty when there is no id to remember", () => {
    expect(draftSaveOutcome({ success: true }).clearDirty).toBe(false);
    expect(draftSaveOutcome(null).clearDirty).toBe(false);
    expect(draftSaveOutcome(undefined).clearDirty).toBe(false);
    expect(draftSaveOutcome({}).id).toBeNull();
  });

  it("treats a missing flag as success, so older responses keep working", () => {
    // The flag is new; a response without it must behave exactly as before.
    expect(draftSaveOutcome({ draft: { id: 3 } }).notice).toBe("saved");
    expect(draftSaveOutcome({ draft: { id: 3 } }).clearDirty).toBe(true);
  });

  it("does not read a falsy-but-present flag as a failure", () => {
    expect(draftSaveOutcome({ draft: { id: 3 }, structuredJsonPersistFailed: false }).clearDirty)
      .toBe(true);
  });
});
