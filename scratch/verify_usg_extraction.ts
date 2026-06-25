import { parseDicomSr, parseGePrivateTags, extractDopplerFromSr } from "../artifacts/api-server/src/lib/usgExtractor";

// Mock DICOM-JSON metadata
const mockDicomJson = {
  // Standard DICOM tags
  "00080070": { "vr": "LO", "Value": ["GE Healthcare"] },
  "00081090": { "vr": "LO", "Value": ["Voluson E10"] },
  // GE Private Tag XML
  "00791021": {
    "vr": "OB",
    "Value": [
      `<USGMeasurements><Measurement Name="BPD" Value="78.5" Unit="mm"/><Measurement Name="HC" Value="285.2" Unit="mm"/><Measurement Name="Endometrium" Value="8.2" Unit="mm"/></USGMeasurements>`
    ]
  },
  // DICOM SR content sequence (0040,A730)
  "0040A730": {
    "vr": "SQ",
    "Value": [
      {
        // Item 1: BPD in SR
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
        // Item 2: Umbilical Artery Vessel Context
        "0040A040": { "vr": "CS", "Value": ["CONTAINER"] },
        "0040A043": { "vr": "SQ", "Value": [{ "00080104": { "vr": "LO", "Value": ["Umbilical Artery"] } }] },
        "0040A730": {
          "vr": "SQ",
          "Value": [
            {
              // Child 1: PSV
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
              // Child 2: RI
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

console.log("=== Testing parseDicomSr ===");
const sr = parseDicomSr(metadataStr);
console.log(JSON.stringify(sr, null, 2));

console.log("\n=== Testing parseGePrivateTags ===");
const ge = parseGePrivateTags(metadataStr);
console.log(JSON.stringify(ge, null, 2));

console.log("\n=== Testing extractDopplerFromSr ===");
const doppler = extractDopplerFromSr(sr);
console.log(JSON.stringify(doppler, null, 2));

let success = true;
if (ge.bpd === "78.5" && ge.hc === "285.2" && ge.endometrium === "8.2") {
  console.log("\nGE Private Tags Extraction: PASS");
} else {
  console.log("\nGE Private Tags Extraction: FAIL");
  success = false;
}

if (doppler.length > 0 && doppler[0].vesselName === "Umbilical Artery" && doppler[0].psv === "42.5 cm/s" && doppler[0].ri === "0.65") {
  console.log("Doppler Extraction: PASS");
} else {
  console.log("Doppler Extraction: FAIL");
  success = false;
}

process.exit(success ? 0 : 1);
