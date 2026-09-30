/**
 * impressionOrdering.test.ts — the store half of spec §37: the derived
 * Impression is ordered by clinical priority, and a hand-built Impression is
 * never reshuffled.
 *
 * Ordering moves existing sentences only. It never rewrites wording and never
 * re-stamps provenance, because the provenance map is keyed by sentence
 * content — which is why a manual line keeps its protection at its new place.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { useWorkspace } from "@/lib/zai-workspace/store";
import { normalizeForDedupe } from "@/lib/reportFieldMerge";

const MINOR = "Mild disc bulge at L4-L5 without neural compromise.";
const CAUDA = "Acute cauda equina syndrome with severe canal stenosis at L4-L5.";
const DOMINANT = "Most pronounced stenosis at L5-S1.";

function reset() {
  useWorkspace.setState({
    impressionText: "",
    findingsText: "",
    fieldProvenance: {},
    impressionOrderFrozen: false,
    isDirty: false,
    appliedPathologyPatches: [],
  });
}

function setImpression(lines: string[], source?: "manual" | "system" | "quick-findings") {
  useWorkspace.getState().setField(
    "impression",
    lines.join("\n"),
    source ? { source } : undefined,
  );
}

describe("orderImpressionByPriority", () => {
  beforeEach(() => reset());

  it("puts the urgent vascular/neural emergency line first without rewriting it", () => {
    setImpression([MINOR, CAUDA, DOMINANT], "quick-findings");
    useWorkspace.getState().orderImpressionByPriority();
    const lines = useWorkspace.getState().impressionText.split("\n");
    expect(lines[0]).toBe(CAUDA);
    expect([...lines].sort()).toEqual([CAUDA, DOMINANT, MINOR].sort());
    expect(lines).toHaveLength(3);
  });

  it("keeps provenance attached to each sentence after it moves", () => {
    setImpression([MINOR, CAUDA], "quick-findings");
    const before = useWorkspace.getState().fieldProvenance.impression;
    expect(before[normalizeForDedupe(CAUDA)]).toContain("quick-findings");
    useWorkspace.getState().orderImpressionByPriority();
    const after = useWorkspace.getState().fieldProvenance.impression;
    expect(after[normalizeForDedupe(CAUDA)]).toEqual(before[normalizeForDedupe(CAUDA)]);
    expect(after[normalizeForDedupe(MINOR)]).toEqual(before[normalizeForDedupe(MINOR)]);
  });

  it("stays a no-op once the radiologist has hand-edited the Impression", () => {
    setImpression([MINOR, CAUDA], "quick-findings");
    useWorkspace.getState().orderImpressionByPriority();
    expect(useWorkspace.getState().impressionText.split("\n")[0]).toBe(CAUDA);
    // The radiologist puts the minor line back on top by hand: same sentences,
    // own order. That freezes automatic priority for the rest of the session.
    setImpression([MINOR, CAUDA], "manual");
    expect(useWorkspace.getState().impressionOrderFrozen).toBe(true);
    useWorkspace.getState().orderImpressionByPriority();
    expect(useWorkspace.getState().impressionText).toBe([MINOR, CAUDA].join("\n"));
  });

  it("freezes only for radiologist-owned writes", () => {
    setImpression([MINOR, CAUDA], "system");
    expect(useWorkspace.getState().impressionOrderFrozen).toBe(false);
    setImpression([MINOR, CAUDA], "quick-findings");
    expect(useWorkspace.getState().impressionOrderFrozen).toBe(false);
    setImpression([CAUDA, MINOR]);
    expect(useWorkspace.getState().impressionOrderFrozen).toBe(true);
  });

  it("can be re-enabled explicitly by the radiologist", () => {
    setImpression([MINOR, CAUDA], "manual");
    useWorkspace.getState().setImpressionOrderFrozen(false);
    useWorkspace.getState().orderImpressionByPriority();
    expect(useWorkspace.getState().impressionText.split("\n")[0]).toBe(CAUDA);
  });

  it("does not dirty the report when there is nothing to reorder", () => {
    setImpression([CAUDA], "quick-findings");
    expect(useWorkspace.getState().isDirty).toBe(true);
    reset();
    setImpression([CAUDA], "quick-findings");
    useWorkspace.getState().orderImpressionByPriority();
    expect(useWorkspace.getState().impressionText).toBe(CAUDA);
    reset();
    useWorkspace.getState().orderImpressionByPriority();
    expect(useWorkspace.getState().impressionText).toBe("");
  });
});
