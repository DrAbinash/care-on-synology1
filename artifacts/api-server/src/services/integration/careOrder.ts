// ============================================================================
// Create (or append to) the canonical CARE order for an accepted referral.
//
// This mirrors the exact order-creation shape of routes/orders.ts (order-number
// format, orders + order_tests inserts) WITHOUT modifying that protected file,
// exactly as services/self-registration.ts already creates orders directly.
// It NEVER creates a bill — the frozen POST /api/bills stays the only path to
// money, opened and confirmed by CARE staff. Prices come from CARE's own
// diagnostic_tests (HOPE prices are estimates and are never used).
// ============================================================================
import { sql, eq, inArray } from "drizzle-orm";
import {
  ordersTable,
  orderTestsTable,
  testsTable,
} from "@workspace/db";
import type { Tx } from "./db";
import { generateOrderNumber } from "../../routes/orders";

async function allocateOrderNumber(tx: Tx): Promise<string> {
  // Same numeric-max allocator as POST /api/orders (imported) so Hope referrals
  // cannot mint a colliding ORD-YYYYMM-#### via the old count(*)+1 path.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('care_erp_order_number'))`);
  return generateOrderNumber(tx);
}

export interface AcceptLine {
  referralItemId: number;
  testId: number;
  displayName?: string | null;
}

export interface CareOrderResult {
  orderId: number;
  orderNumber: string;
  created: boolean;
  lines: Array<{ referralItemId: number; orderTestId: number; testId: number; price: string }>;
  totalAmount: string;
}

/**
 * Create the CARE order for a referral if it doesn't exist yet, else append the
 * given lines to it (partial fulfilment). Returns the mapping of referral items
 * → created order_tests so the caller can link them.
 */
export async function createOrAppendCareOrder(
  tx: Tx,
  params: {
    existingOrderId: number | null;
    patientId: number;
    doctorId: number | null;
    clinicalHistory?: string | null;
    clientRef: string; // referral uuid
    lines: AcceptLine[];
  },
): Promise<CareOrderResult> {
  // Re-price from CARE's catalogue; drop unknown/inactive tests defensively.
  const testIds = [...new Set(params.lines.map((l) => l.testId))];
  const testRows = testIds.length
    ? await tx.select().from(testsTable).where(inArray(testsTable.id, testIds))
    : [];
  const testMap = new Map(testRows.map((t) => [t.id, t]));
  const validLines = params.lines.filter((l) => testMap.get(l.testId)?.isActive);

  const linePrices = validLines.map((l) => ({
    ...l,
    price: String(testMap.get(l.testId)!.price),
  }));
  const addedTotal = linePrices.reduce((s, l) => s + Number(l.price), 0);

  let orderId = params.existingOrderId;
  let orderNumber = "";
  let created = false;

  if (!orderId) {
    // Create the order (retry once on order-number collision).
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      orderNumber = await allocateOrderNumber(tx);
      try {
        const [order] = await tx.insert(ordersTable).values({
          orderNumber,
          patientId: params.patientId,
          doctorId: params.doctorId ?? undefined,
          status: "pending",
          totalAmount: String(addedTotal.toFixed(2)),
          notes: params.clinicalHistory ?? undefined,
          clientRef: params.clientRef,
        }).returning({ id: ordersTable.id, orderNumber: ordersTable.orderNumber });
        orderId = order.id;
        orderNumber = order.orderNumber;
        created = true;
        break;
      } catch (e) {
        const code = (e as { code?: string })?.code;
        if (code === "23505" && attempt < 3) { attempt++; continue; }
        throw e;
      }
    }
  } else {
    const [existing] = await tx.select().from(ordersTable).where(eq(ordersTable.id, orderId)).limit(1);
    orderNumber = existing?.orderNumber ?? "";
    const newTotal = Number(existing?.totalAmount ?? 0) + addedTotal;
    await tx.update(ordersTable).set({ totalAmount: String(newTotal.toFixed(2)) }).where(eq(ordersTable.id, orderId));
  }

  const lines: CareOrderResult["lines"] = [];
  for (const l of linePrices) {
    const [ot] = await tx.insert(orderTestsTable).values({
      orderId: orderId!,
      testId: l.testId,
      price: l.price,
      displayName: l.displayName ?? undefined,
      status: "active",
    }).returning({ id: orderTestsTable.id });
    lines.push({ referralItemId: l.referralItemId, orderTestId: ot.id, testId: l.testId, price: l.price });
  }

  const [{ total }] = await tx
    .select({ total: sql<string>`coalesce(sum(${orderTestsTable.price}), 0)::text` })
    .from(orderTestsTable)
    .where(eq(orderTestsTable.orderId, orderId!));
  await tx.update(ordersTable).set({ totalAmount: String(Number(total).toFixed(2)) }).where(eq(ordersTable.id, orderId!));

  return { orderId: orderId!, orderNumber, created, lines, totalAmount: String(Number(total).toFixed(2)) };
}
