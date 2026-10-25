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
  requestOhifDisplayedAnchor,
  CARE_REPORTING_SOURCE,
  isExpectedOhifSource,
  resolveOhifTargetOrigin,
  ohifAnchorFailureText,
  ohifActiveAnchorToViewport,
  validOhifVoi,
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
      {
        patientId: 42,
        studyId: 7,
        draftId: 55,
        accessionNumber: "ACC-7",
        studyInstanceUID: "1.2.3",
      },
    );
    expect(r).toBe("ok");
    // The viewer's image goes to the FROZEN store through the same endpoint the
    // PACS picker uses — writing it to /image-references left one report holding
    // two competing sets of images, only one of which survived an Orthanc outage.
    expect(api.post).toHaveBeenCalledWith(
      "/api/radiology/report-generator/key-images/from-pacs",
      expect.objectContaining({
        draftId: 55,
        studyId: 7,
        patientId: 42,
        accessionNumber: "ACC-7",
        studyInstanceUid: "1.2.3",
        seriesInstanceUid: "1.2.3.4",
        sopInstanceUid: "1.2.3.4.5",
        // The viewer never says what the image should be called, and CARE no
        // longer decides for the radiologist: an added image has no caption.
        caption: "",
      }),
    );
    const body = vi.mocked(api.post).mock.calls[0][1] as Record<string, unknown>;
    expect(body).not.toHaveProperty("frameNumber");
  });

  it("keeps the viewer's frame for a multiframe image and drops frame 0", async () => {
    await handleCareOhifMessage(
      {
        source: CARE_OHIF_SOURCE,
        type: "key-image",
        studyInstanceUID: "1.2.3",
        seriesInstanceUID: "1.2.3.4",
        sopInstanceUID: "1.2.3.4.5",
        frameNumber: 4,
        caption: "Axial T2",
      },
      { patientId: 1, studyId: 2, draftId: 3, studyInstanceUID: "1.2.3" },
    );
    expect(vi.mocked(api.post).mock.calls[0][1]).toMatchObject({ frameNumber: 4, caption: "Axial T2" });

    await handleCareOhifMessage(
      {
        source: CARE_OHIF_SOURCE,
        type: "key-image",
        studyInstanceUID: "1.2.3",
        seriesInstanceUID: "1.2.3.4",
        sopInstanceUID: "1.2.3.4.5",
        frameNumber: 0,
      },
      { patientId: 1, studyId: 2, draftId: 3, studyInstanceUID: "1.2.3" },
    );
    expect(vi.mocked(api.post).mock.calls[1][1]).not.toHaveProperty("frameNumber");
  });

  it("refuses a key-image claim that is not a DICOM UID, before any request", async () => {
    const r = await handleCareOhifMessage(
      {
        source: CARE_OHIF_SOURCE,
        type: "key-image",
        studyInstanceUID: "1.2.3",
        seriesInstanceUID: "1.2.3.4",
        sopInstanceUID: "not a uid",
      },
      { patientId: 1, studyId: 2, draftId: 3, studyInstanceUID: "1.2.3" },
    );
    expect(r).toBe("error");
    expect(api.post).not.toHaveBeenCalled();
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

/**
 * D2 — the receiver must not be the place where an un-named image becomes an
 * anchored one. These cases are the ones the old guard let through: an empty
 * study claim skipped the study comparison entirely, and an anchor could arrive
 * that nobody had asked for.
 */
describe("D2 identity gates on the receiving side", () => {
  const baseCtx = {
    studyInstanceUID: "1.2.840.study.a",
    patientId: 7,
    studyId: 11,
    draftId: 5,
  };

  it("an event that names no study is refused instead of compared to nothing", async () => {
    for (const msg of [
      { source: CARE_OHIF_SOURCE, type: "measurement", studyInstanceUID: "", value: 12, unit: "mm" },
      { source: CARE_OHIF_SOURCE, type: "key-image", studyInstanceUID: "", seriesInstanceUID: "1.2.3", sopInstanceUID: "1.2.4" },
      { source: CARE_OHIF_SOURCE, type: "active-anchor", studyInstanceUID: "" },
    ] as const) {
      const out = await handleCareOhifMessage(msg as never, { ...baseCtx });
      expect(out, JSON.stringify(msg)).toBe("ignored");
    }
    expect(vi.mocked(api.post)).not.toHaveBeenCalled();
  });

  it("an anchor reply is only honoured for the request that asked for it", async () => {
    const pending = new Set<string>();
    const seen: Array<{ ctx: unknown; requestId: string | null }> = [];
    const ctx = {
      ...baseCtx,
      pendingAnchorRequestIds: pending,
      onActiveAnchor: (c: unknown, requestId: string | null) => seen.push({ ctx: c, requestId }),
    };
    const reply = {
      source: CARE_OHIF_SOURCE,
      type: "active-anchor",
      studyInstanceUID: "1.2.840.study.a",
      seriesInstanceUID: "1.2.840.s",
      sopInstanceUID: "1.2.840.i",
      frameNumber: 3,
      requestId: "anc-never-asked",
    } as const;
    expect(await handleCareOhifMessage(reply as never, ctx)).toBe("ignored");
    expect(seen.length).toBe(0);

    pending.add("anc-1");
    expect(await handleCareOhifMessage({ ...reply, requestId: "anc-1" } as never, ctx)).toBe("ok");
    expect(seen.length).toBe(1);
    expect(pending.has("anc-1")).toBe(false); // consumed, so it cannot be replayed
    // D2: the reply has to name the question it answers, or the click that is
    // waiting cannot tell a fresh answer from one that arrived for an older ask.
    expect(seen[0].requestId).toBe("anc-1");

    // A push the viewer made on its own answers nothing.
    pending.add("anc-2");
    expect(await handleCareOhifMessage({ ...reply, requestId: undefined } as never, ctx)).toBe("ok");
    expect(seen.length).toBe(2);
    expect(seen[1].requestId).toBe(null);
    expect(pending.has("anc-2")).toBe(true); // still waiting for ITS answer
  });

  it("a refusal from the viewer ends the request instead of leaving it to expire", async () => {
    // The viewer says "nothing addressable is on screen". Silently dropping that
    // would leave the ERP waiting for its timeout, so the refusal is consumed by
    // requestId — and it is still not an anchor.
    const pending = new Set(["anc-1"]);
    let unavailable = 0;
    let applied = 0;
    const refusals: Array<{ reason?: string; requestId?: string | null }> = [];
    const ctx = {
      ...baseCtx,
      pendingAnchorRequestIds: pending,
      onActiveAnchor: () => { applied += 1; },
      onActiveAnchorUnavailable: (reason?: string, requestId?: string | null) => {
        unavailable += 1;
        refusals.push({ reason, requestId });
      },
    };
    const refusal = {
      source: CARE_OHIF_SOURCE,
      type: "displayed-anchor-unavailable",
      version: 1,
      error: "no_displayed_image",
      requestId: "anc-1",
    } as const;

    expect(await handleCareOhifMessage(refusal as never, ctx)).toBe("ok");
    expect(unavailable).toBe(1);
    expect(applied).toBe(0);
    expect(pending.has("anc-1")).toBe(false);
    // The radiologist has to be told WHY nothing was attached, and only the click
    // that asked may be told — the viewer's own words are the only evidence.
    expect(refusals[0]).toEqual({ reason: "no_displayed_image", requestId: "anc-1" });

    // A refusal for a request nobody made is silence, not a warning.
    expect(await handleCareOhifMessage({ ...refusal, requestId: "anc-old" } as never, ctx)).toBe("ignored");
    expect(unavailable).toBe(1);
  });

  it("an anchor that cannot identify an image says so instead of anchoring the study", async () => {
    let unavailable = 0;
    let applied = 0;
    const out = await handleCareOhifMessage(
      { source: CARE_OHIF_SOURCE, type: "active-anchor", studyInstanceUID: "1.2.840.study.a" } as never,
      {
        ...baseCtx,
        onActiveAnchor: () => { applied += 1; },
        onActiveAnchorUnavailable: () => { unavailable += 1; },
      },
    );
    expect(out).toBe("ignored");
    expect(applied).toBe(0);
    expect(unavailable).toBe(1);
  });

  it("a displayed-anchor request is never broadcast to *", async () => {
    const postMessage = vi.fn();
    const target = { postMessage } as unknown as Window;
    expect(requestOhifDisplayedAnchor({ target, requestId: "anc-1" })).toBe(false);
    expect(postMessage).not.toHaveBeenCalled();
    expect(requestOhifDisplayedAnchor({
      target,
      requestId: "anc-1",
      targetOrigin: "https://ohif.example",
    })).toBe(true);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        source: CARE_REPORTING_SOURCE,
        type: "displayed-anchor-request",
        version: 1,
        requestId: "anc-1",
      }),
      "https://ohif.example",
    );
  });
});

