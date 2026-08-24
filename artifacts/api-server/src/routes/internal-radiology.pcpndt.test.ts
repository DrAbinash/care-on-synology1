import { describe, expect, test, vi, beforeEach } from "vitest";

// PCPNDT server-side finalize guard — POST /api/internal/radiology/report-status
// rejects the REPORT_FINAL transition for an obstetric/fetal ultrasound study,
// resolved from the DB-authoritative radiology_worklist row (never trusts
// client-supplied values — the request body only carries lookup keys like
// studyInstanceUID/accessionNumber/studyId, never modality/studyDescription).
// See docs/usg-reporting/platform-consolidation-pr-b.md §17-18.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let worklistRow: Record<string, unknown> | null;
let updatedValues: Record<string, unknown> | null;
let auditInserts: Record<string, unknown>[];

const TBL = {
  worklist: { __name: "radiology_worklist" },
  auditLog: { __name: "radiology_audit_log" },
  patients: { __name: "patients" },
  radiologyStudies: { __name: "radiology_studies" },
  dicomNodes: { __name: "dicom_nodes" },
  dicomPullJobs: { __name: "dicom_pull_jobs" },
  pacsLogs: { __name: "pacs_logs" },
  dicomPullAgentLogs: { __name: "dicom_pull_agent_logs" },
  dicomPullAgentStatus: { __name: "dicom_pull_agent_status" },
  pacsSettings: { __name: "pacs_settings" },
  scheduledProcedures: { __name: "radiology_scheduled_procedures" },
  tests: { __name: "tests" },
  bills: { __name: "bills" },
  portalSessions: { __name: "portal_sessions" },
  users: { __name: "users" },
} as const;

vi.mock("@workspace/db/schema", () => ({
  patientsTable: TBL.patients,
  radiologyStudiesTable: TBL.radiologyStudies,
  radiologyWorklistTable: TBL.worklist,
  radiologyAuditLogTable: TBL.auditLog,
  dicomNodesTable: TBL.dicomNodes,
  dicomPullJobsTable: TBL.dicomPullJobs,
  pacsLogsTable: TBL.pacsLogs,
  dicomPullAgentLogsTable: TBL.dicomPullAgentLogs,
  dicomPullAgentStatusTable: TBL.dicomPullAgentStatus,
  pacsSettingsTable: TBL.pacsSettings,
  radiologyScheduledProceduresTable: TBL.scheduledProcedures,
  testsTable: TBL.tests,
  billsTable: TBL.bills,
  portalSessionsTable: TBL.portalSessions,
  usersTable: TBL.users,
  formFRecordsTable: { __name: "form_f_records", patientId: "patient_id", createdAt: "created_at" },
  auditLogsTable: { __name: "audit_logs", id: "id", chainHash: "chain_hash" },
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: (tbl: { __name?: string }) => {
        const rows = () => {
          if (tbl?.__name === "radiology_worklist" && worklistRow) return [worklistRow];
          // No Form F rows → obstetric finalize stays blocked (expected by tests).
          if (tbl?.__name === "form_f_records") return [];
          return [];
        };
        return {
          where: () => ({
            then: (resolve: (v: unknown) => void) => resolve(rows()),
            limit: async () => rows(),
            orderBy: () => ({
              limit: async () => rows(),
              then: (resolve: (v: unknown) => void) => resolve(rows()),
            }),
          }),
        };
      },
    }),
    update: (tbl: { __name?: string }) => ({
      set: (v: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            if (tbl?.__name === "radiology_worklist") updatedValues = v;
            return [{ id: worklistRow?.id, ...v }];
          },
          // CAS path: update(...).set(...).where(... ) may be awaited without returning
          then: (resolve: (v: unknown) => void) => {
            if (tbl?.__name === "radiology_worklist") updatedValues = v as Record<string, unknown>;
            resolve([{ id: worklistRow?.id, ...v }]);
          },
        }),
      }),
    }),
    insert: (tbl: { __name?: string }) => ({
      values: async (v: Record<string, unknown>) => {
        if (tbl?.__name === "radiology_audit_log") auditInserts.push(v);
        return undefined;
      },
    }),
  },
}));

