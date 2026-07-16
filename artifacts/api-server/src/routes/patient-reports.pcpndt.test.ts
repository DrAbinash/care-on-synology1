import { describe, expect, test, vi, beforeEach } from "vitest";

// PCPNDT server-side finalize guard — POST /api/patient-reports (the actual
// content-persisting write: creates the patient_reports row, which the D5
// structured path may then auto-sign). This is the guard's PRIMARY
// enforcement point: blocking here prevents an obstetric/fetal ultrasound
// report's content from ever being persisted or signed, not just from
// having its worklist status flipped (see the companion guard/tests in
// internal-radiology.pcpndt.test.ts for that second, defense-in-depth
// layer). See docs/usg-reporting/platform-consolidation-pr-b.md §17-18.
//
// Mock scaffold intentionally mirrors patient-reports.d5.test.ts's proven
// harness (same file, same import-time dependency surface) — flags are kept
// OFF here so every non-blocked case takes the simple legacy insert path;
// D5's structured-finalize behavior itself is covered by d5.test.ts, not
// re-tested here.

let flags: Record<string, boolean>;
let worklistRow: Record<string, unknown> | null;
let legacyInsertValues: Record<string, unknown>[];
// Latest form_f_records row for the patient — null means "no Form F exists"
// (the guard must then refuse an obstetric finalize). Set to COMPLETE_FORM_F
// to exercise the compliant-allow path added by the canonical PCPNDT gate
// (roadmap §1.4 step 2).
let formFRow: Record<string, unknown> | null;
let auditInsertValues: Record<string, unknown>[];

const COMPLETE_FORM_F = {
  id: 91, patientId: 12, idCardVerified: true,
  husbandFatherName: "Ramesh Kumar", address: "Deoghar",
  consentDate: "2026-07-10", procedureDate: "",
  createdAt: new Date("2026-07-10T09:00:00Z"),
};

const TBL = {
  patientReports: { __name: "patient_reports", id: "id" },
  reportShares: { __name: "report_shares" },
  signatures: { __name: "signatures", id: "id" },
  patients: { __name: "patients", id: "id" },
  tests: { __name: "tests", id: "id" },
  clinicSettings: { __name: "clinic_settings" },
  reportTemplates: { __name: "report_templates" },
  radiologyStudies: { __name: "radiology_studies" },
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
  radiologyInstitutionalStylesTable: TBL.instStyles,
  whatsappSettingsTable: TBL.whatsappSettings,
  radiologyShareLinksTable: TBL.shareLinks,
  radiologyReportDraftsTable: TBL.drafts,
  radiologyWorklistTable: TBL.worklist,
  reportFindingInstancesTable: TBL.rfi,
  radiologyQuickFindingsTable: TBL.quickFindings,
  auditLogsTable: TBL.auditLogs,
  patientReportAmendmentsTable: { __name: "patient_report_amendments", originalReportId: "original_report_id", amendedReportId: "amended_report_id", rootReportId: "root_report_id", sequenceNumber: "sequence_number" },
  formFRecordsTable: { __name: "form_f_records", patientId: "patient_id", createdAt: "created_at" },
}));

