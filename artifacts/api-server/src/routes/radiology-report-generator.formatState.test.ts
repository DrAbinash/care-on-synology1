import { beforeEach, describe, expect, test, vi } from "vitest";

/**
 * POST /save-draft's structured_json write path.
 *
 * This file used to be a three-line source-text ratchet asserting that the
 * strings `let formatStatePersistFailed = false` and
 * `res.json({ success: true, draft, formatStatePersistFailed })` appeared in the
 * route file. That could not fail when the behaviour broke, only when the
 * wording changed, so it is replaced with the real handler invoked over mocks —
 * the technique already used by radiology-report-generator.d3.test.ts.
 *
 * What it pins:
 *   - one request writes structured_json ONCE, carrying every key it brought
 *     (it used to be six independent read-modify-writes of the same column),
 *   - a request that brings none of them does not write at all,
 *   - a write failure is reported to the client on an otherwise-successful
 *     response, because the narrative columns did commit and the client must
 *     keep the study dirty rather than conclude the save worked.
 */

let persistCalls: Array<{ draftId: number; patch: Record<string, unknown> }>;
let persistShouldThrow: boolean;
let draftRowForRead: Record<string, unknown> | undefined;
let a4RegenCallCount: number;

vi.mock("../lib/persistCareStructuredFormatState", () => ({
  persistCareStructuredJsonPatch: async (draftId: number, patch: Record<string, unknown>) => {
    persistCalls.push({ draftId, patch });
    if (persistShouldThrow) throw new Error("simulated structured_json persist failure");
  },
}));

vi.mock("../lib/featureFlags", () => ({
  isFeatureEnabledServer: async () => false,
}));

// A4's cache regeneration has its own suite; stub it so it cannot interfere.
vi.mock("../lib/radiologyStructuredJsonCache", () => ({
  regenerateDraftStructuredJson: async () => { a4RegenCallCount++; },
}));

// The route imports the D3.5 catalog stack at module load, and drizzleStore
// reads a dozen tables off @workspace/db/schema. Stubbing the three modules is
// what keeps this file's schema mock small — same approach as d3.test.ts.
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
  return {
    db: {
      select: () => ({
        from: (tbl: { __name?: string }) => ({
          where: () => {
            if (tbl?.__name === "worklist") return { limit: async () => [] };
            return {
              then: (resolve: (v: unknown) => void) => resolve(draftRowForRead ? [draftRowForRead] : []),
              orderBy: () => ({ limit: async () => [] }),
              limit: async () => (draftRowForRead ? [draftRowForRead] : []),
            };
          },
        }),
      }),
      insert: () => ({
        values: (v: Record<string, unknown>) => ({
          returning: async () => [{ id: 101, worklistId: null, patientId: 2, ...v }],
        }),
      }),
      update: () => ({
        set: (v: Record<string, unknown>) => ({
          where: () => ({ returning: async () => [{ id: 101, worklistId: null, patientId: 2, ...v }] }),
        }),
      }),
      transaction: async (fn: (tx: unknown) => Promise<void>) => {
        await fn({
          delete: () => ({ where: () => Promise.resolve() }),
          insert: () => ({ values: () => Promise.resolve() }),
        });
      },
    },
    radiologyReportDraftsTable: draftsTable,
    reportFindingInstancesTable: { __name: "rfi" },
    radiologyWorklistTable: worklistTable,
    patientReportsTable: { __name: "patient_reports" },
  };
});

