import { describe, expect, test, vi, beforeEach } from "vitest";

// PR 2 — PCPNDT fetal-echo compliance gate.
//
// Root cause under test: POST /fetal/:studyId/finalize finalized a prenatal
// study with NO Form F check (unlike the identical fetalUsgLevel4 workflow),
// and POST /fetal/:studyId accepted client-supplied status:"final" — an
// equivalent finalization path bypassing review, critical-alert AND Form F
// checks. These tests run the REAL route handlers and the REAL shared
// compliance engine (lib/pcpndtCompliance) against a mocked db, following
// the repo's no-HTTP-server router-stack technique.

let fetalEchoRow: Record<string, unknown> | null;
let echoReportRow: Record<string, unknown> | null;
let radiologyStudyRow: Record<string, unknown> | null;
let formFRow: Record<string, unknown> | null;
let formFQueryCount: number;
let updates: Array<{ table: string; values: Record<string, unknown> }>;
let inserts: Array<{ table: string; values: Record<string, unknown> }>;

vi.mock("@workspace/db", () => {
  const rowsFor = (table: { __name: string }): unknown[] => {
    switch (table.__name) {
      case "fetal_echo_studies": return fetalEchoRow ? [fetalEchoRow] : [];
      case "echo_reports": return echoReportRow ? [echoReportRow] : [];
      case "radiology_studies": return radiologyStudyRow ? [radiologyStudyRow] : [];
      case "form_f_records": formFQueryCount += 1; return formFRow ? [formFRow] : [];
      default: return [];
    }
  };
  const db = {
    select: () => ({
      from: (table: { __name: string }) => {
        const resolve = async () => rowsFor(table);
        const tail = { limit: resolve, orderBy: () => ({ limit: resolve }) };
        return { where: () => tail, ...tail };
      },
    }),
    update: (table: { __name: string }) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            updates.push({ table: table.__name, values });
            return [{ ...(fetalEchoRow ?? {}), ...values }];
          },
        }),
      }),
    }),
    insert: (table: { __name: string }) => ({
      values: (values: Record<string, unknown>) => {
        inserts.push({ table: table.__name, values });
        const p = Promise.resolve([]);
        return Object.assign(p, { returning: async () => [{ id: 1, ...values }] });
      },
    }),
  };
  return { db };
});

vi.mock("@workspace/db/schema", () => ({
  echoMeasurementsTable: { __name: "echo_measurements", studyId: "study_id" },
  echoValveAssessmentTable: { __name: "echo_valve_assessment", studyId: "study_id" },
  echoRegionalWallTable: { __name: "echo_regional_wall", studyId: "study_id" },
  echoReportsTable: { __name: "echo_reports", id: "id", studyId: "study_id" },
  echoAuditLogsTable: { __name: "echo_audit_logs" },
  fetalEchoStudiesTable: { __name: "fetal_echo_studies", id: "id", studyId: "study_id" },
  fetalEchoAuditLogsTable: { __name: "fetal_echo_audit_logs" },
  radiologyStudiesTable: { __name: "radiology_studies", id: "id", patientId: "patient_id" },
  formFRecordsTable: { __name: "form_f_records", patientId: "patient_id", createdAt: "created_at" },
}));

vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@workspace/ai-providers", () => ({ generateAiForTask: vi.fn() }));

import router from "./echoCardiology";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getHandler(method: "get" | "post", path: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layer = (router as any).stack.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (l: any) => l.route && l.route.path === path && l.route.methods[method],
  );
  if (!layer) throw new Error(`${method.toUpperCase()} ${path} handler not found`);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function makeRes() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
  return res;
}

function makeReq(body: Record<string, unknown>, role = "radiologist") {
  return {
    params: { studyId: "77" },
    body,
    staffSession: { subjectId: 5, subjectName: "Dr. Sugandha", role, permissions: ["/radiology"] },
    log: { error: vi.fn() },
  };
}

const finalizeFetal = getHandler("post", "/fetal/:studyId/finalize");
const saveFetal = getHandler("post", "/fetal/:studyId");
const finalizeAdult = getHandler("post", "/reports/:studyId/finalize");

const COMPLETE_FORM_F = {
  id: 300,
  idCardVerified: true,
  husbandFatherName: "R. Kumar",
  address: "12 MG Road",
  consentDate: "2026-07-01",
  procedureDate: "",
  createdAt: new Date("2026-07-01T05:00:00Z"),
};

beforeEach(() => {
  fetalEchoRow = { id: 9, studyId: 77, patientId: 42, status: "reviewed", criticalAlertsAcknowledged: true, suspectedAbnormalities: "[]", fetalHeartRate: 140, rhythm: "regular" };
  echoReportRow = { id: 4, studyId: 77, criticalAlertsAcknowledged: true };
  radiologyStudyRow = { id: 77, patientId: 42 };
  formFRow = null;
  formFQueryCount = 0;
  updates = [];
  inserts = [];
});

