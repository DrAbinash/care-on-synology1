import type { PatientMatchClass } from "./types";

export function normalizePhone(raw: string | null | undefined): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits;
}

export function normalizeName(raw: string | null | undefined): string {
  return String(raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export interface MatchCandidate {
  carePatientId: number;
  uhid: string;
  firstName: string;
  lastName: string;
  phone: string;
  sex: string | null;
}

export interface MatchInput {
  carePatientId: number | null;
  uhid: string | null;
  firstName: string;
  lastName: string;
  mobile: string;
  sex: string | null;
}

export interface MatchDecision {
  matchClass: PatientMatchClass;
  reason: string;
  carePatientId: number | null;
  candidates: MatchCandidate[];
}

/**
 * Conservative matching for emergency → CARE import.
 * Never silently merge uncertain patients (name-only never matches).
 */
export function classifyPatientMatch(input: MatchInput, candidates: MatchCandidate[]): MatchDecision {
  if (input.carePatientId) {
    const hit = candidates.find((c) => c.carePatientId === input.carePatientId);
    if (hit) {
      const phoneOk = !normalizePhone(input.mobile) || normalizePhone(input.mobile) === normalizePhone(hit.phone);
      const nameOk = normalizeName(`${input.firstName} ${input.lastName}`) === normalizeName(`${hit.firstName} ${hit.lastName}`);
      if (!phoneOk && !nameOk) {
        return {
          matchClass: "CONFLICT",
          reason: "Cached CARE patient id disagrees with both name and phone",
          carePatientId: hit.carePatientId,
          candidates: [hit],
        };
      }
      return {
        matchClass: "EXACT_MATCH",
        reason: "CARE patient id / UHID",
        carePatientId: hit.carePatientId,
        candidates: [hit],
      };
    }
  }

  if (input.uhid) {
    const byUhid = candidates.filter((c) => c.uhid === input.uhid);
    if (byUhid.length === 1) {
      return {
        matchClass: "EXACT_MATCH",
        reason: "UHID exact",
        carePatientId: byUhid[0]!.carePatientId,
        candidates: byUhid,
      };
    }
    if (byUhid.length > 1) {
      return {
        matchClass: "CONFLICT",
        reason: "Multiple CARE patients share this UHID",
        carePatientId: null,
        candidates: byUhid,
      };
    }
  }

  const phone = normalizePhone(input.mobile);
  if (phone) {
    const byPhone = candidates.filter((c) => normalizePhone(c.phone) === phone);
    if (byPhone.length === 1) {
      const c = byPhone[0]!;
      const inName = normalizeName(`${input.firstName} ${input.lastName}`);
      const cName = normalizeName(`${c.firstName} ${c.lastName}`);
      if (inName && cName && inName === cName) {
        return {
          matchClass: "EXACT_MATCH",
          reason: "Phone + name exact",
          carePatientId: c.carePatientId,
          candidates: byPhone,
        };
      }
      return {
        matchClass: "PROBABLE_MATCH",
        reason: "Same phone, different or incomplete name — review required",
        carePatientId: c.carePatientId,
        candidates: byPhone,
      };
    }
    if (byPhone.length > 1) {
      return {
        matchClass: "CONFLICT",
        reason: "Multiple CARE patients share this phone",
        carePatientId: null,
        candidates: byPhone,
      };
    }
  }

  return {
    matchClass: "NEW_PATIENT",
    reason: "No CARE patient matched",
    carePatientId: null,
    candidates: [],
  };
}

export function isSafeToAutoImport(matchClass: PatientMatchClass, alreadyImported: boolean, blocked: boolean): boolean {
  if (alreadyImported || blocked) return false;
  return matchClass === "EXACT_MATCH" || matchClass === "NEW_PATIENT";
}
