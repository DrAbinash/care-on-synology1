import { db } from "@workspace/db";
import { inventoryItemsTable } from "@workspace/db/schema";
import { and, eq, lte, sql } from "drizzle-orm";

export type LowStockItem = {
  id: number;
  name: string;
  unit: string;
  category: string;
  currentStock: number;
  minStock: number;
  isOut: boolean;
};

export type LowStockSummary = {
  lowCount: number;
  outCount: number;
  criticalCount: number;
  items: LowStockItem[];
};

const n = (v: unknown): number => (v == null ? 0 : Number(v));

/** Active items at or below min stock (includes zero). */
export async function buildLowStockSummary(limit = 12): Promise<LowStockSummary> {
  const rows = await db
    .select()
    .from(inventoryItemsTable)
    .where(and(
      eq(inventoryItemsTable.isActive, true),
      lte(inventoryItemsTable.currentStock, inventoryItemsTable.minStock),
    ))
    .orderBy(sql`${inventoryItemsTable.currentStock}::numeric ASC`, inventoryItemsTable.name);

  const items: LowStockItem[] = rows.map((r) => {
    const currentStock = n(r.currentStock);
    const minStock = n(r.minStock);
    return {
      id: r.id,
      name: r.name,
      unit: r.unit,
      category: r.category,
      currentStock,
      minStock,
      isOut: currentStock <= 0,
    };
  });

  const outCount = items.filter((i) => i.isOut).length;
  const lowCount = items.length - outCount;

  return {
    lowCount,
    outCount,
    criticalCount: items.length,
    items: items.slice(0, limit),
  };
}
