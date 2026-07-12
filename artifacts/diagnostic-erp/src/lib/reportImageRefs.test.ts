import { describe, it, expect } from "vitest";
import {
  buildImageRefPayload, launchQueryForRef, MAX_REPORT_IMAGES, nextDisplayOrder,
  ohifUrlForRef, reorderIds, thumbnailRenderedUrl,
} from "./reportImageRefs";

// Ticket R1.1 — pure helpers behind the workspace image picker. Selected
// images persist as DICOM references ONLY; these tests pin that contract.

describe("buildImageRefPayload (Phase 10)", () => {
  const input = {
    draftId: 6,
    studyId: 2,
    studyInstanceUID: "1.2.840.1",
    seriesInstanceUID: "1.2.840.2",
    sopInstanceUID: "1.2.840.3",
    caption: "T2 Axial",
    displayOrder: 2,
  };

  it("persists exactly the reference fields — never pixels or blob URLs", () => {
    const payload = buildImageRefPayload(input);
    expect(payload).toEqual({
      draftId: 6,
      studyId: 2,
      studyInstanceUid: "1.2.840.1",
      seriesInstanceUid: "1.2.840.2",
      sopInstanceUid: "1.2.840.3",
      description: "T2 Axial",
      displayOrder: 2,
    });
    expect(JSON.stringify(payload)).not.toContain("blob:");
    expect(JSON.stringify(payload)).not.toContain("data:");
  });

  it("includes frameNumber only when meaningful; caption capped at 500", () => {
    expect(buildImageRefPayload({ ...input, frameNumber: 4 }).frameNumber).toBe(4);
    expect(buildImageRefPayload({ ...input, frameNumber: 0 }).frameNumber).toBeUndefined();
    const long = buildImageRefPayload({ ...input, caption: "x".repeat(600) });
    expect((long.description as string).length).toBe(500);
    expect(buildImageRefPayload({ ...input, caption: "" }).description).toBe("Key image");
  });

  it("throws on malformed UIDs so bad references never persist", () => {
    expect(() => buildImageRefPayload({ ...input, sopInstanceUID: "not a uid" })).toThrow(/SOPInstanceUID/);
    expect(() => buildImageRefPayload({ ...input, studyInstanceUID: "" })).toThrow(/StudyInstanceUID/);
  });
});

describe("thumbnailRenderedUrl", () => {
  const ref = { studyInstanceUid: "1.1", seriesInstanceUid: "1.2", sopInstanceUid: "1.3" };

  it("builds the rendered URL on the SAME DICOMweb base the viewer uses", () => {
    expect(thumbnailRenderedUrl("http://192.168.1.137:8042/dicom-web/", ref, 96))
      .toBe("http://192.168.1.137:8042/dicom-web/studies/1.1/series/1.2/instances/1.3/rendered?quality=80&viewport=96,96");
    expect(thumbnailRenderedUrl("http://x/dicom-web", { ...ref, frameNumber: 2 }))
      .toContain("/frames/2/rendered");
  });

  it("returns null for incomplete references", () => {
    expect(thumbnailRenderedUrl("http://x", { ...ref, sopInstanceUid: null })).toBeNull();
  });
});

describe("ohifUrlForRef (Phase 11) + nextDisplayOrder", () => {
  it("only http(s) launch URLs pass through — no raw/empty targets", () => {
    expect(ohifUrlForRef("http://192.168.1.137:3010/viewer?StudyInstanceUIDs=1.2")).toContain("/viewer");
    expect(ohifUrlForRef("weasis://x")).toBeNull();
    expect(ohifUrlForRef(null)).toBeNull();
    expect(ohifUrlForRef("")).toBeNull();
  });

  it("nextDisplayOrder appends after the maximum", () => {
    expect(nextDisplayOrder([])).toBe(0);
    expect(nextDisplayOrder([{ displayOrder: 0 }, { displayOrder: 3 }])).toBe(4);
  });
});

// ── R1.3 — enterprise image panel helpers ────────────────────────────────────

describe("R1.3 — buildImageRefPayload key-image flag", () => {
  const input = {
    draftId: 6, studyInstanceUID: "1.2.840.1", seriesInstanceUID: "1.2.840.2",
    sopInstanceUID: "1.2.840.3", caption: "T2 Axial", displayOrder: 0,
  };

  it("includes isKeyImage only when true (byte-stable payload otherwise)", () => {
    expect(buildImageRefPayload(input).isKeyImage).toBeUndefined();
    expect(buildImageRefPayload({ ...input, isKeyImage: false }).isKeyImage).toBeUndefined();
    expect(buildImageRefPayload({ ...input, isKeyImage: true }).isKeyImage).toBe(true);
  });
});

describe("R1.3 — launchQueryForRef (server-built deep launch)", () => {
  it("names the exact series + SOP for the server to resolve", () => {
    expect(launchQueryForRef({ seriesInstanceUid: "1.2.840.2", sopInstanceUid: "1.2.840.3" }))
      .toBe("?seriesInstanceUID=1.2.840.2&sopInstanceUID=1.2.840.3");
  });

  it("series-only refs launch at series level", () => {
    expect(launchQueryForRef({ seriesInstanceUid: "1.2.840.2", sopInstanceUid: null }))
      .toBe("?seriesInstanceUID=1.2.840.2");
  });

  it("missing or malformed UIDs never reach the server", () => {
    expect(launchQueryForRef({ seriesInstanceUid: null, sopInstanceUid: "1.2.840.3" })).toBe("");
    expect(launchQueryForRef({ seriesInstanceUid: "not a uid", sopInstanceUid: "1.2.840.3" })).toBe("");
    expect(launchQueryForRef({ seriesInstanceUid: "1.2.840.2", sopInstanceUid: "<script>" }))
      .toBe("?seriesInstanceUID=1.2.840.2"); // bad SOP dropped, series survives
  });
});

describe("R1.3 — reorderIds (pure drag-reorder)", () => {
  it("moves forward and backward without mutating the input", () => {
    const ids = [10, 20, 30, 40];
    expect(reorderIds(ids, 0, 2)).toEqual([20, 30, 10, 40]);
    expect(reorderIds(ids, 3, 0)).toEqual([40, 10, 20, 30]);
    expect(ids).toEqual([10, 20, 30, 40]);
  });

  it("no-ops on same-position or out-of-range moves", () => {
    expect(reorderIds([1, 2], 1, 1)).toEqual([1, 2]);
    expect(reorderIds([1, 2], -1, 0)).toEqual([1, 2]);
    expect(reorderIds([1, 2], 0, 5)).toEqual([1, 2]);
  });

  it("panel capacity is 100 images", () => {
    expect(MAX_REPORT_IMAGES).toBe(100);
  });
});