vi.mock("../lib/studyLocks", () => ({ checkWriteLock: async () => ({ blocked: false }) }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getRouteHandler(router: any, method: "get" | "post", path: string) {
  const layer = router.stack.find(
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
    statusCode: 200, body: undefined,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
  return res;
}

async function postReportStatus(body: Record<string, unknown>) {
  const mod = await import("./internal-radiology");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const router = (mod as any).default;
  const handler = getRouteHandler(router, "post", "/radiology/report-status");
  const req = { body, headers: {}, log: { error: () => undefined, warn: () => undefined } };
  const res = makeRes();
  await handler(req, res);
  return res;
}

beforeEach(() => {
  worklistRow = {
    id: 9, modality: "MR", studyDescription: "LS Spine",
    accessionNumber: "ACC-1", studyInstanceUID: "1.2.3", studyId: 55,
    matchScore: "GREEN", matchDecision: "PENDING", status: "STUDY_RECEIVED",
    patientId: 12, reportId: null,
  };
  updatedValues = null;
  auditInserts = [];
});

describe("PCPNDT server-side finalize guard — POST /api/internal/radiology/report-status", () => {
  test("MRI finalizes normally (status flips to REPORT_FINAL, no guard interference)", async () => {
    const res = await postReportStatus({ studyInstanceUID: "1.2.3", status: "REPORT_FINAL" });
    expect(res.statusCode).toBe(200);
    expect(updatedValues?.status).toBe("REPORT_FINAL");
  });

  test("CT finalizes normally", async () => {
    worklistRow = { ...worklistRow, modality: "CT", studyDescription: "Chest CT" };
    const res = await postReportStatus({ studyInstanceUID: "1.2.3", status: "REPORT_FINAL" });
    expect(res.statusCode).toBe(200);
    expect(updatedValues?.status).toBe("REPORT_FINAL");
  });

  test("non-obstetric USG (Whole Abdomen) finalizes normally through the canonical route", async () => {
    worklistRow = { ...worklistRow, modality: "USG", studyDescription: "Whole Abdomen" };
    const res = await postReportStatus({ studyInstanceUID: "1.2.3", status: "REPORT_FINAL" });
    expect(res.statusCode).toBe(200);
    expect(updatedValues?.status).toBe("REPORT_FINAL");
  });

  test("every non-obstetric USG study type finalizes normally", async () => {
    for (const desc of ["KUB", "Thyroid", "Breast", "Scrotum", "Carotid Doppler", "TVS"]) {
      worklistRow = {
        id: 9, modality: "USG", studyDescription: desc, accessionNumber: "ACC-1",
        studyInstanceUID: "1.2.3", studyId: 55,
        matchScore: "GREEN", matchDecision: "PENDING", status: "STUDY_RECEIVED",
        patientId: 12, reportId: null,
      };
      updatedValues = null;
      const res = await postReportStatus({ studyInstanceUID: "1.2.3", status: "REPORT_FINAL" });
      expect(res.statusCode, `${desc} should finalize`).toBe(200);
      expect((updatedValues as Record<string, unknown> | null)?.status).toBe("REPORT_FINAL");
    }
  });

  test("obstetric USG is rejected with 409 pcpndt_compliance_required, worklist row untouched", async () => {
    worklistRow = { ...worklistRow, modality: "USG", studyDescription: "Obstetric Growth Scan" };
    const res = await postReportStatus({ studyInstanceUID: "1.2.3", status: "REPORT_FINAL" });
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe("pcpndt_compliance_required");
    expect(res.body.message).toMatch(/usg reporting|form f/i);
    expect(updatedValues).toBeNull(); // status was NEVER flipped to REPORT_FINAL
    expect(auditInserts).toHaveLength(0); // no REPORT_STATUS_UPDATED audit entry either
  });

  test("fetal-pattern USG under any US-family modality spelling is rejected", async () => {
    worklistRow = { ...worklistRow, modality: "Doppler", studyDescription: "Fetal Anomaly Scan" };
    const res = await postReportStatus({ studyInstanceUID: "1.2.3", status: "REPORT_FINAL" });
    expect(res.statusCode).toBe(409);
  });

  test("MRI Obstetric Pelvimetry is NOT blocked — the guard is USG-only by design (PCPNDT applies to ultrasound)", async () => {
    worklistRow = { ...worklistRow, modality: "MR", studyDescription: "MRI Obstetric Pelvimetry" };
    const res = await postReportStatus({ studyInstanceUID: "1.2.3", status: "REPORT_FINAL" });
    expect(res.statusCode).toBe(200);
  });

  test("obstetric USG can still transition to non-final statuses — only the REPORT_FINAL transition is blocked", async () => {
    worklistRow = { ...worklistRow, modality: "USG", studyDescription: "Obstetric Growth Scan" };
    const res = await postReportStatus({ studyInstanceUID: "1.2.3", status: "REPORT_IN_PROGRESS" });
    expect(res.statusCode).toBe(200);
    expect(updatedValues?.status).toBe("REPORT_IN_PROGRESS");
  });

  test("unknown study still 404s — the guard does not mask the existing not-found path", async () => {
    worklistRow = null;
    const res = await postReportStatus({ studyInstanceUID: "does-not-exist", status: "REPORT_FINAL" });
    expect(res.statusCode).toBe(404);
  });
});
