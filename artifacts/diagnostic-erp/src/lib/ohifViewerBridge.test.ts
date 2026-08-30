import { describe, expect, it, vi } from "vitest";
import {
  isCareOhifMessage,
  CARE_OHIF_SOURCE,
  isAllowedOhifOrigin,
  handleCareOhifMessage,
  captureResultToBlob,
  requestOhifNavigateToAnchor,
  requestOhifViewportCapture,
} from "./ohifViewerBridge";

describe("ohifViewerBridge", () => {
  it("accepts measurement, key-image, capture, and delete contracts", () => {
    expect(isCareOhifMessage({
      source: CARE_OHIF_SOURCE,
      type: "measurement",
      studyInstanceUID: "1.2.3",
      value: 12.5,
    })).toBe(true);
    expect(isCareOhifMessage({
      source: CARE_OHIF_SOURCE,
      type: "key-image",
      studyInstanceUID: "1.2.3",
      seriesInstanceUID: "1.2.4",
      sopInstanceUID: "1.2.5",
    })).toBe(true);
    expect(isCareOhifMessage({
      source: CARE_OHIF_SOURCE,
      type: "viewport-capture-result",
      version: 1,
      requestId: "r1",
      studyInstanceUID: "1.2.3",
      imageData: "data:image/jpeg;base64,abc",
    })).toBe(true);
    expect(isCareOhifMessage({
      source: CARE_OHIF_SOURCE,
      type: "measurement-deleted",
      annotationId: "ABC",
    })).toBe(true);
    expect(isCareOhifMessage({ type: "measurement" })).toBe(false);
  });

  it("validates origin allowlist", () => {
    expect(isAllowedOhifOrigin("https://ohif.example", null)).toBe(true);
    expect(isAllowedOhifOrigin("https://ohif.example", [])).toBe(true);
    expect(isAllowedOhifOrigin("https://ohif.example", ["https://ohif.example"])).toBe(true);
    expect(isAllowedOhifOrigin("https://evil.example", ["https://ohif.example"])).toBe(false);
  });

  it("rejects stale/unknown capture requestId and oversized payload", async () => {
    const pending = new Set<string>(["good"]);
    const onCapture = vi.fn();
    const stale = await handleCareOhifMessage(
      {
        source: CARE_OHIF_SOURCE,
        type: "viewport-capture-result",
        version: 1,
        requestId: "stale",
        studyInstanceUID: "1.2.3",
        imageData: "data:image/jpeg;base64,abc",
      },
      { pendingCaptureRequestIds: pending, onViewportCaptureResult: onCapture },
    );
    expect(stale).toBe("ignored");
    expect(onCapture).not.toHaveBeenCalled();

    const huge = "x".repeat(8_000_001);
    const tooBig = await handleCareOhifMessage(
      {
        source: CARE_OHIF_SOURCE,
        type: "viewport-capture-result",
        version: 1,
        requestId: "good",
        studyInstanceUID: "1.2.3",
        imageData: huge,
      },
      { pendingCaptureRequestIds: pending, onViewportCaptureResult: onCapture },
    );
    expect(tooBig).toBe("error");
  });

  it("measurement-deleted notifies callback", async () => {
    const onDel = vi.fn();
    const r = await handleCareOhifMessage(
      { source: CARE_OHIF_SOURCE, type: "measurement-deleted", annotationId: "ABC" },
      { onMeasurementDeleted: onDel },
    );
    expect(r).toBe("ok");
    expect(onDel).toHaveBeenCalledWith("ABC");
  });

  it("decodes capture result to blob", () => {
    const jpegB64 = btoa("fakejpeg");
    const blob = captureResultToBlob({
      source: CARE_OHIF_SOURCE,
      type: "viewport-capture-result",
      version: 1,
      requestId: "r",
      studyInstanceUID: "1",
      imageData: `data:image/jpeg;base64,${jpegB64}`,
    });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob?.type).toBe("image/jpeg");
  });

  it("emits versioned outbound navigate and capture requests", () => {
    const postMessage = vi.fn();
    const target = { postMessage } as unknown as Window;
    expect(requestOhifViewportCapture({ target, requestId: "cap-1" })).toBe(true);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "care-reporting",
        type: "viewport-capture-request",
        version: 1,
        requestId: "cap-1",
      }),
      "*",
    );
    expect(requestOhifNavigateToAnchor({
      target,
      studyInstanceUID: "1.2.3",
      seriesInstanceUID: "1.2.4",
      sopInstanceUID: "1.2.5",
      frameNumber: 3,
    })).toBe(true);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "care-reporting",
        type: "navigate-to-anchor",
        version: 1,
        studyInstanceUID: "1.2.3",
        frameNumber: 3,
      }),
      "*",
    );
  });
});
