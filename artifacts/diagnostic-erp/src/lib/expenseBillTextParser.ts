import { parseInvoiceText } from "./invoiceTextParser";
import { mapExpenseCategory, mapExpensePaymentMode } from "./expenseScanMapping";

export interface ParsedExpenseBill {
  vendor: string;
  date: string;
  amount: number;
  gstAmount: number;
  category: string;
  description: string;
  paymentMode: string;
  confidence: "low";
  confidencePercent: number;
  ocrProvider: "tesseract";
}

export function parseExpenseBillText(raw: string): ParsedExpenseBill {
  const inv = parseInvoiceText(raw);
  const amount = inv.totalAmount || inv.subtotal || 0;
  return {
    vendor: inv.vendor,
    date: inv.date,
    amount,
    gstAmount: inv.gstAmount,
    category: mapExpenseCategory("Miscellaneous"),
    description: inv.vendor ? `Bill from ${inv.vendor}` : "",
    paymentMode: mapExpensePaymentMode("cash"),
    confidence: "low",
    confidencePercent: amount > 0 || inv.vendor ? 70 : 0,
    ocrProvider: "tesseract",
  };
}
