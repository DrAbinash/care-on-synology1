import { describe, expect, it } from "vitest";
import {
  composeStructuredJsonColumn,
  extractCareAppliedPatterns,
} from "./structuredJsonColumn";

const MARKER = {
  patternId: "lumbar-degenerative-cascade",
  version: 1,
  bundleId: "pattern-lumbar-degenerative-cascade-v1",
  appliedAt: "2026-09-27T00:00:00.000Z",
};

describe("careAppliedPatterns envelope", () => {
  it("keeps markers across cache rewrites and clears on an empty write", () => {
    const col = composeStructuredJsonColumn({
      existing: [{ findingId: 1 }],
      appliedPatterns: [MARKER],
    });
    expect(extractCareAppliedPatterns(col)).toEqual([MARKER]);
    const regen = composeStructuredJsonColumn({ existing: col, a4Cache: [{ findingId: 3 }] });
    expect(extractCareAppliedPatterns(regen)).toEqual([MARKER]);
    expect(extractCareAppliedPatterns(regen)[0]?.version).toBe(1);
    const cleared = composeStructuredJsonColumn({ existing: regen, appliedPatterns: [] });
    expect(extractCareAppliedPatterns(cleared)).toEqual([]);
  });
});
