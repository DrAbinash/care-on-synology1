import { describe, expect, test, vi, beforeEach } from "vitest";

// PR 2 — monthly PCPNDT register routes (GET /register, GET /register/export).
// Proves: management authorization is attached, month/year validation, stable
// serials with pagination, completeness grading of every record (no silent
// omission), billed-test linkage for all test types, the audited CSV export,
// and the clean empty-month state. Router-stack technique, mocked db.

let formFRows: Array<Record<string, unknown>>;
let formFTotal: number;
let billRows: Array<Record<string, unknown>>;
let orderTestRows: Array<Record<string, unknown>>;
let clinicFormFTestIds: string;
let auditCalls: Array<Record<string, unknown>>;
let prescriptionRows: Array<Record<string, unknown>>;

vi.mock("@workspace/db", () => {
  const chainFor = (table: { __name?: string }) => {
    if (table.__name === "form_f_records") {
      return {
        where: () => ({
          // count query resolves at await; list queries go through orderBy
          // (then optionally limit/offset) — the export awaits orderBy directly.
          then: (resolve: (v: unknown) => void) => resolve([{ total: formFTotal }]),
          orderBy: () => {
            const withOffset = { offset: async () => formFRows };
            return {
              limit: () => withOffset,
              ...withOffset,
              then: (resolve: (v: unknown) => void) => resolve(formFRows),
            };
          },
        }),
      };
    }
    if (table.__name === "bills") {
      return { where: async () => billRows };
    }
    if (table.__name === "order_tests") {
      return { leftJoin: () => ({ where: async () => orderTestRows }) };
    }
    if (table.__name === "clinic_settings") {
      return { limit: async () => [{ formFTestIds: clinicFormFTestIds }] };
    }
    if (table.__name === "self_referral_prescriptions") {
      return {
        where: () => Object.assign(Promise.resolve(prescriptionRows), {
          limit: async () => prescriptionRows,
        }),
      };
    }
    return { where: async () => [], limit: async () => [] };
  };
  return {
    db: { select: () => ({ from: (t: { __name?: string }) => chainFor(t) }) },
    billsTable: { __name: "bills", id: "id", orderId: "order_id" },
    patientsTable: { __name: "patients" },
    formFRecordsTable: { __name: "form_f_records", createdAt: "created_at", id: "id", billId: "bill_id" },
    clinicSettingsTable: { __name: "clinic_settings" },
    ordersTable: { __name: "orders" },
    orderTestsTable: { __name: "order_tests", orderId: "order_id", testId: "test_id" },
    testsTable: { __name: "diagnostic_tests", id: "id", name: "name" },
    doctorsTable: { __name: "doctors" },
  };
});

vi.mock("@workspace/db/schema", () => ({
  whatsappConversationsTable: {},
  whatsappSettingsTable: {},
  usgMeasurementsTable: {},
  radiologyStudiesTable: {},
  fetalUsgStudiesTable: {},
  fetalUsgMeasurementsTable: {},
  fetalUsgReportsTable: {},
  fetalUsgChecklistsTable: {},
  selfReferralPrescriptionsTable: { __name: "self_referral_prescriptions", id: "id", formFRecordId: "form_f_record_id", signedAt: "signed_at" },
}));

const ensureSelfReferralPrescriptions = vi.fn(async (_records: Array<{ id: number }>) => {});
vi.mock("../lib/selfReferralPrescriptions", () => ({
  ensureSelfReferralPrescriptions: (records: Array<{ id: number }>) => ensureSelfReferralPrescriptions(records),
}));

vi.mock("../middleware/requireStaffAuth", () => ({
  requireStaffPermission: (permission: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mw: any = (_req: unknown, _res: unknown, next: () => void) => next();
    mw.__permissionTag = permission;
    return mw;
  },
  requireAdminRole: Object.assign(
    (_req: unknown, _res: unknown, next: () => void) => next(),
    { __adminGate: true },
  ),
}));

vi.mock("../lib/audit", () => ({
  auditFromRequest: vi.fn(async (_req: unknown, payload: Record<string, unknown>) => {
    auditCalls.push(payload);
  }),
}));

