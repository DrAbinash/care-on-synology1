import { describe, expect, it } from "vitest";
import {
  canHydrateDraftForPatient,
  shouldApplyAsyncStudyResult,
  shouldCommitAutosave,
} from "./radiologyWorkspaceSafety";

describe("radiologyWorkspaceSafety", () => {
  it("applies an async result only when the open study still matches", () => {
    expect(shouldApplyAsyncStudyResult(10, 10)).toBe(true);
    expect(shouldApplyAsyncStudyResult(10, 11)).toBe(false);
    expect(shouldApplyAsyncStudyResult(null, 10)).toBe(false);
  });

  it("refuses to hydrate a draft that belongs to another patient", () => {
    expect(canHydrateDraftForPatient(1, 1)).toBe(true);
    expect(canHydrateDraftForPatient(1, 2)).toBe(false);
    expect(canHydrateDraftForPatient(null, 2)).toBe(true);
    expect(canHydrateDraftForPatient(1, null)).toBe(false);
  });

  it("drops a delayed Patient A autosave after switching to B", () => {
    expect(shouldCommitAutosave(1, 2, 1, 2)).toBe(false);
    expect(shouldCommitAutosave(2, 2, 2, 2)).toBe(true);
    expect(shouldCommitAutosave(2, 2, 1, 2)).toBe(false);
  });
});
