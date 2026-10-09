/**
 * USG AI-measurement normalization must not carry DICOM identifiers off-prem
 * (P0-4).
 *
 * The old code sent `dicomMetadataJson.slice(0, 2000)` to Gemini. Orthanc
 * returns DICOM JSON in ascending tag order, so that window runs through Group
 * 0008 and into the patient group — PatientName (0010,0010) and PatientID
 * (0010,0020) left the clinic. And it left through a transport that never sees
 * CARE's PHI gate, because the Gemini integration is its own client rather than
 * `generateAiResponse`.
 *
 * What is asserted here is the property the clinic actually needs: not "the
 * allow-list looks reasonable", but "a name, a UHID, an accession and a date of
 * birth cannot get into the string that is sent", including when a sonographer
 * typed the name into a field that IS allow-listed.
 */
import { describe, expect, it, vi } from "vitest";

// usgExtractor imports `db` at module scope, and @workspace/db throws without
// DATABASE_URL. The function under test is pure; the mock only prevents the
// load-time throw. Same pattern as usgExtractor.test.ts.
vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    insert: () => ({ values: async () => [{ id: 1 }] }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  },
}));

import {
  buildSafeUsgNormalizationText,
  extractDopplerFromSr,
  parseDicomSr,
  parseGePrivateTags,
  USG_CLOUD_NEVER_SENT_TAGS,
} from "./usgExtractor";

/** A real-shaped Orthanc study metadata payload. */
const ORTHANC_METADATA = JSON.stringify({
  "00020010": { vr: "UI", Value: ["1.2.840.113619.2.55"] },
  "00080016": { vr: "UI", Value: ["1.2.840.10008.5.1.4.1.1.6.1"] },
  "00080020": { vr: "DA", Value: ["20261008"] },
  "00080030": { vr: "TM", Value: ["114522.000"] },
  "00080050": { vr: "SH", Value: ["ACC-2610-0448"] },
  "00080060": { vr: "CS", Value: ["US"] },
  "00080070": { vr: "LO", Value: ["GE Healthcare"] },
  "00080080": { vr: "LO", Value: ["Care Diagnostics Deoghar"] },
  "00080090": { vr: "PN", Value: [{ Alphabetic: "Singh^Rahul" }] },
  "00081030": { vr: "LO", Value: ["OB FETUS ANOMALY SCAN"] },
  "0008103E": { vr: "LO", Value: ["OT: Fetus(1)  8w3d"] },
  "00081090": { vr: "LO", Value: ["Voluson E10"] },
  "00100010": { vr: "PN", Value: [{ Alphabetic: "Ramesh^Kumar" }] },
  "00100020": { vr: "LO", Value: ["UHID-45812"] },
  "00100030": { vr: "DA", Value: ["19940312"] },
  "00101010": { vr: "AS", Value: ["032Y"] },
  "00101040": { vr: "CS", Value: ["F"] },
  "00180015": { vr: "CS", Value: ["OT: Fetus(1)"] },
  "0020000D": { vr: "UI", Value: ["1.2.840.113619.1.15.2610.448"] },
  "0020000E": { vr: "UI", Value: ["1.2.840.113619.1.15.2610.448.1"] },
});

const KNOWN_IDENTIFIERS = [
  "Ramesh Kumar", // PersonName flattened the way extractDicomMetadata does it
  "UHID-45812",
  "ACC-2610-0448",
  "19940312",
  "Care Diagnostics Deoghar",
  "Singh Rahul",
];

