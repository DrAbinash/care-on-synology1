import { describe, expect, it } from "vitest";
import {
  CARE_REPORT_FORMAT_IDENTITY_KIND,
  CARE_STRUCTURED_FORMAT_STATE_KIND,
  STRUCTURED_JSON_ENVELOPE_KIND,
  composeStructuredJsonColumn,
  extractA4Cache,
  extractCareReportFormatIdentity,
  extractCareStructuredFormat,
} from "./structuredJsonColumn";

const FORMAT = {
  kind: CARE_STRUCTURED_FORMAT_STATE_KIND,
  formatId: 9,
  formatVersion: 2,
  values: { "discs::l4-5::morphology": "bulge" },
  updatedAt: "2026-08-17T00:00:00.000Z",
} as const;

const CACHE = [{ findingId: 1, source: "quickselect" }];

describe("structured_json envelope (A4 cache + format values)", () => {
  it("legacy array is returned unchanged when there is no format state", () => {
    expect(composeStructuredJsonColumn({ existing: CACHE })).toEqual(CACHE);
    expect(extractA4Cache(CACHE)).toEqual(CACHE);
    expect(extractCareStructuredFormat(CACHE)).toBeNull();
  });

  it("null cache with no format state stays null", () => {
    expect(composeStructuredJsonColumn({ existing: null, a4Cache: null })).toBeNull();
  });

  it("wraps A4 array when format state is present so drift still sees the array", () => {
    const col = composeStructuredJsonColumn({ existing: CACHE, formatState: FORMAT });
    expect(col).toEqual({
      kind: STRUCTURED_JSON_ENVELOPE_KIND,
      a4Cache: CACHE,
      careStructuredFormat: FORMAT,
    });
    expect(extractA4Cache(col)).toEqual(CACHE);
    expect(extractCareStructuredFormat(col)).toEqual(FORMAT);
  });

  it("A4 regen updates cache without dropping format values", () => {
    const existing = composeStructuredJsonColumn({ existing: CACHE, formatState: FORMAT });
    const nextCache = [{ findingId: 2 }];
    const col = composeStructuredJsonColumn({ existing, a4Cache: nextCache });
    expect(extractA4Cache(col)).toEqual(nextCache);
    expect(extractCareStructuredFormat(col)).toEqual(FORMAT);
  });

  it("empty A4 cache + format state is an envelope, not null (so values survive deselect-all)", () => {
    const col = composeStructuredJsonColumn({ existing: CACHE, a4Cache: null, formatState: FORMAT });
    expect(extractA4Cache(col)).toBeNull();
    expect(extractCareStructuredFormat(col)).toEqual(FORMAT);
  });

  it("preserves observation ledger on the envelope without dropping A4 cache", () => {
    const ledger = { kind: "care.observation_ledger.v1", version: 1, patches: [] };
    const col = composeStructuredJsonColumn({
      existing: CACHE,
      formatState: FORMAT,
      observationLedger: ledger,
    });
    expect(extractA4Cache(col)).toEqual(CACHE);
    expect(extractCareStructuredFormat(col)).toEqual(FORMAT);
    expect((col as { careObservationLedger?: unknown }).careObservationLedger).toEqual(ledger);
  });

  it("preserves viewer measurements and canal provenance on the envelope", () => {
    const ms = { kind: "care.viewer_measurements.v1", version: 1, items: [] };
    const canal = { "L4-L5": { level: "L4-L5", manualOverride: true } };
    const col = composeStructuredJsonColumn({
      existing: CACHE,
      formatState: FORMAT,
      viewerMeasurements: ms,
      canalApProvenance: canal,
    });
    expect(extractA4Cache(col)).toEqual(CACHE);
    expect((col as { careViewerMeasurements?: unknown }).careViewerMeasurements).toEqual(ms);
    expect((col as { careCanalApProvenance?: unknown }).careCanalApProvenance).toEqual(canal);
  });

  it("bounds oversized viewer measurement payloads to the newest items", () => {
    const items = Array.from({ length: 450 }, (_, i) => ({ id: `m-${i}` }));
    const col = composeStructuredJsonColumn({
      existing: null,
      formatState: FORMAT,
      viewerMeasurements: { kind: "care.viewer_measurements.v1", version: 1, items },
    });
    const stored = (col as { careViewerMeasurements?: { items: unknown[] } }).careViewerMeasurements;
    expect(stored?.items).toHaveLength(400);
    expect(stored?.items[0]).toEqual({ id: "m-50" });
    expect(stored?.items[399]).toEqual({ id: "m-449" });
  });

  // ── careReportFormatIdentity (normal auto-bootstrap baseline) ────────────

  const IDENTITY = {
    kind: CARE_REPORT_FORMAT_IDENTITY_KIND,
    name: "MRI Brain — Normal",
    reportTitle: "MRI BRAIN PLAIN",
    appliedAt: "2026-09-04T00:00:00.000Z",
  } as const;

  it("identity alone turns the column into an envelope without dropping legacy array", () => {
    const col = composeStructuredJsonColumn({ existing: CACHE, reportFormatIdentity: IDENTITY });
    expect(extractA4Cache(col)).toEqual(CACHE);
    expect(extractCareReportFormatIdentity(col)).toEqual(IDENTITY);
  });

  it("identity round-trips alongside format state, ledger and measurements", () => {
    const ledger = { kind: "care.observation_ledger.v1", version: 1, patches: [] };
    const col = composeStructuredJsonColumn({
      existing: CACHE,
      formatState: FORMAT,
      observationLedger: ledger,
      reportFormatIdentity: IDENTITY,
    });
    expect(extractA4Cache(col)).toEqual(CACHE);
    expect(extractCareStructuredFormat(col)).toEqual(FORMAT);
    expect(extractCareReportFormatIdentity(col)).toEqual(IDENTITY);
    // Saving again with the same identity is idempotent.
    const again = composeStructuredJsonColumn({ existing: col, reportFormatIdentity: IDENTITY });
    expect(again).toEqual(col);
  });

  it("identity is preserved when other keys are re-written (merge-preserving)", () => {
    const withIdentity = composeStructuredJsonColumn({ existing: CACHE, reportFormatIdentity: IDENTITY });
    const nextCache = [{ findingId: 3 }];
    const regen = composeStructuredJsonColumn({ existing: withIdentity, a4Cache: nextCache });
    expect(extractA4Cache(regen)).toEqual(nextCache);
    expect(extractCareReportFormatIdentity(regen)).toEqual(IDENTITY);
  });

  it("malformed identity payloads are ignored, not persisted", () => {
    expect(extractCareReportFormatIdentity(null)).toBeNull();
    expect(extractCareReportFormatIdentity({ kind: CARE_REPORT_FORMAT_IDENTITY_KIND })).toBeNull();
    expect(extractCareReportFormatIdentity({ kind: CARE_REPORT_FORMAT_IDENTITY_KIND, name: "  " })).toBeNull();
    expect(extractCareReportFormatIdentity({ unrelated: true })).toBeNull();
  });
});