vi.mock("../lib/ocr/idCardPipeline", () => ({ runIdCardOcrPipeline: vi.fn(), SERVER_BLUR_WARNING_THRESHOLD: 0 }));
vi.mock("../lib/ocr/ocrProviderResolver", () => ({ resolveOcrProvider: vi.fn(), maskEndpointUrl: vi.fn() }));
vi.mock("./whatsapp", () => ({ sendTextMessageRaw: vi.fn(), resolveNumber: vi.fn(), normalizePhone: vi.fn() }));

import formFRouter from "./form-f";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getLayer(method: "get" | "post", path: string): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layer = (formFRouter as any).stack.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (l: any) => l.route && l.route.path === path && l.route.methods[method],
  );
  if (!layer) throw new Error(`${method.toUpperCase()} ${path} handler not found`);
  return layer;
}

function makeRes() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = {
    statusCode: 200,
    body: undefined,
    headers: {} as Record<string, string>,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
    setHeader(k: string, v: string) { this.headers[k] = v; },
    send(payload: unknown) { this.body = payload; return this; },
  };
  return res;
}

function makeReq(query: Record<string, string>) {
  return {
    query,
    headers: {},
    staffSession: { subjectId: 1, subjectName: "Dr Abinash", role: "super_admin", permissions: [] },
    log: { error: vi.fn() },
  };
}

const registerLayer = getLayer("get", "/register");
const exportLayer = getLayer("get", "/register/export");
const registerHandler = registerLayer.route.stack[registerLayer.route.stack.length - 1].handle;
const exportHandler = exportLayer.route.stack[exportLayer.route.stack.length - 1].handle;

const RECORD = {
  id: 51,
  createdAt: new Date("2026-07-05T06:30:00Z"),
  patientId: 42,
  billId: 10,
  billNumber: "0042",
  fetalUsgStudyId: null,
  registrationNo: "REG-1",
  patientName: "Priya Test",
  age: "29",
  mobile: "9999900001",
  referredBy: "Dr. Mehta",
  doctorName: "Dr. Sugandha",
  procedure: "Obstetric USG",
  procedurePurpose: "Anomaly scan",
  basisDiagnosis: "",
  gestationalAgeWeeks: "19",
  gestationalAgeDays: "3",
  ultrasoundResult: "Normal",
  abnormality: "",
  resultConveyed: "yes",
  date: "2026-07-05",
  idCardVerified: true,
  husbandFatherName: "R. Kumar",
  address: "12 MG Road",
  consentDate: "2026-07-05",
  procedureDate: "",
};

beforeEach(() => {
  formFRows = [];
  formFTotal = 0;
  billRows = [{ id: 10, orderId: 700 }];
  // Order carries two Form-F-designated tests (different modalities — the
  // designation is the configured list, never fetal/echo-only) plus one
  // non-Form-F test that must NOT appear in the statutory register.
  orderTestRows = [
    { orderId: 700, testId: 201, testName: "USG Obstetric Level 2" },
    { orderId: 700, testId: 202, testName: "Fetal Echo" },
    { orderId: 700, testId: 203, testName: "CBC" },
  ];
  clinicFormFTestIds = JSON.stringify([201, 202]);
  auditCalls = [];
  prescriptionRows = [];
  ensureSelfReferralPrescriptions.mockClear();
});

describe("authorization", () => {
  test("both register routes carry the admin gate on top of the /form-f mount", () => {
    for (const layer of [registerLayer, exportLayer]) {
      const first = layer.route.stack[0].handle;
      expect(first.__adminGate).toBe(true);
    }
  });
});

