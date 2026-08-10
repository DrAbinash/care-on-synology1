import { describe, expect, test } from "vitest";
import {
  buildBillAuditHash,
  buildBillAuditPayload,
  buildBillAuditToken,
} from "./billAuditHash";

describe("billAuditHash (FNV-1a)", () => {
  const base = {
    billNumber: "BILL-2026-001",
    createdAt: "2026-08-01T10:30:00.000Z",
    totalAmount: 4900,
    operatorId: "Abinash",
  };

  test("payload is BILL_NO-TIMESTAMP-TOTAL-OPERATOR", () => {
    const payload = buildBillAuditPayload(base);
    expect(payload).toMatch(/^2026001-\d+-4900\.00-Abinash$/);
  });

  test("hash is stable 8-char uppercase hex", () => {
    const a = buildBillAuditHash(base);
    const b = buildBillAuditHash(base);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9A-F]{8}$/);
  });

  test("token ends with hash", () => {
    const token = buildBillAuditToken(base);
    const hash = buildBillAuditHash(base);
    expect(token.endsWith(`-${hash}`)).toBe(true);
  });

  test("mismatch when total or operator changes", () => {
    const a = buildBillAuditHash(base);
    expect(buildBillAuditHash({ ...base, totalAmount: 4900.01 })).not.toBe(a);
    expect(buildBillAuditHash({ ...base, operatorId: "Other" })).not.toBe(a);
  });
});
