import { describe, it, expect } from "vitest";
import {
  planInsertAllApproved, insertableItems, resolveConflict,
  type ApprovedMeasurement,
} from "./usgMeasurementInsert";

const PRESET = ["right_kidney", "left_kidney", "urinary_bladder", "prostate"];

function m(over: Partial<ApprovedMeasurement>): ApprovedMeasurement {
  return { key: "cbd", label: "CBD", value: "4 mm", unit: "mm", organ: "right_kidney", sourceType: "sr", reviewState: "approved", ...over };
}

describe("P2.2 insert-all-approved planning", () => {
  it("inserts approved, mapped, new measurements", () => {
    const plan = planInsertAllApproved([m({ key: "rk_len", organ: "right_kidney", value: "98 mm" })], {}, PRESET);
    expect(plan.summary.inserted).toBe(1);
    expect(insertableItems(plan)).toHaveLength(1);
  });

  it("skips unapproved (pending/rejected) untouched", () => {
    const plan = planInsertAllApproved([
      m({ key: "a", reviewState: "pending" }),
      m({ key: "b", reviewState: "rejected" }),
    ], {}, PRESET);
    expect(plan.summary.pending).toBe(2);
    expect(plan.summary.inserted).toBe(0);
  });

  it("marks measurements outside the preset as unmapped", () => {
    const plan = planInsertAllApproved([m({ key: "thyroid_vol", organ: "thyroid", value: "8 ml" })], {}, PRESET);
    expect(plan.summary.unmapped).toBe(1);
  });

  it("detects already-present (same value) vs conflict (different value)", () => {
    const plan = planInsertAllApproved(
      [m({ key: "rk_len", organ: "right_kidney", value: "98 mm" }), m({ key: "cbd", organ: "right_kidney", value: "7 mm" })],
      { rk_len: "98 mm", cbd: "4 mm" },
      PRESET,
    );
    expect(plan.summary.alreadyPresent).toBe(1);
    expect(plan.summary.conflicts).toBe(1);
    const conflict = plan.items.find((i) => i.action === "conflict")!;
    expect(conflict.existingValue).toBe("4 mm");
    expect(conflict.diff?.absolute).toBe(3);
    expect(conflict.diff?.percent).toBe(75);
    // conflicts are NOT auto-inserted
    expect(insertableItems(plan).some((i) => i.measurement.key === "cbd")).toBe(false);
  });
});

describe("P2.3 conflict reconciliation", () => {
  const conflict = planInsertAllApproved(
    [m({ key: "cbd", organ: "right_kidney", value: "7 mm" })], { cbd: "4 mm" }, PRESET,
  ).items[0];

  it("keep_report / use_incoming / keep_both / reject / unresolved resolve deterministically + audited", () => {
    const ctx = { author: "Dr X", timestamp: "2026-07-21T00:00:00Z", reason: "re-measured" };
    expect(resolveConflict(conflict, "keep_report", ctx).finalValue).toBe("4 mm");
    expect(resolveConflict(conflict, "use_incoming", ctx).finalValue).toBe("7 mm");
    expect(resolveConflict(conflict, "keep_both", ctx).finalValue).toBe("4 mm / 7 mm");
    expect(resolveConflict(conflict, "reject_incoming", ctx).finalValue).toBe("4 mm");
    expect(resolveConflict(conflict, "mark_unresolved", ctx).finalValue).toBeNull();
    const rec = resolveConflict(conflict, "use_incoming", ctx);
    expect(rec.author).toBe("Dr X");
    expect(rec.decidedAt).toBe("2026-07-21T00:00:00Z");
    expect(rec.reportValue).toBe("4 mm");
    expect(rec.incomingValue).toBe("7 mm");
    expect(rec.incomingSource).toBe("sr");
  });
});
