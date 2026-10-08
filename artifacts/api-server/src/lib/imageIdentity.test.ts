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
import {
  chainColumnsFor,
  decideFrame,
  identityColumnsFor,
  isDicomUid,
  verifyInstanceChain,
  type InstanceChainVerdict,
  type InstanceLookup,
  type InstanceLookupResult,
} from "./imageIdentity";

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

// The route-level suite proves the PACS is really asked over HTTP; this table pins
// the decisions themselves, including the shapes no current caller sends.
describe("D2 instance chain — a writer that is not a report draft", () => {
  const STUDY = "1.2.840.1";
  const SERIES = "1.2.840.1.1";
  const SOP = "1.2.840.1.1.1";

  function stubLookup(answer: InstanceLookupResult) {
    const asked: Array<string | null> = [];
    const lookup: InstanceLookup = async (args) => {
      asked.push(args.sopInstanceUID);
      return answer;
    };
    return { asked, lookup };
  }

  // A contradicted verdict where the test expects columns is the failure itself,
  // and `chainColumnsFor` deliberately refuses to accept one.
  function columnsOf(verdict: InstanceChainVerdict) {
    if (verdict.status === "contradicted") throw new Error(`contradicted: ${verdict.code}`);
    return chainColumnsFor(verdict);
  }

  it("an artefact that names no image asks nothing and stores no image", async () => {
    const { lookup, asked } = stubLookup({ ok: true, numberOfFrames: 60 });
    const verdict = await verifyInstanceChain({ studyInstanceUID: STUDY, lookup });
    expect(verdict).toEqual({ status: "no_image", studyInstanceUID: STUDY });
    expect(asked.length).toBe(0);
    expect(columnsOf(verdict)).toEqual({
      studyInstanceUid: STUDY, seriesInstanceUid: null, sopInstanceUid: null, frameNumber: null,
    });
  });

  it("a series with no SOP is confirmed one level up and keeps no image identity", async () => {
    const { lookup, asked } = stubLookup({ ok: true, numberOfFrames: null });
    const verdict = await verifyInstanceChain({
      studyInstanceUID: STUDY, seriesInstanceUID: SERIES, frameNumber: 12, lookup,
    });
    expect(asked).toEqual([null]); // the series question, not an instance question
    expect(verdict.status).toBe("series_only");
    // No SOP means no authoritative image, so a frame claim has nothing to point at.
    expect(columnsOf(verdict)).toEqual({
      studyInstanceUid: STUDY, seriesInstanceUid: SERIES, sopInstanceUid: null, frameNumber: null,
    });
  });

  it("a series the study does not hold is contradicted, not stored", async () => {
    const { lookup } = stubLookup({ ok: false, reason: "not-found" });
    const verdict = await verifyInstanceChain({
      studyInstanceUID: STUDY, seriesInstanceUID: SERIES, lookup,
    });
    expect(verdict).toMatchObject({ status: "contradicted", code: "IMAGE_SERIES_NOT_IN_STUDY" });
  });

  it("CARE's own record of the study outranks the claim", async () => {
    const { lookup, asked } = stubLookup({ ok: true, numberOfFrames: 60 });
    const mismatch = await verifyInstanceChain({
      studyInstanceUID: "1.2.840.999",
      expectedStudyInstanceUID: STUDY,
      seriesInstanceUID: SERIES,
      sopInstanceUID: SOP,
      lookup,
    });
    expect(mismatch).toMatchObject({ status: "contradicted", code: "IMAGE_STUDY_MISMATCH" });
    expect(asked.length).toBe(0); // refused before the PACS was disturbed

    const ok = await verifyInstanceChain({
      studyInstanceUID: STUDY,
      expectedStudyInstanceUID: STUDY,
      seriesInstanceUID: SERIES,
      sopInstanceUID: SOP,
      frameNumber: 4,
      lookup,
    });
    expect(columnsOf(ok)).toEqual({
      studyInstanceUid: STUDY, seriesInstanceUid: SERIES, sopInstanceUid: SOP, frameNumber: 4,
    });
  });

  it("an unreachable PACS costs the identity and not the artefact", async () => {
    const { lookup } = stubLookup({ ok: false, reason: "unreachable" });
    const verdict = await verifyInstanceChain({
      studyInstanceUID: STUDY, seriesInstanceUID: SERIES, sopInstanceUID: SOP, lookup,
    });
    expect(verdict.status).toBe("unverifiable");
    if (verdict.status !== "unverifiable") return;
    expect(verdict.studyInstanceUID).toBe(STUDY);
    expect(columnsOf(verdict)).toEqual({
      studyInstanceUid: STUDY, seriesInstanceUid: null, sopInstanceUid: null, frameNumber: null,
    });
  });

  it("a chain built on a non-UID study never reaches the PACS", async () => {
    for (const bad of ["orthanc-uuid-1234", "1.2.3/", ""]) {
      const { lookup, asked } = stubLookup({ ok: true, numberOfFrames: 60 });
      const verdict = await verifyInstanceChain({
        studyInstanceUID: bad, seriesInstanceUID: SERIES, sopInstanceUID: SOP, lookup,
      });
      expect(verdict, bad).toMatchObject({ status: "contradicted", code: "IMAGE_STUDY_UID_INVALID" });
      expect(asked.length, bad).toBe(0);
    }
  });

  it("an SOP with no series is incomplete, not half-verified", async () => {
    const { lookup, asked } = stubLookup({ ok: true, numberOfFrames: 60 });
    const verdict = await verifyInstanceChain({
      studyInstanceUID: STUDY, sopInstanceUID: SOP, lookup,
    });
    expect(verdict).toMatchObject({ status: "contradicted", code: "IMAGE_IDENTITY_INCOMPLETE" });
    expect(asked.length).toBe(0);
  });
});
