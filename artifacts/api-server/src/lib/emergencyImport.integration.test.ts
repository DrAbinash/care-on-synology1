import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EmergencyTransaction } from "@workspace/emergency-billing";

const RUN = process.env.CARE_EMERGENCY_IMPORT_TEST === "1";

function txn(over: Partial<EmergencyTransaction> = {}): EmergencyTransaction {
  const uuid = over.emergencyTransactionUuid ?? randomUUID();
  return {
    emergencyTransactionUuid: uuid,
    emergencyBillNumber: over.emergencyBillNumber ?? `EMG-20260814-${String(Math.floor(Math.random() * 90000) + 10000)}`,
    emergencySessionUuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    status: "PENDING",
    createdAt: "2026-08-14T04:51:00.000Z",
    createdByStaffId: 3,
    createdByStaffName: "Reception",
    patient: {
      carePatientId: 7,
      uhid: "P-00001",
      firstName: "Test Patient",
      lastName: "Hello",
      sex: "M",
      ageValue: 30,
      ageUnit: "years",
      dateOfBirth: null,
      mobile: "9876543210",
    },
    referringDoctorId: null,
    referringDoctorName: null,
    lines: [{
      careServiceId: 1,
      serviceCode: "EMG-MRI-BR",
      serviceName: "MRI Brain (emergency drill)",
      category: "MRI",
      quantity: 1,
      unitPrice: 4000,
      lineGross: 4000,
    }],
    grossAmount: 4000,
    discountAmount: 0,
    discountReason: null,
    netAmount: 4000,
    amountReceived: 3000,
    dueAmount: 1000,
    payments: [{ method: "cash", amount: 3000 }],
    notes: null,
    tariffSyncedAt: "2026-08-14T03:30:00.000Z",
    ...over,
  };
}

describe.skipIf(!RUN)("CARE emergency import (canonical bills)", () => {
  let importEmergencyTransactions: typeof import("./emergencyReconcile").importEmergencyTransactions;
  let db: typeof import("@workspace/db").db;
  let billsTable: typeof import("@workspace/db").billsTable;
  let paymentsTable: typeof import("@workspace/db").paymentsTable;
  let emergencyImportedTransactionsTable: typeof import("@workspace/db").emergencyImportedTransactionsTable;
  let testsTable: typeof import("@workspace/db").testsTable;
  let eq: typeof import("drizzle-orm").eq;
  const uuids: string[] = [];

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
    ({ db, billsTable, paymentsTable, emergencyImportedTransactionsTable, testsTable } = await import("@workspace/db"));
    ({ eq } = await import("drizzle-orm"));
    ({ importEmergencyTransactions } = await import("./emergencyReconcile"));
  }, 30_000);

  afterAll(async () => {
    // leave imported rows for inspection; nothing to close
  });

  it("imports partial payment once and is idempotent on repeat CSV/JSON/NAS", async () => {
    const a = txn({ emergencyBillNumber: "EMG-20260814-90001", emergencyTransactionUuid: randomUUID() });
    const b = txn({
      emergencyBillNumber: "EMG-20260814-90002",
      emergencyTransactionUuid: randomUUID(),
      patient: {
        carePatientId: null,
        uhid: null,
        firstName: "New",
        lastName: "Emg",
        sex: "F",
        ageValue: 21,
        ageUnit: "years",
        dateOfBirth: null,
        mobile: "9555555002",
      },
      amountReceived: 0,
      dueAmount: 4000,
      payments: [],
    });
    const voided = txn({
      emergencyBillNumber: "EMG-20260814-90003",
      emergencyTransactionUuid: randomUUID(),
      status: "VOID",
      voidReason: "drill",
    });
    uuids.push(a.emergencyTransactionUuid, b.emergencyTransactionUuid, voided.emergencyTransactionUuid);

    const first = await importEmergencyTransactions({
      transactions: [a, b, voided],
      importMethod: "CSV",
      importedBy: "drill",
      importedByUserId: 1,
      onlySafe: true,
    });
    expect(first.result.created).toBe(2);
    expect(first.result.failures).toBe(0);
    expect(first.result.skippedReview).toBe(1);

    const [billA] = await db.select().from(billsTable).where(eq(billsTable.clientRef, `emg:${a.emergencyTransactionUuid}`));
    expect(billA).toBeTruthy();
    expect(Number(billA.paidAmount)).toBe(3000);
    expect(Number(billA.balanceAmount)).toBe(1000);
    expect(Number(billA.totalAmount)).toBe(4000);
    expect(billA.status).toBe("partial");
    const pays = await db.select().from(paymentsTable).where(eq(paymentsTable.billId, billA.id));
    expect(pays).toHaveLength(1);
    expect(Number(pays[0]!.amount)).toBe(3000);

    await db.update(testsTable).set({ price: "9999.00" }).where(eq(testsTable.id, 1));
    const second = await importEmergencyTransactions({
      transactions: [a, b, voided],
      importMethod: "JSON",
      importedBy: "drill",
      importedByUserId: 1,
      onlySafe: true,
    });
    expect(second.result.created).toBe(0);
    expect(second.result.alreadyReconciled).toBe(2);
    expect(second.result.duplicates).toBe(2);
    expect(second.result.failures).toBe(0);

    const [billA2] = await db.select().from(billsTable).where(eq(billsTable.clientRef, `emg:${a.emergencyTransactionUuid}`));
    expect(billA2.id).toBe(billA.id);
    expect(Number(billA2.totalAmount)).toBe(4000);

    const nasThenCsv = await importEmergencyTransactions({
      transactions: [a],
      importMethod: "NAS_API",
      importedBy: "drill",
      importedByUserId: 1,
    });
    expect(nasThenCsv.result.created).toBe(0);
    expect(nasThenCsv.result.alreadyReconciled).toBe(1);

    const concurrentUuid = randomUUID();
    const concurrent = await Promise.all([
      importEmergencyTransactions({
        transactions: [txn({ emergencyBillNumber: "EMG-20260814-90010", emergencyTransactionUuid: concurrentUuid })],
        importMethod: "CSV",
        importedBy: "drill-a",
        importedByUserId: 1,
      }),
      importEmergencyTransactions({
        transactions: [txn({ emergencyBillNumber: "EMG-20260814-90010", emergencyTransactionUuid: concurrentUuid })],
        importMethod: "CSV",
        importedBy: "drill-b",
        importedByUserId: 1,
      }),
    ]);
    const created = concurrent.reduce((n, r) => n + r.result.created, 0);
    const already = concurrent.reduce((n, r) => n + r.result.alreadyReconciled, 0);
    expect(created).toBe(1);
    expect(already).toBe(1);

    await db.update(testsTable).set({ price: "4000.00" }).where(eq(testsTable.id, 1));
    const mapped = await db.select().from(emergencyImportedTransactionsTable).where(eq(emergencyImportedTransactionsTable.emergencyTransactionUuid, a.emergencyTransactionUuid));
    expect(mapped).toHaveLength(1);
    expect(mapped[0]!.originalEmgBillNumber).toBe("EMG-20260814-90001");
  });
});
