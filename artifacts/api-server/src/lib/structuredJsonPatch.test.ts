import { describe, expect, it } from "vitest";
import {
  CARE_STRUCTURED_FORMAT_STATE_KIND,
  STRUCTURED_JSON_ENVELOPE_KIND,
  buildCareStructuredJsonPatch,
  composeStructuredJsonColumn,
  extractA4Cache,
  extractCareAppliedPatterns,
  extractCareCanalApProvenance,
  extractCareLinkedStudy,
  extractCareObservationLedger,
  extractCareStructuredFormat,
  extractCareViewerMeasurements,
} from "./structuredJsonColumn";

/**
 * buildCareStructuredJsonPatch decides which envelope keys one save-draft
 * request intends to write. Its `undefined`-vs-`null` distinctions are the wire
 * contract, and getting one of them wrong is silent: either a legitimate clear
 * is ignored (stale markers survive a deselect-all) or an omitted field wipes a
 * stored one.
 */

const FIXED_NOW = () => "2026-10-06T09:00:00.000Z";

describe("buildCareStructuredJsonPatch — which keys a request writes", () => {
  it("writes nothing when the request carries no envelope keys", () => {
    // The handler skips the write entirely on an empty patch. A request that
    // only carries narrative text must not touch structured_json at all.
    expect(buildCareStructuredJsonPatch({})).toEqual({});
    expect(buildCareStructuredJsonPatch({
      observationLedger: null,
      viewerMeasurements: null,
      canalApProvenance: null,
      vascularTechnique: null,
      structuredFormatState: null,
      reportFormatIdentity: null,
    })).toEqual({});
  });

  it("treats a null observationLedger as 'leave it alone', not as 'clear it'", () => {
    expect(buildCareStructuredJsonPatch({ observationLedger: null }, FIXED_NOW))
      .not.toHaveProperty("observationLedger");
    const ledger = { entries: [{ id: "l4-5", role: "positive" }] };
    expect(buildCareStructuredJsonPatch({ observationLedger: ledger }, FIXED_NOW))
      .toEqual({ observationLedger: ledger });
  });

  it("treats a null appliedPatterns as an explicit clear", () => {
    // A deselect-all save sends `[]`/null on purpose. Reading null as "no
    // signal" would leave the previous markers applied to the report.
    expect(buildCareStructuredJsonPatch({ appliedPatterns: null }, FIXED_NOW))
      .toEqual({ appliedPatterns: [] });
    expect(buildCareStructuredJsonPatch({ appliedPatterns: [] }, FIXED_NOW))
      .toEqual({ appliedPatterns: [] });
    expect(buildCareStructuredJsonPatch({}, FIXED_NOW)).not.toHaveProperty("appliedPatterns");
  });

  it("treats a null linkedStudy as an explicit unlink", () => {
    expect(buildCareStructuredJsonPatch({ linkedStudy: null }, FIXED_NOW))
      .toEqual({ linkedStudy: null });
    expect(buildCareStructuredJsonPatch({}, FIXED_NOW)).not.toHaveProperty("linkedStudy");
    const linked = { studyId: 88, title: "MRI Lumbar Spine" };
    expect(buildCareStructuredJsonPatch({ linkedStudy: linked }, FIXED_NOW))
      .toEqual({ linkedStudy: linked });
  });

  it("carries only the measurement fields the request actually sent", () => {
    // An autosave that carries viewer measurements alone must not clear the
    // canal provenance or the vascular technique already on the draft.
    const patch = buildCareStructuredJsonPatch(
      { viewerMeasurements: { items: [{ id: 1 }] } },
      FIXED_NOW,
    );
    expect(patch.viewerMeasurements).toEqual({ items: [{ id: 1 }] });
    expect(patch.canalApProvenance).toBeUndefined();
    expect(patch.vascularTechnique).toBeUndefined();
    expect(Object.keys(patch)).toEqual([
      "viewerMeasurements", "canalApProvenance", "vascularTechnique",
    ]);
  });

  it("keeps a stored transition history unless the request brings one", () => {
    const transition = {
      kind: "care.region_transition.v1",
      fromRegion: "Whole Spine",
      toRegion: "Cervical Spine",
      retired: [{ id: "d1", concept: "alignment", segment: "dorsal", text: "Dorsal spine: Normal." }],
      keptAbnormalities: [],
      manualLinesPreserved: 0,
      decidedBy: "abinashsingh@gmail.com",
      at: "2026-10-12T09:00:00.000Z",
    };
    // Absent or null is not an instruction to forget a decision: the report was re-regioned,
    // and an unrelated autosave that carries no transition must leave the history standing.
    expect(buildCareStructuredJsonPatch({}, FIXED_NOW)).not.toHaveProperty("regionTransitions");
    expect(buildCareStructuredJsonPatch({ regionTransitions: null }, FIXED_NOW))
      .not.toHaveProperty("regionTransitions");
    // What does arrive is normalized through the same reader a reload uses, so a request
    // cannot store a row the reader would later refuse and present as nothing.
    expect(buildCareStructuredJsonPatch({ regionTransitions: [transition] }, FIXED_NOW).regionTransitions)
      .toEqual([transition]);
    expect(buildCareStructuredJsonPatch({
      regionTransitions: [{ kind: "care.something_else", toRegion: "X", retired: [] }, transition],
    }, FIXED_NOW).regionTransitions).toEqual([transition]);
  });

  it("fills the format-state defaults composeStructuredJsonColumn requires", () => {
    const patch = buildCareStructuredJsonPatch({
      structuredFormatState: { formatId: 9, values: { "discs::l4-5": "bulge" } },
    }, FIXED_NOW);
    expect(patch.formatState).toEqual({
      kind: CARE_STRUCTURED_FORMAT_STATE_KIND,
      formatId: 9,
      formatVersion: 1,
      values: { "discs::l4-5": "bulge" },
      updatedAt: "2026-10-06T09:00:00.000Z",
    });
  });

  it("keeps a supplied formatVersion and updatedAt rather than defaulting them", () => {
    const patch = buildCareStructuredJsonPatch({
      structuredFormatState: {
        formatId: 9,
        formatVersion: 4,
        values: {},
        updatedAt: "2026-01-02T03:04:05.000Z",
      },
    }, FIXED_NOW);
    expect(patch.formatState?.formatVersion).toBe(4);
    expect(patch.formatState?.updatedAt).toBe("2026-01-02T03:04:05.000Z");
  });

  it("stamps reportFormatIdentity.appliedAt only when the client omitted it", () => {
    expect(buildCareStructuredJsonPatch({
      reportFormatIdentity: { kind: "care.report_format_identity.v1", name: "MRI Lumbar V3" },
    }, FIXED_NOW).reportFormatIdentity).toEqual({
      kind: "care.report_format_identity.v1",
      name: "MRI Lumbar V3",
      appliedAt: "2026-10-06T09:00:00.000Z",
    });
    expect(buildCareStructuredJsonPatch({
      reportFormatIdentity: { name: "X", appliedAt: "2025-12-31T00:00:00.000Z" },
    }, FIXED_NOW).reportFormatIdentity).toEqual({
      name: "X",
      appliedAt: "2025-12-31T00:00:00.000Z",
    });
  });
});

