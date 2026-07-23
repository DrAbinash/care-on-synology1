import { describe, it, expect } from "vitest";
import { fefoAllocate, classifyExpiry, needsReorder, suggestedReorderQty, type BatchLite } from "./inventoryReagentLogic";

const B = (id: number, expiryDate: string | null, qtyRemaining: number, status = "active"): BatchLite => ({ id, expiryDate, qtyRemaining, status });
const ASOF = new Date("2026-07-23T10:00:00");

describe("fefoAllocate — first-expiry-first-out", () => {
  it("consumes the earliest-expiry batch first", () => {
    const r = fefoAllocate([B(1, "2026-12-01", 10), B(2, "2026-08-01", 10)], 5, ASOF);
    expect(r.allocations).toEqual([{ batchId: 2, qty: 5 }]);
    expect(r.shortfall).toBe(0);
  });

  it("spills across batches in expiry order", () => {
    const r = fefoAllocate([B(1, "2026-12-01", 4), B(2, "2026-08-01", 3)], 6, ASOF);
    expect(r.allocations).toEqual([{ batchId: 2, qty: 3 }, { batchId: 1, qty: 3 }]);
    expect(r.allocated).toBe(6);
  });

  it("NEVER consumes an expired batch and reports it for quarantine", () => {
    const r = fefoAllocate([B(1, "2026-07-01", 100) /* expired */, B(2, "2026-09-01", 5)], 5, ASOF);
    expect(r.skippedExpired).toEqual([1]);
    expect(r.allocations).toEqual([{ batchId: 2, qty: 5 }]);
  });

  it("consumes a no-expiry batch LAST", () => {
    const r = fefoAllocate([B(1, null, 10), B(2, "2026-08-01", 3)], 5, ASOF);
    expect(r.allocations).toEqual([{ batchId: 2, qty: 3 }, { batchId: 1, qty: 2 }]);
  });

  it("reports a shortfall when usable stock is insufficient (expired excluded)", () => {
    const r = fefoAllocate([B(1, "2026-07-01", 100) /* expired */, B(2, "2026-09-01", 2)], 5, ASOF);
    expect(r.allocated).toBe(2);
    expect(r.shortfall).toBe(3);
    expect(r.skippedExpired).toEqual([1]);
  });

  it("ignores non-active / empty batches", () => {
    const r = fefoAllocate([B(1, "2026-08-01", 0), B(2, "2026-08-02", 5, "quarantined"), B(3, "2026-08-03", 4)], 3, ASOF);
    expect(r.allocations).toEqual([{ batchId: 3, qty: 3 }]);
  });
});

describe("classifyExpiry", () => {
  it("splits expired vs expiring-within-N-days", () => {
    const batches = [B(1, "2026-07-01", 5), B(2, "2026-08-15", 5), B(3, "2027-01-01", 5)];
    const { expired, nearExpiry } = classifyExpiry(batches, ASOF, 60);
    expect(expired.map((b) => b.id)).toEqual([1]);
    expect(nearExpiry.map((b) => b.id)).toEqual([2]); // within 60 days; #3 is beyond
  });
});

describe("reorder rules", () => {
  it("needsReorder at/below the reorder point, falling back to minStock", () => {
    expect(needsReorder({ reorderPoint: 10, reorderQuantity: null, minStock: 5, autoReorderEnabled: true }, 10)).toBe(true);
    expect(needsReorder({ reorderPoint: 10, reorderQuantity: null, minStock: 5, autoReorderEnabled: true }, 11)).toBe(false);
    // no explicit reorder point → uses minStock
    expect(needsReorder({ reorderPoint: null, reorderQuantity: null, minStock: 5, autoReorderEnabled: true }, 5)).toBe(true);
    // nothing configured → never reorder
    expect(needsReorder({ reorderPoint: null, reorderQuantity: null, minStock: 0, autoReorderEnabled: true }, 0)).toBe(false);
  });

  it("suggestedReorderQty uses explicit qty, else tops up to 2x the point", () => {
    expect(suggestedReorderQty({ reorderPoint: 10, reorderQuantity: 50, minStock: 5, autoReorderEnabled: true }, 3)).toBe(50);
    expect(suggestedReorderQty({ reorderPoint: 10, reorderQuantity: null, minStock: 5, autoReorderEnabled: true }, 4)).toBe(16); // 2*10 - 4
  });
});
