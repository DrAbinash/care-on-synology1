import { describe, expect, it } from "vitest";
import {
  buildPacsStillBody, buildViewerStillBody, frameOptions, instanceListUrl, parsePacsInstances, parsePacsSeries,
  pickKey, renderedImageUrl, seriesListUrl, TAG_NUMBER_OF_FRAMES,
  type PacsPick, type PacsStudyContext,
} from "./pacsImagePicker";

const dicomTag = (value: unknown) => ({ Value: [value] });
const uid = (n: string) => `1.2.826.0.1.3680043.9.8888.${n}`;

describe("parsePacsSeries", () => {
  it("reads the identifiers the picker shows and orders by series number", () => {
    const rows = parsePacsSeries([
      {
        "0020000E": dicomTag(uid("3.2")),
        "0008103E": dicomTag("T2 TSE AXIAL"),
        "00080060": dicomTag("MR"),
        "00200011": dicomTag("2"),
        "00201209": dicomTag("24"),
      },
      {
        "0020000E": dicomTag(uid("3.1")),
        "0008103E": dicomTag("LOCALIZER"),
        "00080060": dicomTag("MR"),
        "00200011": dicomTag("1"),
        "00201209": dicomTag("3"),
      },
    ]);
    expect(rows.map((r) => r.description)).toEqual(["LOCALIZER", "T2 TSE AXIAL"]);
    expect(rows[1]).toMatchObject({ uid: uid("3.2"), modality: "MR", instanceCount: 24 });
  });

  it("drops a series with no SeriesInstanceUID — it cannot be attached", () => {
    expect(parsePacsSeries([{ "0008103E": dicomTag("NO UID") }])).toEqual([]);
  });

  it("tolerates a non-array or empty PACS answer", () => {
    expect(parsePacsSeries(null)).toEqual([]);
    expect(parsePacsSeries({ error: "Orthanc DICOMweb unreachable" })).toEqual([]);
  });
});

describe("parsePacsInstances", () => {
  it("treats a missing frame count as single-frame", () => {
    const rows = parsePacsInstances([{ "00080018": dicomTag(uid("30101")), "00200013": dicomTag("12") }]);
    expect(rows).toEqual([{ sopUid: uid("30101"), instanceNumber: 12, numberOfFrames: 1 }]);
  });

  it("keeps NumberOfFrames so a CINE object can be chosen frame by frame", () => {
    const rows = parsePacsInstances([
      { "00080018": dicomTag(uid("30101")), "00200013": dicomTag("1"), "00280008": dicomTag("8") },
    ]);
    expect(rows[0].numberOfFrames).toBe(8);
  });

  it("orders by instance number, not by whatever order Orthanc returned", () => {
    const rows = parsePacsInstances([
      { "00080018": dicomTag("1.9"), "00200013": dicomTag("30") },
      { "00080018": dicomTag("1.8"), "00200013": dicomTag("2") },
    ]);
    expect(rows.map((r) => r.instanceNumber)).toEqual([2, 30]);
  });
});

describe("frameOptions", () => {
  it("offers no frame choice for a single-frame object", () => {
    expect(frameOptions(1)).toBeNull();
    expect(frameOptions(0)).toBeNull();
  });

  it("numbers frames from 1", () => {
    expect(frameOptions(4)).toEqual([1, 2, 3, 4]);
  });

  it("bounds a pathological frame count instead of hanging the browser", () => {
    expect(frameOptions(100_000)?.length).toBe(200);
  });
});

describe("pickKey", () => {
  it("separates two frames of the same object", () => {
    expect(pickKey(uid("30101"), 1)).not.toBe(pickKey(uid("30101"), 2));
  });

  it("separates a frame claim from no claim at all", () => {
    expect(pickKey(uid("30101"), null)).not.toBe(pickKey(uid("30101"), 1));
  });
});

describe("buildPacsStillBody", () => {
  const ctx: PacsStudyContext = {
    draftId: 3,
    studyId: 11,
    patientId: 42,
    accessionNumber: "A-77",
    studyInstanceUid: uid("3"),
  };
  const pick: PacsPick = {
    seriesUid: uid("3.1"),
    seriesDescription: "T2 AXIAL",
    modality: "MR",
    sopUid: uid("30101"),
    instanceNumber: 7,
    frame: null,
  };

  it("sends the identifier triple with the report it belongs to", () => {
    const body = buildPacsStillBody(pick, ctx);
    expect(body).toMatchObject({
      draftId: 3,
      studyId: 11,
      patientId: 42,
      accessionNumber: "A-77",
      studyInstanceUid: uid("3"),
      seriesInstanceUid: uid("3.1"),
      sopInstanceUid: uid("30101"),
      instanceNumber: 7,
      modality: "MR",
    });
  });

  it("sends NO frame claim for a single-frame object", () => {
    expect("frameNumber" in buildPacsStillBody(pick, ctx)).toBe(false);
  });

  it("sends the chosen frame for a multiframe object", () => {
    expect(buildPacsStillBody({ ...pick, frame: 5 }, ctx).frameNumber).toBe(5);
  });

  it("labels the picture from the study itself so an untyped report still reads properly", () => {
    expect(buildPacsStillBody(pick, ctx).caption).toBe("T2 AXIAL");
    expect(buildPacsStillBody({ ...pick, seriesDescription: "" }, ctx).caption).toBe("Image 7");
  });

  it("refuses to build a body around a malformed UID", () => {
    expect(() => buildPacsStillBody({ ...pick, sopUid: "../etc/passwd" }, ctx)).toThrow(/valid DICOM/i);
    expect(() => buildPacsStillBody(pick, { ...ctx, studyInstanceUid: "1.2.3;" })).toThrow(/valid DICOM/i);
  });

  it("omits optional bindings rather than sending nulls the server must reject", () => {
    const body = buildPacsStillBody(pick, { studyInstanceUid: uid("3"), draftId: 3 });
    expect("studyId" in body).toBe(false);
    expect("patientId" in body).toBe(false);
    expect("accessionNumber" in body).toBe(false);
  });
});

