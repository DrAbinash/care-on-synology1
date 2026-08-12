/**
 * Bill Desk online (BILLPAY-*) collection attribution.
 *
 * Desk gateway payments must credit the staff member who initiated them at
 * Billing Desk — not Super Admin. Website online booking keeps its own
 * Super Admin / "Online" attribution and does not use this helper.
 *
 * The initiator is persisted on payment_logs.requestPayload.initiatedByName
 * at initiate time (the only staff-authenticated moment before settle).
 *
 * Pure helpers live here (no DB import) so unit tests do not require DATABASE_URL.
 * DB lookup is in resolveBillDeskCollectorFromDb.ts.
 */

export const BILL_DESK_COLLECTOR_FALLBACK = "Billing Desk";

export function parseInitiatedByName(
  requestPayload: string | null | undefined,
): string | null {
  if (!requestPayload) return null;
  try {
    const payload = JSON.parse(requestPayload) as { initiatedByName?: unknown };
    const name =
      typeof payload.initiatedByName === "string"
        ? payload.initiatedByName.trim()
        : "";
    return name || null;
  } catch {
    return null;
  }
}

/**
 * Resolve who should be credited for a Bill Desk online collection.
 * Prefer the stored initiator, then the current staff session, then the bill
 * creator (desk bills), never Super Admin / Online Booking actors.
 */
export function resolveBillDeskCollector(opts: {
  requestPayload?: string | null;
  sessionName?: string | null;
  billCreatedByName?: string | null;
  fallback?: string;
}): string {
  const fromLog = parseInitiatedByName(opts.requestPayload);
  if (fromLog) return fromLog;

  const session = opts.sessionName?.trim();
  if (session) return session;

  const billCreator = opts.billCreatedByName?.trim();
  if (
    billCreator &&
    !billCreator.startsWith("Online Booking") &&
    billCreator !== "Super Admin" &&
    billCreator !== "Online" &&
    billCreator !== "Kiosk"
  ) {
    return billCreator;
  }

  return (opts.fallback?.trim() || BILL_DESK_COLLECTOR_FALLBACK);
}
