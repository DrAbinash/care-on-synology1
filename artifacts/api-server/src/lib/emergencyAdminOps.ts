/**
 * Shared validation for CARE → DS225+ admin recovery actions
 * (void pending emergency bill / close open emergency session).
 * Bills are VOID'd, never hard-deleted — history stays on the NAS.
 */

export const MIN_EMERGENCY_VOID_REASON_LEN = 3;

export function normalizeEmergencyVoidReason(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const reason = raw.trim();
  if (reason.length < MIN_EMERGENCY_VOID_REASON_LEN) return null;
  return reason;
}

export function normalizeEmergencyActorName(raw: unknown, fallback = "CARE admin"): string {
  if (typeof raw !== "string") return fallback;
  const name = raw.trim();
  return name || fallback;
}
