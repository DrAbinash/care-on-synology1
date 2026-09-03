import { describe, expect, it } from "vitest";
import { verifyKeyImageRowOwnership, type KeyImageOwnershipContext } from "./keyImageOwnership";

const baseCtx: KeyImageOwnershipContext = {
  draftId: 100,
  studyId: 50,
  worklistId: 900,
  patientId: 7,
  draftStudyId: 50,
  draftWorklistId: 900,
  draftPatientId: 7,
};

describe("verifyKeyImageRowOwnership", () => {
  it("accepts correct study + correct draft", () => {
    const r = verifyKeyImageRowOwnership(
      { id: 1, studyId: 50, draftId: 100, patientId: 7 },
      baseCtx,
    );
    expect(r.ok).toBe(true);
  });

  it("rejects wrong study", () => {
    const r = verifyKeyImageRowOwnership(
      { id: 1, studyId: 999, draftId: 100, patientId: 7 },
      baseCtx,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.safeError).toMatch(/cross_study|ownership_unverified/);
  });

  it("rejects wrong draft", () => {
    const r = verifyKeyImageRowOwnership(
      { id: 1, studyId: 50, draftId: 888, patientId: 7 },
      baseCtx,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.safeError).toMatch(/cross_draft|ownership_unverified/);
  });

  it("rejects row.studyId null when draft linkage cannot be correlated", () => {
    const r = verifyKeyImageRowOwnership(
      { id: 1, studyId: null, draftId: 100, patientId: 7 },
      {
        ...baseCtx,
        draftStudyId: null,
        draftWorklistId: null,
        draftPatientId: null,
      },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.safeError).toBe("selected_images_ownership_unverified");
  });

  it("rejects row.draftId null without patient + draft study proof", () => {
    const r = verifyKeyImageRowOwnership(
      { id: 1, studyId: 50, draftId: null, patientId: 7 },
      {
        ...baseCtx,
        draftStudyId: null,
      },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.safeError).toBe("selected_images_ownership_unverified");
  });

  it("rejects both null", () => {
    const r = verifyKeyImageRowOwnership(
      { id: 1, studyId: null, draftId: null, patientId: 7 },
      baseCtx,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.safeError).toBe("selected_images_ownership_unverified");
  });

  it("rejects malicious key-image ID from another patient", () => {
    const r = verifyKeyImageRowOwnership(
      { id: 1, studyId: 50, draftId: 100, patientId: 999 },
      baseCtx,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.safeError).toBe("selected_images_ownership_unverified");
  });

  it("accepts valid legacy row where ownership is proven via authoritative draft linkage", () => {
    const r = verifyKeyImageRowOwnership(
      { id: 1, studyId: null, draftId: 100, patientId: 7 },
      baseCtx,
    );
    expect(r.ok).toBe(true);
  });

  it("accepts legacy draftId-null when study + patient + draftStudyId prove association", () => {
    const r = verifyKeyImageRowOwnership(
      { id: 1, studyId: 50, draftId: null, patientId: 7 },
      baseCtx,
    );
    expect(r.ok).toBe(true);
  });
});
