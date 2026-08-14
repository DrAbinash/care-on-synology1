import { describe, expect, it } from "vitest";
import {
  applyIdempotentOutcome,
  buildEmergencyJsonPackage,
  classifyPatientMatch,
  CSV_FORMAT,
  duePreserved,
  emptyImportResult,
  formatEmgBillNumber,
  isSafeToAutoImport,
  isValidEmgBillNumber,
  parseEmergencyCsv,
  parseEmergencyJson,
  parseEmgBillNumber,
  serializeEmergencyCsv,
  summarizeTransactions,
  verifyJsonChecksum,
  type EmergencyTransaction,
} from "./index";

function sampleTxn(over: Partial<EmergencyTransaction> = {}): EmergencyTransaction {
  return {
    emergencyTransactionUuid: "11111111-1111-4111-8111-111111111111",
    emergencyBillNumber: "EMG-20260814-00001",
    emergencySessionUuid: "22222222-2222-4222-8222-222222222222",
    status: "PENDING",
    createdAt: "2026-08-14T04:51:00.000Z",
    createdByStaffId: 3,
    createdByStaffName: "Reception",
    patient: {
      carePatientId: 10,
      uhid: "P-00010",
      firstName: "Ravi",
      lastName: "Kumar",
      sex: "M",
      ageValue: 42,
      ageUnit: "years",
      dateOfBirth: null,
      mobile: "9876543210",
    },
    referringDoctorId: 2,
    referringDoctorName: "Dr Test",
    lines: [{
      careServiceId: 5,
      serviceCode: "MRI-BR",
      serviceName: "MRI Brain",
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

describe("EMG numbering", () => {
  it("formats EMG-YYYYMMDD-XXXXX", () => {
    expect(formatEmgBillNumber("20260814", 1)).toBe("EMG-20260814-00001");
    expect(isValidEmgBillNumber("EMG-20260814-00001")).toBe(true);
    expect(parseEmgBillNumber("EMG-20260814-00001")).toEqual({ yyyymmdd: "20260814", seq: 1 });
    expect(isValidEmgBillNumber("2026081400001")).toBe(false);
  });
});

describe("patient matching", () => {
  const ravi = {
    carePatientId: 10,
    uhid: "P-00010",
    firstName: "Ravi",
    lastName: "Kumar",
    phone: "9876543210",
    sex: "M",
  };

  it("matches CARE id as EXACT", () => {
    const d = classifyPatientMatch({
      carePatientId: 10, uhid: "P-00010", firstName: "Ravi", lastName: "Kumar", mobile: "9876543210", sex: "M",
    }, [ravi]);
    expect(d.matchClass).toBe("EXACT_MATCH");
  });

  it("same phone different name is PROBABLE, never silent merge", () => {
    const d = classifyPatientMatch({
      carePatientId: null, uhid: null, firstName: "Sita", lastName: "Kumar", mobile: "9876543210", sex: "F",
    }, [ravi]);
    expect(d.matchClass).toBe("PROBABLE_MATCH");
    expect(isSafeToAutoImport(d.matchClass, false, false)).toBe(false);
  });

  it("same-name different phone is NEW_PATIENT, never a silent merge", () => {
    const d = classifyPatientMatch({
      carePatientId: null, uhid: null, firstName: "Ravi", lastName: "Kumar", mobile: "9000000001", sex: "M",
    }, [ravi]);
    expect(d.matchClass).toBe("NEW_PATIENT");
  });

  it("no match is NEW_PATIENT", () => {
    const d = classifyPatientMatch({
      carePatientId: null, uhid: null, firstName: "Asha", lastName: "Devi", mobile: "9000000000", sex: "F",
    }, [ravi]);
    expect(d.matchClass).toBe("NEW_PATIENT");
    expect(isSafeToAutoImport(d.matchClass, false, false)).toBe(true);
  });

  it("id vs demographics conflict", () => {
    const d = classifyPatientMatch({
      carePatientId: 10, uhid: null, firstName: "Someone", lastName: "Else", mobile: "1111111111", sex: "M",
    }, [ravi]);
    expect(d.matchClass).toBe("CONFLICT");
  });
});

describe("CSV + JSON round-trip", () => {
  it("CSV serialize/parse preserves UUID, EMG number, due", () => {
    const csv = serializeEmergencyCsv([sampleTxn()]);
    expect(csv.startsWith("format,")).toBe(true);
    expect(csv).toContain(CSV_FORMAT);
    const { transactions, errors } = parseEmergencyCsv(csv);
    expect(errors).toEqual([]);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]!.emergencyTransactionUuid).toBe("11111111-1111-4111-8111-111111111111");
    expect(transactions[0]!.dueAmount).toBe(1000);
    expect(duePreserved(transactions[0]!)).toBe(true);
  });

  it("JSON checksum verifies", () => {
    const pkg = buildEmergencyJsonPackage({
      sessions: [],
      transactions: [sampleTxn()],
      masterDataLastSyncedAt: "2026-08-14T03:30:00.000Z",
    });
    expect(verifyJsonChecksum(pkg)).toBe(true);
    const { pkg: parsed, errors } = parseEmergencyJson(JSON.stringify(pkg));
    expect(errors).toEqual([]);
    expect(parsed?.transactions).toHaveLength(1);
  });
});

describe("idempotency accounting", () => {
  it("same CSV uploaded twice creates 0 extra bills", () => {
    let r = emptyImportResult();
    r = applyIdempotentOutcome(r, "created");
    r = applyIdempotentOutcome(r, "already_reconciled");
    expect(r.supplied).toBe(2);
    expect(r.created).toBe(1);
    expect(r.alreadyReconciled).toBe(1);
    expect(r.duplicates).toBe(1);
    expect(r.failures).toBe(0);
  });

  it("NAS fetch then CSV of the same UUID does not create a second bill", () => {
    let r = emptyImportResult();
    r = applyIdempotentOutcome(r, "created");
    r = applyIdempotentOutcome(r, "already_reconciled");
    r = applyIdempotentOutcome(r, "duplicate");
    expect(r.created).toBe(1);
    expect(r.alreadyReconciled).toBe(2);
    expect(r.duplicates).toBe(2);
  });

  it("concurrent importers: one created, rest already_reconciled", () => {
    let r = emptyImportResult();
    r = applyIdempotentOutcome(r, "created");
    r = applyIdempotentOutcome(r, "already_reconciled");
    r = applyIdempotentOutcome(r, "already_reconciled");
    expect(r.created).toBe(1);
    expect(r.alreadyReconciled).toBe(2);
    expect(r.failures).toBe(0);
  });
});

describe("EMG sequence uniqueness", () => {
  it("formats 100 unique numbers for one day", () => {
    const set = new Set<string>();
    for (let i = 1; i <= 100; i++) set.add(formatEmgBillNumber("20260814", i));
    expect(set.size).toBe(100);
    expect([...set][99]).toBe("EMG-20260814-00100");
  });
});

describe("partial payment preservation", () => {
  it("₹4000 net / ₹3000 received / ₹1000 due", () => {
    const t = sampleTxn();
    const s = summarizeTransactions([t]);
    expect(s.net).toBe(4000);
    expect(s.collected).toBe(3000);
    expect(s.due).toBe(1000);
    expect(duePreserved(t)).toBe(true);
  });
});
