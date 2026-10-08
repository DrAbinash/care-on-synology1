/**
 * D2 frame policy and UID hygiene, as pure decisions.
 *
 * The request-level suite (routes/radiologyImageIdentity.request.test.ts) proves
 * the routes behave; this file pins the rules themselves, including the cases a
 * route cannot reach: a frame of 0, a non-integer, an over-long UID, a claim with
 * no frame at all. The distinction being defended is narrow and clinical: a frame
 * number is a fact about a multi-frame object, and every single-frame slice in
 * the clinic has a URL that says `frames/1` without that meaning anything.
 */
import { describe, expect, it } from "vitest";
import { decideFrame, identityColumnsFor, isDicomUid } from "./imageIdentity";

describe("D2 frame policy — absent is not 1", () => {
  it("drops a frame claimed for a single-frame instance", () => {
    for (const frames of [1, null, undefined]) {
      const v = decideFrame(1, frames ?? null);
      expect(v.frameNumber).toBeNull();
      expect(v.dropped).toBe(true);
      expect(v.outOfRange).toBe(false);
    }
  });

  it("keeps a frame inside a genuinely multi-frame object", () => {
    expect(decideFrame(1, 60)).toEqual({ frameNumber: 1, outOfRange: false, dropped: false });
    expect(decideFrame(60, 60)).toEqual({ frameNumber: 60, outOfRange: false, dropped: false });
  });

  it("refuses a frame outside the object's frame axis", () => {
    for (const bad of [0, -1, 61, 1_000]) {
      const v = decideFrame(bad, 60);
      expect(v.outOfRange).toBe(true);
      expect(v.frameNumber).toBeNull();
    }
  });

  it("leaves the frame unknown when nothing was named", () => {
    for (const frames of [1, 60, null]) {
      const v = decideFrame(undefined, frames);
      expect(v).toEqual({ frameNumber: null, outOfRange: false, dropped: false });
    }
  });

  it("rounds a fractional frame down rather than inventing one", () => {
    expect(decideFrame(7.9, 60).frameNumber).toBe(7);
  });

  it("treats a missing (0028,0008) as single-frame, never as unknown-but-frameable", () => {
    // DICOM requires NumberOfFrames on a multi-frame instance; the absence of the
    // tag is therefore evidence of a single-frame object, not a licence to guess.
    expect(decideFrame(3, null).frameNumber).toBeNull();
    expect(decideFrame(3, 1).frameNumber).toBeNull();
  });
});

describe("D2 UID hygiene", () => {
  it("accepts DICOM UIDs and only those", () => {
    expect(isDicomUid("1.2.840.10008.1.2.1")).toBe(true);
    expect(isDicomUid("2.25.12345678901234567890")).toBe(true);
  });

  it("rejects the things a browser would happily send", () => {
    for (const bad of [
      "",
      " ",
      "not a uid!!!",
      "1.2.3.",
      ".1.2.3",
      "1..2",
      "1.2.3a",
      "javascript:1.2.3",
      "1.2.3/../4",
      `1.${"9".repeat(70)}`,
    ]) {
      expect(isDicomUid(bad), bad).toBe(false);
    }
  });

  it("rejects a non-string", () => {
    expect(isDicomUid(null)).toBe(false);
    expect(isDicomUid(12345)).toBe(false);
  });
});

describe("D2 verdict → stored columns", () => {
  const identity = {
    studyInstanceUID: "1.2.840.1",
    seriesInstanceUID: "1.2.840.1.1",
    sopInstanceUID: "1.2.840.1.1.1",
    frameNumber: null,
  };

  it("only a verified verdict produces identity", () => {
    expect(identityColumnsFor({ status: "verified", identity, frameClaimDropped: false })).toEqual(identity);
    expect(
      identityColumnsFor({ status: "contradicted", code: "IMAGE_SOP_NOT_IN_STUDY", message: "x" }),
    ).toBeNull();
    expect(
      identityColumnsFor({ status: "unverifiable", code: "IMAGE_PACS_UNREACHABLE", message: "x" }),
    ).toBeNull();
  });
});
