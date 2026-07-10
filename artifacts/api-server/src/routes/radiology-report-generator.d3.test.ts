import { describe, expect, test, vi, beforeEach } from "vitest";

// Ticket D3 route-integration coverage — the canonical D1 structured_json
// persistence wired into POST /save-draft. Self-contained mocks (its own
// @workspace/db + featureFlags + D3-writer mocks), completely separate from
// radiology-report-generator.test.ts so the legacy-save / A3.2 / A4 / A5 suite
// there is untouched. This file proves ONLY the D3 wiring, gating, and
// isolation — the adapter/writer/validator/hash logic itself is proven purely
// in radiologyD1DraftWriter.test.ts.
//
// Follows the same no-HTTP-server technique used across this codebase: reach
// into the Express Router's stack and invoke the real handler directly.

// Feature-flag state: D3 requires BOTH flags. Independently controllable.
let coreFlagEnabled: boolean;
let d1DraftFlagEnabled: boolean;

// D3-writer mock: control what buildAndValidateDraftD1Document returns/throws
// so the route test focuses on wiring, not the (separately-tested) internals.
let d1BuildResult: unknown;
let d1BuildShouldThrow: boolean;
let buildCallCount: number;

// DB mock recording.
let insertValuesCalls: Record<string, unknown>[];
let legacyUpdateSetCalls: Record<string, unknown>[];
let d1UpdateSetCalls: Record<string, unknown>[];
let patientReportsWriteCount: number;
let worklistRow: Record<string, unknown> | null;
let draftRowForRead: Record<string, unknown> | undefined;
let a4RegenCallCount: number;

vi.mock("../lib/featureFlags", () => ({
  isFeatureEnabledServer: async (key: string) =>
    key === "ff_radiology_structured_d1_draft" ? d1DraftFlagEnabled : coreFlagEnabled,
}));

// A4 cache regeneration is exercised in its own suite; here it must not
// interfere with the D3 assertions, so stub it to a recorded no-op.
vi.mock("../lib/radiologyStructuredJsonCache", () => ({
  regenerateDraftStructuredJson: async () => { a4RegenCallCount++; },
}));

vi.mock("../lib/radiologyD1DraftWriter", () => ({
  buildAndValidateDraftD1Document: async () => {
    buildCallCount++;
    if (d1BuildShouldThrow) throw new Error("simulated D3 writer/validator failure");
    return d1BuildResult;
  },
}));

vi.mock("@workspace/db", () => {
  const draftsTable = { __name: "drafts" };
  const worklistTable = { __name: "worklist" };
  const patientReportsTable = { __name: "patient_reports" };
  return {
    db: {
      select: () => ({
        from: (tbl: { __name?: string }) => ({
          where: (..._args: unknown[]) => {
            // Worklist lookup in the D3 block: .where().limit(1)
            if (tbl?.__name === "worklist") {
              return { limit: async () => (worklistRow ? [worklistRow] : []) };
            }
            // GET /drafts/:id read path: .where() awaited directly (no limit)
            const thenable = {
              then: (resolve: (v: unknown) => void) => resolve(draftRowForRead ? [draftRowForRead] : []),
              // GET /drafts list path chains .orderBy().limit()
              orderBy: () => ({ limit: async () => [] }),
              limit: async () => (draftRowForRead ? [draftRowForRead] : []),
            };
            return thenable;
          },
        }),
      }),
      insert: (tbl: { __name?: string }) => ({
        values: (v: Record<string, unknown>) => {
          if (tbl?.__name === "patient_reports") patientReportsWriteCount++;
          insertValuesCalls.push(v);
          return { returning: async () => [{ id: 101, worklistId: null, patientId: 2, ...v }] };
        },
      }),
      update: (tbl: { __name?: string }) => ({
        set: (v: Record<string, unknown>) => {
          if (tbl?.__name === "patient_reports") patientReportsWriteCount++;
          if (Object.keys(v).length === 1 && Object.prototype.hasOwnProperty.call(v, "structuredJsonD1")) {
            d1UpdateSetCalls.push(v);
            return { where: () => Promise.resolve() };
          }
          legacyUpdateSetCalls.push(v);
          return { where: () => ({ returning: async () => [{ id: 42, worklistId: null, patientId: 2, ...v }] }) };
        },
      }),
      transaction: async (fn: (tx: unknown) => Promise<void>) => {
        // A3.2 dual-write path (runs when core flag is on); no-op tx.
        const tx = {
          delete: () => ({ where: () => Promise.resolve() }),
          insert: () => ({ values: () => Promise.resolve() }),
        };
        await fn(tx);
      },
    },
    radiologyReportDraftsTable: draftsTable,
    reportFindingInstancesTable: { __name: "rfi" },
    radiologyWorklistTable: worklistTable,
    patientReportsTable,
  };
});

