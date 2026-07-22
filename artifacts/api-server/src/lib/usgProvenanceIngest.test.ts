import { describe, it, expect } from "vitest";
import { buildSrViewerRows } from "./usgProvenanceIngest";
import { OB_SR_FIXTURE, SR_NO_IMAGE_FIXTURE, MALFORMED_FIXTURE } from "./__fixtures__/usgSrFixtures";

const ctx = { studyInstanceUID: "1.2.study", patientId: 42, studyId: 7 };

describe("P3 provenance ingest — row building (pure, fixture-backed)", () => {
  it("maps SR measurements to canonical viewer_measurements rows with real SOP + frame", () => {
    const rows = buildSrViewerRows(OB_SR_FIXTURE, ctx);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.viewerName === "DICOM SR")).toBe(true);
    expect(rows.every((r) => r.patientId === 42 && r.studyInstanceUID === "1.2.study")).toBe(true);
    // At least one row carries a real referenced frame.
    expect(rows.some((r) => typeof r.frameNumber === "number")).toBe(true);
  });

  it("NEVER fabricates a frame — a measurement with no image ref keeps frameNumber null", () => {
    const rows = buildSrViewerRows(SR_NO_IMAGE_FIXTURE, ctx);
    // Every row without a SOP reference must have a null frame (not 1).
    for (const r of rows) {
      if (!r.sopInstanceUID) expect(r.frameNumber).toBeNull();
    }
    expect(rows.some((r) => r.frameNumber === null)).toBe(true);
  });

  it("degrades safely on malformed SR JSON (no throw, no rows)", () => {
    expect(() => buildSrViewerRows(MALFORMED_FIXTURE, ctx)).not.toThrow();
    expect(buildSrViewerRows(MALFORMED_FIXTURE, ctx)).toEqual([]);
  });
});
