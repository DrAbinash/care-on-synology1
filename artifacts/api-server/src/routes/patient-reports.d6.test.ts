import { describe, expect, test, vi, beforeEach } from "vitest";

// Ticket D6 route-integration coverage — the flag-gated structured READ path:
// GET /:id (viewer) and buildReportHtml (print / PDF / public+WhatsApp PDF /
// email share / PACS archive all flow through it). The pure pipeline
// (readStructuredReport / compareStoredVsRendered) is proven in
// radiologyStructuredRead.test.ts; HERE it is mocked so each route decision
// path is driven precisely, and the flag gate + no-mutation guarantees are
// asserted at the route layer.

let flags: Record<string, boolean>;
let readResult: {
  body: string;
  usedStructured: boolean;
  comparisonClass: string;
  document: unknown;
  render: unknown;
  diagnostics: Record<string, unknown>;
} | null;
let readError: Error | null; // when set, the mocked pipeline THROWS (catch-path coverage)
let readCalls: Array<{ row: Record<string, unknown>; ports: Record<string, unknown> }>;
let writeCalls: Array<{ kind: string; table?: string }>; // every write-shaped db call
let auditRows: Array<{ newValue: string | null }>; // what audit_logs selects return
let reportRow: Record<string, unknown>;

const TBL = {
  patientReports: { __name: "patient_reports", id: "id" },
  reportShares: { __name: "report_shares", reportId: "report_id", createdAt: "created_at" },
  signatures: { __name: "signatures", id: "id" },
  patients: { __name: "patients", id: "id" },
  tests: { __name: "tests", id: "id" },
  clinicSettings: { __name: "clinic_settings" },
  reportTemplates: { __name: "report_templates" },
  radiologyStudies: { __name: "radiology_studies" },
  instStyles: { __name: "radiology_institutional_styles" },
  whatsappSettings: { __name: "whatsapp_settings" },
  shareLinks: { __name: "radiology_share_links" },
  drafts: { __name: "radiology_report_drafts", id: "id", studyId: "study_id", updatedAt: "updated_at" },
  worklist: { __name: "radiology_worklist", id: "id" },
  rfi: { __name: "report_finding_instances", id: "id", draftId: "draft_id" },
  quickFindings: { __name: "radiology_quick_findings", id: "id", label: "label" },
  auditLogs: { __name: "audit_logs", id: "id", action: "action", entityId: "entity_id", newValue: "new_value" },
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
  radiologyInstitutionalStylesTable: TBL.instStyles,
  whatsappSettingsTable: TBL.whatsappSettings,
  radiologyShareLinksTable: TBL.shareLinks,
  radiologyReportDraftsTable: TBL.drafts,
  radiologyWorklistTable: TBL.worklist,
  reportFindingInstancesTable: TBL.rfi,
  radiologyQuickFindingsTable: TBL.quickFindings,
  auditLogsTable: TBL.auditLogs,
}));

vi.mock("@workspace/db", () => {
  const joinedReportRow = () => ({
    r: reportRow,
    patientFirstName: "Asha", patientLastName: "P", patientCode: "PAT-1",
    patientPhone: "999", patientEmail: "a@x", patientGender: "F", patientDob: null,
    testName: "MRI LS Spine", testCode: "MRI1",
  });
  const chain = (tbl: { __name?: string }) => {
    // Plain selects (e.g. PATCH /:id's existing-row lookup) get the BARE row;
    // joined selects (GET /:id, buildReportHtml) get the {r, ...} shape.
    const rowsFor = (joined: boolean): unknown[] => {
      if (tbl?.__name === "patient_reports") return [joined ? joinedReportRow() : reportRow];
      if (tbl?.__name === "audit_logs") return auditRows;
      return [];
    };
    const thenable = (joined: boolean) => ({
      then: (resolve: (v: unknown) => void) => resolve(rowsFor(joined)),
      limit: async () => rowsFor(joined),
      orderBy: () => ({ then: (resolve: (v: unknown) => void) => resolve([]), limit: async () => [] }),
    });
    return {
      where: () => thenable(false),
      limit: async () => (tbl?.__name === "clinic_settings" || tbl?.__name === "radiology_institutional_styles" ? [] : rowsFor(false)),
      leftJoin: function lj() { return { leftJoin: lj, where: () => thenable(true) }; },
      orderBy: () => ({ limit: async () => [] }),
    };
  };
  return {
    db: {
      execute: async () => { writeCalls.push({ kind: "execute" }); return [{ n: 0 }]; },
      select: () => ({ from: (tbl: { __name?: string }) => chain(tbl) }),
      insert: (tbl: { __name?: string }) => ({
        values: (v: unknown) => {
          writeCalls.push({ kind: "insert", table: tbl?.__name });
          return { returning: async () => [{ id: 1, ...(v as object) }], then: (r: (x: unknown) => void) => r(undefined) };
        },
      }),
      update: (tbl: { __name?: string }) => ({
        set: (v: unknown) => ({
          where: () => {
            writeCalls.push({ kind: "update", table: tbl?.__name });
            return {
              then: (resolve: (x: unknown) => void) => resolve(undefined),
              returning: async () => [{ ...reportRow, ...(v as object) }],
            };
          },
        }),
      }),
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => { writeCalls.push({ kind: "transaction" }); return fn({}); },
    },
  };
});