describe("POST /fetal/:studyId/finalize — PCPNDT Form F gate", () => {
  test("blocks finalization when NO Form F record exists — 409, no status write, blocked attempt audited", async () => {
    const res = makeRes();
    await finalizeFetal(makeReq({}), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe("pcpndt_compliance_required");
    expect(String(res.body.error)).toMatch(/Form F/i);
    expect(updates).toHaveLength(0);
    const blocked = inserts.filter((i) => i.table === "fetal_echo_audit_logs" && i.values["action"] === "pcpndt_blocked");
    expect(blocked).toHaveLength(1);
    expect(String(blocked[0].values["details"])).toContain("attempted=finalize");
  });

  test("blocks on INCOMPLETE Form F and lists the exact missing fields", async () => {
    formFRow = { ...COMPLETE_FORM_F, address: "  " };
    const res = makeRes();
    await finalizeFetal(makeReq({}), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.validationErrors).toContain("Address is required.");
    expect(res.body.formFId).toBe(300);
    expect(updates).toHaveLength(0);
  });

  test("finalizes when Form F is complete and verified", async () => {
    formFRow = COMPLETE_FORM_F;
    const res = makeRes();
    await finalizeFetal(makeReq({}), res);
    expect(res.statusCode).toBe(200);
    expect(updates).toHaveLength(1);
    expect(updates[0].values["status"]).toBe("final");
    expect(inserts.some((i) => i.values["action"] === "finalized")).toBe(true);
  });

  test("UNAUTHORIZED override attempt (non-admin role) is still blocked", async () => {
    const res = makeRes();
    await finalizeFetal(makeReq({ pcpndtOverride: true, pcpndtOverrideReason: "urgent clinical need" }, "radiologist"), res);
    expect(res.statusCode).toBe(409);
    expect(updates).toHaveLength(0);
  });

  test("admin override with a documented reason proceeds and is audited", async () => {
    const res = makeRes();
    await finalizeFetal(makeReq({ pcpndtOverride: true, pcpndtOverrideReason: "AA-approved emergency" }, "admin"), res);
    expect(res.statusCode).toBe(200);
    const override = inserts.filter((i) => i.values["action"] === "pcpndt_override_finalize");
    expect(override).toHaveLength(1);
    expect(String(override[0].values["details"])).toContain("AA-approved emergency");
  });

  test("admin override WITHOUT a reason is still blocked (documented reason is mandatory)", async () => {
    const res = makeRes();
    await finalizeFetal(makeReq({ pcpndtOverride: true }, "admin"), res);
    expect(res.statusCode).toBe(409);
    expect(updates).toHaveLength(0);
  });

  test("row without denormalized patientId falls back to the radiology_studies lookup", async () => {
    fetalEchoRow = { ...fetalEchoRow!, patientId: null };
    formFRow = COMPLETE_FORM_F;
    const res = makeRes();
    await finalizeFetal(makeReq({}), res);
    expect(res.statusCode).toBe(200);
    expect(formFQueryCount).toBeGreaterThan(0);
  });

  test("fails CLOSED when no patient is resolvable at all", async () => {
    fetalEchoRow = { ...fetalEchoRow!, patientId: null };
    radiologyStudyRow = null;
    formFRow = COMPLETE_FORM_F; // exists, but unreachable without a patient
    const res = makeRes();
    await finalizeFetal(makeReq({}), res);
    expect(res.statusCode).toBe(409);
    expect(updates).toHaveLength(0);
  });
});

describe("POST /fetal/:studyId — equivalent-finalization (status escalation) guard", () => {
  test("client-supplied status:'final' on a non-final study is rejected and audited; nothing is written", async () => {
    const res = makeRes();
    await saveFetal(makeReq({ status: "final", patientId: 42 }), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe("finalize_endpoint_required");
    expect(updates).toHaveLength(0);
    expect(inserts.filter((i) => i.table === "fetal_echo_studies")).toHaveLength(0);
    expect(inserts.some((i) => i.values["action"] === "pcpndt_blocked")).toBe(true);
  });

  test("status:'final' with NO existing row (direct-insert escalation) is rejected too", async () => {
    fetalEchoRow = null;
    const res = makeRes();
    await saveFetal(makeReq({ status: "final", patientId: 42 }), res);
    expect(res.statusCode).toBe(409);
    expect(inserts.filter((i) => i.table === "fetal_echo_studies")).toHaveLength(0);
  });

  test("echoing status:'final' back on an ALREADY-final study still saves (no escalation happening)", async () => {
    fetalEchoRow = { ...fetalEchoRow!, status: "final" };
    const res = makeRes();
    await saveFetal(makeReq({ status: "final", patientId: 42 }), res);
    expect(res.statusCode).toBe(200);
    expect(updates).toHaveLength(1);
  });

  test("ordinary draft save is untouched", async () => {
    const res = makeRes();
    await saveFetal(makeReq({ status: "draft", patientId: 42 }), res);
    expect(res.statusCode).toBe(200);
    expect(updates).toHaveLength(1);
    expect(updates[0].values["status"]).toBe("draft");
  });
});

describe("adult (non-fetal) echo workflow is untouched", () => {
  test("POST /reports/:studyId/finalize never consults Form F", async () => {
    const res = makeRes();
    await finalizeAdult(makeReq({}), res);
    expect(res.statusCode).toBe(200);
    expect(formFQueryCount).toBe(0);
    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe("echo_reports");
  });
});
