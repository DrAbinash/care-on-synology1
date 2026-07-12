import { describe, expect, test, vi, beforeEach } from "vitest";

// Ticket D9 route-integration coverage — verify-path hardening:
// legacy sign protection for structured-signed rows, structured countersign
// (session-only identity, distinctness, hash gate, superseded/corrupt-chain
// blocks, one transaction with the chain audit record), lifecycle metadata,
// and the recipient re-delivery prompt. Same FIFO-scripted harness family as
// the D7/D8 suites; canStructuredSign/Verify are REAL, auditLog is captured.

let flags: Record<string, boolean>;
let hashVerifyOk: boolean;
let failAuditInsert: boolean;
let signatureRows: Record<string, unknown>[];

let plainReportQueryScript: unknown[][];
let linkageQueryScript: unknown[][];
let joinedQueryScript: unknown[][];
let shareQueryScript: unknown[][];

interface WriteRecord { kind: "insert" | "update"; table: string; values: unknown }
/** Immediate (non-transactional) writes — legacy sign/verify use these. */
let allWrites: WriteRecord[];
/** Writes that COMMITTED through db.transaction — rollback tests assert emptiness. */
let committedWrites: WriteRecord[];

const TBL = {
  patientReports: { __name: "patient_reports", id: "id", patientId: "patient_id", status: "status", reportNumber: "report_number", signedByName: "signed_by_name", signedAt: "signed_at", createdAt: "created_at" },
  reportShares: { __name: "report_shares", reportId: "report_id", status: "status", createdAt: "created_at" },
  signatures: { __name: "signatures", id: "id" },
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
  auditLogs: { __name: "audit_logs", id: "id", chainHash: "chain_hash" },
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

function rowsFor(tbl: { __name?: string }, joined: boolean): unknown[] {
  const name = tbl?.__name ?? "";
  if (name === "patient_reports") {
    if (joined) return joinedQueryScript.length > 0 ? (joinedQueryScript.shift() as unknown[]) : [];
    return plainReportQueryScript.length > 0 ? (plainReportQueryScript.shift() as unknown[]) : [];
  }
  if (name === "patient_report_amendments") return linkageQueryScript.length > 0 ? (linkageQueryScript.shift() as unknown[]) : [];
  if (name === "report_shares") return shareQueryScript.length > 0 ? (shareQueryScript.shift() as unknown[]) : [];
  if (name === "signatures") return signatureRows;
  return [];
}

function makeSelectChain(tbl: { __name?: string }) {
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
}

vi.mock("@workspace/db", () => {
  const makeTx = () => {
    const staged: WriteRecord[] = [];
    const tx = {
      select: () => ({ from: (tbl: { __name?: string }) => makeSelectChain(tbl) }),
      execute: async () => ({ rows: [] }),
      insert: (tbl: { __name?: string }) => ({
        values: (v: unknown) => {
          if (tbl?.__name === "audit_logs" && failAuditInsert) {
            return {
              returning: async () => { throw new Error("simulated audit failure"); },
              then: (_r: unknown, reject: (e: unknown) => void) => reject(new Error("simulated audit failure")),
            };
          }
          staged.push({ kind: "insert", table: tbl?.__name ?? "?", values: v });
          return { returning: async () => [{ id: 1, ...(v as object) }], then: (r: (x: unknown) => void) => r(undefined) };
        },
      }),
      update: (tbl: { __name?: string }) => ({
        set: (v: unknown) => ({
          where: () => {
            staged.push({ kind: "update", table: tbl?.__name ?? "?", values: v });
            return {
              then: (r: (x: unknown) => void) => r(undefined),
              returning: async () => [{ id: 909, ...(v as object) }],
            };
          },
        }),
      }),
      __staged: staged,
    };
    return tx;
  };
  return {
    db: {
      execute: async () => [{ n: 0 }],
      select: () => ({ from: (tbl: { __name?: string }) => makeSelectChain(tbl) }),
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
            return { then: (r: (x: unknown) => void) => r(undefined), returning: async () => [{ id: 1, ...(v as object) }] };
          },
        }),
      }),
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = makeTx();
        const result = await fn(tx);
        committedWrites.push(...(tx as unknown as { __staged: WriteRecord[] }).__staged);
        return result;
      },
    },
  };
});

