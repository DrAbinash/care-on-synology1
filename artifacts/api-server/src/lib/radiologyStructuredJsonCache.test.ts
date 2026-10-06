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
let existingDraftStructuredJson: unknown;
/** Which surface each DB operation ran on — "db" (no lock, no transaction) or
 * "tx". A transaction that the reads and the write never actually use would
 * still pass a count, so the surface is what pins the lock. */
let opSurfaces: string[];
let forModeCalls: string[];
let transactionCount: number;
let eqCalls: Array<[unknown, unknown]>;

vi.mock("./featureFlags", () => ({
  isFeatureEnabledServer: async (_key: string) => structuredFlagEnabled,
}));

/** Builds the query surface for either `db` or a transaction handle, so both
 * shapes are identical and an operation that quietly stayed on `db` is caught
 * by opSurfaces rather than by a missing method. */
function querySurface(surface: string) {
  return {
    select: (proj?: Record<string, unknown>) => {
      if (proj && Object.prototype.hasOwnProperty.call(proj, "structuredJson")) {
        opSurfaces.push(`draft-read:${surface}`);
        // Both chain shapes resolve, so dropping .for("update") fails an
        // assertion about the lock instead of throwing a TypeError.
        const tail = {
          limit: async () => [{ structuredJson: existingDraftStructuredJson }],
        };
        return {
          from: () => ({
            where: () => ({
              ...tail,
              for: (mode: string) => {
                forModeCalls.push(mode);
                return tail;
              },
            }),
          }),
        };
      }
      opSurfaces.push(`findings-read:${surface}`);
      return {
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
      };
    },
    update: () => ({
      set: (v: Record<string, unknown>) => {
        opSurfaces.push(`write:${surface}`);
        updateSetCalls.push(v);
        return { where: async () => undefined };
      },
    }),
  };
}

vi.mock("@workspace/db", () => ({
  db: {
    ...querySurface("db"),
    transaction: async (fn: (tx: unknown) => Promise<void>) => {
      transactionCount++;
      await fn(querySurface("tx"));
    },
  },
}));

vi.mock("@workspace/db/schema", () => ({
  radiologyReportDraftsTable: { id: "id", structuredJson: "structured_json" },
  reportFindingInstancesTable: { id: "id", draftId: "draft_id" },
}));

