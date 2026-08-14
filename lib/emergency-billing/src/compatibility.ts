/**
 * Contract compatibility for CARE ↔ 225app.
 *
 * This is not a second versioning scheme. Compatibility is exactly whether
 * 225app advertises the same format identifiers that `parseMasterSnapshot`,
 * `parseEmergencyCsv`, and `parseEmergencyJson` already accept:
 *   CARE_EMERGENCY_MASTER_V1
 *   CARE_EMERGENCY_BILLING_V1
 *   CARE_EMERGENCY_BILLING_JSON_V1
 */
import { CSV_FORMAT, JSON_FORMAT, MASTER_FORMAT } from "./types";
import { UnsupportedContractError } from "./master";

export const CARE_EXPECTED_MASTER_CONTRACT = MASTER_FORMAT;
export const SUPPORTED_MASTER_CONTRACT_VERSIONS = [MASTER_FORMAT] as const;
export const SUPPORTED_BILLING_CSV_VERSIONS = [CSV_FORMAT] as const;
export const SUPPORTED_BILLING_JSON_VERSIONS = [JSON_FORMAT] as const;

export const CONTRACT_COMPAT_STATUSES = ["COMPATIBLE", "MISMATCH", "UNAVAILABLE"] as const;
export type ContractCompatStatus = (typeof CONTRACT_COMPAT_STATUSES)[number];

export interface EmergencyCapability {
  status: string;
  appVersion: string | null;
  buildSha: string | null;
  supportedMasterContractVersions: string[];
  supportedBillingCsvVersions: string[];
  supportedBillingJsonVersions: string[];
  databaseHealthy: boolean;
  masterSnapshotPresent: boolean;
  masterSnapshotCreatedAt: string | null;
}

export interface MasterContractComparison {
  status: ContractCompatStatus;
  careExpected: string;
  remoteSupported: string[];
  remotePrimary: string | null;
}

function asStringList(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return v.map((x) => String(x)).filter((s) => s.length > 0);
}

/**
 * Build the 225app capability advertisement. Versions always come from the
 * same constants `parseMasterSnapshot` uses — never a parallel list.
 */
export function advertisedEmergencyCapability(
  over: Partial<EmergencyCapability> = {},
): EmergencyCapability {
  return {
    status: over.status ?? (over.databaseHealthy === false ? "degraded" : "ok"),
    appVersion: over.appVersion ?? null,
    buildSha: over.buildSha ?? null,
    supportedMasterContractVersions: over.supportedMasterContractVersions
      ?? [...SUPPORTED_MASTER_CONTRACT_VERSIONS],
    supportedBillingCsvVersions: over.supportedBillingCsvVersions
      ?? [...SUPPORTED_BILLING_CSV_VERSIONS],
    supportedBillingJsonVersions: over.supportedBillingJsonVersions
      ?? [...SUPPORTED_BILLING_JSON_VERSIONS],
    databaseHealthy: over.databaseHealthy ?? true,
    masterSnapshotPresent: over.masterSnapshotPresent ?? false,
    masterSnapshotCreatedAt: over.masterSnapshotCreatedAt ?? null,
  };
}

/**
 * Parse a 225app capability/health JSON body. Missing
 * `supportedMasterContractVersions` means the endpoint is too old to ask —
 * treat as unavailable rather than inventing support.
 */
export function parseEmergencyCapability(raw: unknown): EmergencyCapability | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const supported = asStringList(obj.supportedMasterContractVersions);
  if (supported == null) return null;
  return advertisedEmergencyCapability({
    status: typeof obj.status === "string" ? obj.status : "ok",
    appVersion: typeof obj.appVersion === "string" ? obj.appVersion : null,
    buildSha: typeof obj.buildSha === "string" ? obj.buildSha : null,
    supportedMasterContractVersions: supported,
    supportedBillingCsvVersions: asStringList(obj.supportedBillingCsvVersions) ?? [...SUPPORTED_BILLING_CSV_VERSIONS],
    supportedBillingJsonVersions: asStringList(obj.supportedBillingJsonVersions) ?? [...SUPPORTED_BILLING_JSON_VERSIONS],
    databaseHealthy: obj.databaseHealthy === true,
    masterSnapshotPresent: obj.masterSnapshotPresent === true,
    masterSnapshotCreatedAt: typeof obj.masterSnapshotCreatedAt === "string" ? obj.masterSnapshotCreatedAt : null,
  });
}

/**
 * Same rule as `parseMasterSnapshot`: the remote must name `MASTER_FORMAT`.
 * `null` remoteSupported = capability not available (legacy 225app).
 */
export function compareMasterContract(opts: {
  careExpected?: string;
  remoteSupported: readonly string[] | null | undefined;
}): MasterContractComparison {
  const careExpected = opts.careExpected ?? MASTER_FORMAT;
  if (opts.remoteSupported == null) {
    return { status: "UNAVAILABLE", careExpected, remoteSupported: [], remotePrimary: null };
  }
  const remoteSupported = [...opts.remoteSupported].filter((s) => typeof s === "string" && s.length > 0);
  if (remoteSupported.includes(careExpected)) {
    return {
      status: "COMPATIBLE",
      careExpected,
      remoteSupported,
      remotePrimary: careExpected,
    };
  }
  return {
    status: "MISMATCH",
    careExpected,
    remoteSupported,
    remotePrimary: remoteSupported[0] ?? null,
  };
}

export function masterPushBlockedReason(remoteSupported: readonly string[] | null | undefined): string | null {
  const cmp = compareMasterContract({ remoteSupported });
  if (cmp.status !== "MISMATCH") return null;
  return (
    `VERSION MISMATCH. CARE expects: ${cmp.careExpected}. ` +
    `225app supports: ${cmp.remoteSupported.join(", ") || "(none)"}.`
  );
}

export function assertRemoteSupportsMasterContract(supported: readonly string[]): void {
  const reason = masterPushBlockedReason(supported);
  if (reason) throw new UnsupportedContractError(reason);
}
