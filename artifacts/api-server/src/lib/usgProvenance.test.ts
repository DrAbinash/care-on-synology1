import { describe, it, expect } from "vitest";
import {
  provenanceLevel, provenanceLabel, viewerActions, toImageCoordinates,
  USG_PROVENANCE_PARSER_VERSION, type MeasurementProvenance,
} from "./usgProvenance";

const base = (over: Partial<MeasurementProvenance>): MeasurementProvenance => ({
  sourceType: "dicom_sr", confidence: 0.95, parserVersion: USG_PROVENANCE_PARSER_VERSION, ...over,
});

describe("P3.5 provenance — honest degradation", () => {
  it("exact frame + caliper", () => {
    const p = base({ studyInstanceUID: "S", seriesInstanceUID: "Se", imageRef: { sopInstanceUID: "I", frameNumber: 3 }, scoord: { graphicType: "POLYLINE", graphicData: [1, 2, 3, 4] } });
    expect(provenanceLevel(p)).toBe("exact_frame_caliper");
    expect(viewerActions(p)).toEqual({ goToStudy: true, goToSeries: true, goToInstance: true, goToFrame: true, showOverlay: true });
    expect(provenanceLabel(provenanceLevel(p))).toMatch(/exact frame/i);
  });

  it("source image, no caliper", () => {
    const p = base({ studyInstanceUID: "S", imageRef: { sopInstanceUID: "I", frameNumber: 1 } });
    expect(provenanceLevel(p)).toBe("source_image");
    expect(viewerActions(p).showOverlay).toBe(false);
    expect(viewerActions(p).goToFrame).toBe(true);
  });

  it("OCR image", () => {
    const p = base({ sourceType: "ocr", imageRef: { sopInstanceUID: "I", frameNumber: 2 }, confidence: 0.6 });
    expect(provenanceLevel(p)).toBe("ocr_image");
  });

  it("SR document reference only", () => {
    const p = base({ srDocumentSop: "1.2.SR" });
    expect(provenanceLevel(p)).toBe("sr_document");
    expect(viewerActions(p).goToInstance).toBe(false);
  });

  it("series only / unavailable / manual", () => {
    expect(provenanceLevel(base({ seriesInstanceUID: "Se" }))).toBe("series_only");
    expect(provenanceLevel(base({}))).toBe("unavailable");
    expect(provenanceLevel(base({ sourceType: "manual" }))).toBe("manual");
  });

  it("never claims a frame that isn't there", () => {
    const p = base({ imageRef: { sopInstanceUID: "I", frameNumber: null } });
    expect(viewerActions(p).goToFrame).toBe(false);
    expect(provenanceLevel(p)).toBe("source_image");
  });

  it("imageCoordinates JSON only when caliper present", () => {
    expect(toImageCoordinates(base({}))).toBeNull();
    const c = toImageCoordinates(base({ scoord: { graphicType: "CIRCLE", graphicData: [5, 5, 9, 5] } }));
    expect(JSON.parse(c!)).toEqual({ graphicType: "CIRCLE", graphicData: [5, 5, 9, 5] });
  });
});
