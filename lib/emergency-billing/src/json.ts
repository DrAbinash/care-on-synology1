import { sha256Hex } from "./csv";
import { JSON_FORMAT, type EmergencyJsonPackage, type EmergencyTransaction, type EmergencySessionRecord } from "./types";
import { isValidEmgBillNumber, isValidUuid } from "./numbering";

export function buildEmergencyJsonPackage(opts: {
  sessions: EmergencySessionRecord[];
  transactions: EmergencyTransaction[];
  masterDataLastSyncedAt: string | null;
  exportedAt?: string;
}): EmergencyJsonPackage {
  const exportedAt = opts.exportedAt ?? new Date().toISOString();
  const unsigned = {
    format: JSON_FORMAT,
    version: 1 as const,
    exportedAt,
    masterDataLastSyncedAt: opts.masterDataLastSyncedAt,
    sessions: opts.sessions,
    transactions: opts.transactions,
  };
  const checksumSha256 = sha256Hex(JSON.stringify(unsigned));
  return { ...unsigned, checksumSha256 };
}

export function parseEmergencyJson(raw: string): { pkg: EmergencyJsonPackage | null; errors: string[] } {
  const errors: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { pkg: null, errors: ["Invalid JSON"] };
  }
  if (!parsed || typeof parsed !== "object") return { pkg: null, errors: ["JSON root must be an object"] };
  const obj = parsed as Record<string, unknown>;
  if (obj.format !== JSON_FORMAT) {
    return { pkg: null, errors: [`Unsupported format ${String(obj.format)}. Expected ${JSON_FORMAT}.`] };
  }
  if (obj.version != null && obj.version !== 1) {
    return { pkg: null, errors: [`Unsupported JSON contract version ${String(obj.version)}. Expected 1.`] };
  }
  const txns = Array.isArray(obj.transactions) ? obj.transactions : [];
  const sessions = Array.isArray(obj.sessions) ? (obj.sessions as EmergencySessionRecord[]) : [];
  const transactions: EmergencyTransaction[] = [];
  const seen = new Set<string>();
  for (const row of txns) {
    if (!row || typeof row !== "object") {
      errors.push("Malformed transaction row");
      continue;
    }
    const t = row as EmergencyTransaction;
    if (!isValidUuid(t.emergencyTransactionUuid)) {
      errors.push("Invalid emergency_transaction_uuid");
      continue;
    }
    if (seen.has(t.emergencyTransactionUuid)) {
      errors.push(`Duplicate UUID ${t.emergencyTransactionUuid} in file`);
      continue;
    }
    seen.add(t.emergencyTransactionUuid);
    if (!isValidEmgBillNumber(t.emergencyBillNumber)) {
      errors.push(`Invalid EMG number ${t.emergencyBillNumber}`);
      continue;
    }
    transactions.push(t);
  }
  const pkg = buildEmergencyJsonPackage({
    sessions,
    transactions,
    masterDataLastSyncedAt: typeof obj.masterDataLastSyncedAt === "string" ? obj.masterDataLastSyncedAt : null,
    exportedAt: typeof obj.exportedAt === "string" ? obj.exportedAt : new Date().toISOString(),
  });
  return { pkg, errors };
}

export function verifyJsonChecksum(pkg: EmergencyJsonPackage): boolean {
  const unsigned = {
    format: pkg.format,
    version: pkg.version,
    exportedAt: pkg.exportedAt,
    masterDataLastSyncedAt: pkg.masterDataLastSyncedAt,
    sessions: pkg.sessions,
    transactions: pkg.transactions,
  };
  return sha256Hex(JSON.stringify(unsigned)) === pkg.checksumSha256;
}
