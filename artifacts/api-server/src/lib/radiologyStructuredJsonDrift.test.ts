import { describe, expect, test, vi, beforeEach } from "vitest";

// Ticket A5 coverage — standalone unit tests for the drift-check functions,
// mocked independently of the save-draft route. See
// radiologyStructuredJsonCache.test.ts for the analogous A4 pattern this
// follows.

let structuredFlagEnabled: boolean;

// checkDraftStructuredJsonDrift issues, per call, one single-row "cache"
// select (chained .limit(1)) and one "finding rows" select (chained
// .orderBy()). scanDraftsForStructuredJsonDrift calls it once per candidate
// draft, so these queues are consumed in call order — see the "scan" tests
// below for how the candidate order is derived.
let cacheLookupQueue: Array<{ structuredJson: unknown } | undefined>;
let findingRowsQueue: Array<Record<string, unknown>[]>;

// Feeds scanDraftsForStructuredJsonDrift's two candidate-discovery queries.
let distinctFindingDraftIds: Array<{ draftId: number | null }>;
let cachedDraftIds: Array<{ id: number }>;

vi.mock("./featureFlags", () => ({
  isFeatureEnabledServer: async (_key: string) => structuredFlagEnabled,
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: (proj?: Record<string, unknown>) => {
      if (proj && Object.prototype.hasOwnProperty.call(proj, "structuredJson")) {
        // Single-draft cache lookup: db.select({structuredJson}).from(drafts).where(...).limit(1)
        return {
          from: () => ({
            where: () => ({
              limit: async () => {
                const next = cacheLookupQueue.shift();
                return next === undefined ? [] : [next];
              },
            }),
          }),
        };
      }
      if (proj && Object.prototype.hasOwnProperty.call(proj, "id")) {
        // Cached-draft-ids scan query: db.select({id}).from(drafts).where(isNotNull(...)) — awaited directly.
        return {
          from: () => ({
            where: async () => cachedDraftIds,
          }),
        };
      }
      // Finding rows lookup: db.select().from(findingInstances).where(...).orderBy(...)
      return {
        from: () => ({
          where: () => ({
            orderBy: async () => findingRowsQueue.shift() ?? [],
          }),
        }),
      };
    },
    selectDistinct: () => ({
      from: () => ({
        where: async () => distinctFindingDraftIds,
      }),
    }),
  },
}));

function findingRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, draftId: 42, reportId: null, findingId: 8842, anatomicZoneId: null, structureId: null,
    category: "", modality: "", structuredJson: { side: "", severity: "moderate", chronicity: "", level: "L4-5", value: "" },
    catalogVersion: "0", source: "quickselect", confirmed: false, confirmedBy: null, confirmedAt: null,
    createdAt: "2026-07-09T00:00:00.000Z", updatedAt: null,
    ...overrides,
  };
}

const CACHE_ENTRY_A = {
  findingId: 8842, anatomicZoneId: null, structureId: null, category: "", modality: "",
  structuredJson: { side: "", severity: "moderate", chronicity: "", level: "L4-5", value: "" },
  catalogVersion: "0", source: "quickselect", confirmed: false,
};

const CACHE_ENTRY_B = {
  findingId: 9001, anatomicZoneId: null, structureId: null, category: "", modality: "",
  structuredJson: { side: "right", severity: "mild", chronicity: "chronic", level: "", value: "" },
  catalogVersion: "0", source: "quickselect", confirmed: false,
};

