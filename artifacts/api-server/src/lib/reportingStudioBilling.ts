/**
 * Maps ERP bill / payment-link state into the CARE Reporting Studio billing
 * vocabulary: PAID | DUE | UPI_PENDING | null.
 */
export type StudioBillingStatus = "PAID" | "DUE" | "UPI_PENDING" | null;

const OPEN_UPI_LINK_STATUSES = new Set(["created", "sent"]);

export function mapBillToStudioStatus(
  billStatus: string | null | undefined,
  hasOpenUpiLink = false,
): StudioBillingStatus {
  if (!billStatus || billStatus === "cancelled") return null;
  if (billStatus === "paid") return "PAID";
  if (hasOpenUpiLink) return "UPI_PENDING";
  if (billStatus === "pending" || billStatus === "partial") return "DUE";
  return "DUE";
}

export function isOpenUpiLinkStatus(status: string | null | undefined): boolean {
  return OPEN_UPI_LINK_STATUSES.has(String(status ?? "").toLowerCase());
}
