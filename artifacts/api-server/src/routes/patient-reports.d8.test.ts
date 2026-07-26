import { describe, expect, test, vi, beforeEach } from "vitest";

// Ticket D8 route-integration coverage — amendment display cutover and
// superseded-report safeguards across every reading/delivery surface:
// GET /:id (default latest + explicit historical), print, PDF, the public
// token PDF, and WhatsApp/email share. The canonical resolver
// (resolveReportVersion) is REAL here — its queries are driven by the same
// FIFO-scripted db mock the D7 suite established. auditLog is mocked so the
// Phase 7 requested-vs-delivered audit records are assertable.

let flags: Record<string, boolean>;
/** FIFO script for PLAIN patient_reports selects (resolver, token lookup,
 *  markDeliveredIfVerified). */
let plainReportQueryScript: unknown[][];
/** FIFO script for patient_report_amendments selects. */
let linkageQueryScript: unknown[][];
/** FIFO script for JOINED patient_reports selects (GET /:id, HTML render,
 *  share contact lookup). */
let joinedQueryScript: unknown[][];

interface WriteRecord { kind: "insert" | "update"; table: string; values: unknown }
let allWrites: WriteRecord[];

const TBL = {
  patientReports: { __name: "patient_reports", id: "id", patientId: "patient_id", status: "status", reportNumber: "report_number", signedByName: "signed_by_name", signedAt: "signed_at", createdAt: "created_at", publicToken: "public_token" },
  reportShares: { __name: "report_shares" },
  signatures: { __name: "signatures" },
  patients: { __name: "patients" },
  tests: { __name: "tests" },
  clinicSettings: { __name: "clinic_settings" },
  reportTemplates: { __name: "report_templates" },
  radiologyStudies: { __name: "radiology_studies" },
  instStyles: { __name: "radiology_institutional_styles" },
  whatsappSettings: { __name: "whatsapp_settings" },
  shareLinks: { __name: "radiology_share_links" },
  drafts: { __name: "radiology_report_drafts" },
  worklist: { __name: "radiology_worklist" },
  rfi: { __name: "report_finding_instances" },
  quickFindings: { __name: "radiology_quick_findings" },
  auditLogs: { __name: "audit_logs" },
  amendments: { __name: "patient_report_amendments", originalReportId: "original_report_id", amendedReportId: "amended_report_id", rootReportId: "root_report_id", sequenceNumber: "sequence_number", originalDocumentId: "original_document_id" },
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
  patientReportAmendmentsTable: TBL.amendments,
}));

vi.mock("@workspace/db", () => {
  const rowsFor = (tbl: { __name?: string }, joined: boolean): unknown[] => {
    const name = tbl?.__name ?? "";
    if (name === "patient_reports") {
      if (joined) return joinedQueryScript.length > 0 ? (joinedQueryScript.shift() as unknown[]) : [];
      return plainReportQueryScript.length > 0 ? (plainReportQueryScript.shift() as unknown[]) : [];
    }
    if (name === "patient_report_amendments") {
      return linkageQueryScript.length > 0 ? (linkageQueryScript.shift() as unknown[]) : [];
    }
    return [];
  };
  const chain = (tbl: { __name?: string }) => {
    const thenable = (joined: boolean) => ({
      then: (resolve: (v: unknown) => void) => resolve(rowsFor(tbl, joined)),
      limit: async () => rowsFor(tbl, joined),
      orderBy: () => ({
        then: (resolve: (v: unknown) => void) => resolve(rowsFor(tbl, joined)),
        limit: async () => rowsFor(tbl, joined),
      }),
    });
    return {
      where: () => thenable(false),
      limit: async () => rowsFor(tbl, false),
      orderBy: () => ({ limit: async () => rowsFor(tbl, false), then: (r: (v: unknown) => void) => r(rowsFor(tbl, false)) }),
      leftJoin: function lj() { return { leftJoin: lj, where: () => thenable(true) }; },
    };
  };
  return {
    db: {
      execute: async () => [{ n: 0 }],
      select: () => ({ from: (tbl: { __name?: string }) => chain(tbl) }),
      insert: (tbl: { __name?: string }) => ({
        values: (v: unknown) => {
          allWrites.push({ kind: "insert", table: tbl?.__name ?? "?", values: v });
          return { returning: async () => [{ id: 1, ...(v as object) }], then: (r: (x: unknown) => void) => r(undefined), catch: () => undefined };
        },
      }),
      update: (tbl: { __name?: string }) => ({
        set: (v: unknown) => ({
          where: () => {
            allWrites.push({ kind: "update", table: tbl?.__name ?? "?", values: v });
            return { then: (r: (x: unknown) => void) => r(undefined), returning: async () => [v] };
          },
        }),
      }),
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    },
  };
});

