import { describe, expect, it } from "vitest";
import {
  buildStaffActivityRows,
  netClinicCash,
  BILL_AUDIT_OPERATIONAL_CHANGE_TYPES,
} from "./staffActivityAttribution";

function cashPay(name: string, amount: number) {
  return {
    recordedByName: name,
    amount,
    method: "cash",
    isCash: true,
    isDigital: false,
    isKnown: true,
  };
}
function upiPay(name: string, amount: number) {
  return {
    recordedByName: name,
    amount,
    method: "upi",
    isCash: false,
    isDigital: true,
    isKnown: true,
  };
}
function cardPay(name: string, amount: number) {
  return {
    recordedByName: name,
    amount,
    method: "card",
    isCash: false,
    isDigital: true,
    isKnown: true,
  };
}

describe("BILL_AUDIT_OPERATIONAL_CHANGE_TYPES", () => {
  it("excludes bill_created and payment_collected from activity-log Bill Edits", () => {
    expect(BILL_AUDIT_OPERATIONAL_CHANGE_TYPES).toContain("bill_created");
    expect(BILL_AUDIT_OPERATIONAL_CHANGE_TYPES).toContain("payment_collected");
    expect(BILL_AUDIT_OPERATIONAL_CHANGE_TYPES).toContain("referral");
  });
});

describe("buildStaffActivityRows — User1 create/collect, User2 cancel/refund", () => {
  const bills = [
    { createdByName: "User1", totalAmount: 11500, status: "cancelled" },
  ];
  const cancelledByActor = [
    { cancelledByName: "User2", totalAmount: 11500 },
  ];
  const payments = [cashPay("User1", 11500), cashPay("User2", -11500)];

  it("keeps User1 bills created + cash collected after User2 cancels/refunds", () => {
    const rows = buildStaffActivityRows({
      staffNames: ["User1", "User2"],
      bills,
      cancelledByActor,
      payments,
    });
    const u1 = rows.find((r) => r.name === "User1")!;
    expect(u1.billsCreated).toBe(11500);
    expect(u1.cashCollected).toBe(11500);
    expect(u1.billsCancelled).toBe(0);
    expect(u1.cashRefunded).toBe(0);
  });

  it("attributes cancel + refund only to User2", () => {
    const rows = buildStaffActivityRows({
      staffNames: ["User1", "User2"],
      bills,
      cancelledByActor,
      payments,
    });
    const u2 = rows.find((r) => r.name === "User2")!;
    expect(u2.billsCreated).toBe(0);
    expect(u2.cashCollected).toBe(0);
    expect(u2.billsCancelled).toBe(11500);
    expect(u2.cashRefunded).toBe(11500);
  });

  it("clinic net cash is collections − refunds = 0", () => {
    expect(netClinicCash(11500, 11500)).toBe(0);
  });
});

describe("same user does all actions", () => {
  it("shows create, collect, cancel, refund on one staff", () => {
    const rows = buildStaffActivityRows({
      staffNames: ["Sanjeev"],
      bills: [{ createdByName: "Sanjeev", totalAmount: 11500, status: "cancelled" }],
      cancelledByActor: [{ cancelledByName: "Sanjeev", totalAmount: 11500 }],
      payments: [cashPay("Sanjeev", 11500), cashPay("Sanjeev", -11500)],
    });
    const s = rows[0]!;
    expect(s.billsCreated).toBe(11500);
    expect(s.cashCollected).toBe(11500);
    expect(s.billsCancelled).toBe(11500);
    expect(s.cashRefunded).toBe(11500);
  });
});