describe("GET /form-f/register", () => {
  test("400 with a clear message on invalid month/year", async () => {
    for (const query of [{}, { month: "13", year: "2026" }, { month: "7", year: "1990" }]) {
      const res = makeRes();
      await registerHandler(makeReq(query as Record<string, string>), res);
      expect(res.statusCode).toBe(400);
      expect(String(res.body.error)).toContain("Invalid register query");
    }
  });

  test("PARTITION: contains doctor-referred records only — self/walk-in entries go to the OPD register instead", async () => {
    formFRows = [
      RECORD, // referredBy "Dr. Mehta" — doctor-referred, stays
      { ...RECORD, id: 52, address: "", billId: null }, // doctor-referred, incomplete — stays, graded
      { ...RECORD, id: 53, referredBy: "Self", doctorName: "" },   // self — excluded
      { ...RECORD, id: 54, referredBy: "", doctorName: "" },       // walk-in — excluded
    ];
    const res = makeRes();
    await registerHandler(makeReq({ month: "7", year: "2026" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.rows.map((r: { recordId: number }) => r.recordId)).toEqual([51, 52]);
    expect(res.body.rows.map((r: { serial: number }) => r.serial)).toEqual([1, 2]);
    // Only the CONFIGURED Form F tests appear — never other tests on the bill.
    expect(res.body.rows[0].linkedTests).toEqual(["USG Obstetric Level 2", "Fetal Echo"]);
    expect(res.body.rows[0].linkedTests).not.toContain("CBC");
    expect(res.body.rows[1].completionStatus).toBe("incomplete");
    expect(res.body.rows[1].missingFields).toContain("Address is required.");
    expect(res.body.incompleteCount).toBe(1);
    expect(res.body.pagination).toEqual({ page: 1, pageSize: 50, total: 2, totalPages: 1 });
  });

  test("serials stay offset-stable across pages of the partitioned register", async () => {
    formFRows = Array.from({ length: 12 }, (_, i) => ({ ...RECORD, id: 100 + i }));
    const res = makeRes();
    await registerHandler(makeReq({ month: "7", year: "2026", page: "2", pageSize: "10" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.rows.map((r: { serial: number }) => r.serial)).toEqual([11, 12]);
    expect(res.body.pagination).toEqual({ page: 2, pageSize: 10, total: 12, totalPages: 2 });
  });

  test("no Form-F designation configured → linkage column stays empty (mirrors /pending semantics)", async () => {
    clinicFormFTestIds = "[]";
    formFRows = [RECORD];
    formFTotal = 1;
    const res = makeRes();
    await registerHandler(makeReq({ month: "7", year: "2026" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.rows[0].linkedTests).toEqual([]);
  });

  test("empty month is a clean 200 with zero rows", async () => {
    const res = makeRes();
    await registerHandler(makeReq({ month: "1", year: "2026" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.rows).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
  });
});

describe("GET /form-f/register/self-referral-opd", () => {
  const opdLayer = getLayer("get", "/register/self-referral-opd");
  const opdHandler = opdLayer.route.stack[opdLayer.route.stack.length - 1].handle;

  test("carries the admin gate", () => {
    expect(opdLayer.route.stack[0].handle.__adminGate).toBe(true);
  });

  test("BOTH criteria only: self/walk-in referral AND a Form-F test patient — Form 25 prefills, continuous serials", async () => {
    billRows = [{ id: 10, orderId: 700 }, { id: 11, orderId: 701 }];
    orderTestRows = [
      { orderId: 700, testId: 201, testName: "USG Obstetric Level 2" }, // designated Form F test
      { orderId: 701, testId: 203, testName: "CBC" },                    // NOT a Form F test
    ];
    formFRows = [
      { ...RECORD, id: 61, referredBy: "Self", doctorName: "" },                 // self + Form-F test bill — included
      { ...RECORD, id: 62, referredBy: "Dr. Mehta", doctorName: "" },            // doctor-referred — 9(1) register, excluded here
      { ...RECORD, id: 63, referredBy: "", doctorName: "", billId: null },       // walk-in, no bill — Form F record is the evidence, included
      { ...RECORD, id: 64, referredBy: "Self", doctorName: "Dr. R. Gupta" },     // doctor named — excluded
      { ...RECORD, id: 65, referredBy: "Self", doctorName: "", billId: 11 },     // self BUT no Form-F test on the bill — excluded
    ];
    prescriptionRows = [{ id: 500, formFRecordId: 61, signedAt: new Date("2026-07-10T06:00:00Z") }];
    const res = makeRes();
    await opdHandler(makeReq({ month: "7", year: "2026" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.doctor).toBe("Dr. Sugandha Priyadarshini");
    expect(res.body.rows.map((r: { recordId: number }) => r.recordId)).toEqual([61, 63]);
    expect(res.body.rows.map((r: { serial: number }) => r.serial)).toEqual([1, 2]);
    for (const row of res.body.rows) {
      expect(row.natureOfService).toBe("General Obstetrical Checkup");
      expect(row.feesReceived).toBe("Complimentary / Free");
    }
    expect(res.body.pagination.total).toBe(2);
    // Auto-prescription: every qualifying record is ensured (auto-saved,
    // idempotent), and saved prescriptions link into the rows.
    expect(ensureSelfReferralPrescriptions).toHaveBeenCalledTimes(1);
    expect(ensureSelfReferralPrescriptions.mock.calls[0][0].map((r) => r.id)).toEqual([61, 63]);
    expect(res.body.rows[0].prescriptionId).toBe(500);
    expect(res.body.rows[1].prescriptionId).toBeNull();
  });

  test("prescription fetch endpoint: admin-gated, 400 on bad id, 404 when missing, 200 with the signed row", async () => {
    const rxLayer = getLayer("get", "/register/self-referral-opd/prescription/:recordId");
    expect(rxLayer.route.stack[0].handle.__adminGate).toBe(true);
    const rxHandler = rxLayer.route.stack[rxLayer.route.stack.length - 1].handle;

    const bad = makeRes();
    await rxHandler({ ...makeReq({}), params: { recordId: "abc" } }, bad);
    expect(bad.statusCode).toBe(400);

    const missing = makeRes();
    await rxHandler({ ...makeReq({}), params: { recordId: "61" } }, missing);
    expect(missing.statusCode).toBe(404);

    prescriptionRows = [{ id: 500, formFRecordId: 61, contentHash: "ab12", doctorName: "Dr. Sugandha Priyadarshini" }];
    const ok = makeRes();
    await rxHandler({ ...makeReq({}), params: { recordId: "61" } }, ok);
    expect(ok.statusCode).toBe(200);
    expect(ok.body.prescription.id).toBe(500);
  });

  test("400 on invalid month; empty month is a clean 200", async () => {
    const bad = makeRes();
    await opdHandler(makeReq({ month: "0", year: "2026" }), bad);
    expect(bad.statusCode).toBe(400);

    formFRows = [];
    const empty = makeRes();
    await opdHandler(makeReq({ month: "2", year: "2026" }), empty);
    expect(empty.statusCode).toBe(200);
    expect(empty.body.rows).toEqual([]);
  });
});

describe("GET /form-f/register/export", () => {
  test("exports the COMPLETE month of DOCTOR-REFERRED records as CSV and audits the export", async () => {
    formFRows = [
      RECORD,
      { ...RECORD, id: 52, patientName: 'Asha, "junior"', address: "" },
      { ...RECORD, id: 53, referredBy: "Self", doctorName: "" }, // partitioned into the OPD register — excluded here
    ];
    const res = makeRes();
    await exportHandler(makeReq({ month: "7", year: "2026" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.headers["Content-Type"]).toContain("text/csv");
    expect(res.headers["Content-Disposition"]).toContain("form-f-register-2026-07.csv");
    const lines = String(res.body).split("\n");
    expect(lines).toHaveLength(3); // header + BOTH records — incomplete one included
    expect(lines[0]).toContain("Completion");
    // Rule 9(1) Column 3 combines patient + spouse/father in one cell:
    expect(lines[2]).toContain('"Asha, ""junior"" — Spouse/Father: R. Kumar"');
    expect(lines[2]).toContain("incomplete");
    // Rule 9(1) columns lead the header in the prescribed order:
    expect(lines[0].indexOf("Serial Number")).toBe(0);
    expect(lines[0].indexOf("Date of Procedure")).toBeLessThan(lines[0].indexOf("Name of the Patient"));

    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0]).toMatchObject({
      action: "export",
      entityType: "form_f_register",
      entityId: "2026-07",
      userName: "Dr Abinash",
    });
    expect(String(auditCalls[0]["newValue"])).toContain('"records":2');
  });

  test("invalid month → 400 and NO audit entry", async () => {
    const res = makeRes();
    await exportHandler(makeReq({ month: "0", year: "2026" }), res);
    expect(res.statusCode).toBe(400);
    expect(auditCalls).toHaveLength(0);
  });
});
