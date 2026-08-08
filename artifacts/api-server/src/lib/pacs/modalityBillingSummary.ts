/**
 * Clinic-wide imaging modality billing counts for My Daily Summary.
 *
 * Counts active order-test lines on non-cancelled bills created in the date
 * range (bill createdAt, IST), bucketed by diagnostic_tests.department via
 * classifyImagingBucket — same axis as Daily Summary category-test-summary,
 * not radiology studyDate (Billing vs PACS).
 */
import { db } from "@workspace/db";
import {
  billsTable,
  doctorsTable,
  orderTestsTable,
  ordersTable,
  patientsTable,
  testsTable,
} from "@workspace/db/schema";
import { and, eq, gte, isNull, lt, ne, sql } from "drizzle-orm";
import {
  classifyImagingBucket,
  emptyBucketCounts,
  IMAGING_BUCKETS,
  MODALITY_DISPLAY_LABEL,
  MODALITY_REPORT_KEYS,
  resolveModalityQuery,
  type ImagingBucket,
} from "./imagingModalityBucket";

export {
  MODALITY_DISPLAY_LABEL,
  MODALITY_REPORT_KEYS,
  resolveModalityQuery,
  type ImagingBucket,
};

export type ModalityBillingRow = {
  key: ImagingBucket;
  label: string;
  /** Active imaging test lines billed in range */
  testCount: number;
  /** Distinct bills that include at least one line of this modality */
  billCount: number;
  grossBilling: number;
};

export type ModalityBillingSummary = {
  from: string;
  to: string;
  modalities: ModalityBillingRow[];
  totals: {
    testCount: number;
    billCount: number;
    grossBilling: number;
  };
};

export type ModalityBillLine = {
  billId: number;
  billNumber: string;
  patientName: string;
  referringDoctor: string | null;
  billAmount: number;
  status: string;
  createdAt: string;
  /** Imaging tests of the selected modality on this bill */
  tests: string;
  modalityAmount: number;
};

function dayBoundsRange(from: string, to: string) {
  return {
    start: new Date(`${from}T00:00:00+05:30`),
    end: new Date(`${to}T23:59:59.999+05:30`),
  };
}

function patientNameOf(r: { patientFirstName: string | null; patientLastName: string | null }) {
  return r.patientFirstName
    ? `${r.patientFirstName} ${r.patientLastName ?? ""}`.trim()
    : "Unknown";
}

async function fetchBilledImagingLines(from: string, to: string) {
  const { start, end } = dayBoundsRange(from, to);
  return db
    .select({
      billId: billsTable.id,
      billNumber: billsTable.billNumber,
      totalAmount: billsTable.totalAmount,
      status: billsTable.status,
      createdAt: billsTable.createdAt,
      patientFirstName: patientsTable.firstName,
      patientLastName: patientsTable.lastName,
      referringDoctor: doctorsTable.name,
      testName: testsTable.name,
      department: testsTable.department,
      category: testsTable.category,
      linePrice: orderTestsTable.price,
      orderTestId: orderTestsTable.id,
    })
    .from(billsTable)
    .innerJoin(ordersTable, eq(billsTable.orderId, ordersTable.id))
    .innerJoin(orderTestsTable, eq(orderTestsTable.orderId, ordersTable.id))
    .innerJoin(testsTable, eq(orderTestsTable.testId, testsTable.id))
    .leftJoin(patientsTable, eq(billsTable.patientId, patientsTable.id))
    .leftJoin(doctorsTable, eq(ordersTable.doctorId, doctorsTable.id))
    .where(
      and(
        gte(billsTable.createdAt, start),
        lt(billsTable.createdAt, new Date(end.getTime() + 1)),
        ne(billsTable.status, "cancelled"),
        isNull(billsTable.cancelledAt),
        ne(orderTestsTable.status, "cancelled"),
      ),
    )
    .orderBy(sql`${billsTable.createdAt} DESC`);
}

