import { describe, expect, it } from "vitest";
import {
  buildPrintBridgePayload,
  buildPrintLabels,
  resolvePrintPageSize,
  singleStudyUidFor,
} from "./pacsEnterprise";

// Print-from-workspace bridge integration: buildPrintBridgePayload is the
// pure core of POST /api/radiology/print-images — everything it decides
// (copies clamping, orientation fallback, optional layout override, clinic
// branding mapped into the bridge's header/footer shape) is pinned here so
// the route handler itself only has to wire fetch + I/O around it.

const clinicFull = {
  name: "Care Diagnostic Centre",
  tagline: "Trusted since 1998",
  address: "12 MG Road, Pune",
  phone: "020-12345678",
  email: "info@care.example",
  logoDataUrl: "data:image/png;base64,iVBORw0KGgo=",
} as ReturnType<typeof import("../lib/buildPrintClinic").buildPrintClinic>;

describe("buildPrintBridgePayload — copies", () => {
  it("defaults to 1 when omitted", () => {
    expect(buildPrintBridgePayload(["img"], undefined, undefined, undefined, null).copies).toBe(1);
  });
  it("clamps to 1 when zero, negative, or non-numeric", () => {
    expect(buildPrintBridgePayload(["img"], 0, undefined, undefined, null).copies).toBe(1);
    expect(buildPrintBridgePayload(["img"], -3, undefined, undefined, null).copies).toBe(1);
    expect(buildPrintBridgePayload(["img"], "not-a-number", undefined, undefined, null).copies).toBe(1);
  });
  it("clamps to 20 when above the ceiling", () => {
    expect(buildPrintBridgePayload(["img"], 999, undefined, undefined, null).copies).toBe(20);
  });
  it("floors a fractional value", () => {
    expect(buildPrintBridgePayload(["img"], 3.9, undefined, undefined, null).copies).toBe(3);
  });
});

describe("buildPrintBridgePayload — orientation", () => {
  it("passes through LANDSCAPE", () => {
    expect(buildPrintBridgePayload(["img"], 1, "LANDSCAPE", undefined, null).orientation).toBe("LANDSCAPE");
  });
  it("defaults anything else to PORTRAIT", () => {
    expect(buildPrintBridgePayload(["img"], 1, undefined, undefined, null).orientation).toBe("PORTRAIT");
    expect(buildPrintBridgePayload(["img"], 1, "sideways", undefined, null).orientation).toBe("PORTRAIT");
    expect(buildPrintBridgePayload(["img"], 1, null, undefined, null).orientation).toBe("PORTRAIT");
  });
});

describe("buildPrintBridgePayload — layout override", () => {
  it("includes layout only when both rows and cols are present", () => {
    const payload = buildPrintBridgePayload(["img"], 1, undefined, { rows: 2, cols: 2 }, null);
    expect(payload.layout).toEqual({ rows: 2, cols: 2 });
  });
  it("omits layout when only one dimension is given", () => {
    expect(buildPrintBridgePayload(["img"], 1, undefined, { rows: 2 }, null).layout).toBeUndefined();
    expect(buildPrintBridgePayload(["img"], 1, undefined, { cols: 2 }, null).layout).toBeUndefined();
  });
  it("omits layout when not given at all", () => {
    expect(buildPrintBridgePayload(["img"], 1, undefined, undefined, null).layout).toBeUndefined();
  });
  it("floors fractional layout dimensions", () => {
    const payload = buildPrintBridgePayload(["img"], 1, undefined, { rows: 2.7, cols: 3.2 }, null);
    expect(payload.layout).toEqual({ rows: 2, cols: 3 });
  });
});

