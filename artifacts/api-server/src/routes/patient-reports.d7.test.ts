import { describe, expect, test, vi, beforeEach } from "vitest";

// Ticket D7 route-integration coverage — POST /:id/amend (single transaction,
// no partial amendments, parent row never written) and the GET /:id amendment
// chain read path (history traversal, ?resolve=latest). The pure amendment
// logic (prepareStructuredAmendment) is proven in
// radiologyD1AmendmentWriter.test.ts and is mocked here so each route decision
// path is driven precisely. canStructuredSign is REAL (authority through the
// route). Same staged-vs-committed transaction harness as the D5 tests, so
// rollback is asserted, not assumed.

let flags: Record<string, boolean>;
let prepareResult: unknown;
let prepareCalls: unknown[];
let authoritativeValidationOk: boolean;

let parentRow: Record<string, unknown> | null;
let draftRow: Record<string, unknown> | null;
/** Ports the route handed to readStructuredReport — lets tests drive the
 *  real R14c amendsLookup closure applyStructuredRead builds (D7 read side). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let capturedReadPorts: any;
let instanceRows: Record<string, unknown>[];
/** FIFO script of result-sets for patient_report_amendments SELECTs (the
 *  handler's linkage queries run in a deterministic order). */
let linkageQueryScript: unknown[][];
/** FIFO script for JOINED patient_reports selects (GET /:id). */
let joinedQueryScript: unknown[][];
/** FIFO script for PLAIN patient_reports selects (D8 resolver + helpers);
 *  empty → default [parentRow]. */
let plainReportQueryScript: unknown[][];
let failLinkageInsert: boolean;

interface WriteRecord { table: string; kind: "insert" | "update"; values: unknown }
let committedWrites: WriteRecord[];

