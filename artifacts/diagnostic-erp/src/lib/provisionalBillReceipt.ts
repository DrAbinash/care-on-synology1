/**
 * Provisional (offline) bill receipts — printed when Billing Desk queues a bill
 * because the NAS/API is unreachable. The real bill number and QR verification
 * are issued only after sync completes.
 */

import type { PrintBillData, PrintClinic } from "./printBill";
import { buildBillPrintHtml } from "./printBill";
import type { BillPrintSettings } from "./billPrintSettings";
import { resolveBillPrintPageOpts, printLayoutOpts } from "./billPrintSettings";

export type ProvisionalBillPrintSnapshot = {
  clientRef: string;
  provisionalBillNumber: string;
  patient: {
    firstName: string;
    lastName: string;
    patientId: string;
    phone?: string | null;
    gender?: string | null;
    dateOfBirth?: string | null;
    ageValue?: number | null;
    ageUnit?: string | null;
  };
  doctorName: string | null;
  tests: Array<{ name: string; code: string; price: number; category: string }>;
  subtotal: number;
  discount: number;
  total: number;
  payments: Array<{ mode: string; amount: string | number }>;
};

/** Human-readable provisional bill number shown until server sync. */
export function formatProvisionalBillNumber(clientRef: string, at = new Date()): string {
  const short = clientRef.replace(/-/g, "").slice(0, 8).toUpperCase();
  const stamp = at.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" })
    .replace(/\s/g, "")
    .replace(/,/g, "");
  return `OFF-${stamp}-${short}`;
}

export function snapshotToPrintBillData(snapshot: ProvisionalBillPrintSnapshot): PrintBillData {
  const paid = snapshot.payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  return {
    billNumber: snapshot.provisionalBillNumber,
    subtotal: snapshot.subtotal,
    discount: snapshot.discount,
    totalAmount: snapshot.total,
    paidAmount: paid,
    balanceAmount: Math.max(0, snapshot.total - paid),
    createdAt: new Date().toISOString(),
    patient: {
      firstName: snapshot.patient.firstName,
      lastName: snapshot.patient.lastName,
      patientId: snapshot.patient.patientId,
      phone: snapshot.patient.phone ?? null,
      gender: snapshot.patient.gender ?? null,
      dateOfBirth: snapshot.patient.dateOfBirth ?? null,
      ageValue: snapshot.patient.ageValue ?? null,
      ageUnit: snapshot.patient.ageUnit ?? null,
    },
    order: {
      doctor: snapshot.doctorName ? { name: snapshot.doctorName } : null,
      tests: snapshot.tests.map((t) => ({
        price: t.price,
        status: "active",
        test: { name: t.name, code: t.code, category: t.category },
      })),
    },
    payments: snapshot.payments.map((p) => ({
      method: p.mode,
      amount: Number(p.amount || 0),
    })),
    tokenNo: null,
    testTokens: null,
  };
}

export function buildProvisionalBillPrintHtml(
  snapshot: ProvisionalBillPrintSnapshot,
  clinic: PrintClinic,
  settings: BillPrintSettings,
  isBW: boolean,
): string {
  const bill = snapshotToPrintBillData(snapshot);
  const pageOpts = resolveBillPrintPageOpts(settings, snapshot.tests.length);
  return buildBillPrintHtml({
    bill,
    clinic,
    paperSize: pageOpts.paperSize,
    orientation: pageOpts.orientation,
    pageCssSize: pageOpts.pageCssSize,
    compactFooterGap: pageOpts.compactFooterGap,
    isBW,
    qrDataUrl: "",
    format: settings.defaultFormat,
    showQr: false,
    provisionalReceipt: true,
    showAmountInWords: settings.showAmountInWords,
    showSignatureLine: settings.showSignatureLine,
    showComputerGenerated: settings.showComputerGenerated,
    showReportMessage: settings.showReportMessage,
    showServiceFooter: settings.showServiceFooter,
    showBrandingFooter: settings.showBrandingFooter,
    showBarcode: false,
    showWatermark: settings.showWatermark,
    showPatientInstructions: settings.showPatientInstructions,
    showSystemInfo: settings.showSystemInfo,
    showQueueToken: false,
    ...printLayoutOpts(settings),
  });
}
