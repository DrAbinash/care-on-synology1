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

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
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
        updateSetCalls.push(v);
        return {
          where: () => ({
            returning: async () => (updateResult ? [{ ...updateResult, ...v }] : []),
          }),
        };
      },
    }),
  },
  radiologyReportDraftsTable: {
    id: "id", studyId: "study_id", patientId: "patient_id", updatedAt: "updated_at",
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
