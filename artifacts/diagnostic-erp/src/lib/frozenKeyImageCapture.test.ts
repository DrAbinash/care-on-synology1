/**
 * Phase 1 frozen key-image capture — unit + pure helper tests.
 */
import { describe, expect, it } from "vitest";
import {
  buildObservationKeyImageCaption,
  maybeRefreshCaption,
} from "./keyImageCaption";
import { viewportToAnchor, anchorsEqual, viewportContextsEqual } from "./observationAnchor";

describe("keyImageCaption", () => {
  it("builds caption from level + findings", () => {
    expect(
      buildObservationKeyImageCaption({
        level: "L4-L5",
        lastRenderedFindings: "Broad-based posterior disc bulge",
      }),
    ).toBe("L4-L5: Broad-based posterior disc bulge.");
  });

  it("includes laterality / location", () => {
    expect(
      buildObservationKeyImageCaption({
        level: "Right frontal",
        findingsText: "lesion measuring 22 × 18 mm",
      }),
    ).toMatch(/Right frontal/);
  });

  it("protects manual captions from refresh", () => {
    expect(
      maybeRefreshCaption({
        captionManual: true,
        currentCaption: "My caption",
        nextAutoCaption: "Auto overwrite",
      }),
    ).toBe("My caption");
    expect(
      maybeRefreshCaption({
        captionManual: false,
        currentCaption: "Old",
        nextAutoCaption: "Fresh auto",
      }),
    ).toBe("Fresh auto");
  });
});

describe("activeAnchor provenance for capture", () => {
  it("stamps modality and viewer from viewport context", () => {
    const anchor = viewportToAnchor({
      studyInstanceUID: "1.2.3",
      seriesInstanceUID: "1.2.3.4",
      sopInstanceUID: "1.2.3.4.5",
      frameNumber: 12,
      instanceNumber: 12,
      seriesDescription: "T2 SAG",
      modality: "MR",
      totalFrames: 20,
      viewer: "frames",
    });
    expect(anchor.modality).toBe("MR");
    expect(anchor.viewer).toBe("frames");
    expect(anchor.frameNumber).toBe(12);
    expect(anchor.capturedAt).toBeTruthy();
  });

  it("viewport equality includes modality", () => {
    const a = {
      studyInstanceUID: "1.2.3",
      seriesInstanceUID: "s",
      sopInstanceUID: "i",
      frameNumber: 1,
      viewer: "frames" as const,
      modality: "MR",
    };
    expect(viewportContextsEqual(a, { ...a })).toBe(true);
    expect(viewportContextsEqual(a, { ...a, modality: "CT" })).toBe(false);
  });

  it("anchorsEqual ignores capturedAt drift for same UIDs", () => {
    const a = viewportToAnchor({
      studyInstanceUID: "1.2.3",
      viewer: "frames",
    });
    const b = { ...a, capturedAt: "2099-01-01T00:00:00.000Z" };
    expect(anchorsEqual(a, b)).toBe(true);
  });
});
