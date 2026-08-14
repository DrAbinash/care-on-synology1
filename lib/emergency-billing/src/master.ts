/**
 * Versioned CARE → DS225+ master-data interchange.
 * Keep in sync with CARE `lib/emergency-billing` (same file names / exports).
 */
import {
  MASTER_FORMAT,
  MASTER_VERSION,
  type MasterDataSnapshot,
  type MasterPushCounts,
} from "./types";

export class UnsupportedContractError extends Error {
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedContractError";
  }
}

export function stampMasterSnapshot(
  partial: Omit<MasterDataSnapshot, "format" | "version">,
): MasterDataSnapshot {
  return {
    format: MASTER_FORMAT,
    version: MASTER_VERSION,
    ...partial,
  };
}

export function countsFromSnapshot(snapshot: MasterDataSnapshot): MasterPushCounts {
  return {
    serviceCount: snapshot.services.length,
    doctorCount: snapshot.doctors.length,
    patientCount: snapshot.patients.length,
    staffCount: snapshot.staff.length,
  };
}

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function asNumber(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function asBool(v: unknown, fallback = true): boolean {
  if (typeof v === "boolean") return v;
  return fallback;
}

/**
 * Parse a master-data payload. Unknown/future formats and versions are rejected
 * explicitly — never interpreted as the current contract.
 */
export function parseMasterSnapshot(raw: unknown): MasterDataSnapshot {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new UnsupportedContractError("Master snapshot must be a JSON object");
  }
  const obj = raw as Record<string, unknown>;
  if (obj.format !== MASTER_FORMAT) {
    throw new UnsupportedContractError(
      `Unsupported master-data format ${String(obj.format)}. Expected ${MASTER_FORMAT}.`,
    );
  }
  if (obj.version !== MASTER_VERSION) {
    throw new UnsupportedContractError(
      `Unsupported master-data version ${String(obj.version)}. Expected ${MASTER_VERSION}.`,
    );
  }
  if (!Array.isArray(obj.services)) {
    throw new UnsupportedContractError("Master snapshot is missing services[]");
  }
  if (!Array.isArray(obj.doctors)) {
    throw new UnsupportedContractError("Master snapshot is missing doctors[]");
  }
  if (!Array.isArray(obj.patients)) {
    throw new UnsupportedContractError("Master snapshot is missing patients[]");
  }
  if (!Array.isArray(obj.staff)) {
    throw new UnsupportedContractError("Master snapshot is missing staff[]");
  }
  const syncedAt = asString(obj.syncedAt);
  if (!syncedAt) {
    throw new UnsupportedContractError("Master snapshot is missing syncedAt");
  }

  return {
    format: MASTER_FORMAT,
    version: MASTER_VERSION,
    syncedAt,
    services: obj.services.map((row) => {
      const s = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
      return {
        id: asNumber(s.id),
        code: asString(s.code),
        name: asString(s.name),
        category: asString(s.category),
        price: asNumber(s.price),
        isActive: asBool(s.isActive, true),
      };
    }),
    doctors: obj.doctors.map((row) => {
      const d = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
      return {
        id: asNumber(d.id),
        name: asString(d.name),
        specialization: asString(d.specialization),
      };
    }),
    patients: obj.patients.map((row) => {
      const p = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
      return {
        id: asNumber(p.id),
        patientId: asString(p.patientId),
        firstName: asString(p.firstName),
        lastName: asString(p.lastName),
        phone: asString(p.phone),
        gender: asString(p.gender),
        dateOfBirth: typeof p.dateOfBirth === "string" ? p.dateOfBirth : null,
        ageValue: p.ageValue == null || p.ageValue === "" ? null : asNumber(p.ageValue),
        ageUnit: typeof p.ageUnit === "string" ? p.ageUnit : null,
      };
    }),
    staff: obj.staff.map((row) => {
      const u = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
      return {
        id: asNumber(u.id),
        name: asString(u.name),
        username: asString(u.username),
        role: asString(u.role),
        pinHash: asString(u.pinHash),
        maxDiscount: asNumber(u.maxDiscount),
        permissions: typeof u.permissions === "string" ? u.permissions : null,
      };
    }),
    discountReasons: Array.isArray(obj.discountReasons)
      ? obj.discountReasons.map((r) => String(r)).filter(Boolean)
      : [],
  };
}
