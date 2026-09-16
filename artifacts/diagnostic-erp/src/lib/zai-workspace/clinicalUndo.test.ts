import { describe, expect, it } from "vitest";
import {
  CLINICAL_UNDO_DEPTH,
  pushClinicalUndoSnapshot,
  popClinicalUndoSnapshot,
  topClinicalUndoSnapshot,
} from "./clinicalUndo";

describe("clinicalUndo bounded stack", () => {
  it("pushes and pops in LIFO order", () => {
    let stack: string[] = [];
    stack = pushClinicalUndoSnapshot(stack, "A");
    stack = pushClinicalUndoSnapshot(stack, "B");
    stack = pushClinicalUndoSnapshot(stack, "C");
    expect(topClinicalUndoSnapshot(stack)).toBe("C");
    const c = popClinicalUndoSnapshot(stack)!;
    expect(c.snapshot).toBe("C");
    const b = popClinicalUndoSnapshot(c.remaining)!;
    expect(b.snapshot).toBe("B");
    const a = popClinicalUndoSnapshot(b.remaining)!;
    expect(a.snapshot).toBe("A");
    expect(popClinicalUndoSnapshot(a.remaining)).toBeNull();
  });

  it("drops oldest when exceeding depth", () => {
    let stack: number[] = [];
    for (let i = 1; i <= CLINICAL_UNDO_DEPTH + 2; i++) {
      stack = pushClinicalUndoSnapshot(stack, i);
    }
    expect(stack).toHaveLength(CLINICAL_UNDO_DEPTH);
    expect(stack[0]).toBe(3);
    expect(topClinicalUndoSnapshot(stack)).toBe(CLINICAL_UNDO_DEPTH + 2);
  });
});
