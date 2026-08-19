import { describe, expect, test } from "vitest";
import { isReceptionPayAtCentre } from "./onlineBookingPayAtCentre";

describe("isReceptionPayAtCentre", () => {
  test("true only for reception/phone still awaiting payment", () => {
    expect(isReceptionPayAtCentre({ source: "phone", status: "pending_payment" })).toBe(true);
    expect(isReceptionPayAtCentre({ source: "reception", status: "pending_payment" })).toBe(true);
    expect(isReceptionPayAtCentre({ source: "PHONE", status: "pending_payment" })).toBe(true);
  });

  test("false for website/kiosk and for already-paid bookings", () => {
    expect(isReceptionPayAtCentre({ source: "website", status: "pending_payment" })).toBe(false);
    expect(isReceptionPayAtCentre({ source: "kiosk", status: "pending_payment" })).toBe(false);
    expect(isReceptionPayAtCentre({ source: "phone", status: "paid" })).toBe(false);
    expect(isReceptionPayAtCentre({ source: "reception", status: "confirmed" })).toBe(false);
  });
});
