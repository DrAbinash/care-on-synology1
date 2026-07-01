import { expect, test, vi } from "vitest";

// usgExtractor.ts imports `db` from @workspace/db at module top level.
// @workspace/db throws unconditionally at import time when DATABASE_URL
// is not set — before any test code runs. The four functions tested here
// (parseDicomSr, parseGePrivateTags, extractDopplerFromSr,
// parseGePrivateTagsWithProvenance) are pure parsers that never touch
// the database; mocking the module prevents the load-time throw without
// affecting what is actually under test. Same pattern as
// requireAiCallerAuth.test.ts.
vi.mock("@workspace/db", () => ({
  db: {
    select:  () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    insert:  () => ({ values: async () => undefined }),
    update:  () => ({ set:   () => ({ where: async () => undefined }) }),
  },
}));

import { parseDicomSr, parseGePrivateTags, extractDopplerFromSr, parseGePrivateTagsWithProvenance } from "./usgExtractor";

const mockDicomJson = {
  "00080070": { "vr": "LO", "Value": ["GE Healthcare"] },
  "00081090": { "vr": "LO", "Value": ["Voluson E10"] },
  "00791021": {
    "vr": "OB",
    "Value": [
      `<USGMeasurements><Measurement Name="BPD" Value="78.5" Unit="mm"/><Measurement Name="HC" Value="285.2" Unit="mm"/><Measurement Name="Endometrium" Value="8.2" Unit="mm"/></USGMeasurements>`
    ]
  },
  "0040A730": {
    "vr": "SQ",
    "Value": [
      {
        "0040A040": { "vr": "CS", "Value": ["NUM"] },
        "0040A043": { "vr": "SQ", "Value": [{ "00080100": { "vr": "SH", "Value": ["121010"] }, "00080104": { "vr": "LO", "Value": ["Biparietal Diameter"] } }] },
        "0040A300": {
          "vr": "SQ",
          "Value": [
            {
              "0040A30A": { "vr": "DS", "Value": [78.6] },
              "004008EA": { "vr": "SQ", "Value": [{ "00080100": { "vr": "SH", "Value": ["mm"] } }] }
            }
          ]
        }
      },
      {
        "0040A040": { "vr": "CS", "Value": ["CONTAINER"] },
        "0040A043": { "vr": "SQ", "Value": [{ "00080104": { "vr": "LO", "Value": ["Umbilical Artery"] } }] },
        "0040A730": {
          "vr": "SQ",
          "Value": [
            {
              "0040A040": { "vr": "CS", "Value": ["NUM"] },
              "0040A043": { "vr": "SQ", "Value": [{ "00080104": { "vr": "LO", "Value": ["Peak Systolic Velocity"] } }] },
              "0040A300": {
                "vr": "SQ",
                "Value": [
                  {
                    "0040A30A": { "vr": "DS", "Value": [42.5] },
                    "004008EA": { "vr": "SQ", "Value": [{ "00080100": { "vr": "SH", "Value": ["cm/s"] } }] }
                  }
                ]
              }
            },
            {
              "0040A040": { "vr": "CS", "Value": ["NUM"] },
              "0040A043": { "vr": "SQ", "Value": [{ "00080104": { "vr": "LO", "Value": ["Resistive Index"] } }] },
              "0040A300": {
                "vr": "SQ",
                "Value": [
                  {
                    "0040A30A": { "vr": "DS", "Value": [0.65] },
                    "004008EA": { "vr": "SQ", "Value": [{ "00080100": { "vr": "SH", "Value": [""] } }] }
                  }
                ]
              }
            }
          ]
        }
      }
    ]
  }
};

const metadataStr = JSON.stringify(mockDicomJson);

test("parseDicomSr extracts correct measurements", () => {
  const sr = parseDicomSr(metadataStr);
  expect(sr).toHaveLength(3);
  expect(sr[0].conceptName).toBe("Biparietal Diameter");
  expect(sr[0].value).toBe("78.6");
});

test("parseGePrivateTags extracts correct values", () => {
  const ge = parseGePrivateTags(metadataStr);
  expect(ge.bpd).toBe("78.5");
  expect(ge.hc).toBe("285.2");
  expect(ge.endometrium).toBe("8.2");
});

