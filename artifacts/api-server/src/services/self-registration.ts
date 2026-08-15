import { db } from "@workspace/db";
import {
  patientsTable,
  ordersTable,
  orderTestsTable,
  testsTable,
  packagesTable,
  packageTestsTable,
  billsTable,
  paymentsTable,
  clinicSettingsTable,
  ledgersTable,
  doctorsTable,
} from "@workspace/db/schema";
import { eq, sql, inArray } from "drizzle-orm";
import { generateBillNumber } from "../routes/bills";
import { deriveBillTokenFromTestTokens } from "../lib/deriveBillToken";
import { generateTestTokensForOrder } from "../routes/test-tokens";
import { calculateDobFromAge } from "../routes/public-booking";
import { autoVoucherForPayment } from "../lib/auto-voucher";
import { generateStudiesForOrder } from "../routes/radiology";
import { nextPatientId } from "../lib/documentNumberCounters";

/** UHID for kiosk / online self-registration — same SEQUENCE as Billing Desk. */
export async function generatePatientId(): Promise<string> {
  return nextPatientId(db);
}

export interface RegisterPatientSelfFlowParams {
  firstName: string;
  lastName: string;
  phone: string;
  gender: string;
  ageValue: number;
  ageUnit: string;
  testIds: number[];
  packageIds?: number[];
  paymentMethod: string;
  paymentReference: string;
  paymentAmount: number;
  isVip?: boolean;
  notes?: string;
  email?: string;
  source: "kiosk" | "online";
  createdByName?: string;
  // Referring doctor selected in the booking/kiosk form. Copied onto the
  // created order's doctor_id so the referral is tracked exactly like an
  // over-the-counter Billing Desk bill. Undefined/null for walk-in/self.
  doctorId?: number | null;
}