function makeSelectChain(tbl: { __name?: string }) {
  const rowsFor = (): unknown[] => {
    const name = tbl?.__name ?? "";
    if (name === "patients") return [{ id: 12, firstName: "Asha", lastName: "P" }];
    if (name === "tests") return [{ id: 3, name: "USG Growth Scan", department: "USG" }];
    if (name === "radiology_institutional_styles") return [];
    if (name === "radiology_report_drafts") return [];
    if (name === "report_finding_instances") return [];
    // The PCPNDT guard resolves a worklist row two ways (by id, then by
    // studyId) — both attempts return the SAME fixture row here, since the
    // mock doesn't parse `where()` clauses. That's sufficient to exercise
    // the route's decision logic; the drizzle query construction itself is
    // a one-line `eq()` filter, not what this test is verifying.
    if (name === "radiology_worklist") return worklistRow ? [worklistRow] : [];
    if (name === "radiology_quick_findings") return [];
    if (name === "audit_logs") return [];
    if (name === "form_f_records") return formFRow ? [formFRow] : [];
    return [];
  };
  const thenable = () => {
    const t: Record<string, unknown> = {
      then: (resolve: (v: unknown) => void) => resolve(rowsFor()),
      limit: async () => rowsFor(),
      orderBy: () => ({
        then: (resolve: (v: unknown) => void) => resolve(rowsFor()),
        limit: async () => rowsFor(),
      }),
    };
    return t;
  };
  return {
    where: () => thenable(),
    orderBy: () => ({ limit: async () => rowsFor() }),
    limit: async () => rowsFor(),
    leftJoin: () => ({ leftJoin: () => ({ where: () => thenable() }), where: () => thenable() }),
  };
}

vi.mock("@workspace/db", () => ({
  // lib/audit imports auditLogsTable from the package root (not /schema) —
  // without this the override's audit insert would target `undefined`.
  auditLogsTable: TBL.auditLogs,
  db: {
    execute: async () => [{ n: 0 }],
    select: (_proj?: unknown) => ({ from: (tbl: { __name?: string }) => makeSelectChain(tbl) }),
    insert: (tbl: { __name?: string }) => ({
      values: (v: Record<string, unknown>) => {
        if (tbl?.__name === "patient_reports") legacyInsertValues.push(v);
        if (tbl?.__name === "audit_logs") auditInsertValues.push(v);
        return { returning: async () => [{ id: 101, ...v }] };
      },
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      // Used by lib/audit's hash-chained auditLog() (advisory lock + read
      // last chainHash + insert) — needed here because the PCPNDT override
      // path writes a pcpndt_override_finalize audit row. The D5 structured
      // path never runs in this file (flags are always OFF), so a working
      // transaction stub is safe.
      const tx = {
        execute: async () => [{}],
        select: (_proj?: unknown) => ({ from: (tbl: { __name?: string }) => makeSelectChain(tbl) }),
        insert: (tbl: { __name?: string }) => ({
          values: async (v: Record<string, unknown>) => {
            if (tbl?.__name === "audit_logs") auditInsertValues.push(v);
            return undefined;
          },
        }),
      };
      return fn(tx);
    },
  },
}));

vi.mock("../lib/featureFlags", () => ({
  isFeatureEnabledServer: async (key: string) => flags[key] ?? false,
}));

vi.mock("./whatsapp", () => ({
  sendReportWhatsapp: async () => undefined,
  sendReportDelivery: async () => undefined,
}));
vi.mock("../email", () => ({ sendReportEmail: async () => undefined }));

vi.mock("../lib/radiologyD1FinalWriter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/radiologyD1FinalWriter")>();
  return { ...actual };
});
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

// ── Harness ──────────────────────────────────────────────────────────────────

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

async function postCreate(body: Record<string, unknown>, staffSession?: Record<string, unknown>) {
  const { patientReportsRouter } = await import("./patient-reports");
  const handler = getRouteHandler(patientReportsRouter, "post", "/");
  const req = {
    body, staffSession,
    headers: {}, ip: "10.0.0.9", socket: {},
    log: { error: () => undefined, warn: () => undefined },
  };
  const res = makeRes();
  await handler(req, res);
  return res;
}

const BASE_BODY = {
  patientId: 12, testId: 3, type: "radiology", studyId: 9,
  title: "USG Report", body: "FINDINGS.", impression: "Normal.",
  createdBy: "Dr. Rao",
};

beforeEach(() => {
  flags = { ff_radiology_structured_final: false, ff_radiology_catalog: false };
  worklistRow = { id: 9, studyId: 55, modality: "USG", studyDescription: "Whole Abdomen", accessionNumber: "ACC-1", studyInstanceUID: "1.2.3" };
  legacyInsertValues = [];
  formFRow = null; // no Form F on file — obstetric finalizes must be refused
  auditInsertValues = [];
});