describe("buildPrintBridgePayload — clinic branding", () => {
  it("omits header and footer entirely when clinic is null", () => {
    const payload = buildPrintBridgePayload(["img"], 1, undefined, undefined, null);
    expect(payload.header).toBeUndefined();
    expect(payload.footer).toBeUndefined();
  });

  it("maps a full clinic row into header (tagline/name/logo) and footer (address, phone|email)", () => {
    const payload = buildPrintBridgePayload(["img"], 1, undefined, undefined, clinicFull);
    expect(payload.header).toEqual({
      line1: "Trusted since 1998",
      line2: "Care Diagnostic Centre",
      logo: "data:image/png;base64,iVBORw0KGgo=",
      align: "CENTER",
    });
    expect(payload.footer).toEqual({
      line1: "12 MG Road, Pune",
      line2: "020-12345678  |  info@care.example",
      align: "CENTER",
    });
  });

  it("omits header when the clinic has neither a name nor a logo", () => {
    const clinic = { ...clinicFull, name: "", logoDataUrl: null } as ReturnType<
      typeof import("../lib/buildPrintClinic").buildPrintClinic
    >;
    expect(buildPrintBridgePayload(["img"], 1, undefined, undefined, clinic).header).toBeUndefined();
  });

  it("omits footer when the clinic has no address, phone, or email", () => {
    const clinic = { ...clinicFull, address: "", phone: "", email: "" } as ReturnType<
      typeof import("../lib/buildPrintClinic").buildPrintClinic
    >;
    expect(buildPrintBridgePayload(["img"], 1, undefined, undefined, clinic).footer).toBeUndefined();
  });

  it("footer line2 falls back to just phone when email is missing", () => {
    const clinic = { ...clinicFull, email: "" } as ReturnType<typeof import("../lib/buildPrintClinic").buildPrintClinic>;
    const payload = buildPrintBridgePayload(["img"], 1, undefined, undefined, clinic);
    expect((payload.footer as { line2: string }).line2).toBe("020-12345678");
  });

  it("passes the images array through untouched", () => {
    const images = ["data:image/jpeg;base64,aaa", "data:image/jpeg;base64,bbb"];
    expect(buildPrintBridgePayload(images, 1, undefined, undefined, null).images).toBe(images);
  });
});

describe("singleStudyUidFor — patient identification safety", () => {
  it("returns the shared study UID when every image comes from it", () => {
    expect(
      singleStudyUidFor([
        { studyInstanceUid: "1.2.3" },
        { studyInstanceUid: "1.2.3" },
      ]),
    ).toBe("1.2.3");
  });

  it("returns null when the images span two studies", () => {
    // The whole point: two studies could be two patients, and labelling the
    // sheet with either one's name would be worse than labelling neither.
    expect(
      singleStudyUidFor([
        { studyInstanceUid: "1.2.3" },
        { studyInstanceUid: "9.9.9" },
      ]),
    ).toBeNull();
  });

  it("returns null when any image has no study UID at all", () => {
    // An unattributed image could belong to anyone.
    expect(singleStudyUidFor([{ studyInstanceUid: "1.2.3" }, {}])).toBeNull();
    expect(singleStudyUidFor([{ studyInstanceUid: "1.2.3" }, { studyInstanceUid: "  " }])).toBeNull();
  });

  it("returns null for an empty request", () => {
    expect(singleStudyUidFor([])).toBeNull();
  });

  it("tolerates surrounding whitespace", () => {
    expect(singleStudyUidFor([{ studyInstanceUid: " 1.2.3 " }, { studyInstanceUid: "1.2.3" }])).toBe("1.2.3");
  });
});

describe("buildPrintBridgePayload — patient", () => {
  const patient = { name: "SHARMA^RITA", id: "USG-2026-0731", studyDate: "20260725", modality: "us" };

  it("passes the patient block through, upper-casing the modality", () => {
    const payload = buildPrintBridgePayload(["img"], 1, undefined, undefined, null, patient);
    expect(payload.patient).toEqual({
      name: "SHARMA^RITA",
      id: "USG-2026-0731",
      studyDate: "20260725",
      modality: "US",
    });
  });

  it("omits patient entirely when not supplied", () => {
    expect(buildPrintBridgePayload(["img"], 1, undefined, undefined, null).patient).toBeUndefined();
    expect(buildPrintBridgePayload(["img"], 1, undefined, undefined, null, null).patient).toBeUndefined();
  });

  it("omits patient when every field is blank rather than printing an empty line", () => {
    expect(
      buildPrintBridgePayload(["img"], 1, undefined, undefined, null, {
        name: "",
        id: "   ",
        studyDate: "",
        modality: "",
      }).patient,
    ).toBeUndefined();
  });

  it("keeps a partial patient — an ID alone is still worth printing", () => {
    const payload = buildPrintBridgePayload(["img"], 1, undefined, undefined, null, { id: "X-9" });
    expect(payload.patient).toEqual({ name: "", id: "X-9", studyDate: "", modality: "" });
  });

  it("trims surrounding whitespace on every field", () => {
    const payload = buildPrintBridgePayload(["img"], 1, undefined, undefined, null, {
      name: "  KUMAR^ANIL  ",
      id: " CT-1 ",
      studyDate: " 20260725 ",
      modality: " ct ",
    });
    expect(payload.patient).toEqual({
      name: "KUMAR^ANIL",
      id: "CT-1",
      studyDate: "20260725",
      modality: "CT",
    });
  });

  it("leaves clinic branding untouched when a patient is supplied", () => {
    const payload = buildPrintBridgePayload(["img"], 1, undefined, undefined, clinicFull, patient);
    expect((payload.header as { line2: string }).line2).toBe("Care Diagnostic Centre");
    expect(payload.patient).toBeDefined();
  });
});