vi.mock("../lib/featureFlags", () => ({
  isFeatureEnabledServer: async (key: string) => flags[key] ?? false,
}));
vi.mock("./whatsapp", () => ({ sendReportWhatsapp: async () => ({ ok: true }), sendReportDelivery: async () => ({ ok: true }) }));
vi.mock("../email", () => ({ sendReportEmail: async () => ({ ok: true }) }));
vi.mock("../lib/radiologyCatalog/drizzleStore", () => ({ DrizzleCatalogStore: class {} }));
vi.mock("../lib/structuredReport/catalogAccess", () => ({ DrizzleStructuredReportCatalogPort: class { constructor(..._a: unknown[]) {} } }));

vi.mock("../lib/radiologyStructuredRead", () => ({
  readStructuredReport: async (row: unknown, ports: unknown) => {
    readCalls.push({ row: row as Record<string, unknown>, ports: ports as Record<string, unknown> });
    if (readError) throw readError;
    return readResult;
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getRouteHandler(router: any, method: "get" | "post", path: string) {
  const layer = router.stack.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (l: any) => l.route && l.route.path === path && l.route.methods[method],
  );
  if (!layer) throw new Error(`${method.toUpperCase()} ${path} handler not found`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function makeRes() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = {
    statusCode: 200, body: undefined, sent: undefined, headers: {},
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
    send(payload: unknown) { this.sent = payload; return this; },
    setHeader(k: string, v: string) { this.headers[k] = v; },
  };
  return res;
}

const STORED_BODY = "FINDINGS:\nStored signed prose.\n\nIMPRESSION:\n1. Stored impression.";
const RENDERED_BODY = "FINDINGS:\nStored signed prose.\n\nIMPRESSION:\nStored impression.";
const DOC = { kind: "radiology.structured_report", audit: { signature: { state: "final" } } };

function diagnostics(overrides: Record<string, unknown> = {}) {
  return {
    comparisonClass: "APPROVED_FORMATTING_ONLY", usedStructured: true, hashVerified: true,
    validationErrors: [], validationWarnings: [], rendererWarnings: [], divergentLines: [],
    renderMs: 0.4, storedRenderEngineVersion: "d4-structured-1.0.0",
    currentRendererVersion: "d4-structured-1.0.0", catalogVersion: "0", fallbackReason: null,
    ...overrides,
  };
}

async function getById() {
  const { patientReportsRouter } = await import("./patient-reports");
  const handler = getRouteHandler(patientReportsRouter, "get", "/:id");
  const req = { params: { id: "77" }, query: {}, headers: {}, log: { error: () => undefined } };
  const res = makeRes();
  await handler(req, res);
  return res;
}

async function renderHtml() {
  const { buildReportHtml } = await import("./patient-reports");
  return buildReportHtml(77, false);
}

beforeEach(() => {
  flags = { ff_radiology_structured_read: true };
  readCalls = [];
  writeCalls = [];
  auditRows = [];
  readError = null;
  readResult = {
    body: RENDERED_BODY, usedStructured: true, comparisonClass: "APPROVED_FORMATTING_ONLY",
    document: DOC, render: {}, diagnostics: diagnostics(),
  };
  reportRow = {
    id: 77, reportNumber: "RPT-1", type: "radiology", patientId: 12, testId: 3, studyId: 55,
    title: "MRI LS Spine — Report", body: STORED_BODY, parameters: null, impression: "Stored impression.",
    status: "draft", isCritical: false, criticalNote: null, signatureId: null, signedByName: "Dr. Rao",
    signedAt: new Date(), verifiedBySignatureId: null, verifiedByName: null, verifiedAt: null,
    structuredJson: DOC, renderEngineVersion: "d4-structured-1.0.0", templateVersion: "MRI_LS_SPINE",
    catalogVersion: "0", stylePresetUsed: null, createdBy: "Dr. Rao", createdAt: new Date(), updatedAt: new Date(),
  };
});

describe("D6 — GET /:id (viewer read path)", () => {
  test("flag OFF → stored body, no structuredRead key, pipeline never invoked (byte-identical legacy)", async () => {
    flags.ff_radiology_structured_read = false;
    const res = await getById();
    expect(res.statusCode).toBe(200);
    expect(res.body.body).toBe(STORED_BODY);
    expect(res.body.structuredRead).toBeUndefined();
    expect(readCalls).toHaveLength(0);
  });

  test("flag ON + usable render on an EDITABLE (draft) row → body stays the stored signed bytes; render rides as displayBody", async () => {
    // Editors round-trip GET /:id's `body` through PATCH on save — substituting
    // it on an editable row would let a zero-edit save overwrite the signed
    // bytes with the render (adversarial-review HIGH finding).
    const res = await getById();
    expect(res.body.body).toBe(STORED_BODY);
    expect(res.body.displayBody).toBe(RENDERED_BODY);
    expect(res.body.structuredRead.comparisonClass).toBe("APPROVED_FORMATTING_ONLY");
    expect(res.body.structuredRead.hashVerified).toBe(true);
    expect(res.body.structuredRead.renderMs).toBeGreaterThanOrEqual(0);
    expect(readCalls).toHaveLength(1);
    expect(writeCalls).toHaveLength(0); // read never mutates (no insert/update/execute/transaction)
  });

  test("flag ON + usable render on an IMMUTABLE (verified) row → body IS substituted (PATCH already refuses edits)", async () => {
    reportRow = { ...reportRow, status: "verified" };
    const res = await getById();
    expect(res.body.body).toBe(RENDERED_BODY);
    expect(res.body.displayBody).toBeUndefined();
    expect(res.body.structuredRead.comparisonClass).toBe("APPROVED_FORMATTING_ONLY");
    expect(writeCalls).toHaveLength(0);
  });

  test("pipeline receives the exact row fields and live ports (wiring assertion)", async () => {
    await getById();
    expect(readCalls[0].row).toMatchObject({
      body: STORED_BODY,
      structuredJson: DOC,
      renderEngineVersion: "d4-structured-1.0.0",
      catalogVersion: "0",
    });
    const ports = readCalls[0].ports as { catalogPort: unknown; auditLogLookup: (d: string, h: string) => Promise<boolean> };
    expect(ports.catalogPort).toBeDefined();
    // Execute the REAL R14b lookup closure against the mocked db:
    auditRows = [{ newValue: '{"document_id":"X","signed_content_sha256":"sha256:feedface"}' }];
    await expect(ports.auditLogLookup("X", "sha256:feedface")).resolves.toBe(true);
    await expect(ports.auditLogLookup("X", "sha256:other")).resolves.toBe(false);
    auditRows = [];
    await expect(ports.auditLogLookup("X", "sha256:feedface")).resolves.toBe(false);
  });

  test("pipeline THROWS → route serves the stored body unchanged (catch-path containment)", async () => {
    readError = new Error("simulated pipeline explosion");
    const res = await getById();
    expect(res.statusCode).toBe(200);
    expect(res.body.body).toBe(STORED_BODY);
    expect(res.body.structuredRead).toBeUndefined();
    expect(res.body.displayBody).toBeUndefined();
  });

  test("flag ON + CLINICAL_DIFFERENCE → stored body served, divergence visible in diagnostics", async () => {
    readResult = {
      body: STORED_BODY, usedStructured: false, comparisonClass: "CLINICAL_DIFFERENCE",
      document: DOC, render: {}, diagnostics: diagnostics({
        comparisonClass: "CLINICAL_DIFFERENCE", usedStructured: false,
        divergentLines: [{ stored: "Stored signed prose.", rendered: "Other prose." }],
        fallbackReason: "rendered body diverges clinically from the stored signed body — stored body wins",
      }),
    };
    const res = await getById();
    expect(res.body.body).toBe(STORED_BODY);
    expect(res.body.structuredRead.comparisonClass).toBe("CLINICAL_DIFFERENCE");
    expect(res.body.structuredRead.divergentLines).toHaveLength(1);
  });

  test("flag ON + INVALID_STRUCTURED_JSON (tamper/validation failure) → stored body served", async () => {
    readResult = {
      body: STORED_BODY, usedStructured: false, comparisonClass: "INVALID_STRUCTURED_JSON",
      document: null, render: null,
      diagnostics: diagnostics({ comparisonClass: "INVALID_STRUCTURED_JSON", usedStructured: false, hashVerified: false, fallbackReason: "content_sha256_mismatch" }),
    };
    const res = await getById();
    expect(res.body.body).toBe(STORED_BODY);
    expect(res.body.structuredRead.hashVerified).toBe(false);
  });

  test("legacy row (no structured_json) → pipeline skipped entirely, response identical to legacy", async () => {
    reportRow = { ...reportRow, structuredJson: null };
    const res = await getById();
    expect(res.body.body).toBe(STORED_BODY);
    expect(res.body.structuredRead).toBeUndefined();
    expect(readCalls).toHaveLength(0); // short-circuits before the pipeline
  });

  test("pathology rows never enter the structured read path", async () => {
    reportRow = { ...reportRow, type: "pathology" };
    const res = await getById();
    expect(res.body.structuredRead).toBeUndefined();
    expect(readCalls).toHaveLength(0);
  });
});

describe("D6 — buildReportHtml (print / PDF / public+WhatsApp PDF / share / PACS)", () => {
  test("flag OFF → HTML embeds the stored body", async () => {
    flags.ff_radiology_structured_read = false;
    const html = await renderHtml();
    expect(html).toContain("1. Stored impression."); // stored formatting survives
    expect(readCalls).toHaveLength(0);
  });

  test("flag ON + usable render → HTML embeds the D4 render (display-only surface, no round-trip risk)", async () => {
    const html = await renderHtml();
    expect(html).toContain(RENDERED_BODY);
    expect(readCalls).toHaveLength(1);
    expect(writeCalls).toHaveLength(0); // rendering a PDF never writes
  });

  test("pipeline THROWS → HTML embeds the stored body (catch-path containment)", async () => {
    readError = new Error("simulated pipeline explosion");
    const html = await renderHtml();
    expect(html).toContain("1. Stored impression.");
  });

  test("flag ON + fallback classes → HTML embeds the stored body", async () => {
    readResult = {
      body: STORED_BODY, usedStructured: false, comparisonClass: "CLINICAL_DIFFERENCE",
      document: DOC, render: {}, diagnostics: diagnostics({ comparisonClass: "CLINICAL_DIFFERENCE", usedStructured: false }),
    };
    const html = await renderHtml();
    expect(html).toContain("1. Stored impression.");
  });

  test("old signed report without structured_json renders exactly as before", async () => {
    reportRow = { ...reportRow, structuredJson: null, renderEngineVersion: null, catalogVersion: null };
    const html = await renderHtml();
    expect(html).toContain("1. Stored impression.");
    expect(readCalls).toHaveLength(0);
  });
});

describe("D6 — PATCH defense-in-depth (signed structured bodies are immutable)", () => {
  async function patchBody(body: string) {
    const { patientReportsRouter } = await import("./patient-reports");
    const handler = getRouteHandler(patientReportsRouter, "patch" as never, "/:id");
    const req = { params: { id: "77" }, body: { body }, headers: {}, log: { error: () => undefined } };
    const res = makeRes();
    await handler(req, res);
    return res;
  }

  test("a row carrying a signed-final structured document rejects body edits (409, use Amend), even at status draft", async () => {
    const res = await patchBody("REWRITTEN BODY");
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toContain("Signed structured reports");
    expect(writeCalls.filter((w) => w.kind === "update")).toHaveLength(0); // nothing persisted
  });

  test("a legacy draft row (no structured document) still accepts body edits (legacy contract unchanged)", async () => {
    reportRow = { ...reportRow, structuredJson: null };
    const res = await patchBody("edited legacy body");
    expect(res.statusCode).toBe(200);
    expect(writeCalls.filter((w) => w.kind === "update")).toHaveLength(1);
  });
});