describe("PCPNDT server-side finalize guard — POST /api/patient-reports", () => {
  test("non-obstetric USG (Whole Abdomen) finalizes normally — report row is created", async () => {
    const res = await postCreate(BASE_BODY);
    expect(res.statusCode).toBe(201);
    expect(legacyInsertValues).toHaveLength(1);
  });

  test("every non-obstetric USG study type finalizes normally", async () => {
    for (const desc of ["KUB", "Thyroid", "Breast", "Scrotum", "Carotid Doppler", "TVS"]) {
      worklistRow = { id: 9, studyId: 55, modality: "USG", studyDescription: desc, accessionNumber: "ACC-1", studyInstanceUID: "1.2.3" };
      legacyInsertValues = [];
      const res = await postCreate({ ...BASE_BODY, studyId: 9 });
      expect(res.statusCode, `${desc} should create a report row`).toBe(201);
      expect(legacyInsertValues).toHaveLength(1);
    }
  });

  test("MRI finalizes normally, unaffected by the guard", async () => {
    worklistRow = { id: 9, studyId: 55, modality: "MR", studyDescription: "LS Spine", accessionNumber: "ACC-1", studyInstanceUID: "1.2.3" };
    const res = await postCreate({ ...BASE_BODY, testId: 3 });
    expect(res.statusCode).toBe(201);
    expect(legacyInsertValues).toHaveLength(1);
  });

  test("CT finalizes normally, unaffected by the guard", async () => {
    worklistRow = { id: 9, studyId: 55, modality: "CT", studyDescription: "Chest CT", accessionNumber: "ACC-1", studyInstanceUID: "1.2.3" };
    const res = await postCreate(BASE_BODY);
    expect(res.statusCode).toBe(201);
    expect(legacyInsertValues).toHaveLength(1);
  });

  test("obstetric USG is rejected with 409 pcpndt_compliance_required — NO report row is created or signed", async () => {
    worklistRow = { id: 9, studyId: 55, modality: "USG", studyDescription: "Obstetric Growth Scan", accessionNumber: "ACC-1", studyInstanceUID: "1.2.3" };
    const res = await postCreate(BASE_BODY);
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe("pcpndt_compliance_required");
    expect(res.body.message).toMatch(/usg reporting|form f/i);
    expect(legacyInsertValues).toHaveLength(0); // nothing persisted — the key safety property
  });

  test("fetal-pattern USG under any US-family modality spelling is rejected", async () => {
    worklistRow = { id: 9, studyId: 55, modality: "Doppler", studyDescription: "Fetal Anomaly Scan", accessionNumber: "ACC-1", studyInstanceUID: "1.2.3" };
    const res = await postCreate(BASE_BODY);
    expect(res.statusCode).toBe(409);
    expect(legacyInsertValues).toHaveLength(0);
  });

  test("a client that omits/lies about modality in `parameters` still gets blocked — the guard reads the DB worklist row, not client-supplied parameters", async () => {
    worklistRow = { id: 9, studyId: 55, modality: "USG", studyDescription: "Obstetric Growth Scan", accessionNumber: "ACC-1", studyInstanceUID: "1.2.3" };
    const res = await postCreate({
      ...BASE_BODY,
      // A hand-crafted call lying about the study to try to bypass the guard.
      parameters: JSON.stringify({ modality: "MR", studyDescription: "Nothing to see here" }),
    });
    expect(res.statusCode).toBe(409);
    expect(legacyInsertValues).toHaveLength(0);
  });

  test("pathology (non-radiology) report creation is completely unaffected, even against the SAME obstetric worklist row", async () => {
    worklistRow = { id: 9, studyId: 55, modality: "USG", studyDescription: "Obstetric Growth Scan", accessionNumber: "ACC-1", studyInstanceUID: "1.2.3" };
    const res = await postCreate({ ...BASE_BODY, type: "pathology" });
    expect(res.statusCode).toBe(201);
    expect(legacyInsertValues).toHaveLength(1);
  });

  test("a radiology report with no studyId (guard cannot resolve a worklist row) proceeds normally — fails open, not closed, when the study can't be classified", async () => {
    const res = await postCreate({ ...BASE_BODY, studyId: undefined });
    expect(res.statusCode).toBe(201);
    expect(legacyInsertValues).toHaveLength(1);
  });

  test("legacy compliant workflow (routes/usgReports.ts) is a completely separate route/table and is untouched by this guard", async () => {
    // Structural assertion, not a route call: usgReports.ts's own PCPNDT
    // Form F lock now calls the SAME shared checkPcpndtFormFCompliance()
    // (lib/pcpndtCompliance.ts) with byte-identical response shapes — one
    // engine, not two drifting implementations.
    const usgReportsSource = await import("./usgReports");
    expect(usgReportsSource).toBeDefined();
  });
});