/**
 * The viewer's "add this image" answer, built by the same module as the picker's.
 * Both paths must produce one shape of request, or a report ends up with two
 * kinds of image record that print differently.
 */
describe("buildViewerStillBody", () => {
  const ctx: PacsStudyContext = {
    draftId: 9,
    studyId: 11,
    patientId: 42,
    accessionNumber: "A-77",
    studyInstanceUid: uid("3"),
  };
  const ref = {
    seriesInstanceUid: uid("3.1"),
    sopInstanceUid: uid("30101"),
    frameNumber: null,
    caption: null,
  };

  it("carries the identity triple and the report bindings, like a picked image", () => {
    expect(buildViewerStillBody(ref, ctx)).toMatchObject({
      draftId: 9,
      studyId: 11,
      patientId: 42,
      accessionNumber: "A-77",
      studyInstanceUid: uid("3"),
      seriesInstanceUid: uid("3.1"),
      sopInstanceUid: uid("30101"),
    });
  });

  it("names a frame only when the object is multiframe", () => {
    expect("frameNumber" in buildViewerStillBody(ref, ctx)).toBe(false);
    expect("frameNumber" in buildViewerStillBody({ ...ref, frameNumber: 0 }, ctx)).toBe(false);
    expect(buildViewerStillBody({ ...ref, frameNumber: 7 }, ctx).frameNumber).toBe(7);
    expect(buildViewerStillBody({ ...ref, frameNumber: 7.4 }, ctx).frameNumber).toBe(7);
  });

  it("never sends a blank caption, because an unlabelled figure prints as one", () => {
    expect(buildViewerStillBody(ref, ctx).caption).toBe("Key image (viewer)");
    expect(buildViewerStillBody({ ...ref, caption: "   " }, ctx).caption).toBe("Key image (viewer)");
    expect(buildViewerStillBody({ ...ref, caption: " T2 axial C4 " }, ctx).caption).toBe("T2 axial C4");
  });

  it("refuses a viewer answer that is not a DICOM identity", () => {
    expect(() => buildViewerStillBody({ ...ref, sopInstanceUid: "javascript:alert(1)" }, ctx))
      .toThrow(/valid DICOM/i);
    expect(() => buildViewerStillBody(ref, { ...ctx, studyInstanceUid: "" })).toThrow(/valid DICOM/i);
  });
});

describe("picker URLs", () => {
  it("ask the ERP proxy, never a PACS host directly", () => {
    for (const url of [
      seriesListUrl(uid("3")),
      instanceListUrl(uid("3"), uid("3.1")),
      renderedImageUrl({ studyInstanceUid: uid("3"), seriesUid: uid("3.1"), sopUid: uid("30101"), frame: null }, 220),
    ]) {
      expect(url.startsWith("/api/radiology/dicom-web/")).toBe(true);
      expect(url).not.toMatch(/8042|https?:\/\//);
    }
  });

  it("ask for NumberOfFrames, because frame choice must not be a guess", () => {
    expect(instanceListUrl(uid("3"), uid("3.1"))).toContain(`includefield=${TAG_NUMBER_OF_FRAMES}`);
  });

  it("name the frame in the rendered path only when one was chosen", () => {
    const base = { studyInstanceUid: uid("3"), seriesUid: uid("3.1"), sopUid: uid("30101") };
    expect(renderedImageUrl({ ...base, frame: null }, 220)).toMatch(/\/instances\/[^/]+\/rendered/);
    expect(renderedImageUrl({ ...base, frame: 3 }, 220)).toMatch(/\/instances\/[^/]+\/frames\/3\/rendered/);
    expect(renderedImageUrl({ ...base, frame: 1 }, 120)).toContain("/frames/1/rendered");
  });

  it("keep the viewport size the picker asked for", () => {
    expect(renderedImageUrl({ studyInstanceUid: uid("3"), seriesUid: uid("3.1"), sopUid: uid("30101"), frame: null }, 220))
      .toContain("viewport=220,220");
  });
});
