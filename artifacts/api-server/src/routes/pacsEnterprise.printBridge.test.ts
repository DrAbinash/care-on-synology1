import { describe, expect, it } from "vitest";
import { buildPrintBridgePayload } from "./pacsEnterprise";

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
