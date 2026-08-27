import { describe, expect, it } from "vitest";
import {
  enrichmentDiff,
  ownershipSnapshotFromTile,
  resolvedOwnershipMode,
  validateConflictGroupAgainstText,
} from "./ownershipFieldValidation";

describe("ownershipFieldValidation", () => {
  it("R1 live check warns when conflictGroup words are absent from text", () => {
    const miss = validateConflictGroupAgainstText("canal_stenosis", "Disc herniation at L4-L5.");
    expect(miss.ok).toBe(false);
    const hit = validateConflictGroupAgainstText("canal stenosis", "Mild canal stenosis at L4-L5.");
    expect(hit.ok).toBe(true);
  });

  it("resolved mode flips from append to mutex when conflictGroup is set", () => {
    const append = resolvedOwnershipMode({
      findingsText: "Mild canal stenosis at L4-L5.",
      label: "Mild canal stenosis L4-L5",
      region: "LS Spine",
    });
    expect(append.mode).toBe("append");
    const mutex = resolvedOwnershipMode({
      findingsText: "Mild canal stenosis at L4-L5.",
      label: "Mild canal stenosis L4-L5",
      region: "LS Spine",
      conflictGroup: "canal stenosis",
    });
    expect(mutex.mode).toBe("mutex");
    expect(mutex.slotKey).toContain("canal_stenosis");
  });

  it("editor round-trip: save conflictGroup → reload mode is mutex and diff lists it", () => {
    const beforeTile = {
      studyType: "LS Spine",
      label: "Mild canal stenosis L4-L5",
      sentence: "Mild canal stenosis at L4-L5.",
    };
    const afterTile = { ...beforeTile, conflictGroup: "canal stenosis" };
    const prev = [ownershipSnapshotFromTile(beforeTile)];
    const next = [ownershipSnapshotFromTile(afterTile)];
    expect(prev[0]!.mode).toBe("append");
    expect(next[0]!.mode).toBe("mutex");
    const diff = enrichmentDiff(prev, next);
    expect(diff).toHaveLength(1);
    expect(diff[0]!.from).toContain("append");
    expect(diff[0]!.to).toContain("mutex");
  });
});
