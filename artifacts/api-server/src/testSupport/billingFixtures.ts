/**
 * billingFixtures.ts — throwaway rows for request-level billing tests.
 *
 * Everything created here is namespaced with a per-run marker so a failed run
 * can never collide with, or delete, real clinic data.
 */
import { db } from "@workspace/db";
import {
  portalSessionsTable,
  usersTable,
  patientsTable,
  testsTable,
  billsTable,
  ordersTable,
  orderTestsTable,
  paymentsTable,
  billAuditsTable,
  vouchersTable,
} from "@workspace/db/schema";
import { eq, inArray, like } from "drizzle-orm";
import { randomUUID } from "node:crypto";

export interface BillingFixture {
  marker: string;
  token: string;
  userId: number;
  patientId: number;
  testId: number;
  testPrice: number;
  cleanup: () => Promise<void>;
}

/**
 * Seed a staff session (with /orders + /billing permissions), a patient, and
 * an active catalogue test — the minimum POST /api/billing/save needs.
 */
export async function seedBillingFixture(): Promise<BillingFixture> {
  const marker = `vitest-${randomUUID().slice(0, 8)}`;
  const token = `vitest-token-${randomUUID()}`;

  const [user] = await db
    .insert(usersTable)
    .values({
      name: `Vitest Desk ${marker}`,
      email: `${marker}@vitest.invalid`,
      username: `${marker}`,
      role: "receptionist",
      // Explicit permissions (not admin) so the test also proves a normal
      // billing-desk role can save — the VIP/package price guard used to
      // 403 exactly these users.
      permissions: JSON.stringify(["/orders", "/billing", "/patients"]),
      pin: "0000",
      isActive: true,
    })
    .returning();

  await db.insert(portalSessionsTable).values({
    token,
    scope: "staff",
    subjectId: user.id,
    subjectName: user.name,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });

  const [patient] = await db
    .insert(patientsTable)
    .values({
      patientId: `VT-${marker}`,
      firstName: "Vitest",
      lastName: `Patient ${marker}`,
      dateOfBirth: "1990-01-01",
      gender: "male",
      phone: "9000000000",
    })
    .returning();

  const [test] = await db
    .insert(testsTable)
    .values({
      name: `Vitest Test ${marker}`,
      code: `VT${marker.slice(-6).toUpperCase()}`,
      price: "400",
      category: "Pathology",
      duration: "1 day",
      isActive: true,
    })
    .returning();

  async function cleanup(): Promise<void> {
    // Children first — bills/orders carry FKs.
    const bills = await db
      .select({ id: billsTable.id })
      .from(billsTable)
      .where(eq(billsTable.patientId, patient.id));
    const billIds = bills.map((b) => b.id);
    if (billIds.length > 0) {
      await db.delete(vouchersTable).where(inArray(vouchersTable.billId, billIds)).catch(() => {});
      await db.delete(paymentsTable).where(inArray(paymentsTable.billId, billIds)).catch(() => {});
      await db.delete(billAuditsTable).where(inArray(billAuditsTable.billId, billIds)).catch(() => {});
      await db.delete(billsTable).where(inArray(billsTable.id, billIds)).catch(() => {});
    }
    const orders = await db
      .select({ id: ordersTable.id })
      .from(ordersTable)
      .where(eq(ordersTable.patientId, patient.id));
    const orderIds = orders.map((o) => o.id);
    if (orderIds.length > 0) {
      await db.delete(orderTestsTable).where(inArray(orderTestsTable.orderId, orderIds)).catch(() => {});
      await db.delete(ordersTable).where(inArray(ordersTable.id, orderIds)).catch(() => {});
    }
    await db.delete(patientsTable).where(eq(patientsTable.id, patient.id)).catch(() => {});
    await db.delete(testsTable).where(eq(testsTable.id, test.id)).catch(() => {});
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token)).catch(() => {});
    await db.delete(usersTable).where(eq(usersTable.id, user.id)).catch(() => {});
    // Vouchers keyed only by reference text (no bill row left) — marker-scoped.
    await db.delete(vouchersTable).where(like(vouchersTable.particular, `%${marker}%`)).catch(() => {});
  }

  return {
    marker,
    token,
    userId: user.id,
    patientId: patient.id,
    testId: test.id,
    testPrice: 400,
    cleanup,
  };
}
