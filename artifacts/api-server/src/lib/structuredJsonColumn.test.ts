import { describe, expect, it } from "vitest";
import {
  CARE_REPORT_FORMAT_IDENTITY_KIND,
  CARE_STRUCTURED_FORMAT_STATE_KIND,
  STRUCTURED_JSON_ENVELOPE_KIND,
  composeStructuredJsonColumn,
  extractA4Cache,
  extractCareLinkedStudy,
  extractCareRegionTransitions,
  extractCareReportFormatIdentity,
  extractCareStructuredFormat,
  isStructuredJsonEnvelope,
  extractCareVascularTechnique,
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

  it("preserves MRI brain vascular technique across a cache regeneration", () => {
    const vascular = {
      acquired: { mraTof: true, mraCe: false },
      manual: { mraCe: false },
      designationNote: null,
    };
    const col = composeStructuredJsonColumn({
      existing: CACHE,
      formatState: FORMAT,
      vascularTechnique: vascular,
    });
    expect(extractA4Cache(col)).toEqual(CACHE);
    expect(extractCareVascularTechnique(col)).toEqual(vascular);

    // The A4 cache regeneration on a finding-instance change must not drop it:
    // losing this state reverts the radiologist's acquisition answers.
    const regen = composeStructuredJsonColumn({ existing: col, a4Cache: [{ findingId: 4 }] });
    expect(extractCareVascularTechnique(regen)).toEqual(vascular);
    expect(extractA4Cache(regen)).toEqual([{ findingId: 4 }]);
  });

  it("adds no vascular envelope key to a report that never stated acquisition", () => {
    const col = composeStructuredJsonColumn({ existing: CACHE, formatState: FORMAT });
    expect((col as { careVascularTechnique?: unknown }).careVascularTechnique).toBeUndefined();
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
    name: "MRI LS Spine — Standard Normal",
    reportTitle: "MRI LUMBOSACRAL SPINE",
    appliedAt: "2026-09-04T00:00:00.000Z",
    formatId: "42",
    formatRevision: "fnv1a-1234abcd",
    baselineManifestVersion: 1,
    baselineManifestRevision: "mri-ls-standard-normal-r1",
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

  it("stores linkedStudyId on the envelope and keeps it across cache rewrites", () => {
    const linked = {
      studyId: 88,
      title: "MRI CERVICAL SPINE",
      modality: "MR",
      studyDescription: "MRI Cervical Spine",
    };
    const col = composeStructuredJsonColumn({ existing: CACHE, linkedStudy: linked });
    expect(extractCareLinkedStudy(col)).toEqual({
      ...linked,
      region: null,
      accessionNumber: null,
      studyInstanceUID: null,
    });
    expect((col as { linkedStudyId?: number }).linkedStudyId).toBe(88);
    const regen = composeStructuredJsonColumn({ existing: col, a4Cache: [{ findingId: 3 }] });
    expect(extractCareLinkedStudy(regen)?.studyId).toBe(88);
    const cleared = composeStructuredJsonColumn({ existing: regen, linkedStudy: null });
    expect(extractCareLinkedStudy(cleared)).toBeNull();
  });

  it("treats a region-transition history as enough to compose an envelope", () => {
    const history = [{
      kind: "care.region_transition.v1",
      fromRegion: "Whole Spine",
      toRegion: "Cervical Spine",
      retired: [{ id: "d1", concept: "alignment", segment: "dorsal", text: "Dorsal spine: Normal." }],
      keptAbnormalities: [],
      manualLinesPreserved: 0,
      decidedBy: "abinashsingh@gmail.com",
      at: "2026-10-12T09:00:00.000Z",
    }];
    // A report whose only structured content is what it stopped claiming still needs the
    // envelope. composeStructuredJsonColumn falls back to the legacy A4 shape when it
    // believes there is nothing to write, and that would erase the provenance silently.
    const col = composeStructuredJsonColumn({ existing: null, regionTransitions: history });
    expect(isStructuredJsonEnvelope(col)).toBe(true);
    expect(extractCareRegionTransitions(col)).toHaveLength(1);
    // A later save that says nothing about it keeps it — the same rule that protects the
    // ledger, the measurements and the vascular technique.
    const regen = composeStructuredJsonColumn({ existing: col, a4Cache: [{ findingId: 3 }] });
    expect(extractCareRegionTransitions(regen).map((r) => r.toRegion)).toEqual(["Cervical Spine"]);
    expect(extractCareRegionTransitions(regen)[0]!.retired).toHaveLength(1);
    // Garbage is dropped, not coerced into a claim about who removed a sentence.
    expect(extractCareRegionTransitions({ careRegionTransitions: [{ kind: "x" }, null] })).toEqual([]);
  });

  it("malformed identity payloads are ignored, not persisted", () => {
    expect(extractCareReportFormatIdentity(null)).toBeNull();
    expect(extractCareReportFormatIdentity({ kind: CARE_REPORT_FORMAT_IDENTITY_KIND })).toBeNull();
    expect(extractCareReportFormatIdentity({ kind: CARE_REPORT_FORMAT_IDENTITY_KIND, name: "  " })).toBeNull();
    expect(extractCareReportFormatIdentity({ unrelated: true })).toBeNull();
  });
});
