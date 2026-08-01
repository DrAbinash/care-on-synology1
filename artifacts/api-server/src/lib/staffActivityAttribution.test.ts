import { describe, expect, it } from "vitest";
import {
  buildStaffActivityRows,
  netClinicCash,
} from "./staffActivityAttribution";

describe("buildStaffActivityRows — User1 create/collect, User2 cancel/refund", () => {
  const bills = [
    { createdByName: "User1", totalAmount: 11500, status: "cancelled" },
  ];
  const cancelledByActor = [
    { cancelledByName: "User2", totalAmount: 11500 },
  ];
  const payments = [
    {
      recordedByName: "User1",
      amount: 11500,
      method: "cash",
      isCash: true,
      isDigital: false,
      isKnown: true,
    },
    {
      recordedByName: "User2",
      amount: -11500,
      method: "cash",
      isCash: true,
      isDigital: false,
      isKnown: true,
    },
  ];

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
      payments: [
        { recordedByName: "Sanjeev", amount: 11500, method: "cash", isCash: true, isDigital: false, isKnown: true },
        { recordedByName: "Sanjeev", amount: -11500, method: "cash", isCash: true, isDigital: false, isKnown: true },
      ],
    });
    const s = rows[0]!;
    expect(s.billsCreated).toBe(11500);
    expect(s.cashCollected).toBe(11500);
    expect(s.billsCancelled).toBe(11500);
    expect(s.cashRefunded).toBe(11500);
  });
});

describe("partial refund", () => {
  it("attributes ₹2000 refund only to refunding user; bill created stays full", () => {
    const rows = buildStaffActivityRows({
      staffNames: ["User1", "User2"],
      bills: [{ createdByName: "User1", totalAmount: 11500, status: "paid" }],
      cancelledByActor: [],
      payments: [
        { recordedByName: "User1", amount: 11500, method: "cash", isCash: true, isDigital: false, isKnown: true },
        { recordedByName: "User2", amount: -2000, method: "cash", isCash: true, isDigital: false, isKnown: true },
      ],
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
      payments: [
        { recordedByName: "User1", amount: 5000, method: "upi", isCash: false, isDigital: true, isKnown: true },
      ],
    });
    const u2 = rows.find((r) => r.name === "User2")!;
    expect(u2.billsCancelled).toBe(5000);
    expect(u2.cashRefunded).toBe(0);
  });
});

describe("multiple partial refunds", () => {
  it("sums refunds for the refunding user", () => {
    const rows = buildStaffActivityRows({
      staffNames: ["User2"],
      bills: [{ createdByName: "User1", totalAmount: 10000, status: "paid" }],
      cancelledByActor: [],
      payments: [
        { recordedByName: "User2", amount: -1000, method: "cash", isCash: true, isDigital: false, isKnown: true },
        { recordedByName: "User2", amount: -500, method: "cash", isCash: true, isDigital: false, isKnown: true },
      ],
    });
    expect(rows[0]!.cashRefunded).toBe(1500);
  });
});
