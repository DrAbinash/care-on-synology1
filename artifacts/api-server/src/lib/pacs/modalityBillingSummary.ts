/**
 * Clinic-wide diagnostic-service billing for My Daily Summary
 * (imaging modalities + consolidated Pathology).
 *
 * Counts active order-test lines on non-cancelled bills created in the date
 * range (bill createdAt, IST), bucketed by diagnostic_tests.department via
 * classifyDiagnosticService — same axis as Daily Summary category-test-summary,
 * not radiology studyDate (Billing vs PACS).
 *
 * Amounts are SUM(order_tests.price) per bucket — the line billed price already
 * stored on the order line. Bill-level discounts / payments / dues are NOT
 * reapplied here (preserves existing Imaging Billed semantics).
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
  classifyDiagnosticService,
  emptyDiagnosticServiceCounts,
  MODALITY_DISPLAY_LABEL,
  MODALITY_REPORT_KEYS,
  resolveModalityQuery,
  type DiagnosticServiceKey,
  type ImagingBucket,
} from "./imagingModalityBucket";

export {
  MODALITY_DISPLAY_LABEL,
  MODALITY_REPORT_KEYS,
  resolveModalityQuery,
  type DiagnosticServiceKey,
  type ImagingBucket,
};

export type RateKind = "single" | "multiple" | "none";

export type ModalityBillingRow = {
  key: DiagnosticServiceKey;
  label: string;
  /** Active diagnostic test lines billed in range (one order_tests row = one count) */
  testCount: number;
  /** Distinct bills that include at least one line of this service */
  billCount: number;
  /** Sum of order_tests.price for matching lines — authoritative billed amount */
  grossBilling: number;
  /**
   * Price presentation metadata derived from distinct line prices.
   * - single: every line shares the same rate → unitRate is that rate
   * - multiple: heterogeneous prices → show Avg (avgRate); do not invent a tariff
   * - none: zero lines
   */
  rateKind: RateKind;
  /** Present when rateKind === "single" */
  unitRate: number | null;
  /** grossBilling / testCount when testCount > 0 */
  avgRate: number | null;
  /** Distinct positive line prices observed (capped metadata; for drill-down clarity) */
  distinctRateCount: number;
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
  /** Tests of the selected service on this bill */
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

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function normalizeLinePrice(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return roundMoney(n);
}

export function deriveRateMeta(
  testCount: number,
  grossBilling: number,
  distinctPrices: Iterable<number>,
): Pick<ModalityBillingRow, "rateKind" | "unitRate" | "avgRate" | "distinctRateCount"> {
  const unique = [...new Set([...distinctPrices].map(normalizeLinePrice))];
  const distinctRateCount = unique.length;
  if (testCount <= 0 || distinctRateCount === 0) {
    return { rateKind: "none", unitRate: null, avgRate: null, distinctRateCount: 0 };
  }
  const avgRate = roundMoney(grossBilling / testCount);
  if (distinctRateCount === 1) {
    return { rateKind: "single", unitRate: unique[0]!, avgRate, distinctRateCount };
  }
  return { rateKind: "multiple", unitRate: null, avgRate, distinctRateCount };
}

async function fetchBilledDiagnosticLines(from: string, to: string) {
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
  const lines = await fetchBilledDiagnosticLines(from, to);

  const testCounts = emptyDiagnosticServiceCounts();
  const billSets: Record<DiagnosticServiceKey, Set<number>> = {
    MRI: new Set(),
    USG: new Set(),
    CT: new Set(),
    "X-Ray": new Set(),
    OPG: new Set(),
    Pathology: new Set(),
  };
  const grossBilling: Record<DiagnosticServiceKey, number> = {
    MRI: 0,
    USG: 0,
    CT: 0,
    "X-Ray": 0,
    OPG: 0,
    Pathology: 0,
  };
  const priceSets: Record<DiagnosticServiceKey, Set<number>> = {
    MRI: new Set(),
    USG: new Set(),
    CT: new Set(),
    "X-Ray": new Set(),
    OPG: new Set(),
    Pathology: new Set(),
  };

  for (const row of lines) {
    const bucket = classifyDiagnosticService({
      department: row.department,
      category: row.category,
      testName: row.testName,
    });
    if (!bucket) continue;
    const price = normalizeLinePrice(row.linePrice);
    testCounts[bucket] += 1;
    billSets[bucket].add(row.billId);
    grossBilling[bucket] += price;
    priceSets[bucket].add(price);
  }

  // Prefer primary report modalities first; append OPG / Pathology when active.
  const keys: DiagnosticServiceKey[] = [...MODALITY_REPORT_KEYS];
  if (testCounts.OPG > 0) keys.push("OPG");
  if (testCounts.Pathology > 0) keys.push("Pathology");

  const modalities: ModalityBillingRow[] = keys.map((key) => {
    const testCount = testCounts[key];
    const amount = roundMoney(grossBilling[key]);
    const rates = deriveRateMeta(testCount, amount, priceSets[key]);
    return {
      key,
      label: MODALITY_DISPLAY_LABEL[key],
      testCount,
      billCount: billSets[key].size,
      grossBilling: amount,
      ...rates,
    };
  });

  const allBillIds = new Set<number>();
  for (const key of keys) {
    for (const id of billSets[key]) allBillIds.add(id);
  }

  return {
    from,
    to,
    modalities,
    totals: {
      testCount: modalities.reduce((s, m) => s + m.testCount, 0),
      billCount: allBillIds.size,
      grossBilling: roundMoney(modalities.reduce((s, m) => s + m.grossBilling, 0)),
    },
  };
}

export async function listModalityBills(
  from: string,
  to: string,
  modality: DiagnosticServiceKey,
): Promise<{
  modality: DiagnosticServiceKey;
  label: string;
  from: string;
  to: string;
  columns: string[];
  rows: (string | number | null)[][];
  bills: ModalityBillLine[];
}> {
  const lines = await fetchBilledDiagnosticLines(from, to);
  const byBill = new Map<
    number,
    {
      bill: ModalityBillLine;
      testNames: string[];
      modalityAmount: number;
    }
  >();

  for (const row of lines) {
    const bucket = classifyDiagnosticService({
      department: row.department,
      category: row.category,
      testName: row.testName,
    });
    if (bucket !== modality) continue;

    const existing = byBill.get(row.billId);
    const testLabel = row.testName;
    const price = normalizeLinePrice(row.linePrice);
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
    modalityAmount: roundMoney(modalityAmount),
  }));

  const amountCol = modality === "Pathology" ? "Pathology Amount" : "Modality Amount";
  const columns = [
    "Bill #",
    "Patient",
    "Referring Doctor",
    "Tests",
    amountCol,
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
