import { db } from "@workspace/db";
import {
  patientsTable,
  patientCounterTable,
  ordersTable,
  orderTestsTable,
  testsTable,
  packagesTable,
  packageTestsTable,
  billsTable,
  paymentsTable,
  clinicSettingsTable,
  ledgersTable,
} from "@workspace/db/schema";
import { eq, sql, inArray } from "drizzle-orm";
import { generateBillNumber } from "../routes/bills";
import { generateTokenForBill } from "../routes/tokens";
import { generateTestTokensForOrder } from "../routes/test-tokens";
import { calculateDobFromAge } from "../routes/public-booking";
import { generateStudiesForOrder } from "../routes/radiology";

export async function generatePatientId(): Promise<string> {
  const [counter] = await db.select().from(patientCounterTable).limit(1);
  let seq = 1;
  if (counter) {
    seq = counter.counter + 1;
    await db.update(patientCounterTable).set({ counter: seq }).where(eq(patientCounterTable.id, counter.id));
  } else {
    await db.insert(patientCounterTable).values({ counter: 1 });
  }
  return `P${String(seq).padStart(5, "0")}`;
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

  // Get settings for ledger
  const [settings] = await db.select().from(clinicSettingsTable).limit(1);
  const ledgerId = settings?.onlineBookingLedgerId || 1;

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
  const { billRow, orderRow } = await db.transaction(async (tx) => {
    const [ord] = await tx
      .insert(ordersTable)
      .values({
        orderNumber,
        patientId: patientDbId,
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

    const billNumber = await generateBillNumber(ledgerId);
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

    await tx.insert(paymentsTable).values({
      billId: bill.id,
      amount: paymentAmount.toFixed(2),
      method: paymentMethod,
      referenceNumber: paymentReference,
      recordedByName: source === "kiosk" ? "Kiosk" : "Online",
      notes: `${source === "kiosk" ? "Kiosk" : "Online"} self-registration ${paymentMethod} payment`,
    });

    return { billRow: bill, orderRow: ord };
  });

  await db.update(patientsTable).set({ ledgerId }).where(
    sql`${patientsTable.id} = ${patientDbId} AND ${patientsTable.ledgerId} IS NULL`
  );

  let tokenNo: number | null = null;
  let tokenDate: string | null = null;
  try {
    const tokenInfo = await generateTokenForBill({
      ledgerId,
      billId: billRow.id,
      patientId: patientDbId,
      priority: isVip ? 5 : 0,
      source,
    });
    tokenNo = tokenInfo?.tokenNo ?? null;
    tokenDate = tokenInfo?.tokenDate ?? null;
  } catch { /* non-blocking */ }

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
  };
}
