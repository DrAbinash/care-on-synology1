import { describe, expect, it } from "vitest";
import {
  detachStructuredMeasurementsFromObservation,
  emptyViewerMeasurementsState,
  formatMeasurementChip,
  parseNumericAxes,
  removeStructuredMeasurementByAnnotation,
  shouldAttachToSelectedObservation,
  shouldAutoPopulateCanal,
  upsertStructuredMeasurement,
} from "./structuredViewerMeasurements";

describe("structuredViewerMeasurements", () => {
  it("parses 1–3 axes from viewer strings", () => {
    expect(parseNumericAxes("22 × 18 mm")).toMatchObject({ primary: 22, secondary: 18 });
    expect(parseNumericAxes("6.7")).toMatchObject({ primary: 6.7 });
    expect(parseNumericAxes("10 x 8 x 6")).toMatchObject({
      primary: 10,
      secondary: 8,
      tertiary: 6,
    });
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
    expect(
      formatMeasurementChip({
        id: "2",
        concept: "CANAL_AP",
        spinalLevel: "L4-L5",
        values: { primary: 6.7, unit: "mm" },
        createdAt: "",
        updatedAt: "",
        manualOverride: false,
      }),
    ).toBe("AP 6.7 mm");
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
    expect(state.items[0].viewerAnnotationId).toBe("ABC");
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
    expect(next.items).toHaveLength(1);
  });

  it("unknown ruler does not auto-populate canal without intent/level", () => {
    expect(shouldAutoPopulateCanal({ intent: "OTHER", spinalLevel: "L4-L5" })).toBe(false);
    expect(shouldAutoPopulateCanal({ intent: null, spinalLevel: null })).toBe(false);
    expect(
      shouldAutoPopulateCanal({ intent: "CANAL_AP", spinalLevel: "L4-L5" }),
    ).toBe(true);
    expect(
      shouldAutoPopulateCanal({
        intent: "CANAL_AP",
        spinalLevel: "L3-L4",
        measurementId: "CANAL_AP",
      }),
    ).toBe(true);
  });

  it("midline / lesion attach to selected observation; canal does not", () => {
    expect(
      shouldAttachToSelectedObservation({ intent: "LESION", selectedObservationId: "o1" }),
    ).toBe(true);
    expect(
      shouldAttachToSelectedObservation({ intent: "MIDLINE_SHIFT", selectedObservationId: "o1" }),
    ).toBe(true);
    expect(
      shouldAttachToSelectedObservation({ intent: "CANAL_AP", selectedObservationId: "o1" }),
    ).toBe(false);
    expect(
      shouldAttachToSelectedObservation({ intent: "LESION", selectedObservationId: null }),
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

  it("upserts by viewerMeasurementRowId when annotation id absent", () => {
    let state = emptyViewerMeasurementsState();
    state = upsertStructuredMeasurement(state, {
      concept: "OTHER",
      values: { primary: 10, unit: "mm" },
      viewerMeasurementRowId: 42,
      manualOverride: false,
    });
    state = upsertStructuredMeasurement(state, {
      concept: "OTHER",
      values: { primary: 11, unit: "mm" },
      viewerMeasurementRowId: 42,
      manualOverride: false,
    });
    expect(state.items).toHaveLength(1);
    expect(state.items[0].values.primary).toBe(11);
  });
});