describe("buildSafeUsgNormalizationText", () => {
  it("names only device and protocol fields — no patient group at all", () => {
    const text = buildSafeUsgNormalizationText({
      dicomMetadataJson: ORTHANC_METADATA,
      knownIdentifiers: KNOWN_IDENTIFIERS,
    });
    expect(text).toContain("Modality: US");
    expect(text).toContain("Manufacturer: GE Healthcare");
    expect(text).toContain("ManufacturerModelName: Voluson E10");
    expect(text).toContain("StudyDescription: OB FETUS ANOMALY SCAN");
    // What must be absent, asserted on the values rather than the tag numbers.
    expect(text).not.toMatch(/Ramesh|45812|ACC-2610|19940312|032Y/);
    expect(text).not.toMatch(/ReferringPhysician|InstitutionName|PatientName|PatientID/i);
    expect(text).not.toMatch(/\b1\.2\.840\./); // no instance UIDs
  });

  it("fails closed when an identifier is typed into an allow-listed value", () => {
    // Sonographers do write the patient's name into SeriesDescription. An
    // allow-list of tag numbers does not police human text, so the assembled
    // string is checked against the identifiers CARE already holds.
    const dirty = JSON.stringify({
      "00080060": { vr: "CS", Value: ["US"] },
      "0008103E": { vr: "LO", Value: ["RAMESH KUMAR 28w scan"] },
    });
    expect(
      buildSafeUsgNormalizationText({
        dicomMetadataJson: dirty,
        knownIdentifiers: ["Ramesh Kumar"],
      }),
    ).toBe("");
  });

  it("fails closed on an unlabelled identifier shape the shared detector recognises", () => {
    const withPhone = JSON.stringify({
      "00080060": { vr: "CS", Value: ["US"] },
      "00081030": { vr: "LO", Value: ["pain, call 9876543210 for results"] },
    });
    expect(buildSafeUsgNormalizationText({ dicomMetadataJson: withPhone })).toBe("");
  });

  it("does not invent a payload from a malformed or empty blob", () => {
    expect(buildSafeUsgNormalizationText({ dicomMetadataJson: "{not json" })).toBe("");
    expect(buildSafeUsgNormalizationText({ dicomMetadataJson: "" })).toBe("");
    expect(buildSafeUsgNormalizationText({ dicomMetadataJson: null })).toBe("");
    expect(buildSafeUsgNormalizationText({ dicomMetadataJson: "[1,2,3]" })).toBe("");
    // Only identifying tags present → nothing safe to send.
    expect(
      buildSafeUsgNormalizationText({
        dicomMetadataJson: JSON.stringify({
          "00100010": { vr: "PN", Value: [{ Alphabetic: "Ramesh^Kumar" }] },
          "00100020": { vr: "LO", Value: ["UHID-45812"] },
        }),
      }),
    ).toBe("");
  });

  it("accepts the flat key-value shape the ingestion endpoint posts", () => {
    const flat = JSON.stringify({
      modality: "US",
      studyDescription: "KUB SCAN",
      manufacturer: "Mindray",
      patientName: "Ramesh Kumar",
      patientId: "UHID-45812",
    });
    // The flat shape is read field by field too, so the patient keys in it are
    // simply never picked up.
    const text = buildSafeUsgNormalizationText({ dicomMetadataJson: flat });
    expect(text).toContain("Modality: US");
    expect(text).toContain("StudyDescription: KUB SCAN");
    expect(text).toContain("Manufacturer: Mindray");
    expect(text).not.toContain("Ramesh");
    expect(text).not.toContain("45812");
    // Passing the identifiers CARE holds is harmless here, because the name
    // never entered the text in the first place — the guard is a net, not the
    // only reason the field is absent.
    expect(
      buildSafeUsgNormalizationText({ dicomMetadataJson: flat, knownIdentifiers: ["Ramesh Kumar"] }),
    ).toContain("StudyDescription: KUB SCAN");
  });

  it("keeps the never-sent list covering the patient, study and institution groups", () => {
    // A guard whose deny-list can be quietly trimmed is not a guard.
    expect(USG_CLOUD_NEVER_SENT_TAGS).toContain("00100010");
    expect(USG_CLOUD_NEVER_SENT_TAGS).toContain("00100020");
    expect(USG_CLOUD_NEVER_SENT_TAGS).toContain("00100030");
    expect(USG_CLOUD_NEVER_SENT_TAGS).toContain("00080050");
    expect(USG_CLOUD_NEVER_SENT_TAGS).toContain("00080090");
    expect(USG_CLOUD_NEVER_SENT_TAGS).toContain("0020000D");
  });

  it("truncates a long allow-listed value instead of shipping the blob", () => {
    const long = JSON.stringify({
      "00081030": { vr: "LO", Value: [`${"ABDOMEN SCAN ".repeat(30)}`] },
    });
    const text = buildSafeUsgNormalizationText({ dicomMetadataJson: long });
    const line = text.split("\n").find((l) => l.startsWith("StudyDescription:")) ?? "";
    expect(line.length).toBeLessThanOrEqual("StudyDescription: ".length + 120);
  });
});

/**
 * Item 3 — what the narrowed fallback can still do, on a real Voluson machine
 * profile, using the same sanitized fixture shapes `usgExtractor.test.ts` uses.
 *
 * `runUsgExtraction()` reaches the AI normalizer only when BOTH value parsers
 * came back empty (no DICOM SR, no GE private tags) and screenshot OCR is
 * disabled by policy. So the honest question is not "did the allow-list break
 * measurement extraction" — the six fields carry no biometry at all — but
 * "does the measurement pipeline still work, and what is left in the cloud
 * path". Both are asserted below on one realistic blob:
 *  - the values (BPD 78.5 mm, HC 285.2 mm, UA PSV 42.5 cm/s) come out of the
 *    local parsers, untouched by this change;
 *  - what would be sent is device/protocol context plus any gestational-age
 *    hint a sonographer typed into a description field, and nothing else.
 */
