import { db } from "@workspace/db";
import { billsTable, paymentsTable, userDayClosuresTable, ordersTable, doctorsTable, patientsTable } from "@workspace/db/schema";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { isCollectiblePayment } from "./financialIntegrity";
import {
  isSameDayAfterClose,
  summarizeSameDayBills,
  summarizeSameDayPayments,
} from "./sameDayAfterClose";

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
    /** Same IST calendar day as the close, after the close timestamp. */
    sameDayAfterClose: boolean;
  }>;
  payments: Array<{
    id: number;
    billId: number;
    /** The clinic's bill number, or null if the bill row is gone. Never swapped for `billId`. */
    billNumber: string | null;
    amount: number;
    method: string;
    patientName: string | null;
    referringDoctor: string | null;
    createdAt: Date | null;
    sameDayAfterClose: boolean;
  }>;
  billTotal: number;
  paymentTotal: number;
  sameDayBillCount: number;
  sameDayBillTotal: number;
  sameDayPaymentCount: number;
  sameDayPaymentTotal: number;
};

const EMPTY: PostClosureActivityResult = {
  closedAt: null,
  closureId: null,
  drawerStatus: null,
  bills: [],
  payments: [],
  billTotal: 0,
  paymentTotal: 0,
  sameDayBillCount: 0,
  sameDayBillTotal: 0,
  sameDayPaymentCount: 0,
  sameDayPaymentTotal: 0,
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
        billNumber: billsTable.billNumber,
        amount: paymentsTable.amount,
        method: paymentsTable.method,
        createdAt: paymentsTable.createdAt,
        settlementStatus: paymentsTable.settlementStatus,
        patientFirstName: patientsTable.firstName,
        patientLastName: patientsTable.lastName,
        referringDoctor: doctorsTable.name,
      })
      .from(paymentsTable)
      // LEFT, not INNER, and each right side is a primary key: this row set is
      // summed into paymentTotal, so a payment whose bill row is missing must
      // still count, and no payment may ever be matched twice.
      .leftJoin(billsTable, eq(paymentsTable.billId, billsTable.id))
      .leftJoin(patientsTable, eq(billsTable.patientId, patientsTable.id))
      .leftJoin(ordersTable, eq(billsTable.orderId, ordersTable.id))
      .leftJoin(doctorsTable, eq(ordersTable.doctorId, doctorsTable.id))
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
  const mappedBills = bills.map((b) => ({
    ...b,
    totalAmount: n(b.totalAmount),
    paidAmount: n(b.paidAmount),
    sameDayAfterClose: isSameDayAfterClose(b.createdAt, since),
  }));
  const mappedPayments = collectiblePayments.map((p) => ({
    id: p.id,
    billId: p.billId,
    billNumber: p.billNumber ?? null,
    amount: n(p.amount),
    method: p.method,
    patientName: p.patientFirstName
      ? `${p.patientFirstName} ${p.patientLastName ?? ""}`.trim()
      : null,
    referringDoctor: p.referringDoctor ?? null,
    createdAt: p.createdAt,
    sameDayAfterClose: isSameDayAfterClose(p.createdAt, since),
  }));
  const sameDayBills = summarizeSameDayBills(mappedBills, since);
  const sameDayPays = summarizeSameDayPayments(mappedPayments, since);

  return {
    closedAt: latestClose.closedAt,
    closureId: latestClose.id,
    drawerStatus: latestClose.drawerStatus,
    bills: mappedBills,
    payments: mappedPayments,
    billTotal,
    paymentTotal,
    sameDayBillCount: sameDayBills.billCount,
    sameDayBillTotal: sameDayBills.billTotal,
    sameDayPaymentCount: sameDayPays.paymentCount,
    sameDayPaymentTotal: sameDayPays.paymentTotal,
  };
}