describe("checkDraftStructuredJsonDrift", () => {
  beforeEach(() => {
    structuredFlagEnabled = true;
    cacheLookupQueue = [];
    findingRowsQueue = [];
    distinctFindingDraftIds = [];
    cachedDraftIds = [];
  });

  test("in_sync: cache exactly matches the rebuilt value", async () => {
    cacheLookupQueue = [{ structuredJson: [CACHE_ENTRY_A] }];
    findingRowsQueue = [[findingRow({ id: 1, findingId: 8842 })]];
    const { checkDraftStructuredJsonDrift } = await import("./radiologyStructuredJsonDrift");

    const result = await checkDraftStructuredJsonDrift(42);

    expect(result.status).toBe("in_sync");
    expect(result.driftDetected).toBe(false);
  });

  test("in_sync: both empty — null cache, zero current findings", async () => {
    cacheLookupQueue = [{ structuredJson: null }];
    findingRowsQueue = [[]];
    const { checkDraftStructuredJsonDrift } = await import("./radiologyStructuredJsonDrift");

    const result = await checkDraftStructuredJsonDrift(42);

    expect(result.status).toBe("in_sync");
    expect(result.driftDetected).toBe(false);
    expect(result.cache).toBeNull();
    expect(result.rebuilt).toBeNull();
  });

  test("in_sync despite object key reordering — jsonb does not preserve key order on read-back", async () => {
    // Same content as CACHE_ENTRY_A, but with keys written in a different
    // order, simulating what a real jsonb round-trip can produce.
    const reorderedCacheEntry = {
      source: "quickselect", confirmed: false, findingId: 8842, category: "", modality: "",
      structuredJson: { value: "", level: "L4-5", chronicity: "", severity: "moderate", side: "" },
      catalogVersion: "0", anatomicZoneId: null, structureId: null,
    };
    cacheLookupQueue = [{ structuredJson: [reorderedCacheEntry] }];
    findingRowsQueue = [[findingRow({ id: 1, findingId: 8842 })]];
    const { checkDraftStructuredJsonDrift } = await import("./radiologyStructuredJsonDrift");

    const result = await checkDraftStructuredJsonDrift(42);

    expect(result.status).toBe("in_sync");
    expect(result.driftDetected).toBe(false);
  });

  test("missing_cache: current findings exist but the cache is null", async () => {
    cacheLookupQueue = [{ structuredJson: null }];
    findingRowsQueue = [[findingRow({ id: 1, findingId: 8842 })]];
    const { checkDraftStructuredJsonDrift } = await import("./radiologyStructuredJsonDrift");

    const result = await checkDraftStructuredJsonDrift(42);

    expect(result.status).toBe("missing_cache");
    expect(result.driftDetected).toBe(true);
    expect(result.cache).toBeNull();
    expect(result.rebuilt).not.toBeNull();
  });

  test("empty_findings_stale_cache: cache still has data but current findings are now zero", async () => {
    cacheLookupQueue = [{ structuredJson: [CACHE_ENTRY_A] }];
    findingRowsQueue = [[]];
    const { checkDraftStructuredJsonDrift } = await import("./radiologyStructuredJsonDrift");

    const result = await checkDraftStructuredJsonDrift(42);

    expect(result.status).toBe("empty_findings_stale_cache");
    expect(result.driftDetected).toBe(true);
    expect(result.rebuilt).toBeNull();
  });

  test("stale_cache: both non-null but content differs (a finding changed since the cache was built)", async () => {
    cacheLookupQueue = [{ structuredJson: [CACHE_ENTRY_A] }];
    findingRowsQueue = [[findingRow({ id: 2, findingId: 9001, structuredJson: CACHE_ENTRY_B.structuredJson })]];
    const { checkDraftStructuredJsonDrift } = await import("./radiologyStructuredJsonDrift");

    const result = await checkDraftStructuredJsonDrift(42);

    expect(result.status).toBe("stale_cache");
    expect(result.driftDetected).toBe(true);
  });

  test("in_sync: envelope wrapping A4 cache + format values still compares the array", async () => {
    cacheLookupQueue = [{
      structuredJson: {
        kind: "care.structured_json_envelope",
        a4Cache: [CACHE_ENTRY_A],
        careStructuredFormat: {
          kind: "care.structured_format_state",
          formatId: 9,
          formatVersion: 1,
          values: {},
          updatedAt: "2026-08-17T00:00:00.000Z",
        },
      },
    }];
    findingRowsQueue = [[findingRow({ id: 1, findingId: 8842 })]];
    const { checkDraftStructuredJsonDrift } = await import("./radiologyStructuredJsonDrift");

    const result = await checkDraftStructuredJsonDrift(42);

    expect(result.status).toBe("in_sync");
    expect(result.driftDetected).toBe(false);
    expect(result.cache).toEqual([CACHE_ENTRY_A]);
  });

  test("feature flag OFF: returns a trivial in_sync result without querying the database", async () => {
    structuredFlagEnabled = false;
    const { checkDraftStructuredJsonDrift } = await import("./radiologyStructuredJsonDrift");

    const result = await checkDraftStructuredJsonDrift(42);

    expect(result).toEqual({ draftId: 42, status: "in_sync", driftDetected: false, cache: null, rebuilt: null });
    expect(cacheLookupQueue).toHaveLength(0); // never consumed — proves no query ran
  });
});