vi.mock("@workspace/db/schema", () => ({
  radiologyReportDraftsTable: { __name: "drafts", id: "id", worklistId: "worklist_id" },
  radiologyWorklistTable: { __name: "worklist", id: "id" },
  reportFindingInstancesTable: { __name: "rfi", draftId: "draft_id" },
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

const OK_DOC = { schema_version: "1.0.0", audit: { content_sha256: "sha256:deadbeef" } };

async function saveDraft(body: Record<string, unknown>) {
  const { radiologyReportGeneratorRouter } = await import("./radiology-report-generator");
  const handler = getRouteHandler(radiologyReportGeneratorRouter, "post", "/save-draft");
  const req = { body, staffSession: { subjectName: "Dr. Test" } };
  const res = makeRes();
  await handler(req, res);
  return res;
}

describe("Ticket D3 — POST /save-draft D1 persistence wiring", () => {
  beforeEach(() => {
    coreFlagEnabled = true;       // D3 requires core; default it on for these tests
    d1DraftFlagEnabled = true;    // and the D3 flag on, except where a test turns it off
    d1BuildResult = { ok: true, document: OK_DOC, contentSha256: "sha256:deadbeef", warnings: [] };
    d1BuildShouldThrow = false;
    buildCallCount = 0;
    insertValuesCalls = [];
    legacyUpdateSetCalls = [];
    d1UpdateSetCalls = [];
    patientReportsWriteCount = 0;
    worklistRow = null;
    draftRowForRead = undefined;
    a4RegenCallCount = 0;
  });

  const findingsBody = { studyId: 7, modality: "MRI", findings: [{ findingId: 10, params: { side: "left" } }] };

  test("D3 flag OFF → no D1 write, legacy save still succeeds", async () => {
    d1DraftFlagEnabled = false;
    const res = await saveDraft(findingsBody);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(insertValuesCalls).toHaveLength(1); // legacy save happened
    expect(buildCallCount).toBe(0);            // D3 adapter never invoked
    expect(d1UpdateSetCalls).toHaveLength(0);  // structured_json_d1 never written
  });

  test("core flag OFF → D3 does not run even if the D3 flag is on", async () => {
    coreFlagEnabled = false;
    const res = await saveDraft(findingsBody);
    expect(res.statusCode).toBe(200);
    expect(buildCallCount).toBe(0);
    expect(d1UpdateSetCalls).toHaveLength(0);
  });

  test("both flags ON + adapter ok → persists the D1 document to structured_json_d1", async () => {
    const res = await saveDraft(findingsBody);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(buildCallCount).toBe(1);
    expect(d1UpdateSetCalls).toHaveLength(1);
    expect(d1UpdateSetCalls[0]).toEqual({ structuredJsonD1: OK_DOC });
    // legacy save is authoritative and independent
    expect(insertValuesCalls).toHaveLength(1);
    // no final report is ever written by save-draft
    expect(patientReportsWriteCount).toBe(0);
  });

  test("adapter SKIPS (incomplete data) → no D1 write, legacy save unaffected", async () => {
    d1BuildResult = { ok: false, skipReasons: ["study_context.identifiers unavailable"] };
    const res = await saveDraft(findingsBody);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(buildCallCount).toBe(1);
    expect(d1UpdateSetCalls).toHaveLength(0); // skipped
    expect(insertValuesCalls).toHaveLength(1); // legacy save intact
  });

  test("writer/validator THROWS → caught, legacy save still succeeds (isolation)", async () => {
    d1BuildShouldThrow = true;
    const res = await saveDraft(findingsBody);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(d1UpdateSetCalls).toHaveLength(0);
    expect(insertValuesCalls).toHaveLength(1);
  });

  test("D1 UPDATE throws → caught, legacy save still succeeds (isolation)", async () => {
    // Make only the structured_json_d1 update reject.
    d1BuildResult = { ok: true, document: OK_DOC, contentSha256: "sha256:x", warnings: [] };
    const { radiologyReportGeneratorRouter } = await import("./radiology-report-generator");
    // Patch the update mock for this test to throw on the d1 update.
    const dbMod = await import("@workspace/db");
    const originalUpdate = (dbMod.db as any).update;
    (dbMod.db as any).update = (tbl: any) => ({
      set: (v: Record<string, unknown>) => {
        if (Object.keys(v).length === 1 && "structuredJsonD1" in v) {
          return { where: () => Promise.reject(new Error("simulated d1 update failure")) };
        }
        legacyUpdateSetCalls.push(v);
        return { where: () => ({ returning: async () => [{ id: 42, worklistId: null, patientId: 2, ...v }] }) };
      },
    });
    try {
      const handler = getRouteHandler(radiologyReportGeneratorRouter, "post", "/save-draft");
      const req = { body: findingsBody, staffSession: { subjectName: "Dr. Test" } };
      const res = makeRes();
      await handler(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    } finally {
      (dbMod.db as any).update = originalUpdate;
    }
  });

  test("old client omitting `findings` → D3 never runs (guarded, like A3.2/A4)", async () => {
    const res = await saveDraft({ studyId: 7, modality: "MRI" }); // no findings key
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(buildCallCount).toBe(0);
    expect(d1UpdateSetCalls).toHaveLength(0);
  });

  test("explicit findings: [] → D3 still runs (a real deselect-all signal)", async () => {
    const res = await saveDraft({ studyId: 7, modality: "MRI", findings: [] });
    expect(res.statusCode).toBe(200);
    expect(buildCallCount).toBe(1);
    expect(d1UpdateSetCalls).toHaveLength(1);
  });

  test("existing A4 regeneration still runs (no regression from D3)", async () => {
    await saveDraft(findingsBody);
    expect(a4RegenCallCount).toBe(1);
  });
});

describe("Ticket D3 — GET /drafts/:id returns structured_json_d1 with the draft (read path)", () => {
  beforeEach(() => {
    coreFlagEnabled = false;
    d1DraftFlagEnabled = false;
    draftRowForRead = { id: 5, structuredJson: null, structuredJsonD1: { schema_version: "1.0.0" } };
  });

  test("the stored D1 document is included in the draft read (select returns all columns)", async () => {
    const { radiologyReportGeneratorRouter } = await import("./radiology-report-generator");
    const handler = getRouteHandler(radiologyReportGeneratorRouter, "get", "/drafts/:id");
    const req = { params: { id: "5" }, query: {} };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.draft.structuredJsonD1).toEqual({ schema_version: "1.0.0" });
  });
});
