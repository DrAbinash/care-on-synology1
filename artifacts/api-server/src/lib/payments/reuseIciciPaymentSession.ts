import { db, paymentLogsTable } from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { assembleIciciRedirectUrl } from "./initiateIciciOrangePayment";

/**
 * True when the gateway rejected a second initiate for the same merchant txn
 * (common when staff click Share Link again). ICICI often returns P1006 / R1006
 * or a "duplicate" / "already" description — the first session is still usable.
 */
export function isDuplicateOrReuseableInitiateError(message: string | null | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    /\bp?1006\b/i.test(message) ||
    /\br?1006\b/i.test(message) ||
    m.includes("duplicate") ||
    m.includes("already exist") ||
    m.includes("already exists") ||
    m.includes("already paid") ||
    m.includes("already in process") ||
    m.includes("txn already")
  );
}

/** Pull a live HPP redirect URL out of an existing payment_logs row, if any. */
export function redirectUrlFromPaymentLog(row: {
  status: string | null;
  requestPayload: string | null;
  responsePayload: string | null;
}): string | null {
  if (row.status === "success" || row.status === "failed" || row.status === "expired") {
    return null;
  }
  try {
    const req = JSON.parse(row.requestPayload || "{}") as {
      redirectUrl?: string;
      expiryTime?: string;
    };
    if (req.expiryTime && new Date(req.expiryTime) < new Date()) return null;
    if (typeof req.redirectUrl === "string" && /^https?:\/\//i.test(req.redirectUrl)) {
      return req.redirectUrl;
    }
  } catch { /* ignore */ }
  try {
    const resp = JSON.parse(row.responsePayload || "{}") as {
      redirectURI?: string;
      tranCtx?: string;
      redirectUrl?: string;
    };
    if (typeof resp.redirectUrl === "string" && /^https?:\/\//i.test(resp.redirectUrl)) {
      return resp.redirectUrl;
    }
    if (resp.redirectURI && resp.tranCtx) {
      return assembleIciciRedirectUrl(resp.redirectURI, resp.tranCtx);
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Find the newest reusable ICICI/HDFC payment session for this booking ref
 * (Share Link clicked again must not re-initiateSale with the same merchantTxnNo).
 */
export async function findReusableIciciPaymentSession(bookingRef: string): Promise<{
  redirectUrl: string;
  logId: number;
} | null> {
  const rows = await db
    .select({
      id: paymentLogsTable.id,
      status: paymentLogsTable.status,
      requestPayload: paymentLogsTable.requestPayload,
      responsePayload: paymentLogsTable.responsePayload,
    })
    .from(paymentLogsTable)
    .where(
      and(
        eq(paymentLogsTable.bookingRef, bookingRef),
        inArray(paymentLogsTable.status, ["initiated", "pending", "verifying"]),
      ),
    )
    .orderBy(desc(paymentLogsTable.createdAt))
    .limit(5);

  for (const row of rows) {
    const redirectUrl = redirectUrlFromPaymentLog(row);
    if (redirectUrl) return { redirectUrl, logId: row.id };
  }
  return null;
}