describe("buildPrintLabels", () => {
  const series = { "1.2.840.1": "PLAX", "1.2.840.2": "4C VIEW" };

  it("captions each frame with its series description and sheet position", () => {
    expect(
      buildPrintLabels(
        [{ seriesInstanceUid: "1.2.840.1" }, { seriesInstanceUid: "1.2.840.2" }],
        series,
      ),
    ).toEqual(["PLAX  #1", "4C VIEW  #2"]);
  });

  it("falls back to the position alone for an unknown series", () => {
    expect(buildPrintLabels([{ seriesInstanceUid: "9.9.9" }, {}], series)).toEqual(["#1", "#2"]);
  });

  it("numbers by sheet position, not by the caller's original index", () => {
    // The caller passes only the refs whose pixels arrived. If image 2 of 3
    // failed its PACS fetch, the surviving frames must read #1 and #2 — and
    // the second one must carry ITS OWN series, not the dropped frame's.
    expect(
      buildPrintLabels([{ seriesInstanceUid: "1.2.840.1" }, { seriesInstanceUid: "1.2.840.2" }], series),
    ).toEqual(["PLAX  #1", "4C VIEW  #2"]);
  });

  it("tolerates whitespace and blank descriptions", () => {
    expect(buildPrintLabels([{ seriesInstanceUid: " 1.2.840.1 " }], series)).toEqual(["PLAX  #1"]);
    expect(buildPrintLabels([{ seriesInstanceUid: "1.2.840.3" }], { "1.2.840.3": "   " })).toEqual(["#1"]);
  });

  it("returns an empty list for no images", () => {
    expect(buildPrintLabels([], series)).toEqual([]);
  });
});

describe("resolvePrintPageSize", () => {
  const env = { PRINT_PAGE_SIZE_CT: "A3PLUS", PRINT_PAGE_SIZE_MR: "A3", PRINT_PAGE_SIZE_DEFAULT: "A4" };

  it("prefers an explicit request over everything", () => {
    expect(resolvePrintPageSize("14X17", "CT", env)).toBe("14X17");
  });
  it("falls back to the modality mapping", () => {
    expect(resolvePrintPageSize(undefined, "CT", env)).toBe("A3PLUS");
    expect(resolvePrintPageSize(undefined, "MR", env)).toBe("A3");
  });
  it("normalises the modality before looking it up", () => {
    expect(resolvePrintPageSize(undefined, " ct ", env)).toBe("A3PLUS");
  });
  it("falls back to the default for an unmapped modality", () => {
    expect(resolvePrintPageSize(undefined, "US", env)).toBe("A4");
  });
  it("returns empty when nothing is configured, so the bridge keeps its own size", () => {
    expect(resolvePrintPageSize(undefined, "US", {})).toBe("");
    expect(resolvePrintPageSize("", "", {})).toBe("");
  });
  it("ignores a non-string request", () => {
    expect(resolvePrintPageSize(42, "CT", env)).toBe("A3PLUS");
  });
});

describe("buildPrintBridgePayload — labels and pageSize", () => {
  it("passes labels and pageSize through", () => {
    const payload = buildPrintBridgePayload(
      ["a", "b"], 1, undefined, undefined, null, null, ["PLAX  #1", "4C  #2"], "A3PLUS",
    );
    expect(payload.labels).toEqual(["PLAX  #1", "4C  #2"]);
    expect(payload.pageSize).toBe("A3PLUS");
  });

  it("omits both when not supplied — an existing install is unaffected", () => {
    const payload = buildPrintBridgePayload(["a"], 1, undefined, undefined, null);
    expect(payload.labels).toBeUndefined();
    expect(payload.pageSize).toBeUndefined();
  });

  it("omits labels when every caption is blank", () => {
    expect(
      buildPrintBridgePayload(["a"], 1, undefined, undefined, null, null, ["", "  "], "").labels,
    ).toBeUndefined();
  });

  it("omits pageSize when blank", () => {
    expect(
      buildPrintBridgePayload(["a"], 1, undefined, undefined, null, null, null, "   ").pageSize,
    ).toBeUndefined();
  });
});
