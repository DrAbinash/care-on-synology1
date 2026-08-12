import { describe, expect, test } from "vitest";
import {
  BILL_DESK_COLLECTOR_FALLBACK,
  parseInitiatedByName,
  resolveBillDeskCollector,
} from "./resolveBillDeskCollector";

describe("parseInitiatedByName", () => {
  test("reads initiatedByName from payment log payload", () => {
    expect(
      parseInitiatedByName(JSON.stringify({ initiatedByName: "Priya Sharma", redirectUrl: "https://x" })),
    ).toBe("Priya Sharma");
  });

  test("returns null for missing / blank / invalid payload", () => {
    expect(parseInitiatedByName(null)).toBeNull();
    expect(parseInitiatedByName("{}")).toBeNull();
    expect(parseInitiatedByName(JSON.stringify({ initiatedByName: "  " }))).toBeNull();
    expect(parseInitiatedByName("not-json")).toBeNull();
  });
});

describe("resolveBillDeskCollector", () => {
  test("prefers stored initiator over session and bill creator", () => {
    expect(
      resolveBillDeskCollector({
        requestPayload: JSON.stringify({ initiatedByName: "Desk Cashier" }),
        sessionName: "Other Staff",
        billCreatedByName: "Bill Creator",
      }),
    ).toBe("Desk Cashier");
  });

  test("falls back to session, then bill creator", () => {
    expect(
      resolveBillDeskCollector({
        sessionName: "Polling Staff",
        billCreatedByName: "Bill Creator",
      }),
    ).toBe("Polling Staff");

    expect(
      resolveBillDeskCollector({
        billCreatedByName: "Bill Creator",
      }),
    ).toBe("Bill Creator");
  });

  test("does not credit Super Admin / Online Booking creators as desk collectors", () => {
    expect(
      resolveBillDeskCollector({
        billCreatedByName: "Super Admin",
      }),
    ).toBe(BILL_DESK_COLLECTOR_FALLBACK);

    expect(
      resolveBillDeskCollector({
        billCreatedByName: "Online Booking (Super Admin)",
      }),
    ).toBe(BILL_DESK_COLLECTOR_FALLBACK);
  });
});
