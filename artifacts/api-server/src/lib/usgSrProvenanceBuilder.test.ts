import { describe, it, expect } from "vitest";
import { extractSrMeasurements } from "./usgSrContentTree";
import { provenanceLevel, viewerActions } from "./usgProvenance";
import { srMeasurementToProvenance, srMeasurementToViewerRow, measurementTypeFromGraphic } from "./usgSrProvenanceBuilder";
import { OB_SR_FIXTURE } from "./__fixtures__/usgSrFixtures";

const ms = extractSrMeasurements(OB_SR_FIXTURE as unknown as Record<string, unknown>);
const bpd = ms.find((m) => m.conceptText === "Biparietal diameter")!;
const renal = ms.find((m) => m.conceptText === "Renal length")!;
const ctx = { studyInstanceUID: "1.2.STUDY", seriesInstanceUID: "1.2.IMG.SERIES", srDocumentSop: "1.2.3.4.5.SR.1", patientId: 42 };

describe("P3.5 SR → provenance/viewer-row builder", () => {
  it("BPD → exact-frame-caliper provenance + full viewer actions", () => {
    const p = srMeasurementToProvenance(bpd, ctx);
    expect(provenanceLevel(p)).toBe("exact_frame_caliper");
    expect(viewerActions(p)).toEqual({ goToStudy: true, goToSeries: true, goToInstance: true, goToFrame: true, showOverlay: true });
  });

  it("BPD → viewer_measurements row with the real frame (3) and caliper coordinates", () => {
    const row = srMeasurementToViewerRow(bpd, ctx);
    expect(row.sopInstanceUID).toBe("1.2.3.4.5.IMG.7");
    expect(row.frameNumber).toBe(3);
    expect(row.viewerName).toBe("DICOM SR");
    expect(row.measurementType).toBe("linear"); // POLYLINE
    expect(JSON.parse(row.imageCoordinates!)).toEqual({ graphicType: "POLYLINE", graphicData: [10, 20, 84.2, 20] });
    expect(row.value).toBe("74.2");
    expect(row.status).toBe("pending");
  });

  it("a NUM with no image reference → frameNumber null (NOT fabricated as 1)", () => {
    const row = srMeasurementToViewerRow(renal, ctx);
    expect(row.sopInstanceUID).toBeNull();
    expect(row.frameNumber).toBeNull();
    expect(row.imageCoordinates).toBeNull();
    expect(provenanceLevel(srMeasurementToProvenance(renal, ctx))).toBe("sr_document");
  });

  it("graphic type maps to measurement type", () => {
    expect(measurementTypeFromGraphic("POLYLINE")).toBe("linear");
    expect(measurementTypeFromGraphic("ELLIPSE")).toBe("area");
    expect(measurementTypeFromGraphic("POINT")).toBe("point");
    expect(measurementTypeFromGraphic(undefined)).toBe("linear");
  });
});
