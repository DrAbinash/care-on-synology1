import { describe, it, expect } from "vitest";
import {
  parseCineClip, selectKeyFrame, cineFrameRef, cinePlaybackCapability,
  US_MULTIFRAME_SOP_CLASS,
} from "./usgCineClip";

const clipDs = (over: Record<string, unknown> = {}) => ({
  "0020000D": { Value: ["1.2.study"] },
  "0020000E": { Value: ["1.2.series"] },
  "00080018": { Value: ["1.2.sop"] },
  "00080016": { Value: [US_MULTIFRAME_SOP_CLASS] },
  "00280008": { Value: [60] },      // NumberOfFrames
  "00180040": { Value: [30] },      // CineRate
  ...over,
});

describe("P7.1 usgCineClip — parsing", () => {
  it("parses a multi-frame US clip with frame count, fps and duration", () => {
    const c = parseCineClip(clipDs());
    expect(c.isCine).toBe(true);
    expect(c.numberOfFrames).toBe(60);
    expect(c.frameRate).toBe(30);
    expect(c.durationSeconds).toBe(2);
    expect(c.sopInstanceUID).toBe("1.2.sop");
  });

  it("derives fps from FrameTime when CineRate is absent", () => {
    const c = parseCineClip(clipDs({ "00180040": undefined, "00181063": { Value: [25] } }));
    expect(c.frameRate).toBe(40); // 1000 / 25ms
  });

  it("treats a single-frame image as NOT cine and never fabricates a rate", () => {
    const c = parseCineClip(clipDs({ "00280008": { Value: [1] }, "00180040": undefined, "00181063": undefined }));
    expect(c.isCine).toBe(false);
    expect(c.numberOfFrames).toBe(1);
    expect(c.frameRate).toBeNull();
    expect(c.durationSeconds).toBeNull();
  });

  it("defaults NumberOfFrames to 1 when the tag is missing", () => {
    const c = parseCineClip(clipDs({ "00280008": undefined }));
    expect(c.numberOfFrames).toBe(1);
    expect(c.isCine).toBe(false);
  });
});

describe("P7.1 usgCineClip — key-frame selection", () => {
  it("picks the middle frame by default (deterministic)", () => {
    const c = parseCineClip(clipDs());
    expect(selectKeyFrame(c)).toBe(30);
  });

  it("honours an explicit selection, clamped into range", () => {
    const c = parseCineClip(clipDs());
    expect(selectKeyFrame(c, { selectedFrame: 12 })).toBe(12);
    expect(selectKeyFrame(c, { selectedFrame: 999 })).toBe(60);
    expect(selectKeyFrame(c, { selectedFrame: 0 })).toBe(1);
  });
});

describe("P7.1 usgCineClip — canonical provenance reuse", () => {
  it("produces a P3-shaped SrImageRef with the key frame", () => {
    const c = parseCineClip(clipDs());
    const ref = cineFrameRef(c, selectKeyFrame(c, { selectedFrame: 20 }));
    expect(ref.sopInstanceUID).toBe("1.2.sop");
    expect(ref.frameNumber).toBe(20);
    expect(ref.sopClassUID).toBe(US_MULTIFRAME_SOP_CLASS);
  });

  it("emits a null frame for a non-cine image (no fabricated frame)", () => {
    const c = parseCineClip(clipDs({ "00280008": { Value: [1] } }));
    expect(cineFrameRef(c, 1).frameNumber).toBeNull();
  });

  it("reports honest playback capability", () => {
    const cine = cinePlaybackCapability(parseCineClip(clipDs()));
    expect(cine).toMatchObject({ canPlay: true, canStepFrame: true, frameCount: 60, fps: 30 });
    const still = cinePlaybackCapability(parseCineClip(clipDs({ "00280008": { Value: [1] } })));
    expect(still.canPlay).toBe(false);
    expect(still.fps).toBeNull();
  });
});
