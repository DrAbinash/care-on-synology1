import { describe, expect, test, vi } from "vitest";

// paymentDiagnostics.ts imports `db` from @workspace/db at module top level,
// which throws unconditionally at import time when DATABASE_URL is not set.
// Same mocking approach as gateway-webhooks.test.ts / day-close.test.ts.
const insertedRows: any[] = [];
vi.mock("@workspace/db", () => ({
  db: {
    insert: () => ({
      values: async (row: any) => {
        insertedRows.push(row);
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => [],
          }),
        }),
      }),
    }),
  },
}));
vi.mock("@workspace/db/schema", () => ({
  paymentGatewayDiagnosticsTable: {
    gateway: "gateway",
    stage: "stage",
    success: "success",
    merchantTxnNo: "merchant_txn_no",
    createdAt: "created_at",
    id: "id",
  },
}));

import { recordPaymentDiagnostic } from "./paymentDiagnostics";

describe("recordPaymentDiagnostic", () => {
  test("never throws — a diagnostics failure must not break a real payment", async () => {
    // Force the insert to fail and confirm the caller still resolves cleanly.
    const { db } = await import("@workspace/db");
    (db.insert as any) = () => ({
      values: async () => {
        throw new Error("simulated DB outage");
      },
    });

    await expect(
      recordPaymentDiagnostic({ stage: "initiate", success: false })
    ).resolves.toBeUndefined();
  });

  test("masks the secure hash instead of storing it verbatim", async () => {
    insertedRows.length = 0;
    const { db } = await import("@workspace/db");
    (db.insert as any) = () => ({
      values: async (row: any) => {
        insertedRows.push(row);
      },
    });

    await recordPaymentDiagnostic({
      stage: "initiate",
      success: true,
      secureHash: "abcdef0123456789abcdef0123456789",
    });

    expect(insertedRows).toHaveLength(1);
    const stored = insertedRows[0].secureHashMasked as string;
    expect(stored).not.toContain("abcdef0123456789abcdef0123456789");
    expect(stored).toMatch(/^abcd…6789/);
  });

  test("redacts sensitive-looking request headers before storing", async () => {
    insertedRows.length = 0;
    const { db } = await import("@workspace/db");
    (db.insert as any) = () => ({
      values: async (row: any) => {
        insertedRows.push(row);
      },
    });

    await recordPaymentDiagnostic({
      stage: "initiate",
      success: true,
      requestHeaders: { Authorization: "Bearer secret-token", "user-agent": "test-agent" },
    });

    const storedHeaders = JSON.parse(insertedRows[0].requestHeaders);
    expect(storedHeaders.Authorization).toBe("[redacted]");
    expect(storedHeaders["user-agent"]).toBe("test-agent");
  });
});
