import { describe, it, expect } from "vitest";
import {
  parseCineClip, selectKeyFrame, cineFrameRef, cinePlaybackCapability, cinePlaybackPlan,
  US_MULTIFRAME_SOP_CLASS, CINE_MAX_FPS, CINE_MIN_FPS, CINE_DEFAULT_FPS,
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

describe("P7.1 usgCineClip — in-panel playback plan", () => {
  it("builds an ordered 1-based frame list for the whole clip", () => {
    const plan = cinePlaybackPlan(parseCineClip(clipDs())); // 60 frames @ 30fps
    expect(plan.canPlay).toBe(true);
    expect(plan.orderedFrames[0]).toBe(1);
    expect(plan.orderedFrames.at(-1)).toBe(60);
    expect(plan.orderedFrames.length).toBe(60);
    expect(plan.fps).toBe(30);
    expect(plan.frameDelayMs).toBe(Math.round(1000 / 30));
    expect(plan.loop).toBe(true);
    expect(plan.sopInstanceUID).toBe("1.2.sop");
    expect(plan.seriesInstanceUID).toBe("1.2.series");
  });

  it("clamps an absurd DICOM CineRate into a renderable range", () => {
    const fast = cinePlaybackPlan(parseCineClip(clipDs({ "00180040": { Value: [500] } })));
    expect(fast.fps).toBe(CINE_MAX_FPS);
    const zero = cinePlaybackPlan(parseCineClip(clipDs({ "00180040": { Value: [0] }, "00181063": undefined })));
    // 0fps is not renderable → falls back to the default, never 0.
    expect(zero.fps).toBe(CINE_DEFAULT_FPS);
    expect(zero.fps).toBeGreaterThanOrEqual(CINE_MIN_FPS);
  });

  it("honours a caller fps override and a frame cap", () => {
    const plan = cinePlaybackPlan(parseCineClip(clipDs()), { fps: 8, maxFrames: 10 });
    expect(plan.fps).toBe(8);
    expect(plan.orderedFrames).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("yields a non-playable, empty plan for a single-frame image (no fabricated loop)", () => {
    const plan = cinePlaybackPlan(parseCineClip(clipDs({ "00280008": { Value: [1] } })));
    expect(plan.canPlay).toBe(false);
    expect(plan.orderedFrames).toEqual([]);
    expect(plan.fps).toBe(0);
    expect(plan.frameDelayMs).toBe(0);
  });
});
