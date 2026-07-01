import { describe, expect, test, vi } from "vitest";

// auto-voucher.ts imports `db` from @workspace/db at module top level,
// which throws unconditionally at import time when DATABASE_URL is not
// set. resolveMethodAccount is pure and never touches the database —
// mocking prevents the load-time throw without affecting what is under
// test. Same pattern as day-close.test.ts / closureBoundary.test.ts.
vi.mock("@workspace/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }), insert: () => ({ values: () => ({ returning: async () => [{}] }) }) },
}));
vi.mock("@workspace/db/schema", () => ({ accountsTable: {}, vouchersTable: {} }));

import { resolveMethodAccount } from "./auto-voucher";

describe("resolveMethodAccount — existing exact-match methods unchanged (regression guard)", () => {
  test("cash → Cash in Hand", () => {
    expect(resolveMethodAccount("cash").name).toBe("Cash in Hand");
  });
  test("upi → UPI Collections", () => {
    expect(resolveMethodAccount("upi").name).toBe("UPI Collections");
  });
  test("card → Card Collections", () => {
    expect(resolveMethodAccount("card").name).toBe("Card Collections");
  });
  test("cheque → Cheque Collections", () => {
    expect(resolveMethodAccount("cheque").name).toBe("Cheque Collections");
  });
  test("bare 'online' → Online Collections", () => {
    expect(resolveMethodAccount("online").name).toBe("Online Collections");
  });
  test("'bank' keeps its own distinct account (not merged into Online Collections)", () => {
    expect(resolveMethodAccount("bank").name).toBe("Bank Account");
  });
  test("'neft' and 'rtgs' keep their own distinct account", () => {
    expect(resolveMethodAccount("neft").name).toBe("NEFT/RTGS Collections");
    expect(resolveMethodAccount("rtgs").name).toBe("NEFT/RTGS Collections");
  });
});

describe("resolveMethodAccount — fixed bugs", () => {
  test("insurance now has its own account (previously missing, fell through to Cash in Hand)", () => {
    const acc = resolveMethodAccount("insurance");
    expect(acc.name).toBe("Insurance Collections");
    expect(acc.name).not.toBe("Cash in Hand");
  });

  test("gateway-qualified 'Online (ICICI Orange Pay)' resolves to Online Collections, NOT Cash in Hand", () => {
    const acc = resolveMethodAccount("Online (ICICI Orange Pay)");
    expect(acc.name).toBe("Online Collections");
    expect(acc.name).not.toBe("Cash in Hand");
  });

  test("gateway-qualified 'Online (Razorpay)' resolves to Online Collections", () => {
    expect(resolveMethodAccount("Online (Razorpay)").name).toBe("Online Collections");
  });

  test("gateway-qualified 'Online (PhonePe)' and 'Online (BharatPe)' resolve to Online Collections", () => {
    expect(resolveMethodAccount("Online (PhonePe)").name).toBe("Online Collections");
    expect(resolveMethodAccount("Online (BharatPe)").name).toBe("Online Collections");
  });

  test("an unrecognized method routes to Unclassified Collections, NOT Cash in Hand", () => {
    const acc = resolveMethodAccount("wallet-xyz");
    expect(acc.name).toBe("Unclassified Collections (Needs Review)");
    expect(acc.type).toBe("bank"); // never "cash" — must not inflate cash-in-hand
  });

  test("blank/empty method routes to Unclassified Collections, not silently to cash", () => {
    expect(resolveMethodAccount("").name).toBe("Unclassified Collections (Needs Review)");
  });
});