test("extractDopplerFromSr extracts Doppler measurements", () => {
  const sr = parseDicomSr(metadataStr);
  const doppler = extractDopplerFromSr(sr);
  expect(doppler).toHaveLength(1);
  expect(doppler[0].vesselName).toBe("Umbilical Artery");
  expect(doppler[0].psv).toBe("42.5 cm/s");
  expect(doppler[0].ri).toBe("0.65");
});

test("parseDicomSr preserves content paths and SOP/Series UIDs", () => {
  const srObj = {
    "00080018": { "vr": "UI", "Value": ["1.2.840.111.1"] },
    "0008000E": { "vr": "UI", "Value": ["1.2.840.111.2"] },
    "0040A730": {
      "vr": "SQ",
      "Value": [
        {
          "0040A040": { "vr": "CS", "Value": ["NUM"] },
          "0040A043": { "vr": "SQ", "Value": [{ "00080104": { "vr": "LO", "Value": ["Biparietal Diameter"] } }] },
          "0040A300": {
            "vr": "SQ",
            "Value": [{ "0040A30A": { "vr": "DS", "Value": [78.6] } }]
          }
        }
      ]
    }
  };
  const sr = parseDicomSr(JSON.stringify(srObj));
  expect(sr).toHaveLength(1);
  expect(sr[0].path).toBe("ContentSequence[0]");
  expect(sr[0].sopInstanceUID).toBe("1.2.840.111.1");
  expect(sr[0].seriesInstanceUID).toBe("1.2.840.111.2");
});

test("parseGePrivateTagsWithProvenance extracts private tag metadata", () => {
  const geObj = {
    "00790010": { "vr": "LO", "Value": ["GE_Ultrasound"] },
    "00791021": {
      "vr": "OB",
      "Value": [`<USGMeasurements><Measurement Name="BPD" Value="78.5" Unit="mm"/></USGMeasurements>`]
    }
  };
  const res = parseGePrivateTagsWithProvenance(JSON.stringify(geObj));
  expect(res.mapped.bpd).toBe("78.5");
  expect(res.provenance.bpd.tag).toBe("00791021");
  expect(res.provenance.bpd.privateCreator).toBe("GE_Ultrasound");
  expect(res.provenance.bpd.xmlPath).toContain("BPD");
});

test("parse Siemens private tags", () => {
  const siemensObj = {
    "00290010": { "vr": "LO", "Value": ["SIEMENS SYNGO ULTRA-SOUND TO REPORT"] },
    "00291010": {
      "vr": "OB",
      "Value": [`<SiemensMeasurements><Measurement Name="HC" Value="285.2" Unit="mm"/></SiemensMeasurements>`]
    }
  };
  const res = parseGePrivateTagsWithProvenance(JSON.stringify(siemensObj));
  expect(res.mapped.hc).toBe("285.2");
  expect(res.provenance.hc.tag).toBe("00291010");
  expect(res.provenance.hc.privateCreator).toBe("SIEMENS SYNGO ULTRA-SOUND TO REPORT");
});

test("parse Philips private tags", () => {
  const philipsObj = {
    "200d0010": { "vr": "LO", "Value": ["Philips Imaging DD"] },
    "200d100e": {
      "vr": "OB",
      "Value": ["BPD=74.2mm\nHC=280mm"]
    }
  };
  const res = parseGePrivateTagsWithProvenance(JSON.stringify(philipsObj));
  expect(res.mapped.bpd).toBe("74.2mm");
  expect(res.mapped.hc).toBe("280mm");
  expect(res.provenance.bpd.tag).toBe("200d100e");
});

test("parse Samsung private tags", () => {
  const samsungObj = {
    "00330010": { "vr": "LO", "Value": ["Samsung Medison"] },
    "00331010": {
      "vr": "OB",
      "Value": [`<Samsung><BPD>78.9</BPD></Samsung>`]
    }
  };
  const res = parseGePrivateTagsWithProvenance(JSON.stringify(samsungObj));
  expect(res.mapped.bpd).toBe("78.9");
  expect(res.provenance.bpd.tag).toBe("00331010");
});





