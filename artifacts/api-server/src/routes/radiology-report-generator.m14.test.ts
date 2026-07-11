import { describe, expect, test, vi, beforeEach } from "vitest";

// Ticket M1.4 route coverage — the canonical Reporting Workspace's workflow
// endpoints:
//
//   1. POST /save-draft accepts the workspace's REAL payload. Before M1.4 the
//      zod schema rejected it two ways (verified empirically): every empty
//      field is sent as `null` (`.optional()` refuses null) and the
//      workspace's structured sections are `{label: {normal, text}}` objects
//      (schema demanded `{label: string}`). "Save Draft" from the canonical
//      page could never succeed — the root broken link of the save→reload
//      workflow.
//   2. GET /finding-instances — the A3.2 rows the workspace restores its
//      Quick Select selections from.
//   3. POST /validate-draft — the REAL D3/D3.5 builder + D1 validator run
//      read-only for the preview/finalize validation UI.
//
// Self-contained mocks in the d3-test style (no HTTP server; the real Express
// handler is invoked directly). The adapter/writer/validator internals are
// proven in radiologyD1DraftWriter.test.ts — this file proves the WIRING.

let coreFlagEnabled: boolean;
let d1DraftFlagEnabled: boolean;
let catalogFlagEnabled: boolean;
let finalFlagEnabled: boolean;

let d1BuildResult: unknown;
let buildCallCount: number;
let lastBuildOpts: unknown;

let insertValuesCalls: Record<string, unknown>[];
let updateSetCalls: Record<string, unknown>[];
let txRunCount: number;
let txInsertedInstanceRows: Record<string, unknown>[];
let draftRow: Record<string, unknown> | undefined;
let worklistRow: Record<string, unknown> | null;
let instanceRows: Record<string, unknown>[];

vi.mock("../lib/featureFlags", () => ({
  isFeatureEnabledServer: async (key: string) =>
    key === "ff_radiology_structured_d1_draft" ? d1DraftFlagEnabled
    : key === "ff_radiology_catalog" ? catalogFlagEnabled
    : key === "ff_radiology_structured_final" ? finalFlagEnabled
    : coreFlagEnabled,
}));

vi.mock("../lib/radiologyStructuredJsonCache", () => ({
  regenerateDraftStructuredJson: async () => { /* A4 no-op */ },
}));

vi.mock("../lib/radiologyD1DraftWriter", () => ({
  buildAndValidateDraftD1Document: async (_src: unknown, opts: unknown) => {
    buildCallCount++;
    lastBuildOpts = opts;
    return d1BuildResult;
  },
}));

vi.mock("../lib/radiologyFindingMaterializer", () => ({
  CatalogStoreFindingResolver: class {
    constructor(public store: unknown, public lookup: unknown) {}
  },
}));
vi.mock("../lib/radiologyCatalog/drizzleStore", () => ({
  DrizzleCatalogStore: class {},
}));
vi.mock("../lib/structuredReport/catalogAccess", () => ({
  DrizzleStructuredReportCatalogPort: class {
    constructor(public store: unknown) {}
  },
}));

vi.mock("@workspace/db", () => {
  const draftsTable = { __name: "drafts" };
  const worklistTable = { __name: "worklist" };
  const rfiTable = { __name: "rfi" };
  return {
    db: {
      select: (_cols?: unknown) => ({
        from: (tbl: { __name?: string }) => ({
          where: (..._args: unknown[]) => {
            if (tbl?.__name === "worklist") {
              return { limit: async () => (worklistRow ? [worklistRow] : []) };
            }
            if (tbl?.__name === "rfi") {
              // /finding-instances and /validate-draft await .where() directly
              return {
                then: (resolve: (v: unknown) => void) => resolve(instanceRows),
                limit: async () => instanceRows,
              };
            }
            return {
              then: (resolve: (v: unknown) => void) => resolve(draftRow ? [draftRow] : []),
              orderBy: () => ({ limit: async () => (draftRow ? [draftRow] : []) }),
              limit: async () => (draftRow ? [draftRow] : []),
            };
          },
        }),
      }),
      insert: (_tbl: { __name?: string }) => ({
        values: (v: Record<string, unknown>) => {
          insertValuesCalls.push(v);
          return { returning: async () => [{ id: 501, ...v }] };
        },
      }),
      update: (_tbl: { __name?: string }) => ({
        set: (v: Record<string, unknown>) => {
          updateSetCalls.push(v);
          if (Object.keys(v).length === 1 && "structuredJsonD1" in v) {
            return { where: () => Promise.resolve() };
          }
          return { where: () => ({ returning: async () => [{ id: 42, ...v }] }) };
        },
      }),
      transaction: async (fn: (tx: unknown) => Promise<void>) => {
        txRunCount++;
        const tx = {
          delete: () => ({ where: () => Promise.resolve() }),
          insert: () => ({
            values: (rows: Record<string, unknown>[]) => {
              txInsertedInstanceRows.push(...rows);
              return Promise.resolve();
            },
          }),
        };
        await fn(tx);
      },
    },
    radiologyReportDraftsTable: draftsTable,
    radiologyWorklistTable: worklistTable,
    reportFindingInstancesTable: rfiTable,
  };
});

