/**
 * Synthetic DICOM-JSON SR fixtures for P3 extraction/provenance tests.
 * No PHI — all UIDs and values are fabricated. Shapes follow the DICOM-JSON
 * model (tag → { Value: [...] }) and the TID-1400 measurement pattern.
 */

const code = (value: string, meaning: string, scheme = "LN") => ({
  "00080100": { Value: [value] },
  "00080102": { Value: [scheme] },
  "00080104": { Value: [meaning] },
});

const num = (value: number, unitMeaning = "millimeter", unitValue = "mm") => ({
  "0040A300": { Value: [{ "0040A30A": { Value: [value] }, "004008EA": { Value: [code(unitValue, unitMeaning, "UCUM")] } }] },
});

const imageRef = (sop: string, frame: number) => ({
  "0040A040": { Value: ["IMAGE"] },
  "0040A010": { Value: ["SELECTED FROM"] },
  "00081199": { Value: [{ "00081150": { Value: ["1.2.840.10008.5.1.4.1.1.6.1"] }, "00081155": { Value: [sop] }, "00081160": { Value: [frame] } }] },
});

/** BPD: NUM → SCOORD (caliper) → IMAGE (frame 3). Exact provenance. */
const bpdNode = {
  "0040A040": { Value: ["NUM"] },
  "0040A010": { Value: ["CONTAINS"] },
  "0040A043": { Value: [code("11984-2", "Biparietal diameter")] },
  ...num(74.2),
  "0040A730": { Value: [{
    "0040A040": { Value: ["SCOORD"] },
    "0040A010": { Value: ["INFERRED FROM"] },
    "00700023": { Value: ["POLYLINE"] },
    "00700022": { Value: [10, 20, 84.2, 20] },
    "0040A730": { Value: [imageRef("1.2.3.4.5.IMG.7", 3)] },
  }] },
};

/** HC: NUM → IMAGE (frame 1), no caliper. Source-image provenance. */
const hcNode = {
  "0040A040": { Value: ["NUM"] },
  "0040A043": { Value: [code("11820-8", "Head circumference")] },
  ...num(280),
  "0040A730": { Value: [imageRef("1.2.3.4.5.IMG.8", 1)] },
};

/** Right renal length: NUM + laterality CODE, NO image reference. */
const renalRightNode = {
  "0040A040": { Value: ["NUM"] },
  "0040A043": { Value: [code("G-0000", "Renal length", "SRT")] },
  ...num(98),
  "0040A730": { Value: [{
    "0040A040": { Value: ["CODE"] },
    "0040A010": { Value: ["HAS CONCEPT MOD"] },
    "0040A043": { Value: [code("G-C171", "Laterality", "SRT")] },
    "0040A168": { Value: [code("24028007", "Right", "SCT")] },
  }] },
};

/** Umbilical artery PI (Doppler NUM), with a referenced waveform frame. */
const uaPiNode = {
  "0040A040": { Value: ["NUM"] },
  "0040A043": { Value: [code("12006-3", "Umbilical artery pulsatility index")] },
  ...num(0.98, "ratio", "{ratio}"),
  "0040A730": { Value: [imageRef("1.2.3.4.5.IMG.WAVE.9", 1)] },
};

/** A complete OB SR: root series/doc + a CONTAINER holding the measurements. */
export const OB_SR_FIXTURE = {
  "00080018": { Value: ["1.2.3.4.5.SR.1"] },     // SR document SOP
  "0008000E": { Value: ["1.2.3.4.5.SERIES.99"] }, // SR series
  "00080060": { Value: ["SR"] },
  "0040A730": { Value: [{
    "0040A040": { Value: ["CONTAINER"] },
    "0040A010": { Value: ["CONTAINS"] },
    "0040A043": { Value: [code("125000", "OB-GYN measurement report", "DCM")] },
    "0040A730": { Value: [bpdNode, hcNode, renalRightNode, uaPiNode] },
  }] },
};

/** An SR with a NUM that has NO image/SCOORD reference at all (degrades). */
export const SR_NO_IMAGE_FIXTURE = {
  "00080018": { Value: ["1.2.3.4.5.SR.2"] },
  "0040A730": { Value: [{
    "0040A040": { Value: ["NUM"] },
    "0040A043": { Value: [code("11727-5", "Abdominal circumference")] },
    ...num(310),
  }] },
};

/** Malformed / empty — parser must not throw. */
export const MALFORMED_FIXTURE = '{"0040A730": "not-an-object", "junk": [1,2,3]}';
