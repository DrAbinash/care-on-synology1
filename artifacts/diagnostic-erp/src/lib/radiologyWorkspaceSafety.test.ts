import { describe, expect, it } from "vitest";
import {
  canHydrateDraftForPatient,
  dictationBindingHolds,
  dictationIdentityOf,
  dictationStudyKeyOf,
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

describe("dictationBindingHolds — C1 study binding for Smart Dictation", () => {
  const at = (studyId: unknown, studyInstanceUID: unknown) =>
    dictationIdentityOf({ studyId, studyInstanceUID });

  it("holds while the route study is the one the words were spoken against", () => {
    expect(dictationBindingHolds(at(42, "1.2.840.42"), at(42, "1.2.840.42"), "42")).toBe(true);
  });

  it("breaks when the route study moved", () => {
    expect(dictationBindingHolds(at(42, "1.2.840.42"), at(43, "1.2.840.43"), "43")).toBe(false);
    expect(dictationBindingHolds(at(42, "1.2.840.42"), at(null, null), null)).toBe(false);
  });

  it("breaks when a bound study is no longer the one the store holds", () => {
    // The route never moved; the store's narrative — which is what Apply writes
    // into — did. This is the witness that catches A's prose landing in B.
    expect(dictationBindingHolds(at(42, "1.2.840.42"), at(42, "1.2.840.42"), "43")).toBe(false);
  });

  it("does not read the store against itself", () => {
    // A-02: a binding stamped from `activeStudyId` and compared to
    // `activeStudyId` passes even while that field lags the route. The bound key
    // comes from the route, so a store that disagrees is refused rather than
    // agreed with.
    const boundFromRoute = at(42, "1.2.840.42");
    const laggingStore = "41";
    expect(dictationBindingHolds(boundFromRoute, at(42, "1.2.840.42"), laggingStore)).toBe(false);
  });

  it("breaks when the row was re-linked to a different StudyInstanceUID", () => {
    // Same worklist row id, different study — the identity a study-id check misses.
    expect(dictationBindingHolds(at(42, "1.2.840.42"), at(42, "1.2.840.999"), "42")).toBe(false);
  });

  it("treats a missing UID as no evidence, not as a switch", () => {
    // Hydration fills the UID in after the row loads, and a non-PACS study has
    // none. Either must not void a live dictation.
    expect(dictationBindingHolds(at(42, null), at(42, "1.2.840.42"), "42")).toBe(true);
    expect(dictationBindingHolds(at(42, "1.2.840.42"), at(42, null), "42")).toBe(true);
    expect(dictationBindingHolds(at(42, null), at(42, null), "42")).toBe(true);
  });

  it("permits an unbound workspace, both sides agreeing on nothing", () => {
    // App.tsx mounts RadiologyReportingWorkspace with no study id on two routes;
    // refusing there would break a working surface to protect no identity.
    expect(dictationBindingHolds(at(null, null), at(null, null), null)).toBe(true);
    // A store that has not resolved its study yet is not a disagreement either.
    expect(dictationBindingHolds(at(42, "1.2.840.42"), at(42, "1.2.840.42"), null)).toBe(true);
  });

  it("compares a number route id with the store string form of the same id", () => {
    // `useDraftPersistence` already treats `activeStudyId === String(studyId)` as
    // the steady state, so that pair must not look like a switch.
    expect(dictationBindingHolds(at(42, "1.2.840.42"), at(42, "1.2.840.42"), "42")).toBe(true);
    expect(dictationBindingHolds(at("42", "1.2.840.42"), at(42, "1.2.840.42"), "42")).toBe(true);
  });

  it("normalises an unparseable route param to unbound instead of the study \"nan\"", () => {
    // The number arm: `App.tsx` computes `Number(params.studyId)`, so a garbage
    // param arrives as NaN and an "Infinity" param as Infinity.
    expect(dictationStudyKeyOf(Number("abc"))).toBeNull();
    expect(dictationStudyKeyOf(Number("Infinity"))).toBeNull();
    expect(dictationStudyKeyOf(Number(1 / 0))).toBeNull();
    expect(dictationStudyKeyOf(undefined)).toBeNull();
    expect(dictationStudyKeyOf(null)).toBeNull();
    // The string arm: a param that never parsed reaches this as text.
    expect(dictationStudyKeyOf("NaN")).toBeNull();
    expect(dictationStudyKeyOf("")).toBeNull();
    expect(dictationStudyKeyOf("  ")).toBeNull();
    expect(dictationStudyKeyOf("42")).toBe("42");
    expect(dictationStudyKeyOf(42)).toBe("42");
    // Two garbage routes are therefore an unbound workspace — a shared "nan"
    // would have looked like the same study on two different pages.
    expect(dictationBindingHolds(at(NaN, null), at(Number("x"), null), null)).toBe(true);
  });

  it("is exact about identifiers — no prefix or case tolerance", () => {
    expect(dictationBindingHolds(at("42", null), at("424", null), "42")).toBe(false);
    expect(dictationBindingHolds(at(42, "ABC"), at(42, "abc"), "42")).toBe(false);
  });

  it("holds a study, never a patient", () => {
    // The refusal the radiologist sees is a constant sentence in the panel; this
    // guard cannot leak demography because it never carries any.
    expect(Object.keys(at(42, "1.2.840.42")).sort()).toEqual(["studyInstanceUID", "studyKey"]);
  });
});
