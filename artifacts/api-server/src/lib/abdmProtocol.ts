/**
 * abdmProtocol.ts — pure ABDM/ABHA helpers: identifier validation/formatting and
 * request-payload builders. DB-free and side-effect-free so the format rules are
 * unit-tested exhaustively. The gateway client (abdmGateway.ts) and route
 * (routes/abdm.ts) do the I/O and call these.
 */

/** Strip formatting and keep digits only. */
export function abhaDigits(input: string | null | undefined): string {
  return (input ?? "").replace(/\D/g, "");
}

/** A valid ABHA number is exactly 14 digits. */
export function isValidAbhaNumber(input: string | null | undefined): boolean {
  return abhaDigits(input).length === 14;
}

/** Canonical ABHA number formatting: XX-XXXX-XXXX-XXXX. Returns null if invalid. */
export function formatAbhaNumber(input: string | null | undefined): string | null {
  const d = abhaDigits(input);
  if (d.length !== 14) return null;
  return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6, 10)}-${d.slice(10, 14)}`;
}

/**
 * A valid ABHA address (PHR address) is `handle@suffix`, where the handle is
 * 1–50 chars of letters/digits/dot/underscore and the suffix is a registrar
 * label (e.g. `sbx`, `abdm`). Case-insensitive; normalised to lower case.
 */
const ABHA_ADDRESS_RE = /^[a-z0-9](?:[a-z0-9._]{0,48}[a-z0-9])?@[a-z][a-z0-9]{1,19}$/i;
export function isValidAbhaAddress(input: string | null | undefined): boolean {
  return typeof input === "string" && ABHA_ADDRESS_RE.test(input.trim());
}
export function normalizeAbhaAddress(input: string | null | undefined): string | null {
  const s = (input ?? "").trim().toLowerCase();
  return isValidAbhaAddress(s) ? s : null;
}

/** Derive a 4-digit year of birth from a full ABHA/date string, else null. */
export function yearOfBirthFrom(dob: string | null | undefined): number | null {
  const m = (dob ?? "").match(/(\d{4})/);
  if (!m) return null;
  const y = Number(m[1]);
  return y >= 1900 && y <= 2100 ? y : null;
}

export interface CareContextInput {
  careContextRef: string; // stable CARE reference, e.g. order:ORD-2026-0001
  display: string;        // human label shown to the patient
  hiType?: string;        // DiagnosticReport | Prescription | ...
}

/**
 * Build the care-context link payload sent to the gateway to make CARE records
 * discoverable in the patient's PHR app. `requestId` and `timestamp` are passed
 * in (not generated here) to keep this deterministic and testable.
 */
export function buildLinkCareContextRequest(params: {
  requestId: string;
  timestamp: string;
  abhaAddress: string;
  patientReferenceId: string;   // CARE patient id as a string
  patientDisplay: string;
  careContexts: CareContextInput[];
}): Record<string, unknown> {
  return {
    requestId: params.requestId,
    timestamp: params.timestamp,
    link: {
      accessToken: null, // filled by the gateway flow when required
      patient: {
        referenceNumber: params.patientReferenceId,
        display: params.patientDisplay,
        careContexts: params.careContexts.map((c) => ({
          referenceNumber: c.careContextRef,
          display: c.display,
          hiType: c.hiType ?? "DiagnosticReport",
        })),
      },
    },
  };
}

export interface ConsentArtefactLike {
  status?: string | null;
  expiry?: string | Date | null;
  hiTypes?: string | null;
  permissionFrom?: string | Date | null;
  permissionTo?: string | Date | null;
}

/**
 * Decide whether a consent artefact currently authorises sharing a record of
 * `hiType` dated `recordDate`. Pure: the caller supplies "now".
 */
export function consentPermits(
  consent: ConsentArtefactLike,
  hiType: string,
  recordDate: Date,
  now: Date,
): boolean {
  if ((consent.status ?? "").toUpperCase() !== "GRANTED") return false;
  if (consent.expiry != null && new Date(consent.expiry) <= now) return false;
  if (consent.hiTypes) {
    const allowed = consent.hiTypes.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (allowed.length && !allowed.includes(hiType.toLowerCase())) return false;
  }
  if (consent.permissionFrom != null && recordDate < new Date(consent.permissionFrom)) return false;
  if (consent.permissionTo != null && recordDate > new Date(consent.permissionTo)) return false;
  return true;
}