const TBL = {
  patientReports: { __name: "patient_reports", id: "id" },
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
  drafts: { __name: "radiology_report_drafts", id: "id", studyId: "study_id", updatedAt: "updated_at" },
  worklist: { __name: "radiology_worklist", id: "id" },
  rfi: { __name: "report_finding_instances", id: "id", draftId: "draft_id" },
  quickFindings: { __name: "radiology_quick_findings", id: "id", label: "label" },
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

function makeSelect(tbl: { __name?: string }, staged?: WriteRecord[]) {
  const name = tbl?.__name ?? "";
  const rowsFor = (joined: boolean): unknown[] => {
    if (name === "patient_reports") {
      if (joined) return joinedQueryScript.length > 0 ? (joinedQueryScript.shift() as unknown[]) : [];
      if (plainReportQueryScript.length > 0) return plainReportQueryScript.shift() as unknown[];
      return parentRow ? [parentRow] : [];
    }
    if (name === "patient_report_amendments") {
      return linkageQueryScript.length > 0 ? (linkageQueryScript.shift() as unknown[]) : [];
    }
    if (name === "radiology_report_drafts") return draftRow ? [draftRow] : [];
    if (name === "report_finding_instances") return instanceRows;
    if (name === "radiology_worklist") return [];
    if (name === "audit_logs") return [];
    return [];
  };
  const thenable = (joined: boolean) => ({
    then: (resolve: (v: unknown) => void) => resolve(rowsFor(joined)),
    limit: async () => rowsFor(joined),
    orderBy: () => ({
      then: (resolve: (v: unknown) => void) => resolve(rowsFor(joined)),
      limit: async () => rowsFor(joined),
    }),
  });
  return {
    where: () => thenable(false),
    limit: async () => rowsFor(false),
    orderBy: () => ({ limit: async () => rowsFor(false), then: (r: (v: unknown) => void) => r(rowsFor(false)) }),
    leftJoin: function lj() { return { leftJoin: lj, where: () => thenable(true) }; },
  };
}

vi.mock("@workspace/db", () => {
  const makeTx = () => {
    const staged: WriteRecord[] = [];
    let nextvalCount = 0;
    const tx = {
      select: () => ({ from: (tbl: { __name?: string }) => makeSelect(tbl, staged) }),
      execute: async (query: unknown) => {
        const text = JSON.stringify(query);
        if (/nextval/.test(text)) {
          nextvalCount++;
          return { rows: [{ id: nextvalCount === 1 ? 909 : 5050 }] }; // report id, then audit id
        }
        return { rows: [] };
      },
      insert: (tbl: { __name?: string }) => ({
        values: (v: unknown) => {
          if (tbl?.__name === "patient_report_amendments" && failLinkageInsert) {
            return {
              returning: async () => { throw new Error("duplicate key value violates unique constraint"); },
              then: (_r: unknown, reject: (e: unknown) => void) => reject(new Error("duplicate key value violates unique constraint")),
            };
          }
          staged.push({ table: tbl?.__name ?? "?", kind: "insert", values: v });
          const row = { ...(typeof v === "object" && !Array.isArray(v) ? (v as object) : {}) };
          return { returning: async () => [row], then: (resolve: (x: unknown) => void) => resolve(undefined) };
        },
      }),
      update: (tbl: { __name?: string }) => ({
        set: (v: unknown) => ({ where: async () => { staged.push({ table: tbl?.__name ?? "?", kind: "update", values: v }); } }),
      }),
      __staged: staged,
    };
    return tx;
  };
  return {
    db: {
      execute: async () => [{ n: 0 }], // nextReportNumber
      select: () => ({ from: (tbl: { __name?: string }) => makeSelect(tbl) }),
      insert: () => ({ values: (v: unknown) => ({ returning: async () => [{ id: 101, ...(v as object) }] }) }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
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
  readStructuredReport: async (row: { body: string }, ports: unknown) => ((capturedReadPorts = ports), {
    body: row.body, usedStructured: false, comparisonClass: "NO_STRUCTURED_JSON",
    document: null, render: null,
    diagnostics: { comparisonClass: "NO_STRUCTURED_JSON", usedStructured: false, hashVerified: null, validationErrors: [], validationWarnings: [], rendererWarnings: [], divergentLines: [], renderMs: null, storedRenderEngineVersion: null, currentRendererVersion: "d4-structured-1.0.0", catalogVersion: null, fallbackReason: null },
  }),
}));

vi.mock("../lib/radiologyD1AmendmentWriter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/radiologyD1AmendmentWriter")>();
  return {
    ...actual,
    prepareStructuredAmendment: async (input: unknown) => {
      prepareCalls.push(input);
      return prepareResult;
    },
  };
});

vi.mock("../lib/structuredReport/validator", () => ({
  validateStructuredReport: async () =>
    authoritativeValidationOk
      ? { ok: true, errors: [], warnings: [] }
      : { ok: false, errors: [{ rule: "R14c", severity: "error", path: "$", message: "simulated" }], warnings: [] },
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
    statusCode: 200, body: undefined,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
  return res;
}

const RADIOLOGIST = { id: 1, subjectId: 7, subjectName: "Dr. Sen", role: "radiologist", permissions: ["/reports", "/reports:sign"], maxDiscount: null };
const TYPIST = { ...RADIOLOGIST, subjectName: "Tina Typist", role: "typist" };

const PARENT_DOC = {
  kind: "radiology.structured_report",
  document_id: "0000000000000000000000GHJK",
  audit: { revision: 2, signature: { state: "final", signed_content_sha256: "sha256:root" } },
};

const AMENDED_DOC = {
  kind: "radiology.structured_report",
  document_id: "A000000000000000000000000T",
  audit: { revision: 3, signature: { state: "final", amends_document_id: PARENT_DOC.document_id, signed_content_sha256: "sha256:amended" } },
};

function okPrepare() {
  return {
    ok: true,
    document: AMENDED_DOC,
    contentSha256: "sha256:amended",
    renderedBody: "FINDINGS:\nCorrected finding.\n\nIMPRESSION:\n1. Corrected impression.",
    render: {},
    legacyShape: { impression: ["Corrected impression."], findingsSections: {}, recommendation: "", technique: "", formattedReportText: "" },
    equivalence: { verdict: "equivalent", differences: [], staleDraft: false },
    validation: { ok: true, errors: [], warnings: [] },
    amendment: {
      amendsDocumentId: PARENT_DOC.document_id, amendsReportId: 900,
      rootDocumentId: PARENT_DOC.document_id, rootReportId: 900,
      sequenceNumber: 1, reason: "laterality corrected", revision: 3,
    },
  };
}

async function postAmend(body: Record<string, unknown>, staffSession: unknown = RADIOLOGIST, id = "900") {
  const { patientReportsRouter } = await import("./patient-reports");
  const handler = getRouteHandler(patientReportsRouter, "post", "/:id/amend");
  const req = { params: { id }, body, staffSession, headers: {}, ip: "10.0.0.9", socket: {}, log: { error: () => undefined, warn: () => undefined } };
  const res = makeRes();
  await handler(req, res);
  return res;
}

async function getById(id = "900", query: Record<string, string> = {}) {
  const { patientReportsRouter } = await import("./patient-reports");
  const handler = getRouteHandler(patientReportsRouter, "get", "/:id");
  const req = { params: { id }, query, headers: {}, log: { error: () => undefined } };
  const res = makeRes();
  await handler(req, res);
  return res;
}

const committed = (table: string) => committedWrites.filter((w) => w.table === table);

beforeEach(() => {
  flags = { ff_radiology_structured_final: true, ff_radiology_catalog: false };
  prepareResult = okPrepare();
  prepareCalls = [];
  authoritativeValidationOk = true;
  parentRow = {
    id: 900, reportNumber: "RPT-ROOT", type: "radiology", patientId: 12, testId: 3, studyId: 55,
    orderTestId: null, orderId: null, billId: null, title: "MRI LS Spine — Report",
    body: "ROOT SIGNED BODY", parameters: null, impression: "Disc herniation.",
    status: "draft", isCritical: false, criticalNote: null, stylePresetUsed: null,
    templateId: null, structuredJson: PARENT_DOC, createdBy: "Dr. Rao", signedByName: "Dr. Rao",
  };
  draftRow = {
    id: 700, studyId: 55, worklistId: null, patientId: 12, templateId: "MRI_LS_SPINE",
    modality: "MRI", studyName: "MRI LS Spine", rawFindings: "Corrected finding.",
    impression: '["Corrected impression."]', recommendation: null,
    createdBy: "Dr. Rao", createdAt: new Date("2026-07-10T09:00:00Z"), updatedAt: new Date("2026-07-11T09:00:00Z"),
  };
  instanceRows = [{ id: 1, draftId: 700, findingId: 1, anatomicZoneId: null, structureId: null, category: "", modality: "MRI", structuredJson: { side: "right" }, catalogVersion: "0", source: "quickselect", confirmed: false, confirmedBy: null, confirmedAt: null }];
  linkageQueryScript = [[], []]; // amend tx default: not-already-amended, parent-not-an-amendment
  joinedQueryScript = [];
  plainReportQueryScript = [];
  failLinkageInsert = false;
  committedWrites = [];
  capturedReadPorts = undefined;
});

// ── POST /:id/amend ──────────────────────────────────────────────────────────

describe("D7 — POST /:id/amend happy path", () => {
  test("creates the NEW signed row + snapshot + linkage atomically; parent row never written", async () => {
    const res = await postAmend({ reason: "laterality corrected" });
    expect(res.statusCode).toBe(201);
    expect(res.body.report).toBeTruthy();
    expect(res.body.amendment.amendedReportId).toBe(909); // reserved id
    expect(res.body.amendment.sequenceNumber).toBe(1);

    // new patient_reports row inserted at the reserved id with the amendment doc
    const inserts = committed("patient_reports");
    expect(inserts).toHaveLength(1);
    const v = inserts[0].values as Record<string, unknown>;
    expect(v.id).toBe(909);
    expect(v.structuredJson).toBe(AMENDED_DOC);
    expect(v.body).toContain("Corrected finding.");
    expect(v.createdBy).toBe("Dr. Sen");     // session-derived signer
    expect(v.signedByName).toBe("Dr. Sen");
    expect(v.renderEngineVersion).toBe("d4-structured-1.0.0");
    expect(v.patientId).toBe(12);             // carried from the parent

    // finalize audit row at the reserved audit id, carrying the amendment linkage + reason
    const audits = committed("audit_logs");
    expect(audits).toHaveLength(1);
    const a = audits[0].values as Record<string, unknown>;
    expect(a.id).toBe(5050);
    expect(a.action).toBe("finalize");
    expect(a.reason).toBe("laterality corrected");
    expect(String(a.newValue)).toContain(AMENDED_DOC.document_id);
    expect(String(a.newValue)).toContain(PARENT_DOC.document_id);

    // finding-instance snapshot for the NEW report
    const snaps = committed("report_finding_instances");
    expect(snaps).toHaveLength(1);
    const rows = snaps[0].values as Array<Record<string, unknown>>;
    expect(rows[0].reportId).toBe(909);
    expect(rows[0].draftId).toBeNull();

    // linkage row (linear chain)
    const links = committed("patient_report_amendments");
    expect(links).toHaveLength(1);
    const l = links[0].values as Record<string, unknown>;
    expect(l).toMatchObject({
      originalReportId: 900, amendedReportId: 909, rootReportId: 900,
      originalDocumentId: PARENT_DOC.document_id, amendedDocumentId: AMENDED_DOC.document_id,
      sequenceNumber: 1, reason: "laterality corrected", amendedByName: "Dr. Sen",
    });

    // draft promoted to the newest version; PARENT patient_reports row untouched
    const draftUpdates = committed("radiology_report_drafts");
    expect(draftUpdates).toHaveLength(1);
    expect((draftUpdates[0].values as Record<string, unknown>).finalReportId).toBe(909);
    expect(committedWrites.filter((w) => w.table === "patient_reports" && w.kind === "update")).toHaveLength(0);
  });

  test("prepare receives parent identity, reserved id, session sign context, and the mandatory reason", async () => {
    await postAmend({ reason: "laterality corrected" });
    expect(prepareCalls).toHaveLength(1);
    const input = prepareCalls[0] as Record<string, any>;
    expect(input.parent).toMatchObject({ reportId: 900, patientId: 12, priorAmendmentCount: 0 });
    expect(input.newReportId).toBe(909);
    expect(input.reason).toBe("laterality corrected");
    expect(input.sign.signedBy).toBe("Dr. Sen");
    expect(input.sign.auditLogRef).toBe(5050);
    expect(input.draftPatientId).toBe(12);
  });

  test("prepare's amendsLookup resolves the parent as signed-final (R14c must pass inside prepare)", async () => {
    await postAmend({ reason: "laterality corrected" });
    const input = prepareCalls[0] as Record<string, any>;
    // The amendment document ALWAYS names the parent as its prior — a lookup
    // that cannot resolve it would make R14c reject every real amendment.
    await expect(input.validationPorts.amendsLookup(PARENT_DOC.document_id)).resolves.toEqual({
      state: "final",
      alreadyAmendedBy: null,
    });
    await expect(input.validationPorts.amendsLookup("0000000000000000000000ZZZZ")).resolves.toBeNull();
  });
});

describe("D7 — POST /:id/amend guards & rollback (no partial amendments)", () => {
  test("missing reason → 400, nothing runs", async () => {
    const res = await postAmend({});
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("amendment_reason_required");
    expect(committedWrites).toHaveLength(0);
    expect(prepareCalls).toHaveLength(0);
  });

  test("flag OFF → 409, nothing runs", async () => {
    flags.ff_radiology_structured_final = false;
    const res = await postAmend({ reason: "r" });
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe("structured_final_flag_disabled");
    expect(committedWrites).toHaveLength(0);
  });

  test("typist → 403 (sign authority required to amend)", async () => {
    const res = await postAmend({ reason: "r" }, TYPIST);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe("sign_authority_required");
    expect(committedWrites).toHaveLength(0);
  });

  test("report not found → 404", async () => {
    parentRow = null;
    const res = await postAmend({ reason: "r" });
    expect(res.statusCode).toBe(404);
    expect(committedWrites).toHaveLength(0);
  });

  test("parent without a signed structured document → 409 (missing parent semantics)", async () => {
    parentRow = { ...parentRow!, structuredJson: null };
    const res = await postAmend({ reason: "r" });
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe("not_a_signed_structured_report");
    expect(committedWrites).toHaveLength(0);
  });

  test("already-amended parent → 409, rollback (linear chain)", async () => {
    linkageQueryScript = [[{ amendedReportId: 905 }]];
    const res = await postAmend({ reason: "r" });
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe("already_amended");
    expect(committedWrites).toHaveLength(0);
  });

  test("prepare failure (e.g. tampered parent) → 409, rollback", async () => {
    prepareResult = { ok: false, stage: "invalid_parent", detail: "parent content_sha256 does not verify — refusing to amend a tampered document" };
    const res = await postAmend({ reason: "r" });
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe("amendment_invalid_parent");
    expect(committedWrites).toHaveLength(0);
  });

  test("clinical divergence → 409, rollback (never signs divergent content)", async () => {
    prepareResult = { ...okPrepare(), equivalence: { verdict: "clinical_divergence", differences: [{ section: "findings", draft: ["a"], d4: ["b"] }], staleDraft: false } };
    const res = await postAmend({ reason: "r" });
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe("amendment_clinical_divergence");
    expect(committedWrites).toHaveLength(0);
  });

  test("authoritative validation failure AFTER the audit insert → full rollback (audit row discarded)", async () => {
    authoritativeValidationOk = false;
    const res = await postAmend({ reason: "r" });
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe("amendment_d1_validation_failed");
    expect(committedWrites).toHaveLength(0); // audit row rolled back with everything else
  });

  test("concurrent double-amend (UNIQUE constraint fires on linkage insert) → 409 already_amended, full rollback", async () => {
    failLinkageInsert = true;
    const res = await postAmend({ reason: "r" });
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe("already_amended");
    expect(committedWrites).toHaveLength(0); // report + snapshot + audit all rolled back
  });
});

// ── GET /:id amendment chain (Phase 4) ───────────────────────────────────────

const LINK_1 = {
  sequenceNumber: 1, originalReportId: 900, amendedReportId: 909,
  rootReportId: 900, originalDocumentId: PARENT_DOC.document_id, amendedDocumentId: AMENDED_DOC.document_id,
  reason: "laterality corrected", amendedByName: "Dr. Sen", createdAt: new Date("2026-07-11T09:00:00Z"),
};
const LINK_2 = {
  sequenceNumber: 2, originalReportId: 909, amendedReportId: 915,
  rootReportId: 900, originalDocumentId: AMENDED_DOC.document_id, amendedDocumentId: "A000000000000000000000000W",
  reason: "measurement corrected", amendedByName: "Dr. Rao", createdAt: new Date("2026-07-12T09:00:00Z"),
};

function joinedRowFor(id: number) {
  return [{
    r: { ...parentRow!, id },
    patientFirstName: "Asha", patientLastName: "P", patientCode: "PAT-1",
    patientPhone: "9", patientEmail: "a@x", patientGender: "F", patientDob: null,
    testName: "MRI LS Spine", testCode: "MRI1",
  }];
}

// The GET /:id amendment-chain read-path coverage moved to
// patient-reports.d8.test.ts when Ticket D8 made the canonical resolver
// (resolveReportVersion) the single chain implementation behind that route.

// ── applyStructuredRead R14c lookup (D7 read side) ───────────────────────────
// An amendment document carries amends_document_id, so the D6 read pipeline
// now needs a REAL amendsLookup: linkage row proves the prior exists, the
// parent row supplies its live state, and "already amended by" must exclude
// the very document being read (linear chain, not a self-fork).

describe("D7 — applyStructuredRead resolves the amendment parent for R14c", () => {
  const ROW_900 = { id: 900, patientId: 12, status: "verified", reportNumber: "RPT-ROOT", signedByName: "Dr. Rao", signedAt: new Date("2026-07-10T10:00:00Z"), createdAt: new Date("2026-07-10T10:00:00Z") };
  const ROW_909 = { id: 909, patientId: 12, status: "verified", reportNumber: "RPT-A1", signedByName: "Dr. Sen", signedAt: new Date("2026-07-11T09:00:00Z"), createdAt: new Date("2026-07-11T09:00:00Z") };

  async function captured() {
    flags.ff_radiology_structured_read = true;
    // Serve the AMENDMENT row (id 909, tip of the chain) so the closure's
    // self-id is AMENDED_DOC. D8 resolver order: plain requested-row select,
    // linkage (asAmendment, asOriginal, chainByRoot), plain version-rows
    // select, then the joined display select.
    plainReportQueryScript = [[ROW_909], [ROW_900, ROW_909]];
    linkageQueryScript = [[LINK_1], [], [LINK_1]];
    joinedQueryScript = [[{ ...joinedRowFor(909)[0], r: { ...parentRow!, id: 909, structuredJson: AMENDED_DOC } }]];
    await getById("909");
    expect(capturedReadPorts).toBeTruthy();
    return capturedReadPorts;
  }

  test("prior resolves via linkage; amended-by-self reads as NOT already amended", async () => {
    const ports = await captured();
    linkageQueryScript = [[LINK_1]]; // linkage row for the parent doc id
    const prior = await ports.amendsLookup(PARENT_DOC.document_id);
    expect(prior).toEqual({ state: "final", alreadyAmendedBy: null });
  });

  test("prior amended by a DIFFERENT document surfaces alreadyAmendedBy (fork detection)", async () => {
    const ports = await captured();
    linkageQueryScript = [[{ ...LINK_1, amendedDocumentId: "A000000000000000000000000W" }]];
    const prior = await ports.amendsLookup(PARENT_DOC.document_id);
    expect(prior).toEqual({ state: "final", alreadyAmendedBy: "A000000000000000000000000W" });
  });

  test("no linkage row → null (claimed parent does not resolve; validator rejects)", async () => {
    const ports = await captured();
    linkageQueryScript = [[]];
    expect(await ports.amendsLookup("0000000000000000000000ZZZZ")).toBeNull();
  });

  test("linkage present but parent row gone/invalid → null (fail safe to stored body)", async () => {
    const ports = await captured();
    parentRow = null; // parent patient_reports row vanished
    linkageQueryScript = [[LINK_1]];
    expect(await ports.amendsLookup(PARENT_DOC.document_id)).toBeNull();
  });
});
