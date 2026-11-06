/**
 * Case G of the brief: a direct API finalize/sign attempt cannot walk past the
 * unreviewed-AI guard, and a study that never used the composer is byte-identical
 * to today. Plus the failure posture: when the guard cannot determine the review
 * state, the boundary refuses with a retryable 503 and writes nothing.
 *
 * The verify door (POST /:id/verify, legacy AND structured countersign) carries
 * the same gate: a report may be signed clean and still gather a NEW unreviewed
 * AI draft before anyone countersigns — verification re-asks at the door.
 *
 * Mock scaffold mirrors patient-reports.pcpndt.test.ts (the proven harness for
 * this route). The guard module itself is unit-tested separately; here the
 * question is only whether the route consults it and honours every refusal.
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

const guard = vi.hoisted(() => ({
  checkUnreviewedAiFinalize: vi.fn(),
  unreviewedAiFinalizeError: vi.fn((draft: { jobId: number; status: string; pendingChangeCount: number }) => ({
    error: "unreviewed_ai_compose_changes",
    message: `${draft.pendingChangeCount} AI suggestion(s) for this study are still unreviewed.`,
    jobId: draft.jobId,
    jobStatus: draft.status,
    pendingChangeCount: draft.pendingChangeCount,
  })),
  aiReviewStateUnavailableError: vi.fn(() => ({
    error: "ai_review_state_unavailable",
    message:
      "CARE could not check whether this study still has unreviewed AI suggestions, so the report was "
      + "NOT finalized and nothing was changed. Please try again in a moment. If it keeps failing, "
      + "finalize after the AI suggestions have been reviewed, or ask the admin to check the database.",
    retryable: true,
  })),
}));

const mockFlags = vi.hoisted(() => ({ structuredFinal: false }));

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
  // C1 — the create route asks one question that arrives as a
  // where→orderBy→limit chain: "does this study already own a live, unbound draft
  // row?" (the post-withdrawal case, which is written through instead of
  // duplicated). This fake keys its answers by TABLE, not by predicate, so without
  // this leg it would hand that query the same `reportRow` every other
  // patient_reports read gets and turn a first finalize into a reuse. Every case
  // in this suite is a first finalize: the answer is "no such row".
  const rowsForChain = (name: string): unknown[] => (name === "patient_reports" ? [] : rowsFor(name));
  const thenable = () => {
    const t: Record<string, unknown> = {
      then: (resolve: (v: unknown) => void) => resolve(rowsFor(tbl?.__name ?? "")),
      limit: async () => rowsFor(tbl?.__name ?? ""),
      orderBy: () => ({
        then: (resolve: (v: unknown) => void) => resolve(rowsForChain(tbl?.__name ?? "")),
        limit: async () => rowsForChain(tbl?.__name ?? ""),
      }),
    };
    return t;
  };
  return {
    where: () => thenable(),
    orderBy: () => ({ limit: async () => rowsForChain(tbl?.__name ?? "") }),
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
    execute: async () => [{ nextval: 41 }], // nextReportNumber allocates from the day sequence
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

vi.mock("../lib/featureFlags", () => ({
  isFeatureEnabledServer: async (key: string) => key === "ff_radiology_structured_final" && mockFlags.structuredFinal,
}));
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
  mockFlags.structuredFinal = false;
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
  guard.checkUnreviewedAiFinalize.mockResolvedValue({ state: "clear" });
});

describe("unreviewed-AI guard at the finalize/sign boundary", () => {
  test("G. POST /api/patient-reports is refused while AI changes are unreviewed — no row is written", async () => {
    guard.checkUnreviewedAiFinalize.mockResolvedValue({ state: "unreviewed", draft: { jobId: 44, status: "READY", pendingChangeCount: 2 } });
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
    expect(guard.checkUnreviewedAiFinalize).toHaveBeenCalledWith(
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
    expect(guard.checkUnreviewedAiFinalize).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(201);
  });

  test("G. POST /api/patient-reports/:id/sign is refused too, and stamps nothing", async () => {
    guard.checkUnreviewedAiFinalize.mockResolvedValue({ state: "unreviewed", draft: { jobId: 45, status: "STALE_READY", pendingChangeCount: 1 } });
    const { patientReportsRouter } = await import("./patient-reports");
    const handler = getRouteHandler(patientReportsRouter, "post", "/:id/sign");
    const res = makeRes();
    await handler(makeReq({ signatureId: 7 }, { id: "101" }), res);

    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe("unreviewed_ai_compose_changes");
    expect(updateCount).toBe(0);
    expect(guard.checkUnreviewedAiFinalize).toHaveBeenCalledWith(
      expect.objectContaining({ studyId: 9, reportId: 101 }),
    );
  });

  test("signing proceeds when the review is complete", async () => {
    const { patientReportsRouter } = await import("./patient-reports");
    const handler = getRouteHandler(patientReportsRouter, "post", "/:id/sign");
    const res = makeRes();
    await handler(makeReq({ signatureId: 7 }, { id: "101" }), res);
    expect(res.statusCode).not.toBe(409);
    expect(guard.checkUnreviewedAiFinalize).toHaveBeenCalledTimes(1);
  });

  test("D+E. POST / cannot finalize when the review state is undeterminable — 503, no row written", async () => {
    guard.checkUnreviewedAiFinalize.mockResolvedValue({ state: "unknown", reason: "query_failed" });
    const { patientReportsRouter } = await import("./patient-reports");
    const handler = getRouteHandler(patientReportsRouter, "post", "/");
    const res = makeRes();
    await handler(makeReq(MRI_BODY), res);

    expect(res.statusCode).toBe(503);
    expect(res.body.error).toBe("ai_review_state_unavailable");
    expect(res.body.retryable).toBe(true);
    expect(res.body.message).toMatch(/NOT finalized/i);
    expect(res.body.message).toMatch(/try again/i);
    // The whole point of failing closed: nothing was mutated on the way out.
    expect(insertValues).toHaveLength(0);
    expect(updateCount).toBe(0);
  });

  test("D+E. POST /:id/sign cannot stamp a signature when the review state is undeterminable", async () => {
    guard.checkUnreviewedAiFinalize.mockResolvedValue({ state: "unknown", reason: "query_failed" });
    const { patientReportsRouter } = await import("./patient-reports");
    const handler = getRouteHandler(patientReportsRouter, "post", "/:id/sign");
    const res = makeRes();
    await handler(makeReq({ signatureId: 7 }, { id: "101" }), res);

    expect(res.statusCode).toBe(503);
    expect(res.body.error).toBe("ai_review_state_unavailable");
    expect(updateCount).toBe(0);
    expect(guard.checkUnreviewedAiFinalize).toHaveBeenCalledWith(
      expect.objectContaining({ studyId: 9, reportId: 101 }),
    );
  });

  test("undeterminable review state is never reported as an unreviewed draft", async () => {
    guard.checkUnreviewedAiFinalize.mockResolvedValue({ state: "unknown", reason: "query_failed" });
    const { patientReportsRouter } = await import("./patient-reports");
    const handler = getRouteHandler(patientReportsRouter, "post", "/");
    const res = makeRes();
    await handler(makeReq(MRI_BODY), res);

    // Two different clinical statements, two different codes — "nothing to
    // review" (201), "waiting for you" (409), "we could not look" (503).
    expect(res.body.error).not.toBe("unreviewed_ai_compose_changes");
    expect(guard.unreviewedAiFinalizeError).not.toHaveBeenCalled();
    expect(guard.aiReviewStateUnavailableError).toHaveBeenCalledTimes(1);
  });

  test("pathology still ignores the guard entirely, even a broken one", async () => {
    guard.checkUnreviewedAiFinalize.mockResolvedValue({ state: "unknown", reason: "query_failed" });
    const { patientReportsRouter } = await import("./patient-reports");
    const handler = getRouteHandler(patientReportsRouter, "post", "/");
    const res = makeRes();
    await handler(makeReq({ ...MRI_BODY, type: "pathology" }), res);
    expect(guard.checkUnreviewedAiFinalize).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(201);
  });
});

describe("unreviewed-AI guard at the VERIFY door (legacy countersign)", () => {
  beforeEach(() => {
    // A verify-able row: signed (not draft, not already verified), by someone
    // other than the verifying session.
    reportRow = {
      ...reportRow,
      status: "signed",
      signedByName: "Dr. Verma",
    } as Record<string, unknown>;
  });

  test("H. POST /:id/verify is refused while AI changes are unreviewed — nothing is stamped", async () => {
    guard.checkUnreviewedAiFinalize.mockResolvedValue({ state: "unreviewed", draft: { jobId: 46, status: "READY", pendingChangeCount: 3 } });
    const { patientReportsRouter } = await import("./patient-reports");
    const handler = getRouteHandler(patientReportsRouter, "post", "/:id/verify");
    const res = makeRes();
    await handler(makeReq({ signatureId: 7 }, { id: "101" }), res);

    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe("unreviewed_ai_compose_changes");
    expect(res.body.jobId).toBe(46);
    expect(updateCount).toBe(0);
    expect(guard.checkUnreviewedAiFinalize).toHaveBeenCalledWith(
      expect.objectContaining({ studyId: 9, reportId: 101, worklistId: 9 }),
    );
  });

  test("verify proceeds when the review is complete", async () => {
    const { patientReportsRouter } = await import("./patient-reports");
    const handler = getRouteHandler(patientReportsRouter, "post", "/:id/verify");
    const res = makeRes();
    await handler(makeReq({ signatureId: 7 }, { id: "101" }), res);

    expect(res.statusCode).not.toBe(409);
    expect(res.statusCode).not.toBe(503);
    expect(updateCount).toBe(1);
    expect(guard.checkUnreviewedAiFinalize).toHaveBeenCalledTimes(1);
  });

  test("D+E. POST /:id/verify cannot countersign when the review state is undeterminable", async () => {
    guard.checkUnreviewedAiFinalize.mockResolvedValue({ state: "unknown", reason: "query_failed" });
    const { patientReportsRouter } = await import("./patient-reports");
    const handler = getRouteHandler(patientReportsRouter, "post", "/:id/verify");
    const res = makeRes();
    await handler(makeReq({ signatureId: 7 }, { id: "101" }), res);

    expect(res.statusCode).toBe(503);
    expect(res.body.error).toBe("ai_review_state_unavailable");
    expect(updateCount).toBe(0);
  });

  test("a draft report still hears 'sign first', not the AI error", async () => {
    guard.checkUnreviewedAiFinalize.mockResolvedValue({ state: "unreviewed", draft: { jobId: 46, status: "READY", pendingChangeCount: 3 } });
    reportRow = { ...reportRow, status: "draft" } as Record<string, unknown>;
    const { patientReportsRouter } = await import("./patient-reports");
    const handler = getRouteHandler(patientReportsRouter, "post", "/:id/verify");
    const res = makeRes();
    await handler(makeReq({ signatureId: 7 }, { id: "101" }), res);

    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe("Sign the report first before verifying");
  });

  test("pathology verify never consults the radiology AI guard", async () => {
    reportRow = { ...reportRow, type: "pathology" } as Record<string, unknown>;
    const { patientReportsRouter } = await import("./patient-reports");
    const handler = getRouteHandler(patientReportsRouter, "post", "/:id/verify");
    const res = makeRes();
    await handler(makeReq({ signatureId: 7 }, { id: "101" }), res);

    expect(guard.checkUnreviewedAiFinalize).not.toHaveBeenCalled();
    expect(res.statusCode).not.toBe(409);
    expect(updateCount).toBe(1);
  });
});

describe("unreviewed-AI guard at the VERIFY door (structured countersign)", () => {
  beforeEach(() => {
    reportRow = {
      ...reportRow,
      status: "signed",
      signedByName: "Dr. Verma",
      structuredJson: {
        document_id: "doc-101",
        audit: {
          revision: 1,
          signature: { state: "final", signed_by: "Dr. Verma" },
        },
      },
    } as Record<string, unknown>;
    mockFlags.structuredFinal = true;
  });

  test("H. the structured countersign is refused while AI changes are unreviewed — nothing is stamped", async () => {
    guard.checkUnreviewedAiFinalize.mockResolvedValue({ state: "unreviewed", draft: { jobId: 47, status: "READY", pendingChangeCount: 1 } });
    const { patientReportsRouter } = await import("./patient-reports");
    const handler = getRouteHandler(patientReportsRouter, "post", "/:id/verify");
    const res = makeRes();
    await handler(makeReq({ signatureId: 7 }, { id: "101" }), res);

    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe("unreviewed_ai_compose_changes");
    expect(updateCount).toBe(0);
    expect(guard.checkUnreviewedAiFinalize).toHaveBeenCalledWith(
      expect.objectContaining({ studyId: 9, reportId: 101 }),
    );
  });

  test("the structured countersign is refused with the same fail-closed 503 when the state cannot be read", async () => {
    guard.checkUnreviewedAiFinalize.mockResolvedValue({ state: "unknown", reason: "query_failed" });
    const { patientReportsRouter } = await import("./patient-reports");
    const handler = getRouteHandler(patientReportsRouter, "post", "/:id/verify");
    const res = makeRes();
    await handler(makeReq({ signatureId: 7 }, { id: "101" }), res);

    expect(res.statusCode).toBe(503);
    expect(res.body.error).toBe("ai_review_state_unavailable");
    expect(updateCount).toBe(0);
  });
});