vi.mock("@workspace/db/schema", () => ({
  radiologyReportDraftsTable: { __name: "drafts", id: "id", studyId: "study_id", patientId: "patient_id", updatedAt: "updated_at" },
  radiologyWorklistTable: { __name: "worklist", id: "id" },
  reportFindingInstancesTable: { __name: "rfi", draftId: "draft_id", findingId: "finding_id", structuredJson: "structured_json", source: "source" },
  radiologyQuickFindingsTable: { __name: "quick_findings", id: "id", label: "label" },
}));

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

async function invoke(method: "get" | "post", path: string, req: Record<string, unknown>) {
  const { radiologyReportGeneratorRouter } = await import("./radiology-report-generator");
  const handler = getRouteHandler(radiologyReportGeneratorRouter, method, path);
  const res = makeRes();
  await handler({ staffSession: { subjectName: "Dr. Test" }, query: {}, body: {}, ...req }, res);
  return res;
}

beforeEach(() => {
  coreFlagEnabled = false;
  d1DraftFlagEnabled = false;
  catalogFlagEnabled = false;
  finalFlagEnabled = false;
  d1BuildResult = { ok: true, document: { document_id: "0000000000000000000000000A", findings: [] }, contentSha256: "sha256:abc", warnings: [] };
  buildCallCount = 0;
  lastBuildOpts = undefined;
  insertValuesCalls = [];
  updateSetCalls = [];
  txRunCount = 0;
  txInsertedInstanceRows = [];
  draftRow = undefined;
  worklistRow = null;
  instanceRows = [];
});

