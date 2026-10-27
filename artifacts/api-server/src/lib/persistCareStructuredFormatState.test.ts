import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * persistCareStructuredJsonPatch replaced six per-key writers that each did
 * their own SELECT → compose → UPDATE of radiology_report_drafts.structured_json.
 * These tests pin the three properties the replacement exists to provide:
 * one locked read, one compose, one write — and that it does not swallow its
 * own failure, because the handler reports that failure to the client and the
 * client keeps the study dirty on the strength of it.
 */

let existingColumn: unknown;
let forModeCalls: string[];
let selectCalls: number;
let updateSetCalls: Record<string, unknown>[];
let eqCalls: Array<[unknown, unknown]>;
let txShouldThrow: boolean;

vi.mock("@workspace/db", () => ({
  db: {
    transaction: async (fn: (tx: unknown) => Promise<void>) => {
      if (txShouldThrow) throw new Error("simulated structured_json write failure");
      const tx = {
        select: () => {
          selectCalls++;
          return {
            from: () => ({
              where: () => {
                // Both chain shapes resolve, so dropping .for("update") fails an
                // assertion about the lock rather than a TypeError.
                const tail = {
                  limit: async () =>
                    existingColumn === undefined ? [] : [{ structuredJson: existingColumn }],
                };
                return {
                  ...tail,
                  for: (mode: string) => {
                    forModeCalls.push(mode);
                    return tail;
                  },
                };
              },
            }),
          };
        },
        update: () => ({
          set: (values: Record<string, unknown>) => {
            updateSetCalls.push(values);
            return { where: async () => [] };
          },
        }),
      };
      await fn(tx);
    },
  },
}));

vi.mock("@workspace/db/schema", () => ({
  radiologyReportDraftsTable: { id: "id", structuredJson: "structured_json" },
}));

// eq is recorded rather than exercised: the point is which draft the read and
// the write each targeted, and a real drizzle SQL object hides its operands.
vi.mock("drizzle-orm", () => ({
  eq: (left: unknown, right: unknown) => {
    eqCalls.push([left, right]);
    return { eq: [left, right] };
  },
}));

const { persistCareStructuredJsonPatch } = await import("./persistCareStructuredFormatState");
const {
  STRUCTURED_JSON_ENVELOPE_KIND,
  extractA4Cache,
  extractCareCanalApProvenance,
  extractCareObservationLedger,
  extractCareViewerMeasurements,
  extractCareRegionTransitions,
} = await import("./structuredJsonColumn");

beforeEach(() => {
  existingColumn = undefined;
  forModeCalls = [];
  selectCalls = 0;
  updateSetCalls = [];
  eqCalls = [];
  txShouldThrow = false;
});

describe("persistCareStructuredJsonPatch", () => {
  it("does one locked read and one write, however many keys the patch carries", async () => {
    await persistCareStructuredJsonPatch(42, {
      observationLedger: { entries: [{ id: "e1" }] },
      viewerMeasurements: { items: [{ id: 1 }] },
      canalApProvenance: { "l4-5": { manualOverride: true } },
      appliedPatterns: [],
      linkedStudy: null,
    });

    expect(selectCalls).toBe(1);
    expect(updateSetCalls).toHaveLength(1);
    // The lock is what serializes two overlapping autosaves. Without it both
    // could read the same snapshot under READ COMMITTED and the second write
    // would discard the first's keys — a bare transaction does not prevent that.
    expect(forModeCalls).toEqual(["update"]);
  });

  it("reads and writes the draft it was given", async () => {
    await persistCareStructuredJsonPatch(7, { observationLedger: { entries: [] } });
    expect(eqCalls).toEqual([["id", 7], ["id", 7]]);
  });

  it("merges into what the row actually holds, preserving keys the patch omits", async () => {
    existingColumn = {
      kind: STRUCTURED_JSON_ENVELOPE_KIND,
      a4Cache: [{ findingId: 7 }],
      careStructuredFormat: null,
      careCanalApProvenance: { "l4-5": { manualOverride: true } },
    };

    await persistCareStructuredJsonPatch(42, {
      observationLedger: { entries: [{ id: "e1" }] },
    });

    const written = updateSetCalls[0]!.structuredJson;
    expect(extractCareObservationLedger(written)).toEqual({ entries: [{ id: "e1" }] });
    expect(extractCareCanalApProvenance(written)).toEqual({ "l4-5": { manualOverride: true } });
    expect(extractA4Cache(written)).toEqual([{ findingId: 7 }]);
  });

  it("preserves a stored region-transition history that the patch says nothing about", async () => {
    // composeStructuredJsonColumn rebuilds the envelope from the keys it recognises, so a
    // key with no arm in it is dropped on the next unrelated write. ADR-004's history is
    // provenance: losing it turns a confirmed decision into a report that appears to have
    // lost normals on its own.
    existingColumn = {
      kind: STRUCTURED_JSON_ENVELOPE_KIND,
      a4Cache: null,
      careStructuredFormat: null,
      careRegionTransitions: [{
        kind: "care.region_transition.v1",
        fromRegion: "Whole Spine",
        toRegion: "Cervical Spine",
        retired: [{ id: "d1", concept: "alignment", segment: "dorsal", text: "Dorsal spine: Normal." }],
        keptAbnormalities: [],
        manualLinesPreserved: 0,
        decidedBy: "abinashsingh@gmail.com",
        at: "2026-10-12T09:00:00.000Z",
      }],
    };

    await persistCareStructuredJsonPatch(42, { observationLedger: { entries: [{ id: "e1" }] } });

    const written = updateSetCalls[0]!.structuredJson;
    expect(extractCareRegionTransitions(written).map((r) => r.toRegion)).toEqual(["Cervical Spine"]);
    expect(extractCareRegionTransitions(written)[0]!.retired).toHaveLength(1);
    expect(extractCareObservationLedger(written)).toEqual({ entries: [{ id: "e1" }] });
  });

  it("treats a draft with no stored column as an empty envelope", async () => {
    existingColumn = undefined;
    await persistCareStructuredJsonPatch(42, {
      viewerMeasurements: { items: [{ id: 1 }] },
    });
    expect(extractCareViewerMeasurements(updateSetCalls[0]!.structuredJson))
      .toEqual({ items: [{ id: 1 }] });
  });

  it("propagates a write failure instead of swallowing it", async () => {
    txShouldThrow = true;
    await expect(
      persistCareStructuredJsonPatch(42, { observationLedger: { entries: [] } }),
    ).rejects.toThrow("simulated structured_json write failure");
    expect(updateSetCalls).toHaveLength(0);
  });
});
