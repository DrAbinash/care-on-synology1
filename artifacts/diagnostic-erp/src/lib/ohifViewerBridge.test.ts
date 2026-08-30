import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  isCareOhifMessage,
  CARE_OHIF_SOURCE,
  isAllowedOhifOrigin,
  deriveOhifAllowedOrigins,
  handleCareOhifMessage,
  captureResultToBlob,
  requestOhifNavigateToAnchor,
  requestOhifViewportCapture,
  isExpectedOhifSource,
  resolveOhifTargetOrigin,
} from "./ohifViewerBridge";

vi.mock("@/lib/fetchApi", () => ({
  api: {
    post: vi.fn(async () => ({})),
  },
}));

import { api } from "@/lib/fetchApi";

describe("ohifViewerBridge", () => {
  beforeEach(() => {
    vi.mocked(api.post).mockClear();
  });

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
    expect(isCareOhifMessage({ type: "measurement" })).toBe(false);
  });

  it("rejects random origins when allowlist is null/empty (no permissive default)", () => {
    expect(isAllowedOhifOrigin("https://ohif.example", null)).toBe(false);
    expect(isAllowedOhifOrigin("https://ohif.example", [])).toBe(false);
    expect(isAllowedOhifOrigin("https://ohif.example", ["https://ohif.example"])).toBe(true);
    expect(isAllowedOhifOrigin("https://evil.example", ["https://ohif.example"])).toBe(false);
    expect(isAllowedOhifOrigin("https://evil.example", ["*"])).toBe(true);
  });

  it("deriveOhifAllowedOrigins never returns accept-any null", () => {
    expect(deriveOhifAllowedOrigins({ pageOrigin: "https://erp.example" })).toEqual([
      "https://erp.example",
    ]);
    expect(deriveOhifAllowedOrigins({})).toEqual([]);
    expect(
      deriveOhifAllowedOrigins({
        pageOrigin: "https://erp.example",
        ohifLaunchUrl: "https://ohif.example/viewer",
      }),
    ).toEqual(expect.arrayContaining(["https://erp.example", "https://ohif.example"]));
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
    expect(pending.has("good")).toBe(true);
  });

  it("clears pending capture requestId on oversize / bad MIME / malformed / handler throw", async () => {
    const pending = new Set<string>(["a", "b", "c", "d"]);
    const huge = "x".repeat(8_000_001);
    await handleCareOhifMessage(
      {
        source: CARE_OHIF_SOURCE,
        type: "viewport-capture-result",
        version: 1,
        requestId: "a",
        studyInstanceUID: "1.2.3",
        imageData: huge,
      },
      { pendingCaptureRequestIds: pending },
    );
    expect(pending.has("a")).toBe(false);

    await handleCareOhifMessage(
      {
        source: CARE_OHIF_SOURCE,
        type: "viewport-capture-result",
        version: 1,
        requestId: "b",
        studyInstanceUID: "1.2.3",
        mimeType: "application/pdf",
        imageData: "data:application/pdf;base64,abc",
      },
      { pendingCaptureRequestIds: pending },
    );
    expect(pending.has("b")).toBe(false);

    await handleCareOhifMessage(
      {
        source: CARE_OHIF_SOURCE,
        type: "viewport-capture-result",
        version: 1,
        requestId: "c",
        studyInstanceUID: "1.2.3",
        imageData: null as unknown as string,
      },
      { pendingCaptureRequestIds: pending },
    );
    expect(pending.has("c")).toBe(false);

    await handleCareOhifMessage(
      {
        source: CARE_OHIF_SOURCE,
        type: "viewport-capture-result",
        version: 1,
        requestId: "d",
        studyInstanceUID: "1.2.3",
        imageData: `data:image/jpeg;base64,${btoa("x")}`,
      },
      {
        pendingCaptureRequestIds: pending,
        onViewportCaptureResult: async () => {
          throw new Error("boom");
        },
      },
    );
    expect(pending.has("d")).toBe(false);
  });

  it("accepts capture when requestId is pending and clears it", async () => {
    const pending = new Set<string>(["live"]);
    const onCapture = vi.fn(async () => undefined);
    const jpegB64 = btoa("fakejpeg");
    const r = await handleCareOhifMessage(
      {
        source: CARE_OHIF_SOURCE,
        type: "viewport-capture-result",
        version: 1,
        requestId: "live",
        studyInstanceUID: "1.2.3",
        imageData: `data:image/jpeg;base64,${jpegB64}`,
      },
      { pendingCaptureRequestIds: pending, onViewportCaptureResult: onCapture },
    );
    expect(r).toBe("ok");
    expect(onCapture).toHaveBeenCalledOnce();
    expect(pending.has("live")).toBe(false);
  });

  it("ignores mutating events when mutationsAllowed=false", async () => {
    const r = await handleCareOhifMessage(
      {
        source: CARE_OHIF_SOURCE,
        type: "measurement",
        studyInstanceUID: "1.2.3",
        label: "L4-L5",
        value: 6.8,
        intent: "CANAL_AP",
      },
      { patientId: 1, studyInstanceUID: "1.2.3", mutationsAllowed: false },
    );
    expect(r).toBe("ignored");
    expect(api.post).not.toHaveBeenCalled();
  });

  it("binds patientId from CARE context, ignoring hostile message override", async () => {
    const r = await handleCareOhifMessage(
      {
        source: CARE_OHIF_SOURCE,
        type: "measurement",
        studyInstanceUID: "1.2.3",
        label: "lesion",
        value: 10,
        patientId: 999,
        studyId: 888,
      },
      { patientId: 42, studyId: 7, studyInstanceUID: "1.2.3" },
    );
    expect(r).toBe("ok");
    expect(api.post).toHaveBeenCalledWith(
      "/api/radiology-lesions/viewer-measurements",
      expect.objectContaining({ patientId: 42, studyId: 7 }),
    );
  });

  it("binds key-image draftId from CARE context, ignoring hostile message override", async () => {
    const r = await handleCareOhifMessage(
      {
        source: CARE_OHIF_SOURCE,
        type: "key-image",
        studyInstanceUID: "1.2.3",
        seriesInstanceUID: "1.2.3.4",
        sopInstanceUID: "1.2.3.4.5",
        draftId: 9999,
        studyId: 888,
      },
      { patientId: 42, studyId: 7, draftId: 55, studyInstanceUID: "1.2.3", getImageRefs: () => [] },
    );
    expect(r).toBe("ok");
    expect(api.post).toHaveBeenCalledWith(
      "/api/radiology/report-generator/image-references",
      expect.objectContaining({ draftId: 55, studyId: 7 }),
    );
  });

  it("does not tag unlabeled disc-level ruler as CANAL_AP without intent", async () => {
    await handleCareOhifMessage(
      {
        source: CARE_OHIF_SOURCE,
        type: "measurement",
        studyInstanceUID: "1.2.3",
        label: "L4-L5",
        value: 6.8,
        unit: "mm",
      },
      { patientId: 1, studyInstanceUID: "1.2.3" },
    );
    expect(api.post).toHaveBeenCalledWith(
      "/api/radiology-lesions/viewer-measurements",
      expect.objectContaining({ measurementId: undefined, value: "6.8" }),
    );
  });

  it("tags CANAL_AP only with explicit intent", async () => {
    await handleCareOhifMessage(
      {
        source: CARE_OHIF_SOURCE,
        type: "measurement",
        studyInstanceUID: "1.2.3",
        label: "L4-L5",
        value: 6.8,
        intent: "CANAL_AP",
      },
      { patientId: 1, studyInstanceUID: "1.2.3" },
    );
    expect(api.post).toHaveBeenCalledWith(
      "/api/radiology-lesions/viewer-measurements",
      expect.objectContaining({ measurementId: "CANAL_AP" }),
    );
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
  });

  it("emits outbound navigate/capture only with known targetOrigin (no silent *)", () => {
    const postMessage = vi.fn();
    const target = { postMessage } as unknown as Window;
    expect(requestOhifViewportCapture({ target, requestId: "cap-1" })).toBe(false);
    expect(postMessage).not.toHaveBeenCalled();
    expect(requestOhifViewportCapture({
      target,
      requestId: "cap-1",
      targetOrigin: "https://ohif.example",
    })).toBe(true);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "viewport-capture-request", requestId: "cap-1" }),
      "https://ohif.example",
    );
    expect(requestOhifNavigateToAnchor({
      target,
      studyInstanceUID: "1.2.3",
      targetOrigin: "https://ohif.example",
    })).toBe(true);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "navigate-to-anchor" }),
      "https://ohif.example",
    );
  });

  it("isExpectedOhifSource accepts expected window and rejects others", () => {
    const expected = { name: "ohif" } as unknown as Window;
    const other = { name: "evil" } as unknown as Window;
    expect(isExpectedOhifSource(expected, { expectedSourceWindow: expected })).toBe(true);
    expect(isExpectedOhifSource(other, { expectedSourceWindow: expected })).toBe(false);
    expect(isExpectedOhifSource(other, { getExpectedSourceWindow: () => expected })).toBe(false);
    expect(isExpectedOhifSource(expected, { getExpectedSourceWindow: () => expected })).toBe(true);
    // Forged / null source rejected when expected window is configured
    expect(isExpectedOhifSource(null, { expectedSourceWindow: expected })).toBe(false);
  });

  it("origin allowlist + source window gates compose for inbound security", () => {
    const expected = { name: "ohif" } as unknown as Window;
    const other = { name: "evil" } as unknown as Window;
    const origins = deriveOhifAllowedOrigins({
      pageOrigin: "https://erp.example",
      ohifLaunchUrl: "https://ohif.example/viewer",
    });
    // Random origin rejected
    expect(isAllowedOhifOrigin("https://evil.example", origins)).toBe(false);
    // Configured OHIF origin accepted
    expect(isAllowedOhifOrigin("https://ohif.example", origins)).toBe(true);
    // Wrong window rejected even if origin ok
    expect(
      isAllowedOhifOrigin("https://ohif.example", origins)
      && isExpectedOhifSource(other, { expectedSourceWindow: expected }),
    ).toBe(false);
    // Correct window + origin accepted
    expect(
      isAllowedOhifOrigin("https://ohif.example", origins)
      && isExpectedOhifSource(expected, { expectedSourceWindow: expected }),
    ).toBe(true);
  });

  it("resolveOhifTargetOrigin prefers launch URL origin", () => {
    expect(resolveOhifTargetOrigin({
      ohifLaunchUrl: "https://ohif.example/viewer?StudyInstanceUIDs=1",
      allowedOrigins: ["https://erp.example", "https://ohif.example"],
      pageOrigin: "https://erp.example",
    })).toBe("https://ohif.example");
  });
});
