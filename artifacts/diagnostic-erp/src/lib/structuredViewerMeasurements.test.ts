import { describe, expect, it } from "vitest";
import {
  detachStructuredMeasurementsFromObservation,
  emptyViewerMeasurementsState,
  formatMeasurementChip,
  parseNumericAxes,
  removeStructuredMeasurementByAnnotation,
  shouldAttachToSelectedObservation,
  shouldAutoPopulateCanal,
  structuredFromViewerRow,
  upsertStructuredMeasurement,
  annotationIdFromCoordinates,
} from "./structuredViewerMeasurements";
import {
  armCanalCapture,
  pickEligibleCanalCaptureRow,
} from "./spineCanalAp";

describe("structuredViewerMeasurements", () => {
  it("parses 1–3 axes from viewer strings", () => {
    expect(parseNumericAxes("22 × 18 mm")).toMatchObject({ primary: 22, secondary: 18 });
    expect(parseNumericAxes("6.7")).toMatchObject({ primary: 6.7 });
  });

  it("formats chips deterministically", () => {
    expect(
      formatMeasurementChip({
        id: "1",
        concept: "LESION",
        values: { primary: 22, secondary: 18, unit: "mm" },
        createdAt: "",
        updatedAt: "",
        manualOverride: false,
      }),
    ).toBe("22 × 18 mm");
  });

  it("upserts by annotation id (idempotent update, no duplicate)", () => {
    let state = emptyViewerMeasurementsState();
    state = upsertStructuredMeasurement(state, {
      concept: "LESION",
      values: { primary: 22, secondary: 18, unit: "mm" },
      viewerAnnotationId: "ABC",
      manualOverride: false,
    });
    state = upsertStructuredMeasurement(state, {
      concept: "LESION",
      values: { primary: 23, secondary: 19, unit: "mm" },
      viewerAnnotationId: "ABC",
      manualOverride: false,
    });
    expect(state.items).toHaveLength(1);
    expect(state.items[0].values.primary).toBe(23);
  });

  it("annotation delete removes structured row", () => {
    let state = emptyViewerMeasurementsState();
    state = upsertStructuredMeasurement(state, {
      concept: "OTHER",
      values: { primary: 5, unit: "mm" },
      viewerAnnotationId: "DEL",
      manualOverride: false,
    });
    state = removeStructuredMeasurementByAnnotation(state, "DEL");
    expect(state.items).toHaveLength(0);
  });

  it("observation detach preserves measurement rows", () => {
    let state = emptyViewerMeasurementsState();
    state = upsertStructuredMeasurement(state, {
      concept: "LESION",
      values: { primary: 10, unit: "mm" },
      viewerAnnotationId: "X",
      observationId: "obs-1",
      manualOverride: false,
    });
    const { state: next, detached } = detachStructuredMeasurementsFromObservation(state, "obs-1");
    expect(detached).toBe(1);
    expect(next.items[0].observationId).toBeNull();
  });

  it("unknown ruler does not auto-populate canal without intent/level", () => {
    expect(shouldAutoPopulateCanal({ intent: "OTHER", spinalLevel: "L4-L5" })).toBe(false);
    expect(shouldAutoPopulateCanal({ intent: null, spinalLevel: null })).toBe(false);
    expect(shouldAutoPopulateCanal({ intent: "CANAL_AP", spinalLevel: "L4-L5" })).toBe(true);
  });

  it("null/unknown intent does NOT attach to selected observation", () => {
    expect(
      shouldAttachToSelectedObservation({ intent: "LESION", selectedObservationId: "o1" }),
    ).toBe(true);
    expect(
      shouldAttachToSelectedObservation({ intent: "CANAL_AP", selectedObservationId: "o1" }),
    ).toBe(false);
    expect(
      shouldAttachToSelectedObservation({ intent: null, selectedObservationId: "o1" }),
    ).toBe(false);
    expect(
      shouldAttachToSelectedObservation({ intent: undefined, selectedObservationId: "o1" }),
    ).toBe(false);
  });

  it("manual override on structured row is not overwritten by upsert", () => {
    let state = emptyViewerMeasurementsState();
    state = upsertStructuredMeasurement(state, {
      concept: "LESION",
      values: { primary: 22, unit: "mm" },
      viewerAnnotationId: "M",
      manualOverride: true,
    });
    state = upsertStructuredMeasurement(state, {
      concept: "LESION",
      values: { primary: 99, unit: "mm" },
      viewerAnnotationId: "M",
      manualOverride: true,
    });
    expect(state.items[0].values.primary).toBe(22);
  });

  it("historical hydration: old row + current CANAL_AP does not become canal", () => {
    const row = structuredFromViewerRow({
      row: {
        id: 10,
        value: "6.8",
        unit: "mm",
        measurementType: "linear",
        studyInstanceUID: "1.2.3",
        imageCoordinates: JSON.stringify({ annotationId: "old-1" }),
      },
      mode: "historical",
      liveIntent: "CANAL_AP",
      liveCanalLevel: "L4-L5",
      liveSelectedObservationId: "obs-live",
    });
    expect(row.concept).toBe("OTHER");
    expect(row.spinalLevel).toBeNull();
    expect(row.observationId).toBeNull();
  });

  it("historical hydration: old row + selected observation stays unattached", () => {
    const row = structuredFromViewerRow({
      row: {
        id: 11,
        value: "12",
        unit: "mm",
        measurementType: "linear",
        studyInstanceUID: "1.2.3",
      },
      mode: "historical",
      liveIntent: "LESION",
      liveSelectedObservationId: "obs-selected",
    });
    expect(row.observationId).toBeNull();
  });

  it("historical hydration: old row + current L4-L5 target does not acquire L4-L5", () => {
    const row = structuredFromViewerRow({
      row: {
        id: 12,
        value: "7.1",
        unit: "mm",
        measurementType: "linear",
        studyInstanceUID: "1.2.3",
        imageCoordinates: JSON.stringify({ intent: "CANAL_AP" }),
      },
      mode: "historical",
      liveCanalLevel: "L4-L5",
      liveIntent: "CANAL_AP",
    });
    expect(row.concept).toBe("CANAL_AP");
    expect(row.spinalLevel).toBeNull();
  });

  it("row provenance wins over activeAnchor (SOP/frame A retained)", () => {
    const row = structuredFromViewerRow({
      row: {
        id: 13,
        value: "5",
        unit: "mm",
        studyInstanceUID: "1.2.3",
        seriesInstanceUID: "1.2.3.A",
        sopInstanceUID: "1.2.3.A.1",
        frameNumber: 4,
        viewerName: "OHIF",
      },
      mode: "historical",
      liveActiveAnchor: {
        studyInstanceUID: "1.2.3",
        seriesInstanceUID: "1.2.3.B",
        sopInstanceUID: "1.2.3.B.9",
        frameNumber: 99,
        viewer: "ohif",
        capturedAt: new Date().toISOString(),
      },
    });
    expect(row.anchor?.sopInstanceUID).toBe("1.2.3.A.1");
    expect(row.anchor?.frameNumber).toBe(4);
  });

  it("new_event may stamp live intent/level/observation", () => {
    const row = structuredFromViewerRow({
      row: {
        id: 14,
        value: "6.5",
        unit: "mm",
        studyInstanceUID: "1.2.3",
        measurementType: "linear",
        imageCoordinates: JSON.stringify({ annotationId: "new-1" }),
      },
      mode: "new_event",
      liveIntent: "CANAL_AP",
      liveCanalLevel: "L4-L5",
    });
    expect(row.concept).toBe("CANAL_AP");
    expect(row.spinalLevel).toBe("L4-L5");
  });

  it("annotationId from coordinates is distinct from viewerMeasurementRowId", () => {
    const coords = JSON.stringify({ annotationId: "OHIF-ANN-99", intent: "CANAL_AP" });
    expect(annotationIdFromCoordinates(coords)).toBe("OHIF-ANN-99");
    const row = structuredFromViewerRow({
      row: {
        id: 120,
        value: "6.8",
        unit: "mm",
        studyInstanceUID: "1.2.3",
        imageCoordinates: coords,
        measurementId: "CANAL_AP",
        measurementType: "L4-L5",
      },
      mode: "historical",
    });
    expect(row.viewerMeasurementRowId).toBe(120);
    expect(row.viewerAnnotationId).toBe("OHIF-ANN-99");
    expect(String(row.viewerMeasurementRowId)).not.toBe(row.viewerAnnotationId);
  });

  it("structuredFromViewerRow maps MIDLINE_SHIFT and attaches on new_event only", () => {
    const hist = structuredFromViewerRow({
      row: { id: 9, value: "4.2 mm", unit: "mm", studyInstanceUID: "1.2.3" },
      mode: "historical",
      liveIntent: "MIDLINE_SHIFT",
      liveSelectedObservationId: "obs-1",
    });
    expect(hist.observationId).toBeNull();

    const neu = structuredFromViewerRow({
      row: {
        id: 9,
        value: "4.2 mm",
        unit: "mm",
        studyInstanceUID: "1.2.3",
        imageCoordinates: JSON.stringify({ intent: "MIDLINE_SHIFT" }),
      },
      mode: "new_event",
      liveIntent: "MIDLINE_SHIFT",
      liveSelectedObservationId: "obs-1",
    });
    expect(neu.concept).toBe("MIDLINE_SHIFT");
    expect(neu.observationId).toBe("obs-1");
  });
});