describe("M1.4 — POST /save-draft accepts the canonical workspace's real payload", () => {
  test("structured-mode payload: object-valued findingsSections + nulls → 200 and persisted", async () => {
    // EXACTLY what RadiologyReportingWorkspace sends (structured mode,
    // patient linked, some fields empty → null).
    const res = await invoke("post", "/save-draft", {
      body: {
        studyId: 7,
        worklistId: 7,
        patientId: 12,
        templateId: "MRI Brain Plain",
        modality: "MRI",
        studyName: "MRI BRAIN",
        clinicalHistory: "Headache for 2 weeks.",
        rawFindings: "No acute infarct.",
        findingsSections: { Brain: { normal: true, text: "Normal." }, Ventricles: { normal: false, text: "Dilated." } },
        impression: ["No acute intracranial abnormality."],
        recommendation: null,
        findings: [{ findingId: 4, params: { side: "left", severity: "", chronicity: "", level: "", value: "" } }],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(insertValuesCalls).toHaveLength(1);
    // The object sections round-trip verbatim through the JSON text column.
    expect(JSON.parse(insertValuesCalls[0].findingsSections as string)).toEqual({
      Brain: { normal: true, text: "Normal." },
      Ventricles: { normal: false, text: "Dilated." },
    });
    expect(insertValuesCalls[0].recommendation).toBeNull();
  });

  test("free-text payload with nulls everywhere → 200 (was 400 before M1.4)", async () => {
    const res = await invoke("post", "/save-draft", {
      body: {
        studyId: 7, worklistId: 7, patientId: null, templateId: null,
        modality: "CT", studyName: null, clinicalHistory: null,
        rawFindings: "Free text findings.", findingsSections: null,
        impression: [], recommendation: null, findings: [],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(insertValuesCalls[0].findingsSections).toBeNull();
    expect(insertValuesCalls[0].patientId).toBeNull();
  });

  test("legacy string-valued findingsSections (RadiologyReportGenerator page) still accepted", async () => {
    const res = await invoke("post", "/save-draft", {
      body: { studyId: 3, findingsSections: { Chest: "Clear lung fields." } },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(insertValuesCalls[0].findingsSections as string)).toEqual({ Chest: "Clear lung fields." });
  });

  test("findings: [] with core flag ON clears this draft's instance rows (deselect-all save)", async () => {
    coreFlagEnabled = true;
    const res = await invoke("post", "/save-draft", { body: { studyId: 7, findings: [] } });
    expect(res.statusCode).toBe(200);
    expect(txRunCount).toBe(1);              // replace ran (delete, no insert)
    expect(txInsertedInstanceRows).toHaveLength(0);
  });

  test("findings: null behaves like an absent key — instance rows untouched", async () => {
    coreFlagEnabled = true;
    const res = await invoke("post", "/save-draft", { body: { studyId: 7, findings: null } });
    expect(res.statusCode).toBe(200);
    expect(txRunCount).toBe(0);
  });
});

describe("M1.4 — GET /finding-instances", () => {
  test("invalid draftId → 400", async () => {
    for (const bad of ["abc", "-3", "0", ""]) {
      const res = await invoke("get", "/finding-instances", { query: { draftId: bad } });
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    }
  });

  test("returns the draft's persisted selections", async () => {
    instanceRows = [
      { findingId: 4, structuredJson: { side: "left", severity: "mild" }, source: "quickselect" },
      { findingId: 9, structuredJson: {}, source: "quickselect" },
    ];
    const res = await invoke("get", "/finding-instances", { query: { draftId: "42" } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, instances: instanceRows });
  });
});

describe("M1.4 — POST /validate-draft", () => {
  const draft = {
    id: 42, studyId: 7, worklistId: 7, patientId: 12,
    rawFindings: "No acute infarct.", impression: JSON.stringify(["ok"]),
    modality: "MRI", studyName: "MRI BRAIN", templateId: "T",
    clinicalHistory: null, recommendation: null, createdBy: "Dr. A",
    createdAt: new Date("2026-07-01T10:00:00Z"), updatedAt: new Date("2026-07-01T10:00:00Z"),
  };

  test("invalid draftId → 400; unknown draft → 404", async () => {
    const bad = await invoke("post", "/validate-draft", { body: { draftId: "nope" } });
    expect(bad.statusCode).toBe(400);
    draftRow = undefined;
    const missing = await invoke("post", "/validate-draft", { body: { draftId: 42 } });
    expect(missing.statusCode).toBe(404);
  });

  test("flags OFF → enabled:false with truthful legacy presence booleans", async () => {
    draftRow = draft;
    const res = await invoke("post", "/validate-draft", { body: { draftId: 42 } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      structured: { enabled: false, attempted: false },
      legacy: { rawFindings: true, impression: true },
    });
    expect(buildCallCount).toBe(0); // validator never invoked with flags off
  });

  test("flags ON + document builds → built:true with documentId/sha/count/warnings", async () => {
    coreFlagEnabled = true;
    d1DraftFlagEnabled = true;
    draftRow = draft;
    instanceRows = [{ findingId: 4, structuredJson: { side: "left" } }];
    d1BuildResult = {
      ok: true,
      document: { document_id: "0000000000000000000000000A", findings: [{}, {}] },
      contentSha256: "sha256:abc",
      warnings: ["units missing on one measurement"],
    };
    const res = await invoke("post", "/validate-draft", { body: { draftId: 42 } });
    expect(res.statusCode).toBe(200);
    expect(res.body.structured).toEqual({
      enabled: true, attempted: true, built: true,
      documentId: "0000000000000000000000000A",
      contentSha256: "sha256:abc",
      findingsCount: 2,
      errors: [],
      warnings: ["units missing on one measurement"],
    });
    expect(buildCallCount).toBe(1);
    // read-only: validate-draft never persists anything
    expect(updateSetCalls).toHaveLength(0);
    expect(insertValuesCalls).toHaveLength(0);
  });

  test("validation FAILS → blocking errors surfaced; nothing persisted", async () => {
    coreFlagEnabled = true;
    d1DraftFlagEnabled = true;
    draftRow = draft;
    d1BuildResult = {
      ok: false,
      skipReasons: ["document failed D1 validation"],
      validationErrors: [{ code: "R7", path: "/findings/0", message: "presence missing" }],
    };
    const res = await invoke("post", "/validate-draft", { body: { draftId: 42 } });
    expect(res.statusCode).toBe(200);
    expect(res.body.structured.built).toBe(false);
    expect(res.body.structured.errors).toEqual([{ code: "R7", path: "/findings/0", message: "presence missing" }]);
    expect(res.body.structured.skipReasons).toEqual(["document failed D1 validation"]);
    expect(updateSetCalls).toHaveLength(0);
  });

  test("truthful SKIP (identifiers unavailable) → skipReasons, no errors", async () => {
    coreFlagEnabled = true;
    d1DraftFlagEnabled = true;
    draftRow = draft;
    d1BuildResult = { ok: false, skipReasons: ["study_context.identifiers unavailable"] };
    const res = await invoke("post", "/validate-draft", { body: { draftId: 42 } });
    expect(res.body.structured).toEqual({
      enabled: true, attempted: true, built: false,
      skipReasons: ["study_context.identifiers unavailable"],
      errors: [], warnings: [],
    });
  });

  test("catalog flag ON → resolver/catalog ports passed to the builder (D3.5 parity)", async () => {
    coreFlagEnabled = true;
    d1DraftFlagEnabled = true;
    catalogFlagEnabled = true;
    draftRow = draft;
    await invoke("post", "/validate-draft", { body: { draftId: 42 } });
    expect(buildCallCount).toBe(1);
    const opts = lastBuildOpts as { resolver?: unknown; catalogPort?: unknown };
    expect(opts.resolver).toBeDefined();
    expect(opts.catalogPort).toBeDefined();
  });

  test("catalog flag OFF → builder invoked with no catalog ports (D3 parity)", async () => {
    coreFlagEnabled = true;
    d1DraftFlagEnabled = true;
    draftRow = draft;
    await invoke("post", "/validate-draft", { body: { draftId: 42 } });
    expect(lastBuildOpts).toEqual({});
  });
});