describe("Net Cash Available — CASH ONLY", () => {
  it("1. ₹11,500 cash collected and fully refunded → Net Cash Available ₹0", () => {
    const rows = buildStaffActivityRows({
      staffNames: ["A"],
      bills: [{ createdByName: "A", totalAmount: 11500, status: "cancelled" }],
      cancelledByActor: [{ cancelledByName: "A", totalAmount: 11500 }],
      payments: [cashPay("A", 11500), cashPay("A", -11500)],
    });
    expect(netClinicCash(rows[0]!.cashCollected, rows[0]!.cashRefunded)).toBe(0);
  });

  it("2. ₹11,500 UPI collected and fully refunded → Net Cash Available stays ₹0", () => {
    const rows = buildStaffActivityRows({
      staffNames: ["A"],
      bills: [{ createdByName: "A", totalAmount: 11500, status: "cancelled" }],
      cancelledByActor: [{ cancelledByName: "A", totalAmount: 11500 }],
      payments: [upiPay("A", 11500), upiPay("A", -11500)],
    });
    expect(rows[0]!.cashCollected).toBe(0);
    expect(rows[0]!.cashRefunded).toBe(0);
    expect(rows[0]!.digitalCollected).toBe(11500);
    expect(rows[0]!.digitalRefunded).toBe(11500);
    expect(netClinicCash(rows[0]!.cashCollected, rows[0]!.cashRefunded)).toBe(0);
  });

  it("3. ₹11,500 card collection without refund → Net Cash Available stays ₹0", () => {
    const rows = buildStaffActivityRows({
      staffNames: ["A"],
      bills: [{ createdByName: "A", totalAmount: 11500, status: "paid" }],
      cancelledByActor: [],
      payments: [cardPay("A", 11500)],
    });
    expect(rows[0]!.cashCollected).toBe(0);
    expect(netClinicCash(rows[0]!.cashCollected, rows[0]!.cashRefunded)).toBe(0);
  });

  it("4. ₹10,000 cash + ₹1,500 UPI → Net Cash Available ₹10,000", () => {
    const rows = buildStaffActivityRows({
      staffNames: ["A"],
      bills: [{ createdByName: "A", totalAmount: 11500, status: "paid" }],
      cancelledByActor: [],
      payments: [cashPay("A", 10000), upiPay("A", 1500)],
    });
    expect(rows[0]!.cashCollected).toBe(10000);
    expect(rows[0]!.digitalCollected).toBe(1500);
    expect(netClinicCash(rows[0]!.cashCollected, rows[0]!.cashRefunded)).toBe(10000);
  });

  it("5. Refund ₹2,000 cash from ₹11,500 cash collection → Net Cash Available ₹9,500", () => {
    const rows = buildStaffActivityRows({
      staffNames: ["A"],
      bills: [{ createdByName: "A", totalAmount: 11500, status: "paid" }],
      cancelledByActor: [],
      payments: [cashPay("A", 11500), cashPay("A", -2000)],
    });
    expect(netClinicCash(rows[0]!.cashCollected, rows[0]!.cashRefunded)).toBe(9500);
  });

  it("6. multiple partial cash refunds sum correctly", () => {
    const rows = buildStaffActivityRows({
      staffNames: ["A"],
      bills: [{ createdByName: "A", totalAmount: 11500, status: "paid" }],
      cancelledByActor: [],
      payments: [cashPay("A", 11500), cashPay("A", -1000), cashPay("A", -500), cashPay("A", -500)],
    });
    expect(rows[0]!.cashRefunded).toBe(2000);
    expect(netClinicCash(rows[0]!.cashCollected, rows[0]!.cashRefunded)).toBe(9500);
  });

  it("7. failed/pending refunds (no payment row written) do not reduce Net Cash Available", () => {
    // Only completed refunds insert a negative payment row. No row → no effect.
    const rows = buildStaffActivityRows({
      staffNames: ["A"],
      bills: [{ createdByName: "A", totalAmount: 11500, status: "paid" }],
      cancelledByActor: [],
      payments: [cashPay("A", 11500)],
    });
    expect(netClinicCash(rows[0]!.cashCollected, rows[0]!.cashRefunded)).toBe(11500);
  });

  it("8. reversed refund (positive cash payment) restores Net Cash Available", () => {
    const rows = buildStaffActivityRows({
      staffNames: ["A"],
      bills: [{ createdByName: "A", totalAmount: 11500, status: "paid" }],
      cancelledByActor: [],
      payments: [
        cashPay("A", 11500),
        cashPay("A", -2000),
        cashPay("A", 2000),
      ],
    });
    expect(rows[0]!.cashCollected).toBe(13500);
    expect(rows[0]!.cashRefunded).toBe(2000);
    expect(netClinicCash(rows[0]!.cashCollected, rows[0]!.cashRefunded)).toBe(11500);
  });
});

describe("partial refund", () => {
  it("attributes ₹2000 refund only to refunding user; bill created stays full", () => {
    const rows = buildStaffActivityRows({
      staffNames: ["User1", "User2"],
      bills: [{ createdByName: "User1", totalAmount: 11500, status: "paid" }],
      cancelledByActor: [],
      payments: [cashPay("User1", 11500), cashPay("User2", -2000)],
    });
    const u1 = rows.find((r) => r.name === "User1")!;
    const u2 = rows.find((r) => r.name === "User2")!;
    expect(u1.billsCreated).toBe(11500);
    expect(u1.cashCollected).toBe(11500);
    expect(u1.cashRefunded).toBe(0);
    expect(u2.cashRefunded).toBe(2000);
    expect(u2.billsCancelled).toBe(0);
    expect(netClinicCash(11500, 2000)).toBe(9500);
  });
});

describe("cancel without refund", () => {
  it("shows cancellation under canceller, no cash refund", () => {
    const rows = buildStaffActivityRows({
      staffNames: ["User1", "User2"],
      bills: [{ createdByName: "User1", totalAmount: 5000, status: "cancelled" }],
      cancelledByActor: [{ cancelledByName: "User2", totalAmount: 5000 }],
      payments: [upiPay("User1", 5000)],
    });
    const u2 = rows.find((r) => r.name === "User2")!;
    expect(u2.billsCancelled).toBe(5000);
    expect(u2.cashRefunded).toBe(0);
  });
});

describe("date-range independence (action timestamps)", () => {
  it("Monday collection vs Tuesday refund stay separate when callers pass range-scoped events", () => {
    const monday = buildStaffActivityRows({
      staffNames: ["User1"],
      bills: [{ createdByName: "User1", totalAmount: 11500, status: "paid" }],
      cancelledByActor: [],
      payments: [cashPay("User1", 11500)],
    });
    expect(monday[0]!.cashCollected).toBe(11500);
    expect(monday[0]!.cashRefunded).toBe(0);

    const tuesday = buildStaffActivityRows({
      staffNames: ["User2"],
      bills: [],
      cancelledByActor: [{ cancelledByName: "User2", totalAmount: 11500 }],
      payments: [cashPay("User2", -11500)],
    });
    expect(tuesday[0]!.billsCreated).toBe(0);
    expect(tuesday[0]!.billsCancelled).toBe(11500);
    expect(tuesday[0]!.cashRefunded).toBe(11500);
    expect(netClinicCash(0, 11500)).toBe(-11500);
  });
});
