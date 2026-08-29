import { describe, expect, test } from "vitest";
import { mapBillToStudioStatus, isOpenUpiLinkStatus } from "./reportingStudioBilling";

describe("reportingStudioBilling", () => {
  test("maps paid → PAID", () => {
    expect(mapBillToStudioStatus("paid")).toBe("PAID");
    expect(mapBillToStudioStatus("paid", true)).toBe("PAID");
  });

  test("maps pending/partial → DUE when no open UPI link", () => {
    expect(mapBillToStudioStatus("pending")).toBe("DUE");
    expect(mapBillToStudioStatus("partial")).toBe("DUE");
  });

  test("maps pending + open UPI link → UPI_PENDING", () => {
    expect(mapBillToStudioStatus("pending", true)).toBe("UPI_PENDING");
    expect(mapBillToStudioStatus("partial", true)).toBe("UPI_PENDING");
  });

  test("cancelled / missing → null", () => {
    expect(mapBillToStudioStatus("cancelled")).toBeNull();
    expect(mapBillToStudioStatus(null)).toBeNull();
    expect(mapBillToStudioStatus(undefined)).toBeNull();
  });

  test("open UPI link statuses", () => {
    expect(isOpenUpiLinkStatus("created")).toBe(true);
    expect(isOpenUpiLinkStatus("sent")).toBe(true);
    expect(isOpenUpiLinkStatus("expired")).toBe(false);
    expect(isOpenUpiLinkStatus("cancelled")).toBe(false);
  });
});
