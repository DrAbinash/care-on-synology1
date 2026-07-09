import { describe, expect, test, vi, beforeEach } from "vitest";

// Ticket A3.0 coverage: this is the first test file for this router. Scope
// is narrow and deliberate — only the two endpoints the draft-lifecycle fix
// depends on: POST /save-draft's existing (pre-existing, unmodified)
// insert-vs-update-by-id branch, and GET /drafts's existing lookup. Nothing
// about report generation, key images, or any other endpoint in this file
// is touched or tested here.
//
// Follows the established no-HTTP-server technique already used in
// clinicSettings.test.ts / featureFlags.test.ts: reach into the Express
// Router's internal stack to invoke the real handler directly.

let insertedRows: Record<string, unknown>[];
let insertValuesCalls: Record<string, unknown>[];
let updateSetCalls: Record<string, unknown>[];
let updateResult: Record<string, unknown> | null;
let selectDraftsResult: Record<string, unknown>[];

// Ticket A3.2 coverage state — the separate-transaction structured findings
// dual-write. `structuredFlagEnabled` stands in for
// ff_radiology_structured_core; `txCallCount`/`txDeleteWhereCalls`/
// `txInsertValuesCalls` record what happened *inside* db.transaction()
// specifically, kept apart from the legacy insert/update tracking above so
// tests can assert the two write paths independently. `txShouldThrow` lets
// a test simulate the structured write failing without touching the legacy
// save mocks at all.
let structuredFlagEnabled: boolean;
let txCallCount: number;
let txDeleteWhereCalls: unknown[];
let txInsertValuesCalls: Record<string, unknown>[][];
let txShouldThrow: boolean;

// Ticket A4 coverage state — the structured_json cache regeneration that
// runs after A3.2's dual-write. `cacheFindingRows` stands in for what a
// fresh SELECT against report_finding_instances would currently return for
// the draft being saved (set directly by each test, independent of what
// A3.2's own delete/insert mock recorded — they're separate mock code
// paths). `cacheUpdateSetCalls` records the structured_json UPDATE,
// kept apart from `updateSetCalls` (the legacy draft-fields UPDATE) so
// tests can assert the two independently. `cacheRegenShouldThrow` lets a
// test simulate the regeneration read failing.
let cacheFindingRows: Record<string, unknown>[];
let cacheUpdateSetCalls: Record<string, unknown>[];
let cacheRegenShouldThrow: boolean;

vi.mock("../lib/featureFlags", () => ({
  isFeatureEnabledServer: async (_key: string) => structuredFlagEnabled,
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          // Two different callers share this chain shape:
          //  - GET /drafts always chains .limit(50) before awaiting.
          //  - A4's regenerateDraftStructuredJson awaits .orderBy() directly,
          //    never calling .limit().
          // Returning an object that is both a thenable (resolving to the
          // FindingInstance rows) AND exposes .limit() (resolving to the
          // drafts list) serves both callers without needing to inspect
          // which table was queried.
          orderBy: () => ({
            then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
              (cacheRegenShouldThrow
                ? Promise.reject(new Error("simulated structured_json cache regeneration failure"))
                : Promise.resolve(cacheFindingRows)
              ).then(resolve, reject),
            limit: async () => selectDraftsResult,
          }),
        }),
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        insertValuesCalls.push(v);
        const row = { id: 101, ...v };
        insertedRows.push(row);
        return { returning: async () => [row] };
      },
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        // A4's cache regeneration issues its own UPDATE with exactly one
        // key ({ structuredJson }); the legacy draft-fields UPDATE always
        // sets many fields. Shape, not table identity, tells them apart.
        if (Object.keys(v).length === 1 && Object.prototype.hasOwnProperty.call(v, "structuredJson")) {
          cacheUpdateSetCalls.push(v);
          return { where: () => Promise.resolve() };
        }
        updateSetCalls.push(v);
        return {
          where: () => ({
            returning: async () => (updateResult ? [{ ...updateResult, ...v }] : []),
          }),
        };
      },
    }),
    transaction: async (fn: (tx: unknown) => Promise<void>) => {
      txCallCount++;
      if (txShouldThrow) throw new Error("simulated structured write failure");
      const tx = {
        delete: () => ({
          where: (cond: unknown) => {
            txDeleteWhereCalls.push(cond);
            return Promise.resolve();
          },
        }),
        insert: () => ({
          values: (rows: Record<string, unknown>[]) => {
            txInsertValuesCalls.push(rows);
            return Promise.resolve();
          },
        }),
      };
      await fn(tx);
    },
  },
  radiologyReportDraftsTable: {
    id: "id", studyId: "study_id", patientId: "patient_id", updatedAt: "updated_at",
  },
  reportFindingInstancesTable: {
    id: "id", draftId: "draft_id", findingId: "finding_id",
  },
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
    statusCode: 200,
    body: undefined,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
  return res;
}

