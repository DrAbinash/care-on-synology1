import { describe, expect, it } from "vitest";
import { resolveKeyImageCapturePath } from "./keyImageCapturePath";

describe("resolveKeyImageCapturePath", () => {
  it("prefers Frames when a frame is ready", () => {
    expect(
      resolveKeyImageCapturePath({
        viewMode: "FRAMES",
        framesReady: true,
        ohifCaptureAvailable: true,
      }),
    ).toBe("frames");
  });

  it("uses OHIF annotated capture when in OHIF mode", () => {
    expect(
      resolveKeyImageCapturePath({
        viewMode: "OHIF",
        framesReady: false,
        ohifCaptureAvailable: true,
      }),
    ).toBe("ohif");
  });

  it("is unavailable when locked or nothing is ready", () => {
    expect(
      resolveKeyImageCapturePath({
        viewMode: "FRAMES",
        framesReady: false,
        ohifCaptureAvailable: true,
      }),
    ).toBe("unavailable");
    expect(
      resolveKeyImageCapturePath({
        viewMode: "OHIF",
        framesReady: true,
        ohifCaptureAvailable: false,
        disabled: true,
      }),
    ).toBe("unavailable");
  });
});