describe("canal capture arm watermark", () => {
  const parseAnn = annotationIdFromCoordinates;

  it("arming with historical rows rejects all existing ids", () => {
    const rows = [
      { id: 10, value: "6.1", status: "pending", createdAt: "2026-01-01T00:00:00Z", imageCoordinates: JSON.stringify({ annotationId: "a10" }) },
      { id: 120, value: "6.8", status: "pending", createdAt: "2026-01-02T00:00:00Z", imageCoordinates: JSON.stringify({ annotationId: "a120" }) },
    ];
    const arm = armCanalCapture("L4-L5", rows, parseAnn, Date.parse("2026-01-03T00:00:00Z"));
    expect(arm.maxExistingRowId).toBe(120);
    expect(pickEligibleCanalCaptureRow(arm, rows, parseAnn, new Set())).toBeNull();
  });

  it("next new row above watermark is consumed exactly once", () => {
    const historical = [
      { id: 120, value: "6.8", status: "pending", createdAt: "2026-01-02T00:00:00Z" },
    ];
    const arm = armCanalCapture("L4-L5", historical, parseAnn, Date.parse("2026-01-03T00:00:00Z"));
    const withNew = [
      ...historical,
      {
        id: 121,
        value: "7.2",
        status: "pending",
        createdAt: "2026-01-03T00:00:01Z",
        imageCoordinates: JSON.stringify({ annotationId: "a121" }),
        studyInstanceUID: "1.2.3",
        sopInstanceUID: "1.2.3.9",
      },
    ];
    const first = pickEligibleCanalCaptureRow(arm, withNew, parseAnn, new Set());
    expect(first?.id).toBe(121);
    const consumed = new Set([first!.id]);
    const second = pickEligibleCanalCaptureRow(arm, withNew, parseAnn, consumed);
    expect(second).toBeNull();
  });

  it("re-arm required after consume — old watermark still blocks prior rows", () => {
    const rows = [
      { id: 120, value: "6.8", status: "pending", createdAt: "2026-01-02T00:00:00Z" },
      { id: 121, value: "7.2", status: "pending", createdAt: "2026-01-03T00:00:01Z" },
    ];
    const arm1 = armCanalCapture("L4-L5", [{ id: 120, value: "6.8", status: "pending" }], parseAnn);
    const hit = pickEligibleCanalCaptureRow(arm1, rows, parseAnn, new Set());
    expect(hit?.id).toBe(121);
    // After disarm+re-arm with both present, neither is eligible until 122 arrives.
    const arm2 = armCanalCapture("L4-L5", rows, parseAnn);
    expect(pickEligibleCanalCaptureRow(arm2, rows, parseAnn, new Set())).toBeNull();
    const rows3 = [...rows, { id: 122, value: "5.9", status: "pending", createdAt: "2026-01-04T00:00:00Z" }];
    expect(pickEligibleCanalCaptureRow(arm2, rows3, parseAnn, new Set())?.id).toBe(122);
  });
});