describe("POST /save-draft — first save creates, second save updates (pre-existing behavior, unmodified by A3.0)", () => {
  beforeEach(() => {
    insertedRows = [];
    insertValuesCalls = [];
    updateSetCalls = [];
    updateResult = { id: 42, studyId: 7 };
    structuredFlagEnabled = false;
    txCallCount = 0;
    txDeleteWhereCalls = [];
    txInsertValuesCalls = [];
    txShouldThrow = false;
    cacheFindingRows = [];
    cacheUpdateSetCalls = [];
    cacheRegenShouldThrow = false;
  });

  test("first save (no id in the request) INSERTs a new row", async () => {
    const { radiologyReportGeneratorRouter } = await import("./radiology-report-generator");
    const handler = getRouteHandler(radiologyReportGeneratorRouter, "post", "/save-draft");
    const req = { body: { studyId: 7, rawFindings: "Findings text" }, staffSession: { subjectName: "Dr. Test" } };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(insertValuesCalls).toHaveLength(1);
    expect(updateSetCalls).toHaveLength(0);
    expect(res.body.draft.id).toBe(101);
  });

  test("second save (id from the first save's response) UPDATEs the same row, does not insert another", async () => {
    const { radiologyReportGeneratorRouter } = await import("./radiology-report-generator");
    const handler = getRouteHandler(radiologyReportGeneratorRouter, "post", "/save-draft");
    const req = {
      body: { id: 42, studyId: 7, rawFindings: "Findings text, revised" },
      staffSession: { subjectName: "Dr. Test" },
    };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(updateSetCalls).toHaveLength(1);
    expect(insertValuesCalls).toHaveLength(0); // no second orphaned row
    expect(res.body.draft.id).toBe(42);
  });

  test("save still succeeds after reload: an id adopted from a loaded draft round-trips correctly", async () => {
    const { radiologyReportGeneratorRouter } = await import("./radiology-report-generator");
    const handler = getRouteHandler(radiologyReportGeneratorRouter, "post", "/save-draft");
    // Simulates the frontend sending withDraftId(payload, adoptedId) after
    // useRadiologyDraftId loaded an existing draft on mount.
    const req = { body: { id: 42, studyId: 7, rawFindings: "post-reload edit" }, staffSession: {} };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(updateSetCalls[0]).toMatchObject({ rawFindings: "post-reload edit" });
  });

  test("falls back to null createdBy if no session name is present (unchanged pre-existing behavior)", async () => {
    const { radiologyReportGeneratorRouter } = await import("./radiology-report-generator");
    const handler = getRouteHandler(radiologyReportGeneratorRouter, "post", "/save-draft");
    const req = { body: { studyId: 7 }, staffSession: undefined };
    const res = makeRes();
    await handler(req, res);
    expect(insertValuesCalls[0]).toMatchObject({ createdBy: null });
  });
});

describe("POST /save-draft — findings[] (Ticket A3.1): accepted, validated, ignored", () => {
  beforeEach(() => {
    insertedRows = [];
    insertValuesCalls = [];
    updateSetCalls = [];
    updateResult = { id: 42, studyId: 7 };
    // ff_radiology_structured_core stays OFF throughout this suite — it
    // covers A3.1's default-off behavior specifically. The dual-write itself
    // (flag ON) is covered separately below in the A3.2 suite.
    structuredFlagEnabled = false;
    txCallCount = 0;
    txDeleteWhereCalls = [];
    txInsertValuesCalls = [];
    txShouldThrow = false;
    cacheFindingRows = [];
    cacheUpdateSetCalls = [];
    cacheRegenShouldThrow = false;
  });

  test("accepts a payload WITH findings[] and saves successfully, without persisting the findings data", async () => {
    const { radiologyReportGeneratorRouter } = await import("./radiology-report-generator");
    const handler = getRouteHandler(radiologyReportGeneratorRouter, "post", "/save-draft");
    const req = {
      body: {
        studyId: 7,
        rawFindings: "Findings text",
        findings: [
          { findingId: 8842, params: { side: "", severity: "moderate", chronicity: "", level: "L4-5", value: "" } },
          { findingId: 9001, params: { side: "right", severity: "mild", chronicity: "chronic", level: "", value: "" } },
        ],
      },
      staffSession: { subjectName: "Dr. Test" },
    };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    // Accepted (no 400) and the draft still saves — but the field is a
    // no-op: nothing findings-shaped reaches the DB write.
    expect(insertValuesCalls).toHaveLength(1);
    expect(insertValuesCalls[0]).not.toHaveProperty("findings");
    expect(res.body.draft.id).toBe(101);
  });

  test("old frontend bundle without findings[] still saves successfully — unchanged backward compatibility", async () => {
    const { radiologyReportGeneratorRouter } = await import("./radiology-report-generator");
    const handler = getRouteHandler(radiologyReportGeneratorRouter, "post", "/save-draft");
    const req = {
      body: { studyId: 7, rawFindings: "Findings text" }, // no findings key at all — pre-A3.1 shape
      staffSession: { subjectName: "Dr. Test" },
    };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(insertValuesCalls).toHaveLength(1);
    expect(res.body.draft.id).toBe(101);
  });

  test("rejects a findings[] entry missing the required findingId (still validates the shape it does accept)", async () => {
    const { radiologyReportGeneratorRouter } = await import("./radiology-report-generator");
    const handler = getRouteHandler(radiologyReportGeneratorRouter, "post", "/save-draft");
    const req = {
      body: { studyId: 7, findings: [{ params: { side: "left" } }] }, // missing findingId
      staffSession: { subjectName: "Dr. Test" },
    };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(insertValuesCalls).toHaveLength(0);
  });
});

