/**
 * Auto-deduct inventory from consumption rules (test → items).
 * Idempotent via per-item transaction reference keys.
 */
import { db } from "@workspace/db";
import {
  inventoryBatchesTable,
  inventoryConsumptionRulesTable,
  inventoryItemsTable,
  inventoryTransactionsTable,
} from "@workspace/db/schema";
import { and, eq, gt } from "drizzle-orm";
import { fefoAllocate, type BatchLite } from "./inventoryReagentLogic";
import { maybeSendLowStockAlerts } from "./inventoryLowStockAlerts";

const n = (v: unknown): number => (v == null ? 0 : Number(v));
type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ConsumeForTestInput = {
  testId: number;
  referenceKey: string;
  performedBy: string;
  reason?: string;
};

export type ConsumeLineResult = {
  itemId: number;
  itemName: string;
  quantity: number;
  skipped?: boolean;
  error?: string;
};

async function referenceExists(tx: DbTx, reference: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: inventoryTransactionsTable.id })
    .from(inventoryTransactionsTable)
    .where(eq(inventoryTransactionsTable.reference, reference))
    .limit(1);
  return !!row;
}

async function consumeSimpleTx(
  tx: DbTx,
  itemId: number,
  quantity: number,
  reference: string,
  performedBy: string,
  reason: string,
): Promise<void> {
  const [item] = await tx.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, itemId)).limit(1);
  if (!item) throw new Error("ITEM_NOT_FOUND");
  const before = n(item.currentStock);
  if (before < quantity) throw new Error("INSUFFICIENT_STOCK");
  const after = Math.round((before - quantity) * 100) / 100;
  await tx.update(inventoryItemsTable).set({ currentStock: String(after) }).where(eq(inventoryItemsTable.id, itemId));
  await tx.insert(inventoryTransactionsTable).values({
    itemId,
    type: "out",
    quantity: String(quantity),
    stockBefore: String(before),
    stockAfter: String(after),
    reason,
    reference,
    performedBy,
  });
}

async function consumeFefoTx(
  tx: DbTx,
  itemId: number,
  quantity: number,
  reference: string,
  performedBy: string,
  reason: string,
): Promise<void> {
  const [item] = await tx.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, itemId)).limit(1);
  if (!item) throw new Error("ITEM_NOT_FOUND");
  const batches = await tx
    .select()
    .from(inventoryBatchesTable)
    .where(and(
      eq(inventoryBatchesTable.itemId, itemId),
      eq(inventoryBatchesTable.status, "active"),
      gt(inventoryBatchesTable.qtyRemaining, "0"),
    ));
  const lite: BatchLite[] = batches.map((b) => ({
    id: b.id,
    expiryDate: b.expiryDate,
    qtyRemaining: n(b.qtyRemaining),
    status: b.status,
  }));
  const plan = fefoAllocate(lite, quantity);
  if (plan.shortfall > 0) throw new Error("INSUFFICIENT_USABLE_STOCK");

  for (const a of plan.allocations) {
    const b = batches.find((x) => x.id === a.batchId)!;
    const rem = Math.round((n(b.qtyRemaining) - a.qty) * 100) / 100;
    await tx.update(inventoryBatchesTable)
      .set({ qtyRemaining: String(rem), status: rem <= 0 ? "depleted" : "active" })
      .where(eq(inventoryBatchesTable.id, a.batchId));
  }
  const before = n(item.currentStock);
  const after = Math.round((before - quantity) * 100) / 100;
  await tx.update(inventoryItemsTable).set({ currentStock: String(after) }).where(eq(inventoryItemsTable.id, itemId));
  await tx.insert(inventoryTransactionsTable).values({
    itemId,
    type: "out",
    quantity: String(quantity),
    stockBefore: String(before),
    stockAfter: String(after),
    reason,
    reference,
    performedBy,
  });
}

/** Deduct consumables for a completed test. Safe to call multiple times (idempotent). */
export async function consumeInventoryForTest(input: ConsumeForTestInput): Promise<ConsumeLineResult[]> {
  const rules = await db
    .select({
      itemId: inventoryConsumptionRulesTable.itemId,
      quantity: inventoryConsumptionRulesTable.quantity,
      itemName: inventoryItemsTable.name,
      trackExpiry: inventoryItemsTable.trackExpiry,
      isActive: inventoryItemsTable.isActive,
    })
    .from(inventoryConsumptionRulesTable)
    .innerJoin(inventoryItemsTable, eq(inventoryConsumptionRulesTable.itemId, inventoryItemsTable.id))
    .where(eq(inventoryConsumptionRulesTable.testId, input.testId));

  if (rules.length === 0) return [];

  const results: ConsumeLineResult[] = [];
  let anyConsumed = false;

  for (const rule of rules) {
    const qty = n(rule.quantity);
    if (!rule.isActive || qty <= 0) {
      results.push({ itemId: rule.itemId, itemName: rule.itemName, quantity: qty, skipped: true });
      continue;
    }
    const reference = `CONSUME-${input.referenceKey}-ITEM-${rule.itemId}`;
    try {
      let consumed = false;
      await db.transaction(async (tx) => {
        if (await referenceExists(tx, reference)) return;
        const reason = input.reason ?? `Auto-consumed for test completion (${input.referenceKey})`;
        if (rule.trackExpiry) {
          await consumeFefoTx(tx, rule.itemId, qty, reference, input.performedBy, reason);
        } else {
          await consumeSimpleTx(tx, rule.itemId, qty, reference, input.performedBy, reason);
        }
        consumed = true;
      });
      if (consumed) anyConsumed = true;
      results.push({ itemId: rule.itemId, itemName: rule.itemName, quantity: qty, skipped: !consumed });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "consume failed";
      results.push({ itemId: rule.itemId, itemName: rule.itemName, quantity: qty, error: msg });
    }
  }

  if (anyConsumed) {
    void maybeSendLowStockAlerts("auto-consume");
  }

  return results;
}

/** Fire-and-forget hook after report verify. */
export function hookConsumeOnReportVerified(report: {
  id: number;
  testId: number | null;
  verifiedByName?: string | null;
}): void {
  if (!report.testId) return;
  void consumeInventoryForTest({
    testId: report.testId,
    referenceKey: `REPORT-${report.id}`,
    performedBy: report.verifiedByName?.trim() || "system",
    reason: `Auto-consumed on report #${report.id} verify`,
  }).catch((err) => console.warn("[inventory] report verify consume failed:", err));
}

/** Fire-and-forget hook after radiology study finalized. */
export function hookConsumeOnStudyFinalized(study: {
  id: number;
  testId: number;
  finalReportedBy?: string | null;
}): void {
  void consumeInventoryForTest({
    testId: study.testId,
    referenceKey: `STUDY-${study.id}-FINAL`,
    performedBy: study.finalReportedBy?.trim() || "system",
    reason: `Auto-consumed on study #${study.id} final report`,
  }).catch((err) => console.warn("[inventory] study finalize consume failed:", err));
}

/** Fire-and-forget when lab sample marked completed (per order test). */
export function hookConsumeOnSampleCompleted(params: {
  sampleId: number;
  orderTestId: number;
  testId: number;
  performedBy: string;
}): void {
  void consumeInventoryForTest({
    testId: params.testId,
    referenceKey: `SAMPLE-${params.sampleId}-OT-${params.orderTestId}`,
    performedBy: params.performedBy,
    reason: `Auto-consumed on sample #${params.sampleId} completed`,
  }).catch((err) => console.warn("[inventory] sample complete consume failed:", err));
}
