/**
 * CARE Reporting Studio — outgoing worklist payload contract + sentinel detector.
 *
 * Failures are LOUD: callers validate every row, log structured errors, and
 * surface counters in response meta / bridge_sync_log. Rows are never silently
 * dropped from the payload.
 */
import { z } from "zod";

/** Billing vocabulary the studios already consume. */
export const studioBillingStatusSchema = z
  .enum(["PAID", "DUE", "UPI_PENDING"])
  .nullable();

/**
 * Exact row contract GET /worklist emits (plus additive optional demographics
 * studios may ignore). Required keys match the studio patient header / Form F
 * bridge.
 */
export const studioWorklistRowSchema = z.object({
  worklistId: z.string().min(1),
  accessionNumber: z.string(),
  patientName: z.string().min(1),
  patientAge: z.string(),
  patientGender: z.string(),
  referringDoctor: z.string(),
  testName: z.string(),
  modality: z.string().min(1),
  studyDate: z.string().min(1),
  studyInstanceUid: z.string().nullable(),
  billingStatus: studioBillingStatusSchema,
  status: z.string().min(1),
  // Additive USG Studio v6 bridge fields — optional for older studios.
  patientId: z.number().nullable().optional(),
  patientPhone: z.string().optional(),
  patientAddress: z.string().optional(),
  billNumber: z.string().optional(),
});

export type StudioWorklistRow = z.infer<typeof studioWorklistRowSchema>;

export type ContractValidationIssue = {
  worklistId: string;
  field: string;
  message: string;
};

/** Validate one outgoing row. Returns issues (empty = pass). Does not throw. */
export function validateStudioWorklistRow(
  row: unknown,
): { ok: true; data: StudioWorklistRow } | { ok: false; issues: ContractValidationIssue[] } {
  const parsed = studioWorklistRowSchema.safeParse(row);
  if (parsed.success) return { ok: true, data: parsed.data };

  const worklistId =
    row && typeof row === "object" && "worklistId" in row
      ? String((row as { worklistId?: unknown }).worklistId ?? "")
      : "";

  const issues: ContractValidationIssue[] = parsed.error.issues.map((issue) => ({
    worklistId,
    field: issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)",
    message: issue.message,
  }));
  return { ok: false, issues };
}

export type SentinelFlags = {
  ageSuspicious: boolean;
  placeholderDob: boolean;
  blankAccession: boolean;
  blankReferringDoctor: boolean;
};

export type SentinelInput = {
  patientAge: string;
  /** Raw MWL/machine age before Highway Rule — catches "126" even when ageFor cleared it. */
  sourceAge?: string | null;
  patientDob?: string | null;
  accessionNumber: string;
  /** Referring doctor AFTER the fallback chain (may be "Self/Walk-in"). */
  referringDoctor: string;
  /** True when both worklist + study referrers were blank before Self/Walk-in. */
  referringDoctorWasBlank?: boolean;
};

export type SentinelCounters = {
  ageSuspicious: number;
  placeholderDob: number;
  blankAccession: number;
  blankReferringDoctor: number;
};

function ageLooksSuspicious(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (trimmed === "126") return true;
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) && parsed > 110;
}

/** Jan-01 DOBs are classic MWL/machine placeholders (e.g. 1900-01-01). */
export function isPlaceholderDob(dob: string | null | undefined): boolean {
  const s = (dob ?? "").trim();
  if (!s) return false;
  // YYYY-MM-DD… or YYYYMMDD
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[2] === "01" && iso[3] === "01";
  const compact = s.replace(/[^0-9]/g, "");
  if (compact.length >= 8) {
    return compact.slice(4, 6) === "01" && compact.slice(6, 8) === "01";
  }
  return false;
}

/**
 * Pure sentinel detector — counters only, never blocks the row.
 */
export function detectSentinels(row: SentinelInput): SentinelFlags {
  const ageSuspicious =
    ageLooksSuspicious(row.patientAge) || ageLooksSuspicious(String(row.sourceAge ?? ""));
  const blankReferring =
    Boolean(row.referringDoctorWasBlank) || !(row.referringDoctor ?? "").trim();

  return {
    ageSuspicious,
    placeholderDob: isPlaceholderDob(row.patientDob),
    blankAccession: !(row.accessionNumber ?? "").trim(),
    blankReferringDoctor: blankReferring,
  };
}

export function emptySentinelCounters(): SentinelCounters {
  return {
    ageSuspicious: 0,
    placeholderDob: 0,
    blankAccession: 0,
    blankReferringDoctor: 0,
  };
}

export function accumulateSentinels(
  counters: SentinelCounters,
  flags: SentinelFlags,
): SentinelCounters {
  return {
    ageSuspicious: counters.ageSuspicious + (flags.ageSuspicious ? 1 : 0),
    placeholderDob: counters.placeholderDob + (flags.placeholderDob ? 1 : 0),
    blankAccession: counters.blankAccession + (flags.blankAccession ? 1 : 0),
    blankReferringDoctor: counters.blankReferringDoctor + (flags.blankReferringDoctor ? 1 : 0),
  };
}

export type WorklistAuditMeta = {
  syncedAt: string;
  rowsServed: number;
  rowsByModality: Record<string, number>;
  validationFailures: number;
  sentinels: SentinelCounters;
  sourceId: string;
};

export function buildRowsByModality(rows: Array<{ modality?: string | null }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const key = (r.modality ?? "").trim() || "UNKNOWN";
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}