describe("POST /save-draft — structured findings dual-write (Ticket A3.2)", () => {
  beforeEach(() => {
    insertedRows = [];
    insertValuesCalls = [];
    updateSetCalls = [];
    updateResult = { id: 42, studyId: 7 };
    structuredFlagEnabled = true;
    txCallCount = 0;
    txDeleteWhereCalls = [];
    txInsertValuesCalls = [];
    txShouldThrow = false;
    // A4's regeneration also runs in this suite (same flag, wired right
    // after A3.2), so its own state is reset here too — most tests below
    // don't care about it, but it must not leak between them.
    cacheFindingRows = [];
    cacheUpdateSetCalls = [];
    cacheRegenShouldThrow = false;
  });

  const TWO_FINDINGS = [
    { findingId: 8842, params: { side: "", severity: "moderate", chronicity: "", level: "L4-5", value: "" } },
    { findingId: 9001, params: { side: "right", severity: "mild", chronicity: "chronic", level: "", value: "" } },
  ];

  test("feature flag OFF (default): findings[] present, but the transaction never runs", async () => {
    structuredFlagEnabled = false;
    const { radiologyReportGeneratorRouter } = await import("./radiology-report-generator");
    const handler = getRouteHandler(radiologyReportGeneratorRouter, "post", "/save-draft");
    const req = { body: { studyId: 7, findings: TWO_FINDINGS }, staffSession: { subjectName: "Dr. Test" } };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(txCallCount).toBe(0);
  });

  test("flag ON, first save (insert, no id): replaces FindingInstance rows for the newly-created draft's id", async () => {
    const { radiologyReportGeneratorRouter } = await import("./radiology-report-generator");
    const handler = getRouteHandler(radiologyReportGeneratorRouter, "post", "/save-draft");
    const req = { body: { studyId: 7, findings: TWO_FINDINGS }, staffSession: { subjectName: "Dr. Test" } };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.draft.id).toBe(101); // the inserted row's id, from the insert mock
    expect(txCallCount).toBe(1);
    expect(txDeleteWhereCalls).toHaveLength(1);
    expect(txInsertValuesCalls).toHaveLength(1);
    expect(txInsertValuesCalls[0]).toEqual([
      { draftId: 101, findingId: 8842, structuredJson: TWO_FINDINGS[0]!.params, source: "quickselect" },
      { draftId: 101, findingId: 9001, structuredJson: TWO_FINDINGS[1]!.params, source: "quickselect" },
    ]);
  });

  test("flag ON, second save (update, id present): replaces FindingInstance rows for the existing draft's id", async () => {
    const { radiologyReportGeneratorRouter } = await import("./radiology-report-generator");
    const handler = getRouteHandler(radiologyReportGeneratorRouter, "post", "/save-draft");
    const req = { body: { id: 42, studyId: 7, findings: TWO_FINDINGS }, staffSession: { subjectName: "Dr. Test" } };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.draft.id).toBe(42);
    expect(txCallCount).toBe(1);
    expect(txInsertValuesCalls[0]).toEqual([
      { draftId: 42, findingId: 8842, structuredJson: TWO_FINDINGS[0]!.params, source: "quickselect" },
      { draftId: 42, findingId: 9001, structuredJson: TWO_FINDINGS[1]!.params, source: "quickselect" },
    ]);
  });

  test("flag ON, findings: [] (user deselected everything): still replaces — deletes existing rows, inserts none", async () => {
    const { radiologyReportGeneratorRouter } = await import("./radiology-report-generator");
    const handler = getRouteHandler(radiologyReportGeneratorRouter, "post", "/save-draft");
    const req = { body: { id: 42, studyId: 7, findings: [] }, staffSession: { subjectName: "Dr. Test" } };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(txCallCount).toBe(1);
    expect(txDeleteWhereCalls).toHaveLength(1);
    expect(txInsertValuesCalls).toHaveLength(0); // no insert call at all for an empty replace
  });

  test("flag ON, old client without findings[] key at all: transaction never runs, existing rows untouched", async () => {
    const { radiologyReportGeneratorRouter } = await import("./radiology-report-generator");
    const handler = getRouteHandler(radiologyReportGeneratorRouter, "post", "/save-draft");
    const req = { body: { id: 42, studyId: 7, rawFindings: "no findings key" }, staffSession: { subjectName: "Dr. Test" } };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(txCallCount).toBe(0);
  });

  test("replace-not-append: two consecutive saves for the same draft each issue their own delete+insert, not an accumulating one", async () => {
    const { radiologyReportGeneratorRouter } = await import("./radiology-report-generator");
    const handler = getRouteHandler(radiologyReportGeneratorRouter, "post", "/save-draft");

    await handler({ body: { id: 42, studyId: 7, findings: [TWO_FINDINGS[0]] }, staffSession: {} }, makeRes());
    await handler({ body: { id: 42, studyId: 7, findings: [TWO_FINDINGS[1]] }, staffSession: {} }, makeRes());

    expect(txCallCount).toBe(2);
    expect(txDeleteWhereCalls).toHaveLength(2); // one delete per save — each save's transaction clears before inserting
    expect(txInsertValuesCalls[0]).toEqual([
      { draftId: 42, findingId: 8842, structuredJson: TWO_FINDINGS[0]!.params, source: "quickselect" },
    ]);
    // Second save's insert reflects only its own findings — no merge with the first save's row.
    expect(txInsertValuesCalls[1]).toEqual([
      { draftId: 42, findingId: 9001, structuredJson: TWO_FINDINGS[1]!.params, source: "quickselect" },
    ]);
  });

  test("structured write failure is swallowed: the draft save still succeeds and returns the saved draft", async () => {
    txShouldThrow = true;
    const { radiologyReportGeneratorRouter } = await import("./radiology-report-generator");
    const handler = getRouteHandler(radiologyReportGeneratorRouter, "post", "/save-draft");
    const req = { body: { id: 42, studyId: 7, findings: TWO_FINDINGS }, staffSession: { subjectName: "Dr. Test" } };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.draft.id).toBe(42);
    expect(res.body.success).toBe(true);
  });
});

