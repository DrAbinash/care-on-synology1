/**
 * inventoryReagentLogic.ts — pure functions for reagent batch/expiry/reorder.
 *
 * Kept DB-free and deterministic so the FEFO / expiry / reorder rules can be
 * unit-tested exhaustively. The route layer (inventoryBatches.ts) does the I/O
 * and calls these.
 */

export interface BatchLite {
  id: number;
  expiryDate: string | null; // ISO date (YYYY-MM-DD) or null (no expiry)
  qtyRemaining: number;
  status: string; // active | depleted | expired | quarantined
}

export interface Allocation {
  batchId: number;
  qty: number;
}

export interface FefoResult {
  allocations: Allocation[];
  allocated: number;
  shortfall: number; // qty that could not be satisfied from usable batches
  skippedExpired: number[]; // batch ids skipped because they are expired
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
/** Earliest-expiry sorts first; a null expiry (no expiry) is consumed LAST. */
function expiryKey(iso: string | null): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = new Date(iso + "T00:00:00").getTime();
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

/**
 * Allocate `qtyNeeded` across batches first-expiry-first-out. Expired batches
 * (expiry strictly before today) are NEVER consumed — they are reported in
 * skippedExpired so the caller can quarantine them. Only 'active' batches with
 * stock are usable.
 */
export function fefoAllocate(batches: BatchLite[], qtyNeeded: number, asOf: Date = new Date()): FefoResult {
  const allocations: Allocation[] = [];
  const skippedExpired: number[] = [];
  const today = startOfDay(asOf);

  const usable = batches
    .filter((b) => b.status === "active" && b.qtyRemaining > 0)
    .filter((b) => {
      if (b.expiryDate && new Date(b.expiryDate + "T00:00:00") < today) {
        skippedExpired.push(b.id);
        return false;
      }
      return true;
    })
    .sort((a, b) => expiryKey(a.expiryDate) - expiryKey(b.expiryDate) || a.id - b.id);

  let remaining = qtyNeeded > 0 ? qtyNeeded : 0;
  for (const b of usable) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, b.qtyRemaining);
    if (take > 0) {
      allocations.push({ batchId: b.id, qty: round2(take) });
      remaining = round2(remaining - take);
    }
  }
  return {
    allocations,
    allocated: round2((qtyNeeded > 0 ? qtyNeeded : 0) - remaining),
    shortfall: round2(Math.max(0, remaining)),
    skippedExpired,
  };
}

/** Split active batches into already-expired vs expiring within `nearDays`. */
export function classifyExpiry(
  batches: BatchLite[],
  asOf: Date,
  nearDays: number,
): { expired: BatchLite[]; nearExpiry: BatchLite[] } {
  const today = startOfDay(asOf);
  const horizon = startOfDay(asOf);
  horizon.setDate(horizon.getDate() + nearDays);
  const expired: BatchLite[] = [];
  const nearExpiry: BatchLite[] = [];
  for (const b of batches) {
    if (!b.expiryDate || b.qtyRemaining <= 0 || b.status !== "active") continue;
    const e = new Date(b.expiryDate + "T00:00:00");
    if (e < today) expired.push(b);
    else if (e <= horizon) nearExpiry.push(b);
  }
  return { expired, nearExpiry };
}

export interface ReorderItemLite {
  reorderPoint: number | null;
  reorderQuantity: number | null;
  minStock: number;
  autoReorderEnabled: boolean;
}

/**
 * True when stock has fallen to/below the reorder point. Falls back to minStock
 * when no explicit reorder point is configured, so existing items keep working.
 */
export function needsReorder(item: ReorderItemLite, currentStock: number): boolean {
  const point = item.reorderPoint ?? item.minStock;
  if (point == null || point <= 0) return false;
  return currentStock <= point;
}

/**
 * How much to reorder: the explicit reorder_quantity if set, else enough to
 * bring stock back up to 2× the reorder point (a safe default top-up).
 */
export function suggestedReorderQty(item: ReorderItemLite, currentStock: number): number {
  if (item.reorderQuantity != null && item.reorderQuantity > 0) return round2(item.reorderQuantity);
  const point = item.reorderPoint ?? item.minStock ?? 0;
  return round2(Math.max(0, point * 2 - currentStock));
}