describe("the patch round-trips through one compose without losing keys", () => {
  /**
   * This is the regression the atomic write exists for. Six per-key writers each
   * read the column, composed against it and wrote it back, so two overlapping
   * saves both composed against the same stale snapshot and the second
   * discarded everything the first had added. One patch means one compose
   * against one read, so a single request cannot lose its own keys — and the
   * locked read in persistCareStructuredJsonPatch is what stops two requests
   * doing it to each other.
   */
  const EXISTING = {
    kind: STRUCTURED_JSON_ENVELOPE_KIND,
    a4Cache: [{ findingId: 7, source: "quickselect" }],
    careStructuredFormat: null,
    careCanalApProvenance: { "l4-5": { manualOverride: true } },
  };

  it("one request carrying every key writes every key and keeps the A4 cache", () => {
    const patch = buildCareStructuredJsonPatch({
      structuredFormatState: { formatId: 9, values: { a: "b" } },
      observationLedger: { entries: [{ id: "e1" }] },
      viewerMeasurements: { items: [{ id: 1 }] },
      canalApProvenance: { "l4-5": { manualOverride: false } },
      vascularTechnique: { mra: true },
      appliedPatterns: [{ patternId: "p1", version: 1, bundleId: "b1", appliedAt: "x" }],
      linkedStudy: { studyId: 88, title: "MRI Lumbar Spine" },
      reportFormatIdentity: { kind: "care.report_format_identity.v1", name: "MRI Lumbar V3" },
    }, FIXED_NOW);

    const written = composeStructuredJsonColumn({ existing: EXISTING, ...patch });

    expect(extractA4Cache(written)).toEqual([{ findingId: 7, source: "quickselect" }]);
    expect(extractCareObservationLedger(written)).toEqual({ entries: [{ id: "e1" }] });
    expect(extractCareViewerMeasurements(written)).toEqual({ items: [{ id: 1 }] });
    expect(extractCareCanalApProvenance(written)).toEqual({ "l4-5": { manualOverride: false } });
    expect(extractCareAppliedPatterns(written)).toHaveLength(1);
    expect(extractCareLinkedStudy(written)?.studyId).toBe(88);
    expect(extractCareStructuredFormat(written)?.formatId).toBe(9);
  });

  it("a request carrying one key preserves the keys it did not carry", () => {
    const patch = buildCareStructuredJsonPatch({
      observationLedger: { entries: [{ id: "e1" }] },
    }, FIXED_NOW);
    const written = composeStructuredJsonColumn({ existing: EXISTING, ...patch });

    expect(extractCareObservationLedger(written)).toEqual({ entries: [{ id: "e1" }] });
    // Not in the request, not in the patch — so it must survive untouched.
    expect(extractCareCanalApProvenance(written)).toEqual({ "l4-5": { manualOverride: true } });
    expect(extractA4Cache(written)).toEqual([{ findingId: 7, source: "quickselect" }]);
  });

  it("two serialized saves accumulate; the second does not erase the first", () => {
    // Models what the row lock makes true: the second save composes against
    // what the first actually wrote, not against a snapshot taken before it.
    const first = composeStructuredJsonColumn({
      existing: EXISTING,
      ...buildCareStructuredJsonPatch({ observationLedger: { entries: [{ id: "e1" }] } }, FIXED_NOW),
    });
    const second = composeStructuredJsonColumn({
      existing: first,
      ...buildCareStructuredJsonPatch({ viewerMeasurements: { items: [{ id: 2 }] } }, FIXED_NOW),
    });

    expect(extractCareObservationLedger(second)).toEqual({ entries: [{ id: "e1" }] });
    expect(extractCareViewerMeasurements(second)).toEqual({ items: [{ id: 2 }] });
    expect(extractCareCanalApProvenance(second)).toEqual({ "l4-5": { manualOverride: true } });
  });

  it("an empty patch leaves the column byte-identical", () => {
    const patch = buildCareStructuredJsonPatch({}, FIXED_NOW);
    expect(composeStructuredJsonColumn({ existing: EXISTING, ...patch })).toEqual(
      composeStructuredJsonColumn({ existing: EXISTING }),
    );
  });
});
