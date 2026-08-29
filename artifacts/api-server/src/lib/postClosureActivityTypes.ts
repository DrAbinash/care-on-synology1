/** Shared between day-close routes and staff day-close email builder. */
export type StaffPrintActivity = {
  /** Payments in this window on bills created before the window (old dues). */
  dueReceived: number;
  /** Bills this staff cancelled in the window (any original bill date). */
  cancelledBillsAmount: number;
  /**
   * Refunds this staff recorded in the window, excluding auto-refunds on bills
   * they themselves cancelled (those are already in cancelledBillsAmount).
   */
  refundsAmount: number;
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
