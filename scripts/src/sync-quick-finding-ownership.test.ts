import { describe, expect, it } from "vitest";
import {
  pendingOwnershipFills,
  referenceOwnershipFills,
  type ExistingQuickFindingRow,
} from "./sync-quick-finding-ownership";

describe("sync-quick-finding-ownership", () => {
  it("dry-run lists exact rows that would change; non-empty values are not overwritten", () => {
    const reference = referenceOwnershipFills();
    expect(reference.length).toBeGreaterThan(0);
    const fazekas = reference.find((r) => r.label === "Fazekas 1");
    expect(fazekas?.conflictGroup).toBe("fazekas");

    const existing: ExistingQuickFindingRow[] = [
      {
        id: 1,
        studyType: fazekas!.studyType,
        label: "Fazekas 1",
        conflictGroup: "",
        anatomicalSection: "",
        baselineReplaces: "",
      },
      {
        id: 2,
        studyType: fazekas!.studyType,
        label: "Fazekas 1-custom",
        conflictGroup: "",
        anatomicalSection: "",
        baselineReplaces: "",
      },
      {
        id: 3,
        studyType: fazekas!.studyType,
        label: "Fazekas 2",
        conflictGroup: "already-set",
        anatomicalSection: "",
        baselineReplaces: "",
      },
    ];
    const pending = pendingOwnershipFills(existing, reference);
    expect(pending.map((p) => p.id)).toEqual([1]);
    expect(pending[0]!.patch.conflictGroup).toBe("fazekas");

    const afterApply: ExistingQuickFindingRow[] = existing.map((row) => {
      const hit = pending.find((p) => p.id === row.id);
      return hit ? { ...row, ...hit.patch } : row;
    });
    expect(pendingOwnershipFills(afterApply, reference)).toEqual([]);
  });
});
