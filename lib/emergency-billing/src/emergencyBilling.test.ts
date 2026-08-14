import { describe, expect, it } from "vitest";
import {
  applyIdempotentOutcome,
  buildEmergencyJsonPackage,
  applyManualPatientResolution,
  classifyPatientMatch,
  countsFromSnapshot,
  CSV_FORMAT,
  duePreserved,
  emptyImportResult,
  emergencyMasterSyncIntervalHours,
  formatEmgBillNumber,
  isSafeToAutoImport,
  needsManualPatientResolution,
  PatientResolutionError,
  isValidEmgBillNumber,
  JSON_FORMAT,
  MASTER_FORMAT,
  advertisedEmergencyCapability,
  compareMasterContract,
  masterPushBlockedReason,
  parseEmergencyCapability,
  parseEmergencyCsv,
  parseEmergencyJson,
  parseEmgBillNumber,
  parseMasterSnapshot,
  serializeEmergencyCsv,
  shouldSkipScheduledPush,
  snapshotAgeBand,
  stampMasterSnapshot,
  summarizeTransactions,
  UnsupportedContractError,
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

  it("multiple same-phone patients are CONFLICT and stay blocked until resolved", () => {
    const ravi2 = { ...ravi, carePatientId: 11, uhid: "P-00011", firstName: "Abinash" };
    const d = classifyPatientMatch({
      carePatientId: null, uhid: null, firstName: "abinash", lastName: "kumar", mobile: "9876543210", sex: "M",
    }, [ravi, ravi2]);
    expect(d.matchClass).toBe("CONFLICT");
    expect(d.reason).toMatch(/Multiple CARE patients share this phone/);
    expect(d.candidates).toHaveLength(2);
    expect(isSafeToAutoImport(d.matchClass, false, false)).toBe(false);
    expect(needsManualPatientResolution(d.matchClass, false, false)).toBe(true);
  });

  it("selecting one same-phone candidate resolves CONFLICT to EXACT_MATCH", () => {
    const ravi2 = { ...ravi, carePatientId: 11, uhid: "P-00011", firstName: "Abinash" };
    const d = classifyPatientMatch({
      carePatientId: null, uhid: null, firstName: "abinash", lastName: "kumar", mobile: "9876543210", sex: "M",
    }, [ravi, ravi2]);
    const resolved = applyManualPatientResolution(d, { action: "select_existing", carePatientId: 11 });
    expect(resolved.matchClass).toBe("EXACT_MATCH");
    expect(resolved.carePatientId).toBe(11);
    expect(isSafeToAutoImport(resolved.matchClass, false, false)).toBe(true);
  });

  it("create-as-new resolves CONFLICT without attaching an existing candidate", () => {
    const ravi2 = { ...ravi, carePatientId: 11, uhid: "P-00011", firstName: "Abinash" };
    const d = classifyPatientMatch({
      carePatientId: null, uhid: null, firstName: "abinash", lastName: "kumar", mobile: "9876543210", sex: "M",
    }, [ravi, ravi2]);
    const resolved = applyManualPatientResolution(d, { action: "create_new", carePatientId: 99 });
    expect(resolved.matchClass).toBe("NEW_PATIENT");
    expect(resolved.carePatientId).toBe(99);
    expect(isSafeToAutoImport(resolved.matchClass, false, false)).toBe(true);
  });

  it("unresolved CONFLICT stays blocked", () => {
    const ravi2 = { ...ravi, carePatientId: 11, uhid: "P-00011", firstName: "Abinash" };
    const d = classifyPatientMatch({
      carePatientId: null, uhid: null, firstName: "abinash", lastName: "kumar", mobile: "9876543210", sex: "M",
    }, [ravi, ravi2]);
    expect(applyManualPatientResolution(d, null).matchClass).toBe("CONFLICT");
    expect(isSafeToAutoImport(d.matchClass, false, false)).toBe(false);
  });

  it("will not resolve to a patient who is not a matcher candidate (no name-only merge)", () => {
    const d = classifyPatientMatch({
      carePatientId: null, uhid: null, firstName: "Sita", lastName: "Kumar", mobile: "9876543210", sex: "F",
    }, [ravi]);
    expect(() => applyManualPatientResolution(d, { action: "select_existing", carePatientId: 999 })).toThrow(PatientResolutionError);
  });

  it("already imported cannot be re-resolved", () => {
    const d = classifyPatientMatch({
      carePatientId: 10, uhid: "P-00010", firstName: "Ravi", lastName: "Kumar", mobile: "9876543210", sex: "M",
    }, [ravi]);
    expect(() => applyManualPatientResolution(d, { action: "select_existing", carePatientId: 10 }, { alreadyImported: true }))
      .toThrow(/read-only/);
    expect(isSafeToAutoImport("EXACT_MATCH", true, false)).toBe(false);
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

function sampleMaster() {
  return stampMasterSnapshot({
    syncedAt: "2026-08-14T11:35:00.000Z",
    services: [{ id: 1, code: "MRI-BR", name: "MRI Brain", category: "MRI", price: 4000, isActive: true }],
    doctors: [{ id: 2, name: "Dr Test", specialization: "Radiology" }],
    patients: [{
      id: 10, patientId: "P-00010", firstName: "Ravi", lastName: "Kumar",
      phone: "9876543210", gender: "male", dateOfBirth: null, ageValue: 42, ageUnit: "years",
    }],
    staff: [{
      id: 1, name: "Owner", username: "owner@test", role: "super_admin",
      pinHash: "hash", maxDiscount: 100, permissions: null,
    }],
    discountReasons: ["STAFF"],
  });
}

describe("CARE_EMERGENCY_MASTER_V1", () => {
  it("accepts the current contract and stamps format/version", () => {
    const snap = sampleMaster();
    expect(snap.format).toBe(MASTER_FORMAT);
    expect(snap.version).toBe(1);
    const parsed = parseMasterSnapshot(snap);
    expect(parsed.services).toHaveLength(1);
    expect(countsFromSnapshot(parsed)).toEqual({
      serviceCount: 1, doctorCount: 1, patientCount: 1, staffCount: 1,
    });
  });

  it("rejects an incompatible future schema version", () => {
    expect(() => parseMasterSnapshot({ ...sampleMaster(), version: 2 })).toThrow(UnsupportedContractError);
    expect(() => parseMasterSnapshot({ ...sampleMaster(), format: "CARE_EMERGENCY_MASTER_V2" })).toThrow(/Unsupported master-data format/);
  });

  it("rejects a payload with no format rather than guessing", () => {
    const { format: _f, version: _v, ...rest } = sampleMaster();
    expect(() => parseMasterSnapshot(rest)).toThrow(/Expected CARE_EMERGENCY_MASTER_V1/);
  });
});

describe("billing JSON/CSV contract versions", () => {
  it("rejects an incompatible JSON package version", () => {
    const { pkg, errors } = parseEmergencyJson(JSON.stringify({
      format: JSON_FORMAT,
      version: 99,
      exportedAt: "2026-08-14T00:00:00.000Z",
      masterDataLastSyncedAt: null,
      sessions: [],
      transactions: [sampleTxn()],
      checksumSha256: "x",
    }));
    expect(pkg).toBeNull();
    expect(errors[0]).toMatch(/Unsupported JSON contract version 99/);
  });

  it("rejects an unknown CSV format row", () => {
    const csv = serializeEmergencyCsv([sampleTxn()]).replace(CSV_FORMAT, "CARE_EMERGENCY_BILLING_V9");
    const { transactions, errors } = parseEmergencyCsv(csv);
    expect(transactions).toHaveLength(0);
    expect(errors.some((e) => e.includes("unsupported format"))).toBe(true);
  });
});

describe("CARE ↔ 225app master contract compatibility", () => {
  it("matching contract versions → COMPATIBLE", () => {
    const advertised = advertisedEmergencyCapability();
    expect(advertised.supportedMasterContractVersions).toEqual([MASTER_FORMAT]);
    const cmp = compareMasterContract({ remoteSupported: advertised.supportedMasterContractVersions });
    expect(cmp.status).toBe("COMPATIBLE");
    expect(cmp.careExpected).toBe("CARE_EMERGENCY_MASTER_V1");
    expect(cmp.remotePrimary).toBe("CARE_EMERGENCY_MASTER_V1");
    expect(masterPushBlockedReason(advertised.supportedMasterContractVersions)).toBeNull();
  });

  it("unsupported version → MISMATCH and blocks master push", () => {
    const cmp = compareMasterContract({ remoteSupported: ["CARE_EMERGENCY_MASTER_V2"] });
    expect(cmp.status).toBe("MISMATCH");
    expect(cmp.careExpected).toBe("CARE_EMERGENCY_MASTER_V1");
    expect(cmp.remotePrimary).toBe("CARE_EMERGENCY_MASTER_V2");
    expect(masterPushBlockedReason(["CARE_EMERGENCY_MASTER_V2"])).toMatch(/VERSION MISMATCH/);
  });

  it("uses the same identifier parseMasterSnapshot accepts", () => {
    const snap = sampleMaster();
    expect(parseMasterSnapshot(snap).format).toBe(
      compareMasterContract({ remoteSupported: [MASTER_FORMAT] }).careExpected,
    );
  });

  it("legacy capability body without supported versions is UNAVAILABLE (not a silent match)", () => {
    expect(parseEmergencyCapability({ ok: true, service: "care-emergency-billing" })).toBeNull();
    expect(compareMasterContract({ remoteSupported: null }).status).toBe("UNAVAILABLE");
    expect(masterPushBlockedReason(null)).toBeNull();
  });
});

describe("snapshot age bands", () => {
  const now = new Date("2026-08-14T12:00:00.000Z");

  it("never / fresh / warning / stale", () => {
    expect(snapshotAgeBand(null, now)).toBe("never");
    expect(snapshotAgeBand("2026-08-14T10:00:00.000Z", now)).toBe("fresh");
    expect(snapshotAgeBand("2026-08-14T04:00:00.000Z", now)).toBe("warning");
    expect(snapshotAgeBand("2026-08-13T10:00:00.000Z", now)).toBe("stale");
  });

  it("does not treat stale data as a hard failure — billing may continue", () => {
    expect(snapshotAgeBand("2026-08-01T00:00:00.000Z", now)).toBe("stale");
  });
});

describe("scheduled push skip (idempotent interval)", () => {
  const now = new Date("2026-08-14T12:00:00.000Z");

  it("reads EMERGENCY_MASTER_SYNC_INTERVAL_HOURS", () => {
    expect(emergencyMasterSyncIntervalHours({} as NodeJS.ProcessEnv)).toBe(6);
    expect(emergencyMasterSyncIntervalHours({ EMERGENCY_MASTER_SYNC_INTERVAL_HOURS: "12" } as NodeJS.ProcessEnv)).toBe(12);
  });

  it("skips a scheduled tick after a recent manual push", () => {
    expect(shouldSkipScheduledPush("2026-08-14T11:05:00.000Z", 6, now)).toBe(true);
    expect(shouldSkipScheduledPush("2026-08-14T05:00:00.000Z", 6, now)).toBe(false);
    expect(shouldSkipScheduledPush(null, 6, now)).toBe(false);
  });
});
