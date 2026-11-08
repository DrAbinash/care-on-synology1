/**
 * B12 — applying a snippet macro is one undo step of its own.
 *
 * `applyMacroWithValues` wrote the expanded text directly into the field
 * without `withPushedClinicalUndo`, so the clinical undo stack never held a
 * frame from before the macro. Ctrl+Z after applying a macro therefore reverted
 * the macro TOGETHER WITH everything typed since (the next frame on the stack
 * was captured after the macro was already in the text), and a macro applied as
 * the very last action could not be undone at all.
 *
 * Every other clinical writer snapshots + pushes through
 * `withPushedClinicalUndo` (store.ts toggleClinicalHistoryContribution and the
 * setField path are the reference implementations); this pins the same contract
 * for macro expansion: one apply = one frame, and Undo steps back through it
 * exactly as it does through every other clinical write.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { useWorkspace } from "@/lib/zai-workspace/store";
import { emptyClinicalState } from "@/lib/zai-workspace/clinicalStateReset";
import type { SnippetMacro } from "@/lib/zai-workspace/types";

function macro(template: string): SnippetMacro {
  return {
    id: "macro-test",
    trigger: "nl",
    label: "No lesion",
    template,
    variables: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/** Arm the popover exactly the way detectMacroTrigger does: at the trigger token. */
function armAtTrigger(text: string, template = "No focal lesion.") {
  const withTrigger = `${text}:nl`;
  useWorkspace.setState({ findingsText: withTrigger } as never);
  useWorkspace
    .getState()
    .setActiveMacroPrompt({ macro: macro(template), field: "findings", startPos: text.length });
}

beforeEach(() => {
  // The production reset, not a hand-listed one (same rule as
  // finalizedMutationBoundary.hardening.test.ts: a hand-listed reset leaks).
  useWorkspace.setState({
    ...emptyClinicalState(),
  } as never);
});

describe("applyMacroWithValues pushes a clinical undo frame", () => {
  it("an apply is one undo step and reverts exactly the macro", async () => {
    armAtTrigger("Baseline findings sentence. ");
    const before = useWorkspace.getState();
    const undoDepthBefore = before.patchUndoStack.length;
    const textBefore = before.findingsText;

    useWorkspace.getState().applyMacroWithValues({});
    const applied = useWorkspace.getState();
    expect(applied.findingsText, "the expansion replaced the trigger token").toContain("No focal lesion.");
    expect(applied.patchUndoStack.length, "the apply pushed exactly one frame").toBe(undoDepthBefore + 1);

    const undone = useWorkspace.getState().undoLastPatch();
    expect(undone, "there was a frame to step back to").toBe(true);
    expect(useWorkspace.getState().findingsText, "undo restored the pre-macro text verbatim").toBe(textBefore);
    expect(useWorkspace.getState().patchUndoStack.length).toBe(undoDepthBefore);
  });

  it("Ctrl+Z after typing on top of a macro steps back the macro apply as one unit", () => {
    // The user-visible defect: the macro had no frame of its own, so Ctrl+Z
    // popped whatever OLDER frame sat on the stack — reverting the macro, the
    // typing, and everything back to that older write — or found nothing at all
    // and refused to undo the macro entirely.
    armAtTrigger("A. ");
    useWorkspace.getState().applyMacroWithValues({});
    const withMacro = useWorkspace.getState().findingsText;
    expect(withMacro).toContain("No focal lesion.");
    expect(useWorkspace.getState().patchUndoStack.length, "the apply owns one frame").toBe(1);

    // Typing after the apply takes no store frame by design (setField's own
    // contract: the editor's native history owns typing), so the macro's frame
    // is what Ctrl+Z steps back through — the macro and the typing since, as
    // one unit, exactly like a Quick Select tile.
    useWorkspace.getState().setField("findings", `${withMacro}Typed after.`, { source: "manual" });
    expect(useWorkspace.getState().patchUndoStack.length, "typing owns no store frame").toBe(1);

    const first = useWorkspace.getState().undoLastPatch();
    expect(first, "the macro apply is the undo unit").toBe(true);
    expect(useWorkspace.getState().findingsText, "undo lands on the pre-macro state").toBe("A. :nl");

    const second = useWorkspace.getState().undoLastPatch();
    expect(second, "nothing older to pop — the macro was the first structured write").toBe(false);
    expect(useWorkspace.getState().findingsText).toBe("A. :nl");
  });
});
