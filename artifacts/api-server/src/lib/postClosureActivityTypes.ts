/** Shared between day-close routes and staff day-close email builder. */
export type StaffPrintActivity = {
  discountsGiven: number;
  discountBills: Array<{
    billId: number;
    billNumber: string;
    patientName: string;
    totalAmount: number;
    discountGiven: number;
    grossAmount: number;
    discountReason: string | null;
    discountReasonNote: string | null;
  }>;
  billEdits: Array<{
    id: number;
    billId: number;
    billNumber: string;
    changeType: string;
    reason: string;
    oldValue: string | null;
    newValue: string | null;
    createdAt: string;
  }>;
  voucherEdits: Array<{
    id: number;
    voucherId: number;
    voucherNumber: string;
    changeType: string;
    reason: string;
    oldValue: string | null;
    newValue: string | null;
    createdAt: string;
  }>;
  expenseDetails: Array<{
    id: number;
    amount: number;
    category: string;
    description: string;
    paymentMode: string;
  }>;
  totalExpenses: number;
  cashExpenses: number;
  digitalExpenses: number;
};
