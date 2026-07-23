import { describe, expect, test, vi } from "vitest";

// reportDeliveryReceipts.ts imports `db` from @workspace/db at module top level,
// which throws when DATABASE_URL is unset. normalizeMetaStatus / receiptTimestamp
// are pure and never touch the DB — mocking prevents the load-time throw.
// Same pattern as auto-voucher.test.ts.
vi.mock("@workspace/db", () => ({ db: {} }));
vi.mock("@workspace/db/schema", () => ({ reportDeliveryReceiptsTable: {} }));

import { normalizeMetaStatus, receiptTimestamp } from "./reportDeliveryReceipts";

describe("normalizeMetaStatus", () => {
  test("maps each valid Meta status", () => {
    expect(normalizeMetaStatus("sent")).toBe("sent");
    expect(normalizeMetaStatus("delivered")).toBe("delivered");
    expect(normalizeMetaStatus("read")).toBe("read");
    expect(normalizeMetaStatus("failed")).toBe("failed");
  });
  test("is case/whitespace tolerant", () => {
    expect(normalizeMetaStatus(" READ ")).toBe("read");
    expect(normalizeMetaStatus("Delivered")).toBe("delivered");
  });
  test("returns null for unknown/empty", () => {
    expect(normalizeMetaStatus("deleted")).toBeNull();
    expect(normalizeMetaStatus("")).toBeNull();
    expect(normalizeMetaStatus(undefined)).toBeNull();
    expect(normalizeMetaStatus(null)).toBeNull();
  });
});

describe("receiptTimestamp", () => {
  test("converts unix seconds string to Date", () => {
    // 1_700_000_000 s = 2023-11-14T22:13:20.000Z
    expect(receiptTimestamp("1700000000").toISOString()).toBe("2023-11-14T22:13:20.000Z");
  });
  test("falls back to a Date for missing/invalid input", () => {
    expect(receiptTimestamp(undefined)).toBeInstanceOf(Date);
    expect(receiptTimestamp("")).toBeInstanceOf(Date);
    expect(receiptTimestamp("not-a-number")).toBeInstanceOf(Date);
    expect(receiptTimestamp("0")).toBeInstanceOf(Date);
  });
});