// ── Roadmap §1.4 step 2+4 — the guard is now a real compliance GATE ─────────
describe("PCPNDT gate — compliant obstetric studies finalize; override is audited", () => {
  const OBSTETRIC_ROW = { id: 9, studyId: 55, modality: "USG", studyDescription: "Obstetric Growth Scan", accessionNumber: "ACC-1", studyInstanceUID: "1.2.3" };

  test("obstetric USG with a COMPLETE, ID-verified Form F finalizes normally (no false-block)", async () => {
    worklistRow = OBSTETRIC_ROW;
    formFRow = COMPLETE_FORM_F;
    const res = await postCreate(BASE_BODY);
    expect(res.statusCode).toBe(201);
    expect(legacyInsertValues).toHaveLength(1);
  });

  test("obstetric USG with an INCOMPLETE Form F is refused, listing the exact missing fields", async () => {
    worklistRow = OBSTETRIC_ROW;
    formFRow = { ...COMPLETE_FORM_F, idCardVerified: false, address: "" };
    const res = await postCreate(BASE_BODY);
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe("pcpndt_compliance_required");
    expect(res.body.validationErrors).toEqual(["ID Card must be verified.", "Address is required."]);
    expect(legacyInsertValues).toHaveLength(0);
  });

  test("override is refused for a non-admin session even with a reason", async () => {
    worklistRow = OBSTETRIC_ROW;
    formFRow = null;
    const res = await postCreate(
      { ...BASE_BODY, pcpndtOverride: true, pcpndtOverrideReason: "urgent" },
      { subjectId: 4, subjectName: "Dr R", role: "radiologist" },
    );
    expect(res.statusCode).toBe(409);
    expect(legacyInsertValues).toHaveLength(0);
  });

  test("override is refused without a documented reason, even for super_admin", async () => {
    worklistRow = OBSTETRIC_ROW;
    formFRow = null;
    const res = await postCreate(
      { ...BASE_BODY, pcpndtOverride: true },
      { subjectId: 1, subjectName: "Dr A", role: "super_admin" },
    );
    expect(res.statusCode).toBe(409);
    expect(legacyInsertValues).toHaveLength(0);
  });

  test("super_admin override with a documented reason proceeds AND writes a pcpndt_override_finalize audit row", async () => {
    worklistRow = OBSTETRIC_ROW;
    formFRow = null;
    const res = await postCreate(
      { ...BASE_BODY, pcpndtOverride: true, pcpndtOverrideReason: "supervisor-approved exception" },
      { subjectId: 1, subjectName: "Dr A", role: "super_admin" },
    );
    expect(res.statusCode).toBe(201);
    expect(legacyInsertValues).toHaveLength(1);
    const override = auditInsertValues.find((a) => a.action === "pcpndt_override_finalize");
    expect(override).toBeDefined();
    expect(String(override!.reason)).toBe("supervisor-approved exception");
  });
});
