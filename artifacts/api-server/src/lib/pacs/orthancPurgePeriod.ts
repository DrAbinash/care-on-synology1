/**
 * Pure StudyDate period helpers for Orthanc purge (no DB / Orthanc deps).
 */

export const PURGE_CONFIRM_PHRASE = "DELETE STUDIES";
export const PURGE_HARD_CAP = 2000;
export const PURGE_SAMPLE_LIMIT = 25;

export type PurgePreset =
  | "older_than_1_month"
  | "older_than_2_months"
  | "older_than_3_months"
  | "older_than_6_months"
  | "custom";

export type PurgePeriodInput = {
  preset?: PurgePreset;
  dateFrom?: string;
  dateTo?: string;
};

export type ResolvedPurgePeriod = {
  dateFrom: string | null;
  dateTo: string;
  label: string;
};

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCMonth(dt.getUTCMonth() + months);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function resolvePurgePeriod(input: PurgePeriodInput, today: string): ResolvedPurgePeriod {
  const preset = input.preset ?? "custom";
  if (preset !== "custom") {
    const months =
      preset === "older_than_1_month" ? 1
        : preset === "older_than_2_months" ? 2
          : preset === "older_than_3_months" ? 3
            : 6;
    const dateTo = addDaysIso(addMonthsIso(today, -months), -1);
    return {
      dateFrom: null,
      dateTo,
      label: `StudyDate on or before ${dateTo} (${preset.replace(/_/g, " ")})`,
    };
  }

  const dateFrom = (input.dateFrom || "").trim();
  const dateTo = (input.dateTo || "").trim();
  if (!dateFrom && !dateTo) {
    throw new Error("Provide a preset or custom dateFrom/dateTo");
  }
  if (dateFrom && !isIsoDate(dateFrom)) throw new Error("dateFrom must be YYYY-MM-DD");
  if (dateTo && !isIsoDate(dateTo)) throw new Error("dateTo must be YYYY-MM-DD");
  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new Error("dateFrom must be on or before dateTo");
  }
  const resolvedTo = dateTo || today;
  return {
    dateFrom: dateFrom || null,
    dateTo: resolvedTo,
    label: dateFrom
      ? `StudyDate ${dateFrom} → ${resolvedTo}`
      : `StudyDate on or before ${resolvedTo}`,
  };
}

export function toCompactStudyDate(iso: string): string {
  return iso.replace(/-/g, "");
}

export function buildStudyDateQuery(period: ResolvedPurgePeriod): string {
  if (period.dateFrom) return `${toCompactStudyDate(period.dateFrom)}-${toCompactStudyDate(period.dateTo)}`;
  return `-${toCompactStudyDate(period.dateTo)}`;
}