vi.mock("../lib/featureFlags", () => ({ isFeatureEnabledServer: async (key: string) => flags[key] ?? false }));
vi.mock("./whatsapp", () => ({ sendReportWhatsapp: async () => ({ ok: true }), sendReportDelivery: async () => ({ ok: true }) }));
vi.mock("../email", () => ({ sendReportEmail: async () => ({ ok: true }) }));
vi.mock("../lib/radiologyCatalog/drizzleStore", () => ({ DrizzleCatalogStore: class {} }));
vi.mock("../lib/structuredReport/catalogAccess", () => ({ DrizzleStructuredReportCatalogPort: class { constructor(..._a: unknown[]) {} } }));
vi.mock("../lib/radiologyStructuredRead", () => ({
  readStructuredReport: async (row: { body: string }) => ({
    body: row.body, usedStructured: false, comparisonClass: "NO_STRUCTURED_JSON",
    document: null, render: null,
    diagnostics: { comparisonClass: "NO_STRUCTURED_JSON", usedStructured: false, hashVerified: null, validationErrors: [], validationWarnings: [], rendererWarnings: [], divergentLines: [], renderMs: null, storedRenderEngineVersion: null, currentRendererVersion: "d4-structured-1.0.0", catalogVersion: null, fallbackReason: null },
  }),
}));
vi.mock("../lib/structuredReport/hash", () => ({
  verifyContentSha256: () => (hashVerifyOk ? { ok: true } : { ok: false, reason: "hash mismatch (simulated)" }),
}));