describe("the window that travels with the anchor (OHIF window/level)", () => {
  const baseAnchor = {
    source: CARE_OHIF_SOURCE,
    type: "active-anchor" as const,
    studyInstanceUID: "1.2.826.0.1.1",
    seriesInstanceUID: "1.2.826.0.1.2",
    sopInstanceUID: "1.2.826.0.1.3",
    frameNumber: 5,
    requestId: "wl-1",
  };

  it("validOhifVoi accepts exactly the pair the viewer may name", () => {
    expect(validOhifVoi({ windowWidth: 400, windowCenter: 40 })).toEqual({ windowWidth: 400, windowCenter: 40 });
    expect(validOhifVoi({ windowWidth: 1500.5, windowCenter: -600.25 })).toEqual({
      windowWidth: 1500.5,
      windowCenter: -600.25,
    });
  });

  it("validOhifVoi refuses a window that is not one, rather than repairing it", () => {
    for (const bad of [
      {},
      { windowWidth: 400 },
      { windowCenter: 40 },
      { windowWidth: 0, windowCenter: 40 },
      { windowWidth: -400, windowCenter: 40 },
      { windowWidth: Number.NaN, windowCenter: 40 },
      { windowWidth: Number.POSITIVE_INFINITY, windowCenter: 40 },
      { windowWidth: "400" as unknown as number, windowCenter: 40 },
    ]) {
      expect(validOhifVoi(bad)).toBeNull();
    }
  });

  it("the anchor's window reaches the viewport context it will be attached under", () => {
    const ctx = ohifActiveAnchorToViewport({ ...baseAnchor, windowWidth: 1500, windowCenter: -600 });
    expect(ctx.windowWidth).toBe(1500);
    expect(ctx.windowCenter).toBe(-600);
    expect(ctx.sopInstanceUID).toBe("1.2.826.0.1.3"); // identity unaffected
  });

  it("an anchor without a window answers identity only — nothing is invented", () => {
    const ctx = ohifActiveAnchorToViewport(baseAnchor);
    expect("windowWidth" in ctx).toBe(false);
    expect("windowCenter" in ctx).toBe(false);
    expect(ctx.sopInstanceUID).toBe("1.2.826.0.1.3");
  });

  it("an unusable window is dropped, and the identity keeps flowing", () => {
    const ctx = ohifActiveAnchorToViewport({ ...baseAnchor, windowWidth: Number.NaN, windowCenter: 40 });
    expect("windowWidth" in ctx).toBe(false);
    expect("windowCenter" in ctx).toBe(false);
    expect(ctx.sopInstanceUID).toBe("1.2.826.0.1.3");
  });

  it("a window-bearing anchor still passes the message gate", () => {
    expect(isCareOhifMessage({ ...baseAnchor, windowWidth: 400, windowCenter: 40 })).toBe(true);
  });
});

