import { describe, it, expect } from "vitest";
import type { UsgMeasurement, UsgDopplerMeasurement } from "@workspace/db/schema";
import {
  detectStudyType,
  summarizeMeasurements,
  extractMachine,
  estimateTimeSavedSeconds,
  EXPECTED_MEASUREMENTS,
} from "./usgCompanion";

function meas(partial: Partial<UsgMeasurement>): UsgMeasurement {
  return {
    id: 1,
    source: "dicom_sr",
    overallConfidence: "high",
    status: "pending_review",
    provenanceJson: "{}",
    extraMeasurementsJson: "{}",
    ...partial,
  } as unknown as UsgMeasurement;
}

describe("detectStudyType (reuses suggestTemplate)", () => {
  it("recognises growth, anomaly, thyroid, breast, scrotum, KUB, doppler", () => {
    expect(detectStudyType({ modality: "US", studyDescription: "OB Growth Scan 3rd trimester" }).id).toBe("OB_GROWTH");
    expect(detectStudyType({ modality: "US", studyDescription: "Anomaly Scan TIFFA" }).id).toBe("OB_ANOMALY");
    expect(detectStudyType({ modality: "US", studyDescription: "Thyroid ultrasound TIRADS" }).id).toBe("THYROID");
    expect(detectStudyType({ modality: "US", studyDescription: "Bilateral Breast USG" }).id).toBe("BREAST");
    expect(detectStudyType({ modality: "US", studyDescription: "Scrotum / testis" }).id).toBe("SCROTUM");
    expect(detectStudyType({ modality: "US", studyDescription: "KUB kidney bladder" }).id).toBe("KUB");
    expect(detectStudyType({ modality: "US", studyDescription: "Carotid Doppler IMT" }).id).toBe("CAROTID_DOPPLER");
    expect(detectStudyType({ modality: "US", studyDescription: "Whole Abdomen liver" }).id).toBe("WHOLE_ABDOMEN");
  });

  it("returns a descriptor from the existing USG_TEMPLATES list", () => {
    const d = detectStudyType({ modality: "US", studyDescription: "TVS pelvis uterus ovary" });
    expect(d.id).toBe("PELVIS_FEMALE");
    expect(d.descriptor?.label).toContain("Pelvis");
  });
});

describe("summarizeMeasurements", () => {
  it("computes found vs missing against the expected checklist (OB growth)", () => {
    const m = meas({ bpd: "78 mm", hc: "280 mm", ga: "32w1d", fhr: "146" });
    const s = summarizeMeasurements("OB_GROWTH", m, []);
    expect(s.expectedCount).toBe(EXPECTED_MEASUREMENTS.OB_GROWTH.length);
    expect(s.foundCount).toBe(4);
    expect(s.missingCount).toBe(EXPECTED_MEASUREMENTS.OB_GROWTH.length - 4);
    const bpd = s.items.find((i) => i.key === "bpd");
    expect(bpd?.present).toBe(true);
    expect(bpd?.value).toBe("78 mm");
    expect(s.missing.some((x) => x.key === "ac")).toBe(true);
  });

  it("uses per-field confidence when present, else overall", () => {
    const m = meas({ bpd: "78 mm", bpdConfidence: "medium", hc: "280 mm", overallConfidence: "high" });
    const s = summarizeMeasurements("OB_GROWTH", m, []);
    expect(s.items.find((i) => i.key === "bpd")?.confidence).toBe("medium");
    expect(s.items.find((i) => i.key === "hc")?.confidence).toBe("high");
  });

  it("surfaces extra measurements beyond the checklist", () => {
    const m = meas({ bpd: "78 mm", extraMeasurementsJson: JSON.stringify({ "Cervical Length": "35 mm" }) });
    const s = summarizeMeasurements("OB_GROWTH", m, []);
    expect(s.extras.some((e) => e.label === "Cervical Length" && e.value === "35 mm")).toBe(true);
  });

  it("handles Doppler studies by vessel presence, ignoring rejected rows", () => {
    const doppler = [
      { id: 1, status: "approved", vesselName: "Right ICA" },
      { id: 2, status: "rejected", vesselName: "Left ICA" },
    ] as unknown as UsgDopplerMeasurement[];
    const s = summarizeMeasurements("CAROTID_DOPPLER", null, doppler);
    expect(s.doppler.vesselCount).toBe(1);
    expect(s.expectedCount).toBe(1);
    expect(s.foundCount).toBe(1);
    expect(s.missingCount).toBe(0);
  });

  it("degrades gracefully with no measurement row", () => {
    const s = summarizeMeasurements("WHOLE_ABDOMEN", null, []);
    expect(s.foundCount).toBe(0);
    expect(s.missingCount).toBe(EXPECTED_MEASUREMENTS.WHOLE_ABDOMEN.length);
    expect(s.measurementRowId).toBeNull();
  });

  it("reports zero expected for manual-authored study types (thyroid/breast/scrotum)", () => {
    for (const t of ["THYROID", "BREAST", "SCROTUM"] as const) {
      const s = summarizeMeasurements(t, null, []);
      expect(s.expectedCount).toBe(0);
      expect(s.missingCount).toBe(0);
    }
  });

  it("reads per-field source from provenance when available", () => {
    const m = meas({
      bpd: "78 mm",
      source: "combined",
      provenanceJson: JSON.stringify({ bpd: { sourceType: "DICOM_SR" } }),
    });
    const s = summarizeMeasurements("OB_GROWTH", m, []);
    expect(s.items.find((i) => i.key === "bpd")?.source).toBe("DICOM_SR");
  });
});

describe("extractMachine", () => {
  it("prefers measurement columns", () => {
    const m = meas({ manufacturer: "GE Healthcare", manufacturerModel: "Voluson E10", institutionName: "CARE" });
    const info = extractMachine(m, null);
    expect(info.manufacturer).toBe("GE Healthcare");
    expect(info.model).toBe("Voluson E10");
    expect(info.isVoluson).toBe(true);
  });

  it("falls back to flat DICOM-JSON tags", () => {
    const meta = JSON.stringify({ "00080070": "GE Healthcare", "00081090": "Voluson S8", "00081010": "US-ROOM-1" });
    const info = extractMachine(null, meta);
    expect(info.manufacturer).toBe("GE Healthcare");
    expect(info.model).toBe("Voluson S8");
    expect(info.station).toBe("US-ROOM-1");
    expect(info.isVoluson).toBe(true);
  });

  it("reads nested DICOM-JSON Value arrays and MainDicomTags named keys", () => {
    const nested = JSON.stringify({ "00080070": { vr: "LO", Value: ["Samsung Medison"] } });
    expect(extractMachine(null, nested).manufacturer).toBe("Samsung Medison");
    const named = JSON.stringify({ MainDicomTags: { Manufacturer: "Philips", ManufacturerModelName: "EPIQ" } });
    const info = extractMachine(null, named);
    expect(info.manufacturer).toBe("Philips");
    expect(info.model).toBe("EPIQ");
    expect(info.isVoluson).toBe(false);
  });

  it("returns nulls on malformed metadata without throwing", () => {
    const info = extractMachine(null, "not json");
    expect(info.manufacturer).toBeNull();
    expect(info.isVoluson).toBe(false);
  });
});

describe("estimateTimeSavedSeconds", () => {
  it("is zero for zero/negative imports and scales linearly", () => {
    expect(estimateTimeSavedSeconds(0)).toBe(0);
    expect(estimateTimeSavedSeconds(-3)).toBe(0);
    expect(estimateTimeSavedSeconds(5)).toBe(90);
  });
});