describe("scanDraftsForStructuredJsonDrift", () => {
  beforeEach(() => {
    structuredFlagEnabled = true;
    cacheLookupQueue = [];
    findingRowsQueue = [];
    distinctFindingDraftIds = [];
    cachedDraftIds = [];
  });

  test("feature flag OFF: returns an empty summary without querying", async () => {
    structuredFlagEnabled = false;
    const { scanDraftsForStructuredJsonDrift } = await import("./radiologyStructuredJsonDrift");

    const summary = await scanDraftsForStructuredJsonDrift();

    expect(summary).toEqual({ checkedCount: 0, driftCount: 0, results: [] });
  });

  test("unions candidate draft ids from both sources (deduping overlap) and classifies each", async () => {
    // Draft 10: appears only via report_finding_instances, cache matches -> in_sync.
    // Draft 20: appears in BOTH sources (dedup case), content differs -> stale_cache.
    // Draft 30: appears only via a non-null cache with zero current findings -> empty_findings_stale_cache.
    distinctFindingDraftIds = [{ draftId: 10 }, { draftId: 20 }];
    cachedDraftIds = [{ id: 20 }, { id: 30 }];

    // Consumed in Set-iteration order: 10, 20, 30 (insertion order — 20 is
    // only added once despite appearing in both source queries).
    cacheLookupQueue = [
      { structuredJson: [CACHE_ENTRY_A] }, // draft 10
      { structuredJson: [CACHE_ENTRY_A] }, // draft 20 (stale vs rebuilt below)
      { structuredJson: [CACHE_ENTRY_A] }, // draft 30 (stale vs zero findings)
    ];
    findingRowsQueue = [
      [findingRow({ id: 1, findingId: 8842 })], // draft 10 -> rebuilds to CACHE_ENTRY_A -> matches
      [findingRow({ id: 2, findingId: 9001, structuredJson: CACHE_ENTRY_B.structuredJson })], // draft 20 -> differs
      [], // draft 30 -> zero current findings
    ];

    const { scanDraftsForStructuredJsonDrift } = await import("./radiologyStructuredJsonDrift");
    const summary = await scanDraftsForStructuredJsonDrift();

    expect(summary.checkedCount).toBe(3); // 10, 20, 30 — not 4, proving the overlap on 20 was deduped
    expect(summary.driftCount).toBe(2); // 20 and 30
    expect(summary.results).toEqual([
      { draftId: 10, status: "in_sync", driftDetected: false },
      { draftId: 20, status: "stale_cache", driftDetected: true },
      { draftId: 30, status: "empty_findings_stale_cache", driftDetected: true },
    ]);
  });

  test("no candidates: neither source has any rows, nothing is checked", async () => {
    const { scanDraftsForStructuredJsonDrift } = await import("./radiologyStructuredJsonDrift");
    const summary = await scanDraftsForStructuredJsonDrift();

    expect(summary).toEqual({ checkedCount: 0, driftCount: 0, results: [] });
  });
});