const auditLogCalls: Record<string, unknown>[] = [];
vi.mock("../lib/audit", () => ({
  auditLog: async (payload: Record<string, unknown>) => { auditLogCalls.push(payload); },
  canonicalHashPayload: (row: unknown) => JSON.stringify(row),
  computeChainHash: () => "stub-chain-hash",
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getRouteHandler(router: any, method: string, path: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layer = router.stack.find((l: any) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`${method.toUpperCase()} ${path} handler not found`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function makeRes() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = {
    statusCode: 200, body: undefined,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
    setHeader() { return this; },
    send(payload: unknown) { this.body = payload; return this; },
  };
  return res;
}

const SIGNER = { id: 1, subjectId: 8, subjectName: "Dr. Sen", role: "radiologist", permissions: ["/reports", "/reports:sign"], maxDiscount: null };
const VERIFIER = { id: 2, subjectId: 9, subjectName: "Dr. Verma", role: "radiologist", permissions: ["/reports", "/reports:verify"], maxDiscount: null };
const TYPIST = { id: 3, subjectId: 10, subjectName: "Tina Typist", role: "typist", permissions: ["/reports", "/reports:sign", "/reports:verify"], maxDiscount: null };
const NO_GRANT = { id: 4, subjectId: 11, subjectName: "Dr. NoGrant", role: "radiologist", permissions: ["/reports"], maxDiscount: null };

const ROOT_DOC = {
  kind: "radiology.structured_report",
  document_id: "0000000000000000000000GHJK",
  audit: { revision: 2, signature: { state: "final", signed_by: "Dr. Rao", signed_at: "2026-07-10T10:00:00Z", signed_content_sha256: "sha256:root" } },
};
const AMEND_DOC = {
  kind: "radiology.structured_report",
  document_id: "A000000000000000000000000T",
  audit: { revision: 3, signature: { state: "final", signed_by: "Dr. Sen", signed_at: "2026-07-11T09:00:00Z", signed_content_sha256: "sha256:amended", amends_document_id: ROOT_DOC.document_id } },
};

const T0 = new Date("2026-07-10T10:00:00Z");
const T1 = new Date("2026-07-11T09:00:00Z");

function row(overrides: Record<string, unknown>) {
  return {
    id: 900, reportNumber: "RPT-ROOT", type: "radiology", patientId: 12, testId: 3, studyId: 55,
    title: "MRI LS Spine — Report", body: "ROOT BODY", parameters: null, impression: "Disc herniation.",
    status: "draft", isCritical: false, criticalNote: null, signatureId: 5, signedByName: "Dr. Rao", signedAt: T0,
    verifiedBySignatureId: null, verifiedByName: null, verifiedAt: null, verifierNotes: null,
    deliveredAt: null, templateId: null, createdBy: "Dr. Rao", createdAt: T0, updatedAt: T0,
    structuredJson: ROOT_DOC, stylePresetUsed: null, publicToken: null, publicTokenExpiresAt: null,
    renderEngineVersion: "d4-structured-1.0.0", templateVersion: null, catalogVersion: "0",
    ...overrides,
  };
}

const ROW_ROOT_DRAFT = row({});
const ROW_ROOT_VERIFIED = row({ status: "verified", verifiedAt: T0, verifiedByName: "Dr. V" });
const ROW_AMEND_DRAFT = row({ id: 909, reportNumber: "RPT-A1", body: "AMENDED BODY", structuredJson: AMEND_DOC, signedByName: "Dr. Sen", signatureId: 6, signedAt: T1, createdAt: T1 });
const ROW_AMEND_VERIFIED = row({ id: 909, reportNumber: "RPT-A1", body: "AMENDED BODY", structuredJson: AMEND_DOC, signedByName: "Dr. Sen", signatureId: 6, signedAt: T1, createdAt: T1, status: "verified", verifiedAt: T1, verifiedByName: "Dr. Verma" });
const ROW_LEGACY_DRAFT = row({ id: 100, reportNumber: "RPT-LEG", type: "pathology", structuredJson: null, signedByName: null, signatureId: null, signedAt: null });
const ROW_LEGACY_PENDING = row({ id: 101, reportNumber: "RPT-LEG2", type: "pathology", structuredJson: null, status: "pending_verification", signedByName: "Dr. A", signatureId: 7 });

const L1 = {
  sequenceNumber: 1, originalReportId: 900, amendedReportId: 909, rootReportId: 900,
  originalDocumentId: ROOT_DOC.document_id, amendedDocumentId: AMEND_DOC.document_id,
  reason: "laterality corrected", amendedByName: "Dr. Sen", createdAt: T1,
};
const L2 = {
  sequenceNumber: 2, originalReportId: 909, amendedReportId: 915, rootReportId: 900,
  originalDocumentId: AMEND_DOC.document_id, amendedDocumentId: "A000000000000000000000000W",
  reason: "measurement corrected", amendedByName: "Dr. Rao", createdAt: new Date("2026-07-12T09:00:00Z"),
};
const ROW_TIP_DEEP = row({ id: 915, reportNumber: "RPT-A2", structuredJson: { ...AMEND_DOC, document_id: "A000000000000000000000000W", audit: { revision: 4, signature: { ...AMEND_DOC.audit.signature, signed_by: "Dr. Rao", amends_document_id: AMEND_DOC.document_id } } }, signedByName: "Dr. Rao", signatureId: 5 });

async function post(path: "/:id/sign" | "/:id/verify", id: string, body: Record<string, unknown>, staffSession: unknown) {
  const { patientReportsRouter } = await import("./patient-reports");
  const handler = getRouteHandler(patientReportsRouter, "post", path);
  const req = { params: { id }, body, query: {}, headers: {}, staffSession, log: { error: () => undefined, warn: () => undefined } };
  const res = makeRes();
  await handler(req, res);
  return res;
}

async function getById(id: string, query: Record<string, string> = {}) {
  const { patientReportsRouter } = await import("./patient-reports");
  const handler = getRouteHandler(patientReportsRouter, "get", "/:id");
  const req = { params: { id }, query, headers: {}, log: { error: () => undefined } };
  const res = makeRes();
  await handler(req, res);
  return res;
}

function joined(r: Record<string, unknown>) {
  return [{
    r,
    patientFirstName: "Asha", patientLastName: "P", patientCode: "PAT-1",
    patientPhone: "9999999999", patientEmail: "a@x.test", patientGender: "F", patientDob: null,
    testName: "MRI LS Spine", testCode: "MRI1",
  }];
}

const audits = (action: string) => auditLogCalls.filter((a) => a.action === action);

beforeEach(() => {
  flags = { ff_radiology_structured_final: true };
  hashVerifyOk = true;
  failAuditInsert = false;
  signatureRows = [];
  plainReportQueryScript = [];
  linkageQueryScript = [];
  joinedQueryScript = [];
  shareQueryScript = [];
  allWrites = [];
  committedWrites = [];
  auditLogCalls.length = 0;
});

// ── POST /:id/sign — legacy-sign protection (Phase 2) ────────────────────────

describe("D9 — legacy sign protection", () => {
  test("legacy UNSTRUCTURED report sign is unchanged (client-supplied name still honored)", async () => {
    plainReportQueryScript = [[ROW_LEGACY_DRAFT]];
    const res = await post("/:id/sign", "100", { signedByName: "Dr. Legacy" }, SIGNER);
    expect(res.statusCode).toBe(200);
    const update = allWrites.find((w) => w.kind === "update" && w.table === "patient_reports");
    expect(update).toBeTruthy();
    expect(update!.values).toMatchObject({ signedByName: "Dr. Legacy", status: "pending_verification" });
    expect(audits("legacy_sign_rejected")).toHaveLength(0);
  });

  test("structured-signed report → 409, row never written, refusal audited", async () => {
    plainReportQueryScript = [[ROW_AMEND_DRAFT]];
    const res = await post("/:id/sign", "909", { signedByName: "Dr. Clobber", signatureId: 1 }, SIGNER);
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe("structured_signed_report");
    expect(res.body.message).toContain("verify");
    expect(allWrites.filter((w) => w.table === "patient_reports")).toHaveLength(0);
    const rejected = audits("legacy_sign_rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0].entityId).toBe(AMEND_DOC.document_id);
    expect(rejected[0].reason).toBe("structured_signed_report");
  });

  test("typist can never sign — even a legacy report (defense in depth), audited", async () => {
    const res = await post("/:id/sign", "100", { signedByName: "Tina" }, TYPIST);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe("role_cannot_sign");
    expect(allWrites).toHaveLength(0);
    expect(audits("legacy_sign_rejected")[0].reason).toBe("role_cannot_sign:typist");
  });
});

// ── POST /:id/verify — structured countersign (Phase 3) ──────────────────────

describe("D9 — structured countersign happy path", () => {
  function successScripts(target = ROW_AMEND_DRAFT) {
    plainReportQueryScript = [[target], [target], [ROW_ROOT_VERIFIED, target], [target]];
    linkageQueryScript = [[L1], [], [L1], []];
  }

  test("authorized distinct verifier succeeds; row update + chain audit commit together", async () => {
    successScripts();
    const res = await post("/:id/verify", "909", { verifierNotes: "checked against images" }, VERIFIER);
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe("verified");
    expect(res.body.structuredVerify).toMatchObject({
      documentId: AMEND_DOC.document_id, revision: 3, contentSha256Verified: true, verifiedBy: "Dr. Verma",
    });

    const update = committedWrites.find((w) => w.kind === "update" && w.table === "patient_reports");
    expect(update).toBeTruthy();
    expect(update!.values).toMatchObject({ verifiedByName: "Dr. Verma", status: "verified", verifierNotes: "checked against images" });
    // The signed structured document is NEVER touched by verification.
    expect(Object.keys(update!.values as object)).not.toContain("structuredJson");
    expect(Object.keys(update!.values as object)).not.toContain("body");
    expect(Object.keys(update!.values as object)).not.toContain("signedByName");

    // Hash-chained success record in the SAME transaction.
    const audit = committedWrites.find((w) => w.kind === "insert" && w.table === "audit_logs");
    expect(audit).toBeTruthy();
    const a = audit!.values as Record<string, unknown>;
    expect(a.action).toBe("verify");
    expect(a.entityId).toBe(AMEND_DOC.document_id);
    expect(String(a.newValue)).toContain('"verified_by":"Dr. Verma"');
    expect(String(a.newValue)).toContain('"root_report_id":900');
    expect(String(a.newValue)).toContain('"sequence_number":2');
    // Attempt was audited (fire-and-forget channel).
    expect(audits("verify_attempt")).toHaveLength(1);
  });

  test("client-supplied verifier identity is IGNORED — session name is stamped", async () => {
    successScripts();
    await post("/:id/verify", "909", { verifiedByName: "Dr. Spoofed", signatureId: null }, VERIFIER);
    const update = committedWrites.find((w) => w.kind === "update");
    expect((update!.values as Record<string, unknown>).verifiedByName).toBe("Dr. Verma");
  });

  test("ROOT report verification works the same way (no chain)", async () => {
    plainReportQueryScript = [[ROW_ROOT_DRAFT], [ROW_ROOT_DRAFT], [ROW_ROOT_DRAFT]];
    linkageQueryScript = [[], [], []];
    const res = await post("/:id/verify", "900", {}, VERIFIER);
    expect(res.statusCode).toBe(200);
    const a = committedWrites.find((w) => w.table === "audit_logs")!.values as Record<string, unknown>;
    expect(String(a.newValue)).toContain('"sequence_number":1');
  });

  test("deep chain: the TIP of a multi-amendment chain verifies with its true sequence number", async () => {
    plainReportQueryScript = [[ROW_TIP_DEEP], [ROW_TIP_DEEP], [ROW_ROOT_VERIFIED, ROW_AMEND_VERIFIED, ROW_TIP_DEEP], [ROW_TIP_DEEP]];
    linkageQueryScript = [[L2], [], [L1, L2], []];
    const res = await post("/:id/verify", "915", {}, VERIFIER);
    expect(res.statusCode).toBe(200);
    const a = committedWrites.find((w) => w.table === "audit_logs")!.values as Record<string, unknown>;
    expect(String(a.newValue)).toContain('"sequence_number":3');
  });
});

describe("D9 — structured countersign rejections (all audited, nothing written)", () => {
  test("typist denied even with grants", async () => {
    plainReportQueryScript = [[ROW_AMEND_DRAFT]];
    const res = await post("/:id/verify", "909", {}, TYPIST);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe("verify_authority_required");
    expect(committedWrites).toHaveLength(0);
    expect(audits("verify_rejected")[0].reason).toBe("role_cannot_verify:typist");
  });

  test("verifier without verify/sign grant denied", async () => {
    plainReportQueryScript = [[ROW_AMEND_DRAFT]];
    const res = await post("/:id/verify", "909", {}, NO_GRANT);
    expect(res.statusCode).toBe(403);
    expect(audits("verify_rejected")[0].reason).toContain("missing_verify_permission");
  });

  test("signer cannot verify their own report (session vs row + document signer)", async () => {
    plainReportQueryScript = [[ROW_AMEND_DRAFT]];
    const res = await post("/:id/verify", "909", {}, SIGNER); // Dr. Sen signed 909
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe("verifier_must_differ");
    expect(committedWrites).toHaveLength(0);
    expect(audits("verify_rejected")[0].reason).toBe("verifier_must_differ_from_signer");
  });

  test("verifier signature id matching the signer's is refused", async () => {
    plainReportQueryScript = [[ROW_AMEND_DRAFT], [ROW_AMEND_DRAFT], [ROW_ROOT_VERIFIED, ROW_AMEND_DRAFT]];
    linkageQueryScript = [[L1], [], [L1]];
    signatureRows = [{ id: 6, name: "Dr. Sen" }];
    const res = await post("/:id/verify", "909", { signatureId: 6 }, VERIFIER);
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe("verifier_must_differ");
    expect(audits("verify_rejected")[0].reason).toBe("verifier_signature_matches_signer");
  });

  test("hash failure blocks verification outright", async () => {
    hashVerifyOk = false;
    plainReportQueryScript = [[ROW_AMEND_DRAFT]];
    const res = await post("/:id/verify", "909", {}, VERIFIER);
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe("structured_hash_verification_failed");
    expect(committedWrites).toHaveLength(0);
    expect(audits("verify_rejected")[0].reason).toBe("content_hash_verification_failed");
  });

  test("superseded historical version cannot be verified", async () => {
    plainReportQueryScript = [[ROW_ROOT_DRAFT], [ROW_ROOT_DRAFT], [ROW_ROOT_DRAFT, ROW_AMEND_DRAFT]];
    linkageQueryScript = [[], [L1], [L1]];
    const res = await post("/:id/verify", "900", {}, VERIFIER);
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe("superseded_version_cannot_be_verified");
    expect(res.body.latestReportId).toBe(909);
    expect(committedWrites).toHaveLength(0);
    expect(audits("verify_rejected")[0].reason).toBe("superseded_version_cannot_be_verified");
  });

  test("MIDDLE of a deep chain is refused the same way", async () => {
    plainReportQueryScript = [[ROW_AMEND_DRAFT], [ROW_AMEND_DRAFT], [ROW_ROOT_VERIFIED, ROW_AMEND_DRAFT, ROW_TIP_DEEP]];
    linkageQueryScript = [[L1], [L2], [L1, L2]];
    const res = await post("/:id/verify", "909", {}, VERIFIER);
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe("superseded_version_cannot_be_verified");
  });

  test("corrupt chain blocks verification", async () => {
    plainReportQueryScript = [[ROW_ROOT_DRAFT], [ROW_ROOT_DRAFT], [ROW_ROOT_DRAFT]]; // 909 row missing
    linkageQueryScript = [[], [L1], [L1]];
    const res = await post("/:id/verify", "900", {}, VERIFIER);
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe("chain_integrity_warning");
    expect(audits("verify_rejected")[0].reason).toBe("chain_integrity_warning");
  });

  test("transaction rollback: audit-chain failure discards the row update too", async () => {
    failAuditInsert = true;
    plainReportQueryScript = [[ROW_AMEND_DRAFT], [ROW_AMEND_DRAFT], [ROW_ROOT_VERIFIED, ROW_AMEND_DRAFT], [ROW_AMEND_DRAFT]];
    linkageQueryScript = [[L1], [], [L1], []];
    const res = await post("/:id/verify", "909", {}, VERIFIER);
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe("verify_transaction_failed");
    expect(committedWrites).toHaveLength(0); // update rolled back with the audit insert
    expect(audits("verify_rejected")[0].reason).toBe("verify_transaction_failed");
  });

  test("flag OFF: structured row falls through to the exact pre-D9 legacy guard", async () => {
    flags.ff_radiology_structured_final = false;
    plainReportQueryScript = [[ROW_AMEND_DRAFT]];
    const res = await post("/:id/verify", "909", {}, VERIFIER);
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe("Sign the report first before verifying");
    expect(committedWrites).toHaveLength(0);
    expect(audits("verify_attempt")).toHaveLength(0); // structured path never entered
  });

  test("legacy pending_verification report verifies exactly as before (old report compatibility)", async () => {
    plainReportQueryScript = [[ROW_LEGACY_PENDING]];
    const res = await post("/:id/verify", "101", { verifiedByName: "Dr. B" }, VERIFIER);
    expect(res.statusCode).toBe(200);
    const update = allWrites.find((w) => w.kind === "update" && w.table === "patient_reports");
    expect(update!.values).toMatchObject({ verifiedByName: "Dr. B", status: "verified" }); // legacy path: client name honored
    expect(audits("verify_attempt")).toHaveLength(0);
  });
});

// ── GET /:id lifecycle metadata (Phases 4 & 6) ───────────────────────────────

describe("D9 — lifecycle metadata and re-delivery prompt", () => {
  test("amendment pending verification", async () => {
    plainReportQueryScript = [[ROW_AMEND_DRAFT], [ROW_ROOT_VERIFIED, ROW_AMEND_DRAFT]];
    linkageQueryScript = [[L1], [], [L1]];
    joinedQueryScript = [joined(ROW_AMEND_DRAFT)];
    const res = await getById("909");
    expect(res.body.lifecycle).toMatchObject({
      state: "pending_verification",
      structuredSigned: true,
      amendmentPendingVerification: true,
      deliverable: false,
      superseded: false,
      latestVersion: true,
      recipientNotificationPending: false,
    });
  });

  test("verified amendment becomes deliverable; prior WhatsApp delivery detected → re-delivery prompt (masked recipient)", async () => {
    plainReportQueryScript = [[ROW_AMEND_VERIFIED], [ROW_ROOT_VERIFIED, ROW_AMEND_VERIFIED]];
    linkageQueryScript = [[L1], [], [L1]];
    joinedQueryScript = [joined(ROW_AMEND_VERIFIED)];
    shareQueryScript = [
      [], // response `shares` list for the served row
      [{ id: 1, reportId: 900, channel: "whatsapp", recipient: "9876543210", sharedBy: "Dr. Rao", status: "sent", errorMessage: null, createdAt: T0 }],
    ];
    const res = await getById("909");
    expect(res.body.lifecycle).toMatchObject({
      state: "verified", deliverable: true, verifiedBy: "Dr. Verma", recipientNotificationPending: true,
    });
    expect(res.body.lifecycle.priorDeliveries).toEqual([
      { channel: "whatsapp", recipient: "98******10", reportId: 900, at: T0.toISOString() },
    ]);
  });

  test("prior EMAIL delivery detected and masked; duplicates deduped by channel+recipient", async () => {
    plainReportQueryScript = [[ROW_AMEND_VERIFIED], [ROW_ROOT_VERIFIED, ROW_AMEND_VERIFIED]];
    linkageQueryScript = [[L1], [], [L1]];
    joinedQueryScript = [joined(ROW_AMEND_VERIFIED)];
    shareQueryScript = [
      [],
      [
        { id: 1, reportId: 900, channel: "email", recipient: "asha@example.com", status: "sent", createdAt: T0 },
        { id: 2, reportId: 900, channel: "email", recipient: "asha@example.com", status: "sent", createdAt: T0 },
      ],
    ];
    const res = await getById("909");
    expect(res.body.lifecycle.priorDeliveries).toHaveLength(1);
    expect(res.body.lifecycle.priorDeliveries[0]).toMatchObject({ channel: "email", recipient: "a***@example.com" });
  });

  test("no duplicate prompt: a sent share on the LATEST version marks re-delivery complete", async () => {
    plainReportQueryScript = [[ROW_AMEND_VERIFIED], [ROW_ROOT_VERIFIED, ROW_AMEND_VERIFIED]];
    linkageQueryScript = [[L1], [], [L1]];
    joinedQueryScript = [joined(ROW_AMEND_VERIFIED)];
    shareQueryScript = [
      [],
      [
        { id: 1, reportId: 900, channel: "whatsapp", recipient: "9876543210", status: "sent", createdAt: T0 },
        { id: 2, reportId: 909, channel: "whatsapp", recipient: "9876543210", status: "sent", createdAt: T1 },
      ],
    ];
    const res = await getById("909");
    expect(res.body.lifecycle.recipientNotificationPending).toBe(false);
    expect(res.body.lifecycle.priorDeliveries).toHaveLength(1); // still listed for context
  });

  test("superseded historical version reads as superseded + not deliverable-as-current; D8 banner metadata intact", async () => {
    plainReportQueryScript = [[ROW_ROOT_VERIFIED], [ROW_ROOT_VERIFIED, ROW_AMEND_VERIFIED]];
    linkageQueryScript = [[], [L1], [L1]];
    joinedQueryScript = [joined(ROW_ROOT_VERIFIED)];
    const res = await getById("900", { version: "specific" });
    expect(res.body.lifecycle).toMatchObject({ state: "superseded", superseded: true, latestVersion: false, recipientNotificationPending: false });
    expect(res.body.version.superseded).toBe(true); // D8 metadata untouched
  });

  test("legacy unstructured report lifecycle stays plain and GET performs no writes", async () => {
    plainReportQueryScript = [[ROW_LEGACY_DRAFT]];
    linkageQueryScript = [[], []];
    joinedQueryScript = [joined(ROW_LEGACY_DRAFT)];
    const res = await getById("100");
    expect(res.body.lifecycle).toMatchObject({ state: "draft", structuredSigned: false, amendmentPendingVerification: false });
    expect(allWrites).toHaveLength(0);
    expect(committedWrites).toHaveLength(0);
    expect(auditLogCalls).toHaveLength(0);
  });
});