describe("ohifAnchorFailureText — what the radiologist is told when identity is unknown", () => {
  const reasons = [
    "no_viewer",
    "no_origin",
    "not_sent",
    "timeout",
    "services_unavailable",
    "no_active_viewport",
    "no_displayed_image",
    "unparsable_image_id",
    "incomplete_identity",
    "unsupported_version",
  ];

  for (const reason of reasons) {
    it(`"${reason}" says out loud that nothing reached the report`, () => {
      const text = ohifAnchorFailureText(reason);
      expect(text.length).toBeGreaterThan(24);
      expect(/nothing was attached|use frames|needs rebuilding/i.test(text)).toBe(true);
    });
  }

  it("a reason CARE has never seen still becomes a sentence, not a blank toast", () => {
    expect(ohifAnchorFailureText("brand_new_viewer_reason")).toContain("brand_new_viewer_reason");
    expect(ohifAnchorFailureText(undefined)).toContain("could not identify the displayed image");
    // The one thing every branch owes the radiologist, whatever the reason.
    expect(ohifAnchorFailureText("brand_new_viewer_reason")).toContain("Nothing was attached to this report.");
    expect(ohifAnchorFailureText(undefined)).toContain("Nothing was attached to this report.");
  });
});

describe("key-image from the viewer — no silent drops", () => {
  beforeEach(() => {
    vi.mocked(api.post).mockReset();
    vi.mocked(api.post).mockResolvedValue({} as never);
  });

  const KEY_IMAGE = {
    source: CARE_OHIF_SOURCE,
    type: "key-image",
    studyInstanceUID: "1.2.3",
    seriesInstanceUID: "1.2.3.4",
    sopInstanceUID: "1.2.3.4.5",
  } as const;

  it("a key-image with no draft yet asks the workspace to create one and retries the save", async () => {
    // The audited defect: a fresh study (no draft) silently dropped the FIRST
    // key image saved from the OHIF toolbar — "error" was returned to nobody.
    const ensureDraft = vi.fn().mockResolvedValue(77);
    const r = await handleCareOhifMessage(
      { ...KEY_IMAGE },
      {
        patientId: 1,
        studyId: 2,
        draftId: null,
        studyInstanceUID: "1.2.3",
        ensureDraft,
        onKeyImageDropped: vi.fn(),
      },
    );
    expect(r).toBe("ok");
    expect(ensureDraft).toHaveBeenCalled();
    expect(api.post).toHaveBeenCalledWith(
      "/api/radiology/report-generator/key-images/from-pacs",
      expect.objectContaining({ draftId: 77 }),
    );
  });

  it("a key-image with no draft and no ensure path says the drop out loud", async () => {
    const onKeyImageDropped = vi.fn();
    const r = await handleCareOhifMessage(
      { ...KEY_IMAGE },
      { patientId: 1, studyId: 2, draftId: null, studyInstanceUID: "1.2.3", onKeyImageDropped },
    );
    expect(r).toBe("error");
    expect(onKeyImageDropped).toHaveBeenCalledWith("no_draft");
    expect(api.post).not.toHaveBeenCalled();
  });

  it("a failed save reports the drop instead of vanishing", async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error("offline"));
    const onKeyImageDropped = vi.fn();
    const r = await handleCareOhifMessage(
      { ...KEY_IMAGE },
      { patientId: 1, studyId: 2, draftId: 5, studyInstanceUID: "1.2.3", onKeyImageDropped },
    );
    expect(r).toBe("error");
    expect(onKeyImageDropped).toHaveBeenCalledWith("save_failed");
  });
});
