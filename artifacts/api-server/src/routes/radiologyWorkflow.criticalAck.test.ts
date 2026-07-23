import { describe, expect, test, vi, beforeEach } from "vitest";

// PR 3 — critical-finding acknowledgement repair.
//
// Root cause under test: CriticalAlertsManager PATCHed
// /api/radiology-workflow/critical-alerts/:id/acknowledge, which did not
// exist (404 forever — findings could never be acknowledged from any
// client), and the Notify button had no action at all. These tests run the
// REAL route handlers and the REAL engine (lib/criticalFindingsAlert)
// against a mocked db, proving: session-identity acknowledgement (client
// identity never trusted), idempotency, notify as an honest recorded
// attempt (delivery never pretended), auditing of both actions, and 404/400
// validation. Router-stack technique (no supertest in this repo).

let findingRow: Record<string, unknown> | null;
let updateWhereHasAckGuard: boolean;
let updates: Array<Record<string, unknown>>;
let auditCalls: Array<Record<string, unknown>>;
let updateMatches: boolean;

vi.mock("@workspace/db", () => {
  const db = {
    select: () => ({
      from: () => {
        const resolve = async () => (findingRow ? [findingRow] : []);
        const tail = { limit: resolve, orderBy: () => ({ limit: resolve }) };
        return { where: () => tail, ...tail };
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: (arg: unknown) => ({
          returning: async () => {
            updates.push(values);
            updateWhereHasAckGuard = JSON.stringify(arg).includes("acknowledged_at");
            return updateMatches && findingRow ? [{ ...findingRow, ...values }] : [];
          },
        }),
      }),
    }),
    insert: () => ({ values: () => Promise.resolve([]) }),
    execute: async () => ({ rows: [] }),
  };
  return { db };
});

vi.mock("@workspace/db/schema", () => {
  const t = (name: string, cols: Record<string, string> = {}) => ({ __name: name, ...cols });
  return {
    mwlEntriesTable: t("mwl"), dicomIncomingStudiesTable: t("dicom_incoming"), aiJobQueueTable: t("ai_jobs"),
    radiologistShortcutsTable: t("shortcuts"), radiologistMacrosTable: t("macros"), viewerPresetsTable: t("presets"),
    studyAccessLogTable: t("access_log"), pacsStorageTierTable: t("storage_tier"),
    radiologyStudiesTable: t("radiology_studies"), dicomStudiesTable: t("dicom_studies"),
    radiologyCriticalFindingsTable: t("radiology_critical_findings", { id: "id", acknowledgedAt: "acknowledged_at", createdAt: "created_at" }),
    radiologyReportDraftsTable: t("report_drafts"), usgReportDraftsTable: t("usg_drafts"),
  };
});

vi.mock("../lib/canonicalStudy", () => ({ resolveRadiologyStudyId: vi.fn(), ensureCanonicalStudy: vi.fn() }));
vi.mock("../lib/audit", () => ({
  auditFromRequest: vi.fn(async (_req: unknown, payload: Record<string, unknown>) => { auditCalls.push(payload); }),
}));

