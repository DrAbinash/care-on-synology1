import { describe, expect, test, vi, beforeEach } from "vitest";

// Ticket A4 coverage — standalone unit tests for the pure cache-building
// function and the regeneration function, mocked independently of the
// save-draft route (which has its own integration-style coverage in
// radiology-report-generator.test.ts proving the wiring itself).

let findingInstanceRows: Record<string, unknown>[];
let selectFromCalls: unknown[];
let updateSetCalls: Record<string, unknown>[];
let structuredFlagEnabled: boolean;
let selectShouldThrow: boolean;

vi.mock("./featureFlags", () => ({
  isFeatureEnabledServer: async (_key: string) => structuredFlagEnabled,
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => {
        selectFromCalls.push(table);
        return {
          where: () => ({
            orderBy: async () => {
              if (selectShouldThrow) throw new Error("simulated select failure");
              return findingInstanceRows;
            },
          }),
        };
      },
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        updateSetCalls.push(v);
        return { where: async () => undefined };
      },
    }),
  },
}));

function findingRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    draftId: 42,
    reportId: null,
    findingId: 8842,
    anatomicZoneId: null,
    structureId: null,
    category: "",
    modality: "",
    structuredJson: { side: "", severity: "moderate", chronicity: "", level: "L4-5", value: "" },
    catalogVersion: "0",
    source: "quickselect",
    confirmed: false,
    confirmedBy: null,
    confirmedAt: null,
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: null,
    ...overrides,
  };
}

describe("buildStructuredJsonFromFindingInstances — pure mapping", () => {
  test("maps each FindingInstance row into the cache shape, in row order", async () => {
    const { buildStructuredJsonFromFindingInstances } = await import("./radiologyStructuredJsonCache");
    const rows = [
      findingRow({ id: 1, findingId: 8842 }),
      findingRow({ id: 2, findingId: 9001, source: "manual", confirmed: true }),
    ];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cache = buildStructuredJsonFromFindingInstances(rows as any);

    expect(cache).toEqual([
      {
        findingId: 8842, anatomicZoneId: null, structureId: null, category: "", modality: "",
        structuredJson: rows[0]!.structuredJson, catalogVersion: "0", source: "quickselect", confirmed: false,
      },
      {
        findingId: 9001, anatomicZoneId: null, structureId: null, category: "", modality: "",
        structuredJson: rows[1]!.structuredJson, catalogVersion: "0", source: "manual", confirmed: true,
      },
    ]);
  });

  test("zero rows maps to null, not an empty array", async () => {
    const { buildStructuredJsonFromFindingInstances } = await import("./radiologyStructuredJsonCache");
    expect(buildStructuredJsonFromFindingInstances([])).toBeNull();
  });
});

describe("regenerateDraftStructuredJson", () => {
  beforeEach(() => {
    findingInstanceRows = [];
    selectFromCalls = [];
    updateSetCalls = [];
    structuredFlagEnabled = true;
    selectShouldThrow = false;
  });

  test("flag OFF: no-op — does not query or update anything", async () => {
    structuredFlagEnabled = false;
    const { regenerateDraftStructuredJson } = await import("./radiologyStructuredJsonCache");
    await regenerateDraftStructuredJson(42);

    expect(selectFromCalls).toHaveLength(0);
    expect(updateSetCalls).toHaveLength(0);
  });

  test("structured_json matches the current FindingInstance rows for that draft", async () => {
    findingInstanceRows = [findingRow({ id: 1, findingId: 8842 }), findingRow({ id: 2, findingId: 9001 })];
    const { regenerateDraftStructuredJson, buildStructuredJsonFromFindingInstances } = await import(
      "./radiologyStructuredJsonCache"
    );
    await regenerateDraftStructuredJson(42);

    expect(updateSetCalls).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(updateSetCalls[0]!.structuredJson).toEqual(buildStructuredJsonFromFindingInstances(findingInstanceRows as any));
  });

  test("repeated regeneration against unchanged rows is idempotent — same cache both times", async () => {
    findingInstanceRows = [findingRow({ id: 1, findingId: 8842 }), findingRow({ id: 2, findingId: 9001 })];
    const { regenerateDraftStructuredJson } = await import("./radiologyStructuredJsonCache");

    await regenerateDraftStructuredJson(42);
    await regenerateDraftStructuredJson(42);

    expect(updateSetCalls).toHaveLength(2);
    expect(updateSetCalls[0]!.structuredJson).toEqual(updateSetCalls[1]!.structuredJson);
  });

  test("zero FindingInstance rows clears structured_json to null (not an empty array)", async () => {
    findingInstanceRows = [];
    const { regenerateDraftStructuredJson } = await import("./radiologyStructuredJsonCache");
    await regenerateDraftStructuredJson(42);

    expect(updateSetCalls).toHaveLength(1);
    expect(updateSetCalls[0]!.structuredJson).toBeNull();
  });

  test("propagates a DB failure to its caller rather than swallowing it — isolation is the caller's job", async () => {
    selectShouldThrow = true;
    const { regenerateDraftStructuredJson } = await import("./radiologyStructuredJsonCache");
    await expect(regenerateDraftStructuredJson(42)).rejects.toThrow("simulated select failure");
    expect(updateSetCalls).toHaveLength(0);
  });
});
