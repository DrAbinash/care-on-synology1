import { db } from "@workspace/db";
import { billsTable, paymentsTable, userDayClosuresTable } from "@workspace/db/schema";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { isCollectiblePayment } from "./financialIntegrity";

function n(v: unknown): number {
  return Number(v ?? 0) || 0;
}

export type PostClosureActivityResult = {
  closedAt: Date | null;
  closureId: number | null;
  drawerStatus: string | null;
  bills: Array<{
    id: number;
    billNumber: string | null;
    totalAmount: number;
    paidAmount: number;
    status: string | null;
    createdAt: Date | null;
  }>;
  payments: Array<{
    id: number;
    billId: number;
    amount: number;
    method: string;
    createdAt: Date | null;
  }>;
  billTotal: number;
  paymentTotal: number;
};

const EMPTY: PostClosureActivityResult = {
  closedAt: null,
  closureId: null,
  drawerStatus: null,
  bills: [],
  payments: [],
  billTotal: 0,
  paymentTotal: 0,
};

/**
 * Bills/payments recorded after the staff member's latest drawer close.
 * Includes reopened drawers — a reopen keeps the same close timestamp as
 * the anchor so post-close billing is visible until the next close.
 */
export async function loadPostClosureActivity(userName: string): Promise<PostClosureActivityResult> {
  const [latestClose] = await db
    .select({
      id: userDayClosuresTable.id,
      closedAt: userDayClosuresTable.closedAt,
      drawerStatus: userDayClosuresTable.drawerStatus,
    })
    .from(userDayClosuresTable)
    .where(eq(userDayClosuresTable.userName, userName))
    .orderBy(desc(userDayClosuresTable.closedAt))
    .limit(1);

  if (!latestClose) return EMPTY;

  // Drawer open for the first time this window — nothing to flag yet.
  if (latestClose.drawerStatus === "open") return EMPTY;

  const since = new Date(latestClose.closedAt);

  const [bills, payments] = await Promise.all([
    db
      .select({
        id: billsTable.id,
        billNumber: billsTable.billNumber,
        totalAmount: billsTable.totalAmount,
        paidAmount: billsTable.paidAmount,
        status: billsTable.status,
        createdAt: billsTable.createdAt,
      })
      .from(billsTable)
      .where(and(
        eq(billsTable.createdByName, userName),
        gt(billsTable.createdAt, since),
        sql`${billsTable.status} != 'cancelled'`,
      ))
      .orderBy(desc(billsTable.createdAt))
      .limit(50),

    db
      .select({
        id: paymentsTable.id,
        billId: paymentsTable.billId,
        amount: paymentsTable.amount,
        method: paymentsTable.method,
        createdAt: paymentsTable.createdAt,
        settlementStatus: paymentsTable.settlementStatus,
      })
      .from(paymentsTable)
      .where(and(
        eq(paymentsTable.recordedByName, userName),
        gt(paymentsTable.createdAt, since),
      ))
      .orderBy(desc(paymentsTable.createdAt))
      .limit(100),
  ]);

  const collectiblePayments = payments.filter(isCollectiblePayment);
  const billTotal = bills.reduce((s, b) => s + n(b.totalAmount), 0);
  const paymentTotal = collectiblePayments.reduce((s, p) => s + n(p.amount), 0);

  return {
    closedAt: latestClose.closedAt,
    closureId: latestClose.id,
    drawerStatus: latestClose.drawerStatus,
    bills: bills.map((b) => ({
      ...b,
      totalAmount: n(b.totalAmount),
      paidAmount: n(b.paidAmount),
    })),
    payments: collectiblePayments.map((p) => ({
      id: p.id,
      billId: p.billId,
      amount: n(p.amount),
      method: p.method,
      createdAt: p.createdAt,
    })),
    billTotal,
    paymentTotal,
  };
}
