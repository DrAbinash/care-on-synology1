/**
 * leaveSilentFlush.contract.test.ts — wiring contracts for the few-clicks
 * pass 2, leave half (owner's order: FEW CLICKS, easy quick reports).
 *
 * THE COST UNDER GUARD
 *   Leaving a dirty study asked a three-button question on EVERY Next / Prev /
 *   queue click — and dirty is the NORMAL state while drafting, because the
 *   autosave debounces 30 s. One click per study switch, all day, to choose
 *   between three options where only one ("Save & leave") is ever safe by
 *   default: a saved draft loses nothing and is revisable, and the 30 s
 *   autosave would persist the same text anyway.
 *
 *   New culture: silent flush-then-leave. The dialog survives for exactly the
 *   case where saving is IMPOSSIBLE — local edits on a signed study — because
 *   there its Discard is the only honest exit. And the route-away door (sidebar
 *   → worklist, which unmounts the workspace without ever running the leave
 *   gate) now flushes the same silent save instead of dropping the last <30 s
 *   of typing onto the 2 s localStorage backup.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const HOOK = readFileSync(
  resolve(__dirname, "useDraftPersistence.ts"),
  "utf8",
).replace(/\r\n/g, "\n");

const leaveFn = HOOK.indexOf("const requestLeaveThen = useCallback(");

describe("leaving a dirty study flushes silently (few-clicks pass 2)", () => {
  it("the verdict is read first, and blocked stays blocked", () => {
    const verdictIdx = HOOK.indexOf("const verdict = canLeaveStudy({", leaveFn);
    expect(verdictIdx).toBeGreaterThan(leaveFn);
    expect(HOOK.indexOf("if (verdict.kind === \"blocked\") {", verdictIdx)).toBeGreaterThan(verdictIdx);
    expect(HOOK.indexOf("if (verdict.kind === \"ok\") {", verdictIdx)).toBeGreaterThan(verdictIdx);
  });

  it("a dirty DRAFT saves silently and leaves — no prompt, one code path", () => {
    const flushIdx = HOOK.indexOf("const ok = await saveAndConfirmLeave();", leaveFn);
    const navIdx = HOOK.indexOf("navigateFn();", flushIdx);
    const ifNotOk = HOOK.indexOf("if (!ok) return;", flushIdx);
    expect(flushIdx).toBeGreaterThan(leaveFn);
    expect(ifNotOk).toBeGreaterThan(flushIdx);
    expect(navIdx).toBeGreaterThan(ifNotOk);
  });

  it("the three-button dialog survives only where saving is impossible (signed study)", () => {
    const dialogIdx = HOOK.indexOf("if (signedContentLocked) {", leaveFn);
    const dialogCall = HOOK.indexOf("promptDirty: promptDirtyLeave,", dialogIdx);
    expect(dialogIdx).toBeGreaterThan(leaveFn);
    expect(dialogCall).toBeGreaterThan(dialogIdx);
    // And it comes BEFORE the silent-flush branch: the signed case never falls
    // through to a save that cannot work.
    const flushIdx = HOOK.indexOf("const ok = await saveAndConfirmLeave();", leaveFn);
    expect(dialogIdx).toBeLessThan(flushIdx);
  });

  it("a failed flush never navigates away from unsaved text", () => {
    // saveAndConfirmLeave returns false after its own destructive toast; the
    // hook must stop there instead of navigating.
    const flushIdx = HOOK.indexOf("const ok = await saveAndConfirmLeave();", leaveFn);
    const window = HOOK.slice(flushIdx, flushIdx + 220);
    expect(window).toContain("if (!ok) return;");
    expect(window).toContain("navigateFn();");
  });
});

describe("route-away flushes the draft on unmount (few-clicks pass 2)", () => {
  it("an unmount-only effect saves silently when the store is still dirty", () => {
    expect(HOOK).toContain(
      "useEffect(() => () => {\n  if (!useWorkspace.getState().isDirty) return;",
    );
    expect(HOOK).toContain("void saveDraftRef.current({ silent: true })");
  });

  it("a signed study never flushes (its local edits cannot be saved)", () => {
    expect(HOOK).toContain("if (signedContentLockedRef.current) return;");
    expect(HOOK).toContain("signedContentLockedRef.current = signedContentLocked;");
  });

  it("the flush is best-effort: failures log, never throw over unmount", () => {
    expect(HOOK).toContain(".catch((err) => {");
    expect(HOOK).toContain("[draft-flush-on-leave] silent save failed");
  });
});