vi.mock("../lib/featureFlags", () => ({ isFeatureEnabledServer: async (key: string) => flags[key] ?? false }));

// PDF rendering (htmlToPdf.ts) launches a real headless Chromium — stub it to
// a passthrough so /pdf tests stay fast and can still assert on the artifact
// HTML that reached it, without actually invoking Playwright.
vi.mock("../lib/htmlToPdf", () => ({
  renderHtmlToPdf: async (html: string) => Buffer.from(html),
}));

const whatsappCalls: unknown[] = [];
vi.mock("./whatsapp", () => ({
  sendReportWhatsapp: async (args: unknown) => { whatsappCalls.push(args); return { ok: true }; },
  sendReportDelivery: async () => ({ ok: true }),
}));
const emailCalls: unknown[] = [];
vi.mock("../email", () => ({ sendReportEmail: async (args: unknown) => { emailCalls.push(args); return { ok: true }; } }));

const auditLogCalls: Record<string, unknown>[] = [];
vi.mock("../lib/audit", () => ({
  auditLog: async (payload: Record<string, unknown>) => { auditLogCalls.push(payload); },
  canonicalHashPayload: (row: unknown) => JSON.stringify(row),
  computeChainHash: () => "stub-chain-hash",
}));

vi.mock("../lib/radiologyCatalog/drizzleStore", () => ({ DrizzleCatalogStore: class {} }));
vi.mock("../lib/structuredReport/catalogAccess", () => ({ DrizzleStructuredReportCatalogPort: class { constructor(..._a: unknown[]) {} } }));
vi.mock("../lib/radiologyStructuredRead", () => ({
  readStructuredReport: async (row: { body: string }) => ({
    body: row.body, usedStructured: false, comparisonClass: "NO_STRUCTURED_JSON",
    document: null, render: null,
    diagnostics: { comparisonClass: "NO_STRUCTURED_JSON", usedStructured: false, hashVerified: null, validationErrors: [], validationWarnings: [], rendererWarnings: [], divergentLines: [], renderMs: null, storedRenderEngineVersion: null, currentRendererVersion: "d4-structured-1.0.0", catalogVersion: null, fallbackReason: null },
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getRouteHandler(router: any, method: string, path: string) {
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
    statusCode: 200, body: undefined, headers: {} as Record<string, string>,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
    send(payload: unknown) { this.body = payload; return this; },
    setHeader(name: string, value: string) { this.headers[name] = value; return this; },
  };
  return res;
}

const RADIOLOGIST = { id: 1, subjectId: 7, subjectName: "Dr. Sen", role: "radiologist", permissions: ["/reports", "/reports:sign"], maxDiscount: null };

const T0 = new Date("2026-07-10T10:00:00Z");
const T1 = new Date("2026-07-11T09:00:00Z");

function fullRow(overrides: Record<string, unknown>) {
  return {
    id: 900, reportNumber: "RPT-ROOT", type: "radiology", patientId: 12, testId: 3, studyId: 55,
    orderTestId: null, orderId: null, billId: null, title: "MRI LS Spine — Report",
    body: "ROOT SIGNED BODY", parameters: null, impression: "Disc herniation.",
    status: "delivered", deliveredAt: T0, isCritical: false, criticalNote: null,
    criticalAcknowledgedAt: null, criticalAcknowledgedBy: null,
    signatureId: null, signedByName: "Dr. Rao", signedAt: T0,
    verifiedBySignatureId: null, verifiedByName: "Dr. V", verifiedAt: T0, verifierNotes: null,
    templateId: null, publicToken: null, publicTokenExpiresAt: null,
    createdBy: "Dr. Rao", createdAt: T0, updatedAt: T0, deliveredBy: null, stylePresetUsed: null,
    structuredJson: null, renderEngineVersion: null, templateVersion: null, catalogVersion: null,
    ...overrides,
  };
}

const ROW_900 = fullRow({});
const ROW_909 = fullRow({ id: 909, reportNumber: "RPT-A1", body: "AMENDED SIGNED BODY", signedByName: "Dr. Sen", signedAt: T1, createdAt: T1 });
const ROW_915_DRAFT = fullRow({ id: 915, reportNumber: "RPT-A2", body: "DRAFT AMENDMENT BODY", status: "draft", deliveredAt: null, createdAt: T1 });

const L1 = {
  sequenceNumber: 1, originalReportId: 900, amendedReportId: 909, rootReportId: 900,
  originalDocumentId: "0ROOT", amendedDocumentId: "AONE",
  reason: "laterality corrected", amendedByName: "Dr. Sen", createdAt: T1,
};
const L1_TO_DRAFT = { ...L1, amendedReportId: 915, amendedDocumentId: "ATWO" };

function joined(row: Record<string, unknown>) {
  return [{
    r: row,
    patientFirstName: "Asha", patientLastName: "P", patientCode: "PAT-1",
    patientPhone: "9999999999", patientEmail: "a@x.test", patientGender: "F", patientDob: null,
    testName: "MRI LS Spine", testCode: "MRI1",
  }];
}

async function getById(id: string, query: Record<string, string> = {}) {
  const { patientReportsRouter } = await import("./patient-reports");
  const handler = getRouteHandler(patientReportsRouter, "get", "/:id");
  const req = { params: { id }, query, headers: {}, log: { error: () => undefined } };
  const res = makeRes();
  await handler(req, res);
  return res;
}

async function getSurface(path: "/:id/print" | "/:id/pdf", id: string, query: Record<string, string> = {}) {
  const { patientReportsRouter } = await import("./patient-reports");
  const handler = getRouteHandler(patientReportsRouter, "get", path);
  const req = { params: { id }, query, headers: {}, staffSession: RADIOLOGIST, log: { error: () => undefined } };
  const res = makeRes();
  await handler(req, res);
  return res;
}

async function getPublicPdf(token: string) {
  const { publicReportsRouter } = await import("./patient-reports");
  const handler = getRouteHandler(publicReportsRouter, "get", "/:token/pdf");
  const req = { params: { token }, query: {}, headers: {}, log: { error: () => undefined } };
  const res = makeRes();
  await handler(req, res);
  return res;
}

async function postShare(id: string, body: Record<string, unknown>) {
  const { patientReportsRouter } = await import("./patient-reports");
  const handler = getRouteHandler(patientReportsRouter, "post", "/:id/share");
  const req = {
    params: { id }, body, query: {}, headers: { host: "care.test" }, protocol: "https",
    staffSession: RADIOLOGIST, log: { error: () => undefined },
  };
  const res = makeRes();
  await handler(req, res);
  return res;
}

const shares = () => allWrites.filter((w) => w.table === "report_shares");

beforeEach(() => {
  flags = { ff_radiology_structured_final: true };
  plainReportQueryScript = [];
  linkageQueryScript = [];
  joinedQueryScript = [];
  allWrites = [];
  whatsappCalls.length = 0;
  emailCalls.length = 0;
  auditLogCalls.length = 0;
});

// ── GET /:id — read API (Phase 3) ────────────────────────────────────────────

describe("D8 — GET /:id version resolution", () => {
  test("default resolves a superseded root to the LATEST signed version, metadata additive", async () => {
    plainReportQueryScript = [[ROW_900], [ROW_900, ROW_909]];
    linkageQueryScript = [[], [L1], [L1]];
    joinedQueryScript = [joined(ROW_909)];
    const res = await getById("900");
    expect(res.statusCode).toBe(200);
    expect(res.body.id).toBe(909);
    expect(res.body.body).toBe("AMENDED SIGNED BODY");
    expect(res.body.version).toMatchObject({
      requestedReportId: 900, resolvedReportId: 909, rootReportId: 900, latestReportId: 909,
      sequenceNumber: 2, totalVersions: 2, superseded: false, requestedSuperseded: true,
      amendmentReason: "laterality corrected", resolutionReason: "resolved_to_latest", warnings: [],
    });
    // D7 back-compat key still present, describing the served row.
    expect(res.body.amendment).toMatchObject({ rootReportId: 900, latestReportId: 909, superseded: false });
    expect(res.body.amendment.chain).toHaveLength(1);
  });

  test("?version=specific preserves exact historical access, clearly marked superseded", async () => {
    plainReportQueryScript = [[ROW_900], [ROW_900, ROW_909]];
    linkageQueryScript = [[], [L1], [L1]];
    joinedQueryScript = [joined(ROW_900)];
    const res = await getById("900", { version: "specific" });
    expect(res.body.id).toBe(900);
    expect(res.body.body).toBe("ROOT SIGNED BODY"); // history never mutated
    expect(res.body.version).toMatchObject({
      resolvedReportId: 900, superseded: true, sequenceNumber: 1, totalVersions: 2,
      resolutionReason: "explicit_specific",
    });
    expect(res.body.amendment.superseded).toBe(true);
  });

  test("?version=root serves the chain root from the tip", async () => {
    plainReportQueryScript = [[ROW_909], [ROW_900, ROW_909]];
    linkageQueryScript = [[L1], [], [L1]];
    joinedQueryScript = [joined(ROW_900)];
    const res = await getById("909", { version: "root" });
    expect(res.body.id).toBe(900);
    expect(res.body.version).toMatchObject({ resolvedReportId: 900, resolutionReason: "explicit_root", superseded: true });
  });

  test("D7's ?resolve=latest keeps working as an alias", async () => {
    flags.ff_radiology_structured_final = false; // alias must work even with the flag off
    plainReportQueryScript = [[ROW_900], [ROW_900, ROW_909]];
    linkageQueryScript = [[], [L1], [L1]];
    joinedQueryScript = [joined(ROW_909)];
    const res = await getById("900", { resolve: "latest" });
    expect(res.body.id).toBe(909);
  });

  test("flag OFF: default serves the exact requested row (pre-D8 behavior) with safety metadata", async () => {
    flags.ff_radiology_structured_final = false;
    plainReportQueryScript = [[ROW_900], [ROW_900, ROW_909]];
    linkageQueryScript = [[], [L1], [L1]];
    joinedQueryScript = [joined(ROW_900)];
    const res = await getById("900");
    expect(res.body.id).toBe(900);
    expect(res.body.body).toBe("ROOT SIGNED BODY");
    expect(res.body.version.superseded).toBe(true); // safety metadata stays truthful
    expect(res.body.amendment).toMatchObject({ latestReportId: 909, superseded: true });
  });

  test("old clients: existing body fields intact; new keys purely additive", async () => {
    plainReportQueryScript = [[ROW_900], [ROW_900, ROW_909]];
    linkageQueryScript = [[], [L1], [L1]];
    joinedQueryScript = [joined(ROW_909)];
    const res = await getById("900");
    expect(res.body).toMatchObject({
      reportNumber: "RPT-A1", type: "radiology", status: "delivered",
      impression: "Disc herniation.", patientName: "Asha P", testName: "MRI LS Spine",
    });
    expect(Array.isArray(res.body.shares)).toBe(true);
  });

  test("no amendment chain: no amendment key, version says no_chain", async () => {
    plainReportQueryScript = [[ROW_900]];
    linkageQueryScript = [[], []];
    joinedQueryScript = [joined(ROW_900)];
    const res = await getById("900");
    expect(res.body.id).toBe(900);
    expect(res.body.amendment).toBeUndefined();
    expect(res.body.version).toMatchObject({ resolutionReason: "no_chain", totalVersions: 1, superseded: false });
  });

  test("malformed chain fails safe to the requested row and surfaces warnings", async () => {
    plainReportQueryScript = [[ROW_900], [ROW_900]]; // linked row 909 missing from patient_reports
    linkageQueryScript = [[], [L1], [L1]];
    joinedQueryScript = [joined(ROW_900)];
    const res = await getById("900");
    expect(res.body.id).toBe(900);
    expect(res.body.version.resolutionReason).toBe("chain_corrupt_fallback");
    expect(res.body.version.warnings.some((w: string) => w.startsWith("chain_missing_report_row:909"))).toBe(true);
  });

  test("GET performs NO database writes, whatever the resolution", async () => {
    plainReportQueryScript = [[ROW_900], [ROW_900, ROW_909]];
    linkageQueryScript = [[], [L1], [L1]];
    joinedQueryScript = [joined(ROW_909)];
    await getById("900");
    expect(allWrites).toHaveLength(0);
    expect(auditLogCalls).toHaveLength(0);
  });

  test("version.chain lists every version with reportNumber, status, and the latest marker", async () => {
    plainReportQueryScript = [[ROW_900], [ROW_900, ROW_909]];
    linkageQueryScript = [[], [L1], [L1]];
    joinedQueryScript = [joined(ROW_909)];
    const res = await getById("900");
    expect(res.body.version.chain).toEqual([
      expect.objectContaining({ sequenceNumber: 1, reportId: 900, reportNumber: "RPT-ROOT", isLatest: false, reason: null }),
      expect.objectContaining({ sequenceNumber: 2, reportId: 909, reportNumber: "RPT-A1", isLatest: true, reason: "laterality corrected", amendedByName: "Dr. Sen" }),
    ]);
  });
});

// ── print / PDF (Phase 5) ────────────────────────────────────────────────────

describe("D8 — print/PDF default to latest; explicit historical is watermarked", () => {
  test("print of a superseded id serves the LATEST version with the amended banner; side effects target the served row", async () => {
    plainReportQueryScript = [[ROW_900], [ROW_900, ROW_909], [ROW_909]];
    linkageQueryScript = [[], [L1], [L1]];
    joinedQueryScript = [joined(ROW_909)];
    const res = await getSurface("/:id/print", "900");
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("AMENDED REPORT — Version 2 of 2");
    expect(res.body).toContain("laterality corrected");
    expect(res.body).not.toContain("SUPERSEDED — A NEWER");
    expect(res.headers["X-Report-Requested-Id"]).toBe("900");
    expect(res.headers["X-Report-Delivered-Id"]).toBe("909");
    expect(res.headers["X-Report-Version"]).toBe("2/2");
    expect(shares()).toHaveLength(1);
    expect((shares()[0].values as Record<string, unknown>).reportId).toBe(909);
    // Phase 7 — auditable requested-vs-delivered record.
    expect(auditLogCalls).toHaveLength(1);
    const audit = auditLogCalls[0];
    expect(audit.action).toBe("deliver_version");
    expect(String(audit.newValue)).toContain('"surface":"print"');
    expect(String(audit.newValue)).toContain('"requestedReportId":900');
    expect(String(audit.newValue)).toContain('"deliveredReportId":909');
    expect(audit.userName).toBe("Dr. Sen");
  });

  test("explicit historical print carries the SUPERSEDED banner + watermark", async () => {
    plainReportQueryScript = [[ROW_900], [ROW_900, ROW_909], [ROW_900]];
    linkageQueryScript = [[], [L1], [L1]];
    joinedQueryScript = [joined(ROW_900)];
    const res = await getSurface("/:id/print", "900", { version: "specific" });
    expect(res.body).toContain("SUPERSEDED — A NEWER SIGNED AMENDMENT EXISTS");
    expect(res.body).toContain('class="superseded-watermark"');
    expect(res.body).toContain("Version 1 of 2");
    expect(res.body).toContain("laterality corrected"); // superseding amendment's reason
    expect(res.headers["X-Report-Superseded"]).toBe("true");
    expect((shares()[0].values as Record<string, unknown>).reportId).toBe(900);
    expect(auditLogCalls).toHaveLength(1);
    expect(String(auditLogCalls[0].newValue)).toContain('"historicalOverride":true');
  });

  test("PDF filename states the delivered revision", async () => {
    plainReportQueryScript = [[ROW_900], [ROW_900, ROW_909], [ROW_909]];
    linkageQueryScript = [[], [L1], [L1]];
    joinedQueryScript = [joined(ROW_909)];
    const res = await getSurface("/:id/pdf", "900");
    expect(res.headers["Content-Disposition"]).toBe('inline; filename="RPT-A1-v2of2.pdf"');
  });

  test("historical PDF filename is marked SUPERSEDED", async () => {
    plainReportQueryScript = [[ROW_900], [ROW_900, ROW_909], [ROW_900]];
    linkageQueryScript = [[], [L1], [L1]];
    joinedQueryScript = [joined(ROW_900)];
    const res = await getSurface("/:id/pdf", "900", { version: "specific" });
    expect(res.headers["Content-Disposition"]).toBe('inline; filename="RPT-ROOT-v1of2-SUPERSEDED.pdf"');
  });

  test("flag OFF: print serves the requested row but the superseded watermark still protects it", async () => {
    flags.ff_radiology_structured_final = false;
    plainReportQueryScript = [[ROW_900], [ROW_900, ROW_909], [ROW_900]];
    linkageQueryScript = [[], [L1], [L1]];
    joinedQueryScript = [joined(ROW_900)];
    const res = await getSurface("/:id/print", "900");
    expect(res.body).toContain("SUPERSEDED — A NEWER SIGNED AMENDMENT EXISTS");
    expect((shares()[0].values as Record<string, unknown>).reportId).toBe(900);
  });

  test("report with no chain renders with no banner, no watermark, no audit record", async () => {
    plainReportQueryScript = [[ROW_900], [ROW_900]];
    linkageQueryScript = [[], []];
    joinedQueryScript = [joined(ROW_900)];
    const res = await getSurface("/:id/print", "900");
    expect(res.body).not.toContain('class="superseded-banner"');
    expect(res.body).not.toContain('class="amended-banner"');
    expect(res.body).not.toContain('class="superseded-watermark"');
    expect(res.body).not.toContain("SUPERSEDED");
    expect(auditLogCalls).toHaveLength(0);
  });

  test("malformed chain: print falls back to the requested row with the integrity warning banner", async () => {
    plainReportQueryScript = [[ROW_900], [ROW_900], [ROW_900]];
    linkageQueryScript = [[], [L1], [L1]];
    joinedQueryScript = [joined(ROW_900)];
    const res = await getSurface("/:id/print", "900");
    expect(res.body).toContain("AMENDMENT HISTORY WARNING");
    expect(auditLogCalls).toHaveLength(1); // warning is auditable
  });
});

// ── public token PDF (Phase 6) ───────────────────────────────────────────────

describe("D8 — public token resolves to the latest valid signed amendment", () => {
  const FUTURE = new Date("2027-01-01T00:00:00Z");
  const TOKEN = "tok_0123456789abcdef0123456789abcdef";
  const ROW_900_TOK = { ...ROW_900, publicToken: TOKEN, publicTokenExpiresAt: FUTURE };

  test("token minted for a superseded report serves the latest deliverable version", async () => {
    plainReportQueryScript = [[ROW_900_TOK], [ROW_900_TOK], [ROW_900_TOK, ROW_909], [ROW_909]];
    linkageQueryScript = [[], [L1], [L1]];
    joinedQueryScript = [joined(ROW_909)];
    const res = await getPublicPdf(TOKEN);
    expect(res.statusCode).toBe(200);
    expect(res.body.toString()).toContain("AMENDED SIGNED BODY");
    expect(res.body.toString()).toContain("AMENDED REPORT — Version 2 of 2");
    expect(res.headers["X-Report-Delivered-Id"]).toBe("909");
    expect((shares()[0].values as Record<string, unknown>).reportId).toBe(909);
    expect(auditLogCalls).toHaveLength(1);
    expect(String(auditLogCalls[0].newValue)).toContain('"tokenReportId":900');
    expect(auditLogCalls[0].userName).toBe("patient-link");
  });

  test("newest amendment not yet deliverable → token's own row serves WITH the superseded watermark, never as current", async () => {
    plainReportQueryScript = [[ROW_900_TOK], [ROW_900_TOK], [ROW_900_TOK, ROW_915_DRAFT], [ROW_900_TOK]];
    linkageQueryScript = [[], [L1_TO_DRAFT], [L1_TO_DRAFT]];
    joinedQueryScript = [joined(ROW_900_TOK)];
    const res = await getPublicPdf(TOKEN);
    expect(res.statusCode).toBe(200);
    expect(res.body.toString()).toContain("ROOT SIGNED BODY");
    expect(res.body.toString()).toContain("SUPERSEDED — A NEWER SIGNED AMENDMENT EXISTS");
    expect(res.body.toString()).toContain('class="superseded-watermark"');
    expect(res.headers["X-Report-Superseded"]).toBe("true");
    expect(String(auditLogCalls[0].newValue)).toContain('"superseded":true');
    // The draft amendment never leaked.
    expect(res.body.toString()).not.toContain("DRAFT AMENDMENT BODY");
  });

  test("expired token stays rejected (410) before any resolution", async () => {
    plainReportQueryScript = [[{ ...ROW_900_TOK, publicTokenExpiresAt: new Date("2020-01-01T00:00:00Z") }]];
    const res = await getPublicPdf(TOKEN);
    expect(res.statusCode).toBe(410);
    expect(auditLogCalls).toHaveLength(0);
  });

  test("unverified token row stays rejected (403)", async () => {
    plainReportQueryScript = [[{ ...ROW_900_TOK, status: "draft" }]];
    const res = await getPublicPdf(TOKEN);
    expect(res.statusCode).toBe(403);
  });
});

// ── share: WhatsApp / email (Phase 5) ────────────────────────────────────────

describe("D8 — share targets the latest deliverable version", () => {
  test("WhatsApp link and share log reference the latest version", async () => {
    plainReportQueryScript = [[ROW_900], [ROW_900, ROW_909], [ROW_909]];
    linkageQueryScript = [[], [L1], [L1]];
    joinedQueryScript = [joined(ROW_909)];
    const res = await postShare("900", { channel: "whatsapp" });
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(whatsappCalls).toHaveLength(1);
    const wa = whatsappCalls[0] as Record<string, unknown>;
    expect(String(wa.reportUrl)).toContain("/api/patient-reports/909/pdf");
    expect(wa.reportNumber).toBe("RPT-A1");
    expect((shares()[0].values as Record<string, unknown>).reportId).toBe(909);
    expect(String(auditLogCalls[0].newValue)).toContain('"surface":"share_whatsapp"');
  });

  test("email body is built from the latest version (with its amended banner)", async () => {
    plainReportQueryScript = [[ROW_900], [ROW_900, ROW_909], [ROW_909], [ROW_900, ROW_909], [ROW_909]];
    linkageQueryScript = [[], [L1], [L1], [L1], [], [L1]];
    joinedQueryScript = [joined(ROW_909), joined(ROW_909)];
    const res = await postShare("900", { channel: "email" });
    expect(res.statusCode).toBe(200);
    expect(emailCalls).toHaveLength(1);
    const mail = emailCalls[0] as Record<string, unknown>;
    expect(String(mail.html)).toContain("AMENDED SIGNED BODY");
    expect(String(mail.html)).toContain("AMENDED REPORT — Version 2 of 2");
    expect(mail.reportNumber).toBe("RPT-A1");
    expect((shares()[0].values as Record<string, unknown>).reportId).toBe(909);
  });

  test("sharing an unverified report stays rejected (409) — resolution never bypasses the status gate", async () => {
    plainReportQueryScript = [[ROW_915_DRAFT]];
    linkageQueryScript = [[L1_TO_DRAFT], [], [L1_TO_DRAFT]];
    joinedQueryScript = [joined(ROW_915_DRAFT)];
    const res = await postShare("915", { channel: "whatsapp" });
    expect(res.statusCode).toBe(409);
    expect(shares()).toHaveLength(0);
  });
});