vi.mock("@workspace/db/schema", () => ({
  radiologyReportDraftsTable: { __name: "drafts", id: "id", worklistId: "worklist_id" },
  radiologyWorklistTable: { __name: "worklist", id: "id" },
  reportFindingInstancesTable: { __name: "rfi", draftId: "draft_id" },
  radiologyQuickFindingsTable: { __name: "quick_findings", id: "id", label: "label" },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getRouteHandler(router: any, method: "post", path: string) {
  const layer = router.stack.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (l: any) => l.route && l.route.path === path && l.route.methods[method],
  );
  if (!layer) throw new Error(`${method.toUpperCase()} ${path} handler not found`);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

async function saveDraft(body: Record<string, unknown>) {
  const { radiologyReportGeneratorRouter } = await import("./radiology-report-generator");
  const handler = getRouteHandler(radiologyReportGeneratorRouter, "post", "/save-draft");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
  await handler({ body, staffSession: { subjectName: "Dr. Test" } }, res);
  return res;
}

const NARRATIVE = {
  studyId: 7,
  rawFindings: "No acute intracranial abnormality.",
  impression: ["Normal study."],
};

beforeEach(() => {
  persistCalls = [];
  persistShouldThrow = false;
  draftRowForRead = undefined;
  a4RegenCallCount = 0;
});

describe("POST /save-draft — structured_json is written once per request", () => {
  test("every envelope key the request carries lands in a single write", async () => {
    const res = await saveDraft({
      ...NARRATIVE,
      observationLedger: { entries: [{ id: "e1" }] },
      viewerMeasurements: { items: [{ id: 1 }] },
      canalApProvenance: { "l4-5": { manualOverride: true } },
      linkedStudy: { studyId: 88, title: "MRI Lumbar Spine" },
      appliedPatterns: [{ patternId: "p1", version: 1, bundleId: "b1", appliedAt: "x" }],
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    // Six keys in, ONE write out. Six separate read-modify-writes of the same
    // column is what let two overlapping autosaves erase each other.
    expect(persistCalls).toHaveLength(1);
    expect(persistCalls[0]!.draftId).toBe(101);
    expect(Object.keys(persistCalls[0]!.patch).sort()).toEqual([
      "appliedPatterns",
      "canalApProvenance",
      "linkedStudy",
      "observationLedger",
      "viewerMeasurements",
      "vascularTechnique",
    ].sort());
    expect(res.body.structuredJsonPersistFailed).toBe(false);
  });

  test("structured format state is normalized into the patch", async () => {
    await saveDraft({
      ...NARRATIVE,
      structuredFormatState: {
        kind: "care.structured_format_state",
        formatId: 9,
        values: { "discs::l4-5": "bulge" },
      },
    });

    expect(persistCalls).toHaveLength(1);
    expect(persistCalls[0]!.patch.formatState).toMatchObject({
      kind: "care.structured_format_state",
      formatId: 9,
      formatVersion: 1,
      values: { "discs::l4-5": "bulge" },
    });
    expect(typeof (persistCalls[0]!.patch.formatState as { updatedAt: string }).updatedAt)
      .toBe("string");
  });

  test("a narrative-only save does not touch structured_json at all", async () => {
    const res = await saveDraft({ ...NARRATIVE });

    expect(res.body.success).toBe(true);
    expect(persistCalls).toHaveLength(0);
    expect(res.body.structuredJsonPersistFailed).toBe(false);
  });

  test("an explicit null appliedPatterns is a clear, and still writes", async () => {
    await saveDraft({ ...NARRATIVE, appliedPatterns: null });
    expect(persistCalls).toHaveLength(1);
    expect(persistCalls[0]!.patch.appliedPatterns).toEqual([]);
  });

  test("a null observationLedger is 'no signal', so nothing is written for it", async () => {
    await saveDraft({ ...NARRATIVE, observationLedger: null });
    expect(persistCalls).toHaveLength(0);
  });
});

describe("POST /save-draft — a failed structured_json write is reported, not hidden", () => {
  test("success stays true, the draft is returned, and the failure flag is set", async () => {
    persistShouldThrow = true;
    const res = await saveDraft({
      ...NARRATIVE,
      observationLedger: { entries: [{ id: "e1" }] },
    });

    // The narrative columns committed, so this is not a failed save — but the
    // client must be told the envelope did not persist, or it clears its dirty
    // flag and the loss becomes permanent and invisible.
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.draft?.id).toBe(101);
    expect(res.body.structuredJsonPersistFailed).toBe(true);
  });

  test("the old formatStatePersistFailed field is gone", async () => {
    const res = await saveDraft({ ...NARRATIVE });
    expect(res.body).not.toHaveProperty("formatStatePersistFailed");
    expect(res.body).toHaveProperty("structuredJsonPersistFailed");
  });
});
