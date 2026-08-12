import { db } from "@workspace/db";
import { paymentLogsTable } from "@workspace/db/schema";
import { asc, eq } from "drizzle-orm";
import {
  parseInitiatedByName,
  resolveBillDeskCollector,
} from "./resolveBillDeskCollector";

/** Load payment_logs for a BILLPAY txn and resolve the collector. */
export async function resolveBillDeskCollectorFromTxnRef(
  txnRef: string,
  opts?: {
    sessionName?: string | null;
    billCreatedByName?: string | null;
    fallback?: string;
  },
): Promise<string> {
  const logs = await db
    .select({ requestPayload: paymentLogsTable.requestPayload })
    .from(paymentLogsTable)
    .where(eq(paymentLogsTable.bookingRef, txnRef))
    .orderBy(asc(paymentLogsTable.createdAt))
    .limit(20);

  for (const log of logs) {
    const name = parseInitiatedByName(log.requestPayload);
    if (name) return name;
  }

  return resolveBillDeskCollector({
    requestPayload: logs[0]?.requestPayload,
    sessionName: opts?.sessionName,
    billCreatedByName: opts?.billCreatedByName,
    fallback: opts?.fallback,
  });
}
