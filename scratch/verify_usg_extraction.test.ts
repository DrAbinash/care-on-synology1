import { expect, test } from "vitest";
import { parseDicomSr, parseGePrivateTags, extractDopplerFromSr } from "../artifacts/api-server/src/lib/usgExtractor";

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
