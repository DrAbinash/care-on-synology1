/**
 * The impression dependency basis travels inside the observation-ledger envelope,
 * because that is the one draft payload this clinic's save → reopen cycle already
 * round-trips verbatim. Adding a top-level envelope key would have needed the
 * server's whitelist to grow; nesting the field means the only new code is the
 * client's own reader.
 *
 * These tests pin that the server does not lose or re-shape the field, since a
 * basis that silently vanished on save would put D-1 back exactly as it was.
 */
import { describe, expect, it } from "vitest";
import {
  composeStructuredJsonColumn,
  buildCareStructuredJsonPatch,
  extractCareObservationLedger,
} from "./structuredJsonColumn";

const ENVELOPE = {
  kind: "care.observation_ledger.v1",
  version: 1,
  patches: [],
  impressionBasis: {
    findingsSignature: "A:fracture|L:C5-C6|N:haemorrhage",
    impressionFingerprint: "c5-c6 fracture. no haemorrhage",
    recordedBy: "impression-write",
  },
};

describe("impression basis persistence through the draft envelope", () => {
  it("is stored verbatim by a save that carries the ledger", () => {
    const column = composeStructuredJsonColumn({ existing: null, observationLedger: ENVELOPE });
    expect(extractCareObservationLedger(column)).toEqual(ENVELOPE);
  });

  it("survives a later save that sends no ledger at all", () => {
    const stored = composeStructuredJsonColumn({ existing: null, observationLedger: ENVELOPE });
    const afterUnrelatedSave = composeStructuredJsonColumn({ existing: stored });
    const basis = (extractCareObservationLedger(afterUnrelatedSave) as { impressionBasis?: unknown }).impressionBasis;
    expect(basis).toEqual(ENVELOPE.impressionBasis);
  });

  it("passes through the save-draft patch builder untouched", () => {
    const patch = buildCareStructuredJsonPatch({ observationLedger: ENVELOPE });
    expect(patch.observationLedger).toEqual(ENVELOPE);
  });

  it("leaves a draft written before this field exists exactly as it was", () => {
    const legacy = { kind: "care.observation_ledger.v1", version: 1, patches: [{ id: "p1" }] };
    const column = composeStructuredJsonColumn({ existing: null, observationLedger: legacy });
    const restored = extractCareObservationLedger(column) as Record<string, unknown>;
    expect(restored.impressionBasis).toBeUndefined();
    expect(restored.patches).toEqual(legacy.patches);
  });
});
