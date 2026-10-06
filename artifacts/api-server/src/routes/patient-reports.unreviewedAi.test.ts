/**
 * Case G of the brief: a direct API finalize/sign attempt cannot walk past the
 * unreviewed-AI guard, and a study that never used the composer is byte-identical
 * to today.
 *
 * Mock scaffold mirrors patient-reports.pcpndt.test.ts (the proven harness for
 * this route). The guard module itself is unit-tested separately; here the
 * question is only whether the route consults it and honours the refusal.
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

const guard = vi.hoisted(() => ({
  findUnreviewedAiDraft: vi.fn(),
  unreviewedAiFinalizeError: vi.fn((draft: { jobId: number; status: string; pendingChangeCount: number }) => ({
    error: "unreviewed_ai_compose_changes",
    message: `${draft.pendingChangeCount} AI suggestion(s) for this study are still unreviewed.`,
    jobId: draft.jobId,
    jobStatus: draft.status,
    pendingChangeCount: draft.pendingChangeCount,
  })),
}));

let worklistRow: Record<string, unknown> | null;
let reportRow: Record<string, unknown> | null;
let insertValues: Record<string, unknown>[];
let updateCount: number;

const TBL = {
  patientReports: { __name: "patient_reports", id: "id" },
  reportShares: { __name: "report_shares" },
  signatures: { __name: "signatures", id: "id" },
  patients: { __name: "patients", id: "id" },
  tests: { __name: "tests", id: "id" },
  clinicSettings: { __name: "clinic_settings" },
  reportTemplates: { __name: "report_templates" },
  radiologyStudies: { __name: "radiology_studies" },
  pacsSettings: { __name: "pacs_settings" },
  instStyles: { __name: "radiology_institutional_styles", presetName: "preset_name" },
  whatsappSettings: { __name: "whatsapp_settings" },
  shareLinks: { __name: "radiology_share_links" },
  drafts: { __name: "radiology_report_drafts", id: "id", studyId: "study_id", updatedAt: "updated_at" },
  worklist: { __name: "radiology_worklist", id: "id" },
  rfi: { __name: "report_finding_instances", id: "id", draftId: "draft_id" },
  quickFindings: { __name: "radiology_quick_findings", id: "id", label: "label" },
  auditLogs: { __name: "audit_logs", id: "id", chainHash: "chain_hash" },
} as const;

vi.mock("@workspace/db/schema", () => ({
  patientReportsTable: TBL.patientReports,
  reportSharesTable: TBL.reportShares,
  signaturesTable: TBL.signatures,
  patientsTable: TBL.patients,
  testsTable: TBL.tests,
  clinicSettingsTable: TBL.clinicSettings,
  reportTemplatesTable: TBL.reportTemplates,
  radiologyStudiesTable: TBL.radiologyStudies,
  pacsSettingsTable: TBL.pacsSettings,
  radiologyInstitutionalStylesTable: TBL.instStyles,
  whatsappSettingsTable: TBL.whatsappSettings,
  radiologyShareLinksTable: TBL.shareLinks,
  radiologyReportDraftsTable: TBL.drafts,
  radiologyWorklistTable: TBL.worklist,
  reportFindingInstancesTable: TBL.rfi,
  radiologyQuickFindingsTable: TBL.quickFindings,
  auditLogsTable: TBL.auditLogs,
  patientReportAmendmentsTable: {
    __name: "patient_report_amendments",
    originalReportId: "original_report_id",
    amendedReportId: "amended_report_id",
    rootReportId: "root_report_id",
    sequenceNumber: "sequence_number",
  },
  formFRecordsTable: { __name: "form_f_records", patientId: "patient_id", createdAt: "created_at" },
}));

function rowsFor(name: string): unknown[] {
  if (name === "patients") return [{ id: 12, firstName: "Asha", lastName: "P" }];
  if (name === "tests") return [{ id: 3, name: "MRI LS Spine", department: "MRI" }];
  if (name === "radiology_worklist") return worklistRow ? [worklistRow] : [];
  if (name === "patient_reports") return reportRow ? [reportRow] : [];
  if (name === "signatures") return [{ id: 7, name: "Dr. Sugandha" }];
  return [];
}

function makeSelectChain(tbl: { __name?: string }) {
  const thenable = () => {
    const t: Record<string, unknown> = {
      then: (resolve: (v: unknown) => void) => resolve(rowsFor(tbl?.__name ?? "")),
      limit: async () => rowsFor(tbl?.__name ?? ""),
      orderBy: () => ({
        then: (resolve: (v: unknown) => void) => resolve(rowsFor(tbl?.__name ?? "")),
        limit: async () => rowsFor(tbl?.__name ?? ""),
      }),
    };
    return t;
  };
  return {
    where: () => thenable(),
    orderBy: () => ({ limit: async () => rowsFor(tbl?.__name ?? "") }),
    limit: async () => rowsFor(tbl?.__name ?? ""),
    leftJoin: () => ({ leftJoin: () => ({ where: () => thenable() }), where: () => thenable() }),
  };
}

function makeUpdateChain() {
  updateCount += 1;
  return {
    set: (v: Record<string, unknown>) => ({
      where: () => ({
        returning: async () => [{ id: 101, ...(v ?? {}) }],
        then: (resolve: (x: unknown) => void) => resolve(undefined),
      }),
    }),
  };
}

vi.mock("@workspace/db", () => ({
  auditLogsTable: TBL.auditLogs,
  db: {
    execute: async () => [{ n: 0 }],
    select: () => ({ from: (tbl: { __name?: string }) => makeSelectChain(tbl) }),
    insert: (tbl: { __name?: string }) => ({
      values: (v: Record<string, unknown>) => {
        if (tbl?.__name === "patient_reports") insertValues.push(v);
        return { returning: async () => [{ id: 101, ...v }] };
      },
    }),
    update: () => makeUpdateChain(),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        execute: async () => [{}],
        select: () => ({ from: (tbl: { __name?: string }) => makeSelectChain(tbl) }),
        insert: (tbl: { __name?: string }) => ({
          values: (v: Record<string, unknown>) => {
            if (tbl?.__name === "patient_reports") insertValues.push(v);
            return { returning: async () => [{ id: 101, ...v }], then: (r: (x: unknown) => void) => r(undefined) };
          },
        }),
        update: () => makeUpdateChain(),
      };
      return fn(tx);
    },
  },
}));

vi.mock("../lib/featureFlags", () => ({ isFeatureEnabledServer: async () => false }));
vi.mock("./whatsapp", () => ({ sendReportWhatsapp: async () => undefined, sendReportDelivery: async () => undefined }));
vi.mock("../email", () => ({ sendReportEmail: async () => undefined }));
vi.mock("../lib/structuredReport/validator", () => ({
  validateStructuredReport: async () => ({ ok: true, errors: [], warnings: [] }),
}));
vi.mock("../lib/radiologyFindingMaterializer", () => ({
  materializeFindings: async () => ({ findings: [], measurements: [], recommendations: [], skipped: [] }),
  CatalogStoreFindingResolver: class { constructor(..._a: unknown[]) {} },
}));
vi.mock("../lib/radiologyCatalog/drizzleStore", () => ({ DrizzleCatalogStore: class {} }));
vi.mock("../lib/structuredReport/catalogAccess", () => ({
  DrizzleStructuredReportCatalogPort: class { constructor(..._a: unknown[]) {} },
}));
vi.mock("../lib/reportComposer/unreviewedAiGuard", () => guard);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getRouteHandler(router: any, method: "post", path: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layer = router.stack.find((l: any) => l.route && l.route.path === path && l.route.methods[method]);
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeReq(body: Record<string, unknown>, params: Record<string, string> = {}): any {
  return {
    body,
    params,
    query: {},
    headers: {},
    ip: "10.0.0.9",
    socket: {},
    staffSession: { role: "admin", subjectId: 1, subjectName: "Dr. Rao", permissions: [] },
    log: { error: () => undefined, warn: () => undefined },
  };
}

const MRI_BODY = {
  patientId: 12,
  testId: 3,
  type: "radiology",
  studyId: 9,
  title: "MRI LS Spine",
  body: "FINDINGS: Normal lumbar lordosis and alignment.",
  impression: "Impression.",
  createdBy: "Dr. Rao",
};

beforeEach(() => {
  vi.clearAllMocks();
  insertValues = [];
  updateCount = 0;
  worklistRow = {
    id: 9, studyId: 55, modality: "MR", studyDescription: "MRI LS Spine",
    accessionNumber: "ACC-1", studyInstanceUID: "1.2.3",
    matchScore: "GREEN", matchDecision: "MATCHED", status: "REPORT_IN_PROGRESS",
    reportId: null, patientId: 12,
  };
  reportRow = {
    id: 101, type: "radiology", studyId: 9, status: "draft",
    structuredJson: null, signedAt: null, signedByName: null, signatureId: null,
    body: "FINDINGS: Normal lumbar lordosis and alignment.", impression: "Impression.", title: "MRI LS Spine", patientId: 12,
  };
  guard.findUnreviewedAiDraft.mockResolvedValue(null);
});

describe("unreviewed-AI guard at the finalize/sign boundary", () => {
  test("G. POST /api/patient-reports is refused while AI changes are unreviewed — no row is written", async () => {
    guard.findUnreviewedAiDraft.mockResolvedValue({ jobId: 44, status: "READY", pendingChangeCount: 2 });
    const { patientReportsRouter } = await import("./patient-reports");
    const handler = getRouteHandler(patientReportsRouter, "post", "/");
    const res = makeRes();
    await handler(makeReq(MRI_BODY), res);

    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe("unreviewed_ai_compose_changes");
    expect(res.body.jobId).toBe(44);
    expect(res.body.pendingChangeCount).toBe(2);
    expect(res.body.message).toMatch(/unreviewed/i);
    expect(insertValues).toHaveLength(0);
  });

  test("the guard is asked about THIS study, not some other one", async () => {
    const { patientReportsRouter } = await import("./patient-reports");
    const handler = getRouteHandler(patientReportsRouter, "post", "/");
    await handler(makeReq(MRI_BODY), makeRes());
    expect(guard.findUnreviewedAiDraft).toHaveBeenCalledWith(
      expect.objectContaining({ worklistId: 9, studyId: 9 }),
    );
  });

  test("a study with no unreviewed AI finalizes exactly as before", async () => {
    const { patientReportsRouter } = await import("./patient-reports");
    const handler = getRouteHandler(patientReportsRouter, "post", "/");
    const res = makeRes();
    await handler(makeReq(MRI_BODY), res);
    expect(res.statusCode).toBe(201);
    expect(insertValues).toHaveLength(1);
  });

  test("pathology reports never consult the radiology AI guard", async () => {
    const { patientReportsRouter } = await import("./patient-reports");
    const handler = getRouteHandler(patientReportsRouter, "post", "/");
    const res = makeRes();
    await handler(makeReq({ ...MRI_BODY, type: "pathology" }), res);
    expect(guard.findUnreviewedAiDraft).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(201);
  });

  test("G. POST /api/patient-reports/:id/sign is refused too, and stamps nothing", async () => {
    guard.findUnreviewedAiDraft.mockResolvedValue({ jobId: 45, status: "STALE_READY", pendingChangeCount: 1 });
    const { patientReportsRouter } = await import("./patient-reports");
    const handler = getRouteHandler(patientReportsRouter, "post", "/:id/sign");
    const res = makeRes();
    await handler(makeReq({ signatureId: 7 }, { id: "101" }), res);

    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe("unreviewed_ai_compose_changes");
    expect(updateCount).toBe(0);
    expect(guard.findUnreviewedAiDraft).toHaveBeenCalledWith(
      expect.objectContaining({ studyId: 9, reportId: 101 }),
    );
  });

  test("signing proceeds when the review is complete", async () => {
    const { patientReportsRouter } = await import("./patient-reports");
    const handler = getRouteHandler(patientReportsRouter, "post", "/:id/sign");
    const res = makeRes();
    await handler(makeReq({ signatureId: 7 }, { id: "101" }), res);
    expect(res.statusCode).not.toBe(409);
    expect(guard.findUnreviewedAiDraft).toHaveBeenCalledTimes(1);
  });
});