describe("POST /save-draft — structured_json cache regeneration (Ticket A4)", () => {
  beforeEach(() => {
    insertedRows = [];
    insertValuesCalls = [];
    updateSetCalls = [];
    updateResult = { id: 42, studyId: 7 };
    structuredFlagEnabled = true;
    txCallCount = 0;
    txDeleteWhereCalls = [];
    txInsertValuesCalls = [];
    txShouldThrow = false;
    cacheFindingRows = [];
    cacheUpdateSetCalls = [];
    cacheRegenShouldThrow = false;
  });

  const ONE_FINDING = {
    findingId: 8842,
    params: { side: "", severity: "moderate", chronicity: "", level: "L4-5", value: "" },
  };

  test("structured_json matches the current FindingInstance rows for this draft after a save", async () => {
    // Simulates what a fresh SELECT against report_finding_instances would
    // return right after A3.2's dual-write committed this row.
    cacheFindingRows = [
      {
        id: 1, draftId: 42, reportId: null, findingId: 8842, anatomicZoneId: null, structureId: null,
        category: "", modality: "", structuredJson: ONE_FINDING.params, catalogVersion: "0",
        source: "quickselect", confirmed: false, confirmedBy: null, confirmedAt: null,
        createdAt: "2026-07-09T00:00:00.000Z", updatedAt: null,
      },
    ];
    const { radiologyReportGeneratorRouter } = await import("./radiology-report-generator");
    const handler = getRouteHandler(radiologyReportGeneratorRouter, "post", "/save-draft");
    const req = { body: { id: 42, studyId: 7, findings: [ONE_FINDING] }, staffSession: {} };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(cacheUpdateSetCalls).toHaveLength(1);
    expect(cacheUpdateSetCalls[0]!.structuredJson).toEqual([
      {
        findingId: 8842, anatomicZoneId: null, structureId: null, category: "", modality: "",
        structuredJson: ONE_FINDING.params, catalogVersion: "0", source: "quickselect", confirmed: false,
      },
    ]);
  });

  test("empty findings[] (deselect-all) clears the structured_json cache to null", async () => {
    cacheFindingRows = []; // the replace already ran with zero rows before regeneration reads it back
    const { radiologyReportGeneratorRouter } = await import("./radiology-report-generator");
    const handler = getRouteHandler(radiologyReportGeneratorRouter, "post", "/save-draft");
    const req = { body: { id: 42, studyId: 7, findings: [] }, staffSession: {} };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(cacheUpdateSetCalls).toHaveLength(1);
    expect(cacheUpdateSetCalls[0]!.structuredJson).toBeNull();
  });

  test("regeneration failure is swallowed — the draft save still succeeds and returns the saved draft", async () => {
    cacheRegenShouldThrow = true;
    const { radiologyReportGeneratorRouter } = await import("./radiology-report-generator");
    const handler = getRouteHandler(radiologyReportGeneratorRouter, "post", "/save-draft");
    const req = { body: { id: 42, studyId: 7, findings: [ONE_FINDING] }, staffSession: {} };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.draft.id).toBe(42);
    expect(res.body.success).toBe(true);
    expect(cacheUpdateSetCalls).toHaveLength(0); // never reached the UPDATE — failed during the read
  });

  test("touches only this draft's own row — no other UPDATE occurs (radiology-report-generator.ts never imports patientReportsTable)", async () => {
    cacheFindingRows = [
      {
        id: 1, draftId: 42, reportId: null, findingId: 8842, anatomicZoneId: null, structureId: null,
        category: "", modality: "", structuredJson: ONE_FINDING.params, catalogVersion: "0",
        source: "quickselect", confirmed: false, confirmedBy: null, confirmedAt: null,
        createdAt: "2026-07-09T00:00:00.000Z", updatedAt: null,
      },
    ];
    const { radiologyReportGeneratorRouter } = await import("./radiology-report-generator");
    const handler = getRouteHandler(radiologyReportGeneratorRouter, "post", "/save-draft");
    const req = { body: { id: 42, studyId: 7, findings: [ONE_FINDING] }, staffSession: {} };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    // Exactly one legacy draft-fields UPDATE and one structured_json cache
    // UPDATE, both scoped to this draft's own row — nothing else. Since the
    // route module never imports patientReportsTable at all (confirmed by
    // grep before implementing this ticket), there is no code path here
    // that could touch patient_reports even accidentally.
    expect(updateSetCalls).toHaveLength(1);
    expect(cacheUpdateSetCalls).toHaveLength(1);
  });

  test("skips regeneration entirely when the feature flag is off, same as A3.2's own gate", async () => {
    structuredFlagEnabled = false;
    cacheFindingRows = [
      {
        id: 1, draftId: 42, reportId: null, findingId: 8842, anatomicZoneId: null, structureId: null,
        category: "", modality: "", structuredJson: ONE_FINDING.params, catalogVersion: "0",
        source: "quickselect", confirmed: false, confirmedBy: null, confirmedAt: null,
        createdAt: "2026-07-09T00:00:00.000Z", updatedAt: null,
      },
    ];
    const { radiologyReportGeneratorRouter } = await import("./radiology-report-generator");
    const handler = getRouteHandler(radiologyReportGeneratorRouter, "post", "/save-draft");
    const req = { body: { id: 42, studyId: 7, findings: [ONE_FINDING] }, staffSession: {} };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(cacheUpdateSetCalls).toHaveLength(0);
  });
});

describe("GET /drafts — page reload loads an existing draft, or starts blank", () => {
  test("returns the existing draft when one was previously saved for this study", async () => {
    selectDraftsResult = [{ id: 42, studyId: 7, rawFindings: "Findings text", updatedAt: "2026-07-09T00:00:00.000Z" }];
    const { radiologyReportGeneratorRouter } = await import("./radiology-report-generator");
    const handler = getRouteHandler(radiologyReportGeneratorRouter, "get", "/drafts");
    const req = { query: { studyId: "7" } };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.drafts).toHaveLength(1);
    expect(res.body.drafts[0].id).toBe(42);
  });

  test("returns an empty list when no draft exists for this study — frontend starts blank", async () => {
    selectDraftsResult = [];
    const { radiologyReportGeneratorRouter } = await import("./radiology-report-generator");
    const handler = getRouteHandler(radiologyReportGeneratorRouter, "get", "/drafts");
    const req = { query: { studyId: "999" } };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.drafts).toEqual([]);
  });
});
