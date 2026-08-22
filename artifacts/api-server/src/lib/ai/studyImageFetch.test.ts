import { describe, expect, it } from "vitest";
import {
  instancesFromDicomWeb,
  instancesFromOrthancRest,
  resolveOrthancBaseFromSources,
  stripOrthancBase,
} from "./studyImageFetchCore";

describe("overnight Orthanc URL resolution", () => {
  it("prefers ORTHANC_INTERNAL_URL (Docker) over public LAN and DB keys", () => {
    expect(resolveOrthancBaseFromSources({
      envInternal: "http://care-orthanc:8042/",
      envPublic: "http://172.16.1.139:8042",
      orthancBaseUrl: "http://localhost:8042",
    })).toBe("http://care-orthanc:8042");
  });

  it("falls back to orthanc_url when orthanc_base_url is empty (seeded key)", () => {
    expect(resolveOrthancBaseFromSources({
      envInternal: "",
      orthancBaseUrl: "",
      orthancUrl: "http://care-orthanc:8042",
      orthancDicomWebUrl: "http://care-orthanc:8042/dicom-web",
    })).toBe("http://care-orthanc:8042");
  });

  it("strips /dicom-web suffix", () => {
    expect(stripOrthancBase("http://pacs.local/dicom-web")).toBe("http://pacs.local");
  });
});

describe("Orthanc REST expanded instances", () => {
  it("maps ParentSeries + SOPInstanceUID into InstanceRef with orthanc id", () => {
    const out = instancesFromOrthancRest({
      instances: [{
        ID: "inst-1",
        ParentSeries: "ser-1",
        MainDicomTags: { SOPInstanceUID: "1.2.3.SOP", InstanceNumber: "12" },
      }],
      seriesById: {
        "ser-1": { ID: "ser-1", MainDicomTags: { SeriesInstanceUID: "1.2.3.SER", Modality: "MR", SeriesNumber: "4" } },
      },
    });
    expect(out).toEqual([{
      seriesUid: "1.2.3.SER",
      sopUid: "1.2.3.SOP",
      modality: "MR",
      seriesNumber: 4,
      instanceNumber: 12,
      numberOfFrames: undefined,
      orthancInstanceId: "inst-1",
    }]);
  });
});

describe("DICOMweb QIDO mapping", () => {
  it("reads standard tag numbers", () => {
    const series = [{
      "0020000E": { Value: ["1.2.SER"] },
      "00080060": { Value: ["MR"] },
      "00200011": { Value: ["1"] },
    }];
    const instances = [{
      "00080018": { Value: ["1.2.SOP"] },
      "00200013": { Value: ["7"] },
    }];
    expect(instancesFromDicomWeb(series, [{ seriesUid: "1.2.SER", instances }])).toEqual([{
      seriesUid: "1.2.SER",
      sopUid: "1.2.SOP",
      modality: "MR",
      seriesNumber: 1,
      instanceNumber: 7,
      numberOfFrames: undefined,
    }]);
  });
});