const VOLUSON_E8_BLOB = JSON.stringify({
  // Identifying content, in Orthanc's ascending tag order — exactly the window
  // the old `slice(0, 2000)` used to ship.
  "00080050": { vr: "SH", Value: ["ACC-2610-0448"] },
  "00080060": { vr: "CS", Value: ["US"] },
  "00080070": { vr: "LO", Value: ["GE Healthcare"] },
  "00080080": { vr: "LO", Value: ["Care Diagnostics Deoghar"] },
  "00080090": { vr: "PN", Value: [{ Alphabetic: "Singh^Rahul" }] },
  "00081030": { vr: "LO", Value: ["OG ANTROPOMETRY + DOPPLER"] },
  "0008103E": { vr: "LO", Value: ["OT: Fetus(1)  30w2d"] },
  "00081090": { vr: "LO", Value: ["Voluson E8"] },
  "00100010": { vr: "PN", Value: [{ Alphabetic: "Ramesh^Kumar" }] },
  "00100020": { vr: "LO", Value: ["UHID-45812"] },
  "00100030": { vr: "DA", Value: ["19960312"] },
  "00101040": { vr: "CS", Value: ["F"] },
  // GE private measurement block — the real values live here.
  "00791021": {
    vr: "OB",
    Value: [
      `<USGMeasurements><Measurement Name="BPD" Value="78.5" Unit="mm"/><Measurement Name="HC" Value="285.2" Unit="mm"/><Measurement Name="AC" Value="271.0" Unit="mm"/><Measurement Name="FL" Value="56.1" Unit="mm"/></USGMeasurements>`,
    ],
  },
  // DICOM SR content sequence with a Doppler value.
  "0040A730": {
    vr: "SQ",
    Value: [
      {
        "0040A040": { vr: "CS", Value: ["NUM"] },
        "0040A043": {
          vr: "SQ",
          Value: [{ "00080104": { vr: "LO", Value: ["Peak Systolic Velocity"] } }],
        },
        "0040A300": {
          vr: "SQ",
          Value: [
            {
              "0040A30A": { vr: "DS", Value: [42.5] },
              "004008EA": { vr: "SQ", Value: [{ "00080100": { vr: "SH", Value: ["cm/s"] } }] },
            },
          ],
        },
      },
    ],
  },
});

describe("Voluson E8 profile — measurement pipeline survives the narrowed cloud path", () => {
  const identifiers = [
    "Ramesh Kumar",
    "UHID-45812",
    "ACC-2610-0448",
    "Care Diagnostics Deoghar",
    "Singh Rahul",
  ];

  it("still extracts every real measurement value locally, from the same blob", () => {
    const ge = parseGePrivateTags(VOLUSON_E8_BLOB);
    expect(ge.bpd).toBe("78.5");
    expect(ge.hc).toBe("285.2");
    expect(ge.ac).toBe("271.0");
    expect(ge.fl).toBe("56.1");

    const sr = parseDicomSr(VOLUSON_E8_BLOB);
    const psv = sr.find((s) => /peak systolic/i.test(s.conceptName));
    expect(psv?.value).toBe("42.5");
    expect(psv?.unit).toBe("cm/s");
    const dopplers = extractDopplerFromSr(sr);
    // The Doppler group carries value AND unit ("42.5 cm/s") — proof the SR tree
    // is fully parsed locally, which is exactly the content the cloud path lost.
    expect(dopplers.some((d) => d.psv === "42.5 cm/s")).toBe(true);
  });

  it("sends only device and protocol context, and none of those values", () => {
    const text = buildSafeUsgNormalizationText({
      dicomMetadataJson: VOLUSON_E8_BLOB,
      knownIdentifiers: identifiers,
    });

    expect(text).toContain("Modality: US");
    expect(text).toContain("Manufacturer: GE Healthcare");
    expect(text).toContain("ManufacturerModelName: Voluson E8");
    expect(text).toContain("StudyDescription: OG ANTROPOMETRY + DOPPLER");
    expect(text).toContain("SeriesDescription: OT: Fetus(1)  30w2d");

    // No biometry leaves: the values the parsers just read are absent here.
    for (const value of ["78.5", "285.2", "271.0", "56.1", "42.5"]) {
      expect(text, `measurement value leaked: ${value}`).not.toContain(value);
    }
    expect(text).not.toMatch(/\d+(\.\d+)?\s?(mm|cm|cc|g|cm\/s)\b/);
    // No private-tag payload, no SR tree, no UIDs, no patient group.
    expect(text).not.toContain("USGMeasurements");
    expect(text).not.toMatch(/00791021|0040A730|0040A30A/i);
    expect(text).not.toMatch(/Ramesh|45812|ACC-2610|19960312|Deoghar|Singh/);
    expect(text.length).toBeGreaterThan(0);
    expect(text.split("\n").length).toBeLessThanOrEqual(6);
  });

  it("keeps the one genuinely useful hint a sonographer can type — gestational age in a description", () => {
    // This is the whole residual value of the fallback: it can carry a typed
    // "30w2d" and the exam context. It cannot invent a measurement it was never
    // given, and it no longer buys that with a patient's name.
    const text = buildSafeUsgNormalizationText({
      dicomMetadataJson: VOLUSON_E8_BLOB,
      knownIdentifiers: identifiers,
    });
    expect(text).toMatch(/30w2d/);
  });

  it("refuses everything when the description field itself names the patient", () => {
    const named = VOLUSON_E8_BLOB.replace(
      '"OT: Fetus(1)  30w2d"',
      '"RAMESH KUMAR 30w2d followup"',
    );
    expect(
      buildSafeUsgNormalizationText({ dicomMetadataJson: named, knownIdentifiers: identifiers }),
    ).toBe("");
  });
});
