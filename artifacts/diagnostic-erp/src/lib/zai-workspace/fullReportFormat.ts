/**
 * Full Report Format helpers — one-click ready-to-print presets.
 *
 * Reuses the existing ReportFormat library. Pure functions only:
 * printed heading, protocol ranking, overwrite gating, clinical-only payload.
 * Demographics are never stored or applied from a format.
 */

import type { ReportFormat } from "./types";

export type FormatLookupExtras = {
  protocolName?: string | null;
  studyDescription?: string | null;
};

export type ClinicalFormatPayload = {
  clinicalHistory: string;
  technique: string;
  findings: string;
  impression: string;
  recommendation: string;
  reportTitle: string;
};

const DEMOGRAPHY_KEYS = [
  "patientName",
  "patientId",
  "uhid",
  "age",
  "sex",
  "gender",
  "dateOfBirth",
  "accessionNumber",
  "referringDoctor",
  "studyDate",
  "crn",
] as const;

/** Printed test heading: explicit format.reportTitle wins; else existing fallback. */
export function resolvePrintedReportTitle(
  formatReportTitle: string | null | undefined,
  fallback: string,
): string {
  const title = (formatReportTitle ?? "").trim();
  return title || fallback;
}

export function editorHasMeaningfulReportText(fields: {
  technique: string;
  findings: string;
  impression: string;
  recommendation: string;
}): boolean {
  return Boolean(
    fields.technique.trim()
    || fields.findings.trim()
    || fields.impression.trim()
    || fields.recommendation.trim(),
  );
}

/** True when applying would replace radiologist-typed report body (not worklist Hx). */
export function shouldConfirmFormatOverwrite(fields: {
  technique: string;
  findings: string;
  impression: string;
  recommendation: string;
}): boolean {
  return editorHasMeaningfulReportText(fields);
}

export function clinicalFieldsFromFormat(format: ReportFormat): ClinicalFormatPayload {
  return {
    clinicalHistory: format.clinicalHistory ?? "",
    technique: format.technique ?? "",
    findings: format.findings ?? "",
    impression: format.impression ?? "",
    recommendation: format.recommendation ?? "",
    reportTitle: (format.reportTitle ?? "").trim(),
  };
}

/** Payload saved to the format library — clinical sections only. */
export function clinicalSavePayload(input: {
  name: string;
  modality: ReportFormat["modality"];
  bodyPart: string;
  diagnosisTags: string[];
  clinicalHistory: string;
  technique: string;
  findings: string;
  impression: string;
  recommendation: string;
  reportTitle?: string;
  protocolScope?: string;
  isCommon?: boolean;
  custom?: boolean;
}): Omit<ReportFormat, "id" | "createdAt" | "updatedAt"> {
  return {
    name: input.name,
    modality: input.modality,
    bodyPart: input.bodyPart,
    diagnosisTags: input.diagnosisTags,
    clinicalHistory: input.clinicalHistory,
    technique: input.technique,
    findings: input.findings,
    impression: input.impression,
    recommendation: input.recommendation,
    reportTitle: (input.reportTitle ?? "").trim(),
    protocolScope: (input.protocolScope ?? "").trim(),
    isCommon: input.isCommon ?? false,
    custom: input.custom ?? true,
  };
}

export function payloadContainsDemography(payload: Record<string, unknown>): boolean {
  return DEMOGRAPHY_KEYS.some((k) => k in payload && payload[k] != null && String(payload[k]).trim() !== "");
}

export function protocolScopeMatches(
  scope: string | null | undefined,
  haystack: string | null | undefined,
): boolean {
  const raw = (scope ?? "").trim().toLowerCase();
  if (!raw) return false;
  const hay = (haystack ?? "").toLowerCase();
  if (!hay) return false;
  return raw.split(/[,;/|]+/).some((part) => {
    const p = part.trim();
    return p.length >= 3 && hay.includes(p);
  });
}

function protocolHaystack(extras?: FormatLookupExtras): string {
  return `${extras?.protocolName ?? ""} ${extras?.studyDescription ?? ""}`.trim();
}

/** Higher = more specific to the open study (protocol/sub-technique hit). */
export function formatContextRank(
  format: Pick<ReportFormat, "protocolScope" | "favorite" | "isCommon" | "usageCount" | "name">,
  extras?: FormatLookupExtras,
): number {
  const hay = protocolHaystack(extras);
  const scoped = Boolean((format.protocolScope ?? "").trim());
  const match = scoped && protocolScopeMatches(format.protocolScope, hay);
  let score = 0;
  if (match) score += 1000;
  else if (scoped) score -= 50; // still listed for the region, ranked below generic
  if (format.favorite) score += 200;
  if (format.isCommon) score += 50;
  score += Math.min(format.usageCount ?? 0, 99);
  return score;
}

export function filterFormatsByPickerTab(
  formats: ReportFormat[],
  tab: "all" | "favorites" | "recent",
): ReportFormat[] {
  if (tab === "favorites") return formats.filter((f) => f.favorite);
  if (tab === "recent") {
    return formats
      .filter((f) => (f.usageCount ?? 0) > 0)
      .slice()
      .sort((a, b) => (b.usageCount ?? 0) - (a.usageCount ?? 0) || a.name.localeCompare(b.name));
  }
  return formats;
}