export async function buildModalityBillingSummary(
  from: string,
  to: string,
): Promise<ModalityBillingSummary> {
  const lines = await fetchBilledImagingLines(from, to);

  const testCounts = emptyBucketCounts();
  const billSets: Record<ImagingBucket, Set<number>> = {
    MRI: new Set(),
    USG: new Set(),
    CT: new Set(),
    "X-Ray": new Set(),
    OPG: new Set(),
  };
  const grossBilling: Record<ImagingBucket, number> = {
    MRI: 0,
    USG: 0,
    CT: 0,
    "X-Ray": 0,
    OPG: 0,
  };

  for (const row of lines) {
    const bucket = classifyImagingBucket({
      department: row.department,
      testName: row.testName,
    });
    if (!bucket) continue;
    testCounts[bucket] += 1;
    billSets[bucket].add(row.billId);
    grossBilling[bucket] += Number(row.linePrice) || 0;
  }

  // Prefer primary report modalities first; append OPG when it has activity.
  const keys: ImagingBucket[] = [...MODALITY_REPORT_KEYS];
  if (testCounts.OPG > 0) keys.push("OPG");

  const modalities: ModalityBillingRow[] = keys.map((key) => ({
    key,
    label: MODALITY_DISPLAY_LABEL[key],
    testCount: testCounts[key],
    billCount: billSets[key].size,
    grossBilling: Math.round(grossBilling[key] * 100) / 100,
  }));

  const allBillIds = new Set<number>();
  for (const key of IMAGING_BUCKETS) {
    for (const id of billSets[key]) allBillIds.add(id);
  }

  return {
    from,
    to,
    modalities,
    totals: {
      testCount: modalities.reduce((s, m) => s + m.testCount, 0),
      billCount: allBillIds.size,
      grossBilling: Math.round(modalities.reduce((s, m) => s + m.grossBilling, 0) * 100) / 100,
    },
  };
}

export async function listModalityBills(
  from: string,
  to: string,
  modality: ImagingBucket,
): Promise<{
  modality: ImagingBucket;
  label: string;
  from: string;
  to: string;
  columns: string[];
  rows: (string | number | null)[][];
  bills: ModalityBillLine[];
}> {
  const lines = await fetchBilledImagingLines(from, to);
  const byBill = new Map<
    number,
    {
      bill: ModalityBillLine;
      testNames: string[];
      modalityAmount: number;
    }
  >();

  for (const row of lines) {
    const bucket = classifyImagingBucket({
      department: row.department,
      testName: row.testName,
    });
    if (bucket !== modality) continue;

    const existing = byBill.get(row.billId);
    const testLabel = row.testName;
    const price = Number(row.linePrice) || 0;
    if (existing) {
      existing.testNames.push(testLabel);
      existing.modalityAmount += price;
    } else {
      byBill.set(row.billId, {
        bill: {
          billId: row.billId,
          billNumber: row.billNumber,
          patientName: patientNameOf(row),
          referringDoctor: row.referringDoctor,
          billAmount: Number(row.totalAmount) || 0,
          status: row.status,
          createdAt:
            row.createdAt instanceof Date
              ? row.createdAt.toISOString()
              : String(row.createdAt),
          tests: "",
          modalityAmount: 0,
        },
        testNames: [testLabel],
        modalityAmount: price,
      });
    }
  }

  const bills: ModalityBillLine[] = Array.from(byBill.values()).map(({ bill, testNames, modalityAmount }) => ({
    ...bill,
    tests: testNames.join(", "),
    modalityAmount: Math.round(modalityAmount * 100) / 100,
  }));

  const columns = [
    "Bill #",
    "Patient",
    "Referring Doctor",
    "Tests",
    "Modality Amount",
    "Bill Amount",
    "Status",
    "Created At",
  ];
  const rows: (string | number | null)[][] = bills.map((b) => [
    b.billNumber,
    b.patientName,
    b.referringDoctor ?? "—",
    b.tests,
    b.modalityAmount,
    b.billAmount,
    b.status,
    b.createdAt,
  ]);

  return {
    modality,
    label: MODALITY_DISPLAY_LABEL[modality],
    from,
    to,
    columns,
    rows,
    bills,
  };
}
