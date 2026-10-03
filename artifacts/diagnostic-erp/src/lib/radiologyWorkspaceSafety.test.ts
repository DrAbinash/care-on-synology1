import { describe, expect, it } from "vitest";
import {
  canHydrateDraftForPatient,
  shouldApplyAsyncStudyKey,
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

describe("shouldApplyAsyncStudyKey — non-numeric study identity", () => {
  // The numeric helper cannot carry a DICOM StudyInstanceUID: Number() on a UID
  // is NaN, and NaN === NaN is false, so every result would be refused.
  it("does not coerce a DICOM UID through Number()", () => {
    const uid = "1.2.840.113619.2.55.3.604688.1234567890.123";
    expect(Number(uid)).toBeNaN();
    expect(shouldApplyAsyncStudyResult(uid as never, uid as never)).toBe(false);
    expect(shouldApplyAsyncStudyKey(uid, uid)).toBe(true);
  });

  it("refuses a result whose study is no longer the open one", () => {
    expect(shouldApplyAsyncStudyKey("1.2.840.1", "1.2.840.2")).toBe(false);
    expect(shouldApplyAsyncStudyKey("7", "8")).toBe(false);
  });

  it("refuses when the request named a study and nothing is open now", () => {
    expect(shouldApplyAsyncStudyKey("1.2.840.1", null)).toBe(false);
    expect(shouldApplyAsyncStudyKey("1.2.840.1", undefined)).toBe(false);
  });

  it("allows a request that never had an identity to lose", () => {
    // Worklist rows without a StudyInstanceUID are legitimate; refusing those
    // would disable the AI path for them entirely.
    expect(shouldApplyAsyncStudyKey(null, "1.2.840.1")).toBe(true);
    expect(shouldApplyAsyncStudyKey(null, null)).toBe(true);
    expect(shouldApplyAsyncStudyKey(undefined, "1.2.840.1")).toBe(true);
  });

  it("is exact — no prefix, substring or case tolerance", () => {
    expect(shouldApplyAsyncStudyKey("1.2.840.1", "1.2.840.10")).toBe(false);
    expect(shouldApplyAsyncStudyKey("1.2.840.1", "1.2.840")).toBe(false);
    expect(shouldApplyAsyncStudyKey("abc", "ABC")).toBe(false);
  });
});