import router from "./radiologyWorkflow";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getHandler(method: "get" | "post" | "patch", path: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layer = (router as any).stack.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (l: any) => l.route && l.route.path === path && l.route.methods[method],
  );
  if (!layer) throw new Error(`${method.toUpperCase()} ${path} handler not found`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function makeRes() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = {
    statusCode: 200, body: undefined,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
  return res;
}

function makeReq(body: Record<string, unknown>, id = "9") {
  return {
    params: { id },
    body,
    headers: {},
    staffSession: { subjectId: 5, subjectName: "Dr. Sugandha", role: "radiologist", permissions: ["/radiology"] },
    log: { error: vi.fn() },
  };
}

const ackHandler = getHandler("patch", "/critical-alerts/:id/acknowledge");
const notifyHandler = getHandler("post", "/critical-alerts/:id/notify");

beforeEach(() => {
  findingRow = { id: 9, studyId: 77, finding: "Acute hemorrhage", severity: "critical", acknowledgedAt: null };
  updates = [];
  auditCalls = [];
  updateMatches = true;
  updateWhereHasAckGuard = false;
});

describe("PATCH /critical-alerts/:id/acknowledge", () => {
  test("acknowledges with the AUTHENTICATED identity — client-supplied identity in the body is ignored", async () => {
    const res = makeRes();
    await ackHandler(makeReq({ clinicianName: "Attacker Chosen Name", note: "seen, patient shifted to ER" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.outcome).toBe("acknowledged");
    expect(updates).toHaveLength(1);
    expect(updates[0]["acknowledgedBy"]).toBe("Dr. Sugandha");
    expect(updates[0]["acknowledgedRole"]).toBe("radiologist");
    expect(updates[0]["acknowledgedNote"]).toBe("seen, patient shifted to ER");
    expect(updates[0]["acknowledgedBy"]).not.toBe("Attacker Chosen Name");
    // Audited:
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0]).toMatchObject({ action: "acknowledge", module: "radiology", entityType: "critical_finding", entityId: "9", userName: "Dr. Sugandha" });
  });

  test("IDEMPOTENT: the engine's update carries the acknowledged_at-IS-NULL guard, and a second ack never overwrites the first", async () => {
    const res = makeRes();
    await ackHandler(makeReq({}), res);
    expect(updateWhereHasAckGuard).toBe(true); // first-ack-wins guard in the WHERE clause

    // Second call: the guarded update matches nothing (already acked) — the
    // handler reports already_acknowledged, and no second audit entry is made.
    updateMatches = false;
    findingRow = { ...findingRow!, acknowledgedAt: new Date(), acknowledgedBy: "Dr. First" };
    const res2 = makeRes();
    await ackHandler(makeReq({}), res2);
    expect(res2.statusCode).toBe(200);
    expect(res2.body.outcome).toBe("already_acknowledged");
    expect(res2.body.finding.acknowledgedBy).toBe("Dr. First");
    expect(auditCalls).toHaveLength(1); // only the FIRST ack audited
  });

  test("404 on unknown finding; 400 on bad id or malformed note", async () => {
    updateMatches = false;
    findingRow = null;
    const notFound = makeRes();
    await ackHandler(makeReq({}), notFound);
    expect(notFound.statusCode).toBe(404);

    const badId = makeRes();
    await ackHandler(makeReq({}, "abc"), badId);
    expect(badId.statusCode).toBe(400);

    const badNote = makeRes();
    await ackHandler(makeReq({ note: 42 }), badNote);
    expect(badNote.statusCode).toBe(400);
    expect(updates).toHaveLength(1); // only the notFound attempt reached the engine
  });
});

describe("POST /critical-alerts/:id/notify", () => {
  test("records an honest notification attempt: clinician, method, note, RECORDER from session — delivery never claimed", async () => {
    const res = makeRes();
    await notifyHandler(makeReq({ clinicianName: "Dr. Mehta (referring)", method: "phone", note: "informed at 14:05" }), res);
    expect(res.statusCode).toBe(200);
    expect(updates).toHaveLength(1);
    expect(updates[0]["notifiedClinician"]).toBe("Dr. Mehta (referring)");
    expect(updates[0]["notificationMethod"]).toBe("phone");
    expect(updates[0]["notifiedBy"]).toBe("Dr. Sugandha");
    expect(updates[0]["notificationNote"]).toBe("informed at 14:05");
    expect(updates[0]["notificationDelivered"]).toBeNull(); // NEVER pretended
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0]).toMatchObject({ action: "notify", entityType: "critical_finding", entityId: "9" });
  });

  test("validates clinicianName and method; 404 on unknown finding", async () => {
    for (const body of [{}, { clinicianName: "X", method: "carrier_pigeon" }, { method: "phone" }]) {
      const res = makeRes();
      await notifyHandler(makeReq(body), res);
      expect(res.statusCode).toBe(400);
    }
    updateMatches = false;
    findingRow = null;
    const res = makeRes();
    await notifyHandler(makeReq({ clinicianName: "Dr. Mehta", method: "phone" }), res);
    expect(res.statusCode).toBe(404);
    expect(auditCalls).toHaveLength(0); // failed attempts are not audited as notifications
  });
});