// eq/asc are recorded rather than exercised: the point is which draft each
// operation targeted, and a real drizzle SQL object hides its operands.
vi.mock("drizzle-orm", () => ({
  eq: (left: unknown, right: unknown) => {
    eqCalls.push([left, right]);
    return { eq: [left, right] };
  },
  asc: (col: unknown) => ({ asc: col }),
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
    existingDraftStructuredJson = null;
    opSurfaces = [];
    forModeCalls = [];
    transactionCount = 0;
    eqCalls = [];
  });

  test("flag OFF: no-op — does not query or update anything", async () => {
    structuredFlagEnabled = false;
    const { regenerateDraftStructuredJson } = await import("./radiologyStructuredJsonCache");
    await regenerateDraftStructuredJson(42);

    expect(selectFromCalls).toHaveLength(0);
    expect(updateSetCalls).toHaveLength(0);
    // The flag check stays outside the transaction, so an OFF clinic never
    // opens one and never takes a row lock on a draft save.
    expect(transactionCount).toBe(0);
    expect(forModeCalls).toHaveLength(0);
  });

  test("reads and writes the draft under a row lock, all three inside one transaction", async () => {
    findingInstanceRows = [findingRow({ id: 1, findingId: 8842 })];
    const { regenerateDraftStructuredJson } = await import("./radiologyStructuredJsonCache");
    await regenerateDraftStructuredJson(42);

    expect(transactionCount).toBe(1);
    // FOR UPDATE is what serializes this writer against
    // persistCareStructuredJsonPatch. A bare transaction is not enough under
    // READ COMMITTED — both could still read the pre-write value — and a lock
    // only one writer takes protects nothing at all.
    expect(forModeCalls).toEqual(["update"]);
    expect(opSurfaces).toEqual(["draft-read:tx", "findings-read:tx", "write:tx"]);
    // Locks the draft it was given, reads that draft's findings, writes that
    // draft — a mismatch here would corrupt a different study's cache.
    expect(eqCalls).toEqual([
      ["id", 42],
      ["draft_id", 42],
      ["id", 42],
    ]);
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

  test("preserves care.structured_format_state when regenerating the A4 cache", async () => {
    findingInstanceRows = [findingRow({ id: 1, findingId: 8842 })];
    const formatState = {
      kind: "care.structured_format_state" as const,
      formatId: 9,
      formatVersion: 1,
      values: { "discs::l4-5::morphology": "bulge" },
      updatedAt: "2026-08-17T00:00:00.000Z",
    };
    existingDraftStructuredJson = {
      kind: "care.structured_json_envelope",
      a4Cache: null,
      careStructuredFormat: formatState,
    };
    const { regenerateDraftStructuredJson, buildStructuredJsonFromFindingInstances } = await import(
      "./radiologyStructuredJsonCache"
    );
    await regenerateDraftStructuredJson(42);
    expect(updateSetCalls[0]!.structuredJson).toEqual({
      kind: "care.structured_json_envelope",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      a4Cache: buildStructuredJsonFromFindingInstances(findingInstanceRows as any),
      careStructuredFormat: formatState,
    });
  });

  // The regression this PR exists to prevent. composeStructuredJsonColumn
  // merges into the `existing` value it is handed, so a regeneration that read
  // the column without holding the row lock would compose against a snapshot a
  // concurrent persistCareStructuredJsonPatch had already superseded, and its
  // UPDATE would then drop every key that patch had written. This asserts each
  // of them survives by reading the written column back through the same
  // extractors the rest of the app uses — not by comparing a hand-copied
  // envelope, which would keep passing if an extractor changed meaning.
  test("regenerating the cache keeps every envelope key another writer put there", async () => {
    findingInstanceRows = [findingRow({ id: 1, findingId: 8842 })];
    const {
      extractA4Cache,
      extractCareAppliedPatterns,
      extractCareCanalApProvenance,
      extractCareLinkedStudy,
      extractCareObservationLedger,
      extractCareReportFormatIdentity,
      extractCareStructuredFormat,
      extractCareVascularTechnique,
      extractCareViewerMeasurements,
    } = await import("./structuredJsonColumn");
    existingDraftStructuredJson = {
      kind: "care.structured_json_envelope",
      a4Cache: [{ findingId: 11111 }], // the stale cache being replaced
      careStructuredFormat: {
        kind: "care.structured_format_state",
        formatId: 9,
        formatVersion: 2,
        values: { "discs::l4-5::morphology": "bulge" },
        updatedAt: "2026-08-17T00:00:00.000Z",
      },
      careObservationLedger: { entries: [{ id: "e1", text: "L4-5 disc bulge." }] },
      careViewerMeasurements: { items: [{ id: 1, label: "Canal AP", valueMm: 12 }] },
      careCanalApProvenance: { "l4-5": { manualOverride: true } },
      careVascularTechnique: { performed: ["mra"], overridden: false },
      careReportFormatIdentity: {
        kind: "care.report_format_identity.v1",
        name: "MRI Lumbar Spine",
        appliedAt: "2026-09-01T00:00:00.000Z",
      },
      linkedStudyId: 77,
      careLinkedStudy: { studyId: 77, title: "MRI BRAIN", accessionNumber: "A-77" },
      careAppliedPatterns: [
        { patternId: "p1", version: 3, bundleId: "b1", appliedAt: "2026-09-02T00:00:00.000Z" },
      ],
    };

    const { regenerateDraftStructuredJson, buildStructuredJsonFromFindingInstances } = await import(
      "./radiologyStructuredJsonCache"
    );
    await regenerateDraftStructuredJson(42);

    const written = updateSetCalls[0]!.structuredJson;
    // Only the cache changed.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(extractA4Cache(written)).toEqual(buildStructuredJsonFromFindingInstances(findingInstanceRows as any));
    // Everything the other writer owns is still there, byte for byte.
    expect(extractCareStructuredFormat(written)).toEqual(
      (existingDraftStructuredJson as Record<string, unknown>).careStructuredFormat,
    );
    expect(extractCareObservationLedger(written)).toEqual({ entries: [{ id: "e1", text: "L4-5 disc bulge." }] });
    expect(extractCareViewerMeasurements(written)).toEqual({ items: [{ id: 1, label: "Canal AP", valueMm: 12 }] });
    expect(extractCareCanalApProvenance(written)).toEqual({ "l4-5": { manualOverride: true } });
    expect(extractCareVascularTechnique(written)).toEqual({ performed: ["mra"], overridden: false });
    expect(extractCareReportFormatIdentity(written)).toMatchObject({ name: "MRI Lumbar Spine" });
    expect(extractCareLinkedStudy(written)).toMatchObject({ studyId: 77, title: "MRI BRAIN", accessionNumber: "A-77" });
    expect(extractCareAppliedPatterns(written)).toEqual([
      { patternId: "p1", version: 3, bundleId: "b1", appliedAt: "2026-09-02T00:00:00.000Z" },
    ]);
  });
});