export async function registerPatientSelfFlow(params: RegisterPatientSelfFlowParams) {
  const {
    firstName,
    lastName,
    phone,
    gender,
    ageValue,
    ageUnit,
    testIds,
    packageIds = [],
    paymentMethod,
    paymentReference,
    paymentAmount,
    isVip = false,
    notes = "",
    email = "",
    source,
    createdByName,
    doctorId = null,
  } = params;

  // Resolve package -> test IDs
  const resolvedTestIds = [...testIds];
  if (packageIds.length > 0) {
    const pkgTests = await db
      .select({ testId: packageTestsTable.testId })
      .from(packageTestsTable)
      .where(inArray(packageTestsTable.packageId, packageIds));
    for (const pt of pkgTests) {
      resolvedTestIds.push(pt.testId);
    }
  }

  const allTestIds = [...new Set(resolvedTestIds)];
  if (allTestIds.length === 0) {
    throw new Error("No tests could be resolved for registration.");
  }

  // Ledger routing. When a referring doctor is attached, route the whole
  // registration (order, bill, queue tokens, and the patient's home ledger) to
  // that doctor's own ledger — exactly what the Billing Desk does via
  // resolveLedgerForOrder()/orders.ts (`resolvedDoctor.ledgerId ?? walk-in`).
  // This is what makes referral commission accrue against the doctor's ledger
  // instead of silently landing in the generic booking ledger. Falls back to
  // the configured "Booking Ledger" (onlineBookingLedgerId) — the walk-in
  // equivalent for this flow — when there's no referral (or the doctor has no
  // ledger assigned).
  const [settings] = await db.select().from(clinicSettingsTable).limit(1);
  let ledgerId = settings?.onlineBookingLedgerId || 1;
  if (doctorId) {
    const [doc] = await db
      .select({ ledgerId: doctorsTable.ledgerId })
      .from(doctorsTable)
      .where(eq(doctorsTable.id, doctorId))
      .limit(1);
    if (doc?.ledgerId) ledgerId = doc.ledgerId;
  }

  // Find or create patient by phone
  const [existingPatient] = await db
    .select()
    .from(patientsTable)
    .where(eq(patientsTable.phone, phone))
    .limit(1);

  let patientDbId: number;
  let patientCode: string;
  let isNewPatient: boolean;

  if (existingPatient) {
    patientDbId = existingPatient.id;
    patientCode = existingPatient.patientId;
    isNewPatient = false;
  } else {
    const patientIdStr = await generatePatientId();
    const resolvedDob = calculateDobFromAge(ageValue, ageUnit);
    const [newPat] = await db
      .insert(patientsTable)
      .values({
        patientId: patientIdStr,
        firstName,
        lastName,
        phone,
        email: email || null,
        dateOfBirth: resolvedDob,
        ageValue,
        ageUnit,
        gender,
        ledgerId,
      })
      .returning();
    patientDbId = newPat.id;
    patientCode = newPat.patientId;
    isNewPatient = true;
  }

  // Fetch test prices
  const tests = await db
    .select({ id: testsTable.id, price: testsTable.price, department: testsTable.department })
    .from(testsTable)
    .where(inArray(testsTable.id, allTestIds));

  // Determine VIP price multiplier if applicable
  const vipPct = settings?.vipPercentage ? Number(settings.vipPercentage) : 50.00;
  const vipMultiplier = 1 + (vipPct / 100);

  const testPrices = tests.map(t => {
    let priceNum = Number(t.price);
    if (isVip) {
      priceNum = priceNum * vipMultiplier;
    }
    return { id: t.id, price: priceNum.toFixed(2) };
  });

  const calculatedTotal = testPrices.reduce((sum, t) => sum + Number(t.price), 0);

  // Generate order number
  const stamp = `${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, "0")}${String(new Date().getDate()).padStart(2, "0")}`;
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  const orderNumber = `${source.toUpperCase()}-${stamp}-${rand}`;

  // Create order + order_tests + bill in a transaction
  const { billRow, orderRow, paymentId } = await db.transaction(async (tx) => {
    const [ord] = await tx
      .insert(ordersTable)
      .values({
        orderNumber,
        patientId: patientDbId,
        doctorId: doctorId ?? undefined,
        status: "pending",
        totalAmount: calculatedTotal.toFixed(2),
        notes: `${source === "kiosk" ? "Kiosk self-registration" : "Online booking"}. ${notes}`.trim(),
        ledgerId,
      })
      .returning();

    for (const tp of testPrices) {
      await tx.insert(orderTestsTable).values({
        orderId: ord.id,
        testId: tp.id,
        price: tp.price,
      });
    }

    // Bill numbers come from document_number_counters (atomic UPSERT) — same
    // allocator as POST /api/bills; no process-wide advisory lock.
    const billNumber = await generateBillNumber(ledgerId, tx);
    const [bill] = await tx
      .insert(billsTable)
      .values({
        billNumber,
        orderId: ord.id,
        patientId: patientDbId,
        subtotal: calculatedTotal.toFixed(2),
        discount: "0.00",
        taxAmount: "0.00",
        totalAmount: calculatedTotal.toFixed(2),
        paidAmount: paymentAmount.toFixed(2),
        balanceAmount: Math.max(0, calculatedTotal - paymentAmount).toFixed(2),
        status: paymentAmount >= calculatedTotal ? "paid" : "partial",
        ledgerId,
        createdByName: createdByName || `${source === "kiosk" ? "Kiosk" : "Online"} Self-Registration`,
      })
      .returning();

    const [payment] = await tx.insert(paymentsTable).values({
      billId: bill.id,
      amount: paymentAmount.toFixed(2),
      method: paymentMethod,
      referenceNumber: paymentReference,
      recordedByName: source === "kiosk" ? "Kiosk" : "Online",
      notes: `${source === "kiosk" ? "Kiosk" : "Online"} self-registration ${paymentMethod} payment`,
    }).returning({ id: paymentsTable.id });

    return { billRow: bill, orderRow: ord, paymentId: payment?.id ?? null };
  });

  // F2 — voucher the prepayment AT CAPTURE (IST-dated, method-correct account,
  // linked by payment_id), instead of leaving it for the sync-billing backfill
  // (which posted it late, UTC-dated and misclassified). Fire-and-forget and
  // idempotent by payment_id, so a later sync never doubles it.
  if (paymentId != null && paymentAmount > 0) {
    void autoVoucherForPayment({
      billId: billRow.id,
      amount: paymentAmount,
      method: paymentMethod,
      billNumber: billRow.billNumber,
      patientName: `${firstName} ${lastName}`.trim() || undefined,
      performedBy: source === "kiosk" ? "Kiosk" : "Online",
      paymentId,
    }).catch(() => { /* logged inside auto-voucher; never blocks registration */ });
  }

  await db.update(patientsTable).set({ ledgerId }).where(
    sql`${patientsTable.id} = ${patientDbId} AND ${patientsTable.ledgerId} IS NULL`
  );

  let testTokens: Array<{ orderTestId: number; testName: string; department: string; roomNumber: string; tokenNo: number }> = [];
  try {
    testTokens = await generateTestTokensForOrder({
      ledgerId,
      billId: billRow.id,
      orderId: orderRow.id,
      patientId: patientDbId,
      priority: isVip ? 5 : 0,
      source,
    });
  } catch { /* non-blocking */ }

  const derivedToken = deriveBillTokenFromTestTokens(testTokens);
  const tokenNo = derivedToken?.tokenNo ?? null;
  const tokenDate = derivedToken?.tokenDate ?? null;

  // Fan out radiology studies if applicable
  try {
    await generateStudiesForOrder({
      billId: billRow.id,
      orderId: orderRow.id,
      patientId: patientDbId,
      priority: isVip ? "vip" : "routine",
    });
  } catch { /* non-blocking */ }

  return {
    success: true,
    billNumber: billRow.billNumber,
    billId: billRow.id,
    patientDbId,
    totalAmount: calculatedTotal,
    patientCode,
    patientName: `${firstName} ${lastName}`.trim(),
    isNewPatient,
    tokenNo,
    tokenDate,
    testTokens,
    createdAt: billRow.createdAt,
    createdByName: billRow.createdByName,
  };
}
