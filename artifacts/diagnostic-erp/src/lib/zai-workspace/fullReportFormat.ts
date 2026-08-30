/**
 * Full Report Format helpers — one-click ready-to-print presets.
 *
 * Reuses the existing ReportFormat library. Pure functions only:
 * printed heading, protocol ranking, overwrite gating, clinical-only payload,
 * reporting-region resolve, provenance-aware overwrite analysis.
 * Demographics / DICOM identity are never stored or applied from a format.
 */

import type { FieldProvenanceMap, InsertSource } from "@/lib/reportFieldMerge";
import { canonicalContentRegion } from "@/lib/reportingStudyContext";
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

export type FormatBodySection = "technique" | "findings" | "impression" | "recommendation";

/** Classification of an existing report section before format apply. */
export type FormatSectionClass =
  | "blank"
  | "generated"
  | "template"
  | "ai"
  | "manual"
  | "ambiguous";

export type FormatSectionAnalysis = {
  section: FormatBodySection;
  classification: FormatSectionClass;
  /** True when this section needs radiologist confirmation before replace. */
  requiresConfirmation: boolean;
};

export type FormatOverwriteAnalysis = {
  sections: FormatSectionAnalysis[];
  /** Sections that require confirmation (manual / ambiguous). */
  confirmingSections: FormatBodySection[];
  requiresConfirmation: boolean;
  regionFrom: string | null;
  regionTo: string | null;
  regionChanging: boolean;
};

export type ReportingRegionResolveResult =
  | { status: "resolved"; region: string }
  | { status: "ambiguous"; candidates: string[] }
  | { status: "unresolved" };

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

/** DICOM / ERP identity keys — format apply must never write these. */
export const FORMAT_IDENTITY_KEYS = [
  "patientId",
  "patientName",
  "age",
  "sex",
  "accession",
  "accessionNumber",
  "orderId",
  "studyInstanceUID",
  "seriesInstanceUID",
  "sopInstanceUID",
  "modality",
] as const;

const TEMPLATE_SOURCES = new Set<InsertSource>([
  "template",
  "template-a",
  "template-b",
  "structured-template",
  "structured-template-candidate",
]);

const GENERATED_SOURCES = new Set<InsertSource>([
  "protocol",
  "quick-select",
  "quick-findings",
  "macro",
  "companion",
]);

const BODY_SECTIONS: FormatBodySection[] = [
  "technique",
  "findings",
  "impression",
  "recommendation",
];

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

/**
 * Map a whole-report format onto exactly one CARE reporting region.
 * Prefer explicit `format.bodyPart` (already canonicalized in the library).
 * Does not invent regions from free-text name guessing.
 */
export function resolveReportingRegionForFormat(
  format: Pick<ReportFormat, "bodyPart" | "name">,
  availableRegions: readonly string[],
): ReportingRegionResolveResult {
  const canonical = canonicalContentRegion(format.bodyPart);
  if (!canonical) return { status: "unresolved" };

  const catalog = availableRegions
    .map((raw) => ({ raw, key: canonicalContentRegion(raw).toLowerCase() }))
    .filter((r) => r.key.length > 0);

  if (catalog.length === 0) {
    // Tabs not loaded yet — still safe to use explicit bodyPart metadata.
    return { status: "resolved", region: canonical };
  }

  const want = canonical.toLowerCase();
  const matches = catalog.filter((r) => r.key === want || r.raw.toLowerCase() === want);
  if (matches.length === 1) {
    return { status: "resolved", region: matches[0]!.raw };
  }
  if (matches.length > 1) {
    const exact = matches.find((m) => m.raw === canonical);
    if (exact) return { status: "resolved", region: exact.raw };
    return { status: "ambiguous", candidates: [...new Set(matches.map((m) => m.raw))] };
  }
  // Explicit bodyPart not present in catalog — do not silently invent a tab.
  return { status: "unresolved" };
}

function collectSources(provenance: FieldProvenanceMap | undefined): Set<InsertSource> {
  const out = new Set<InsertSource>();
  if (!provenance) return out;
  for (const list of Object.values(provenance)) {
    for (const s of list) out.add(s);
  }
  return out;
}

/** Classify one body section from text + existing fieldProvenance (no new dirty system). */
export function classifyFormatSection(
  text: string,
  provenance: FieldProvenanceMap | undefined,
): FormatSectionClass {
  if (!text.trim()) return "blank";
  const sources = collectSources(provenance);
  if (sources.size === 0) return "ambiguous";
  if (sources.has("manual") || sources.has("radiologist-voice")) return "manual";
  if (sources.has("ai-draft")) return "ai";
  if ([...sources].some((s) => TEMPLATE_SOURCES.has(s))) return "template";
  if ([...sources].some((s) => GENERATED_SOURCES.has(s))) return "generated";
  return "ambiguous";
}

export function sectionRequiresOverwriteConfirmation(classification: FormatSectionClass): boolean {
  return classification === "manual" || classification === "ambiguous";
}

/**
 * Provenance-aware overwrite analysis for whole-report format apply.
 * Safe auto-replace: blank / generated / template / AI.
 * Confirm: genuine manual (incl. voice) or ambiguous provenance.
 * Region change alone does not force confirm unless a confirming section exists.
 */
export function analyzeFormatOverwrite(input: {
  technique: string;
  findings: string;
  impression: string;
  recommendation: string;
  fieldProvenance?: {
    technique?: FieldProvenanceMap;
    findings?: FieldProvenanceMap;
    impression?: FieldProvenanceMap;
    recommendation?: FieldProvenanceMap;
  };
  currentRegion?: string | null;
  resolvedRegion?: string | null;
}): FormatOverwriteAnalysis {
  const texts: Record<FormatBodySection, string> = {
    technique: input.technique,
    findings: input.findings,
    impression: input.impression,
    recommendation: input.recommendation,
  };
  const sections: FormatSectionAnalysis[] = BODY_SECTIONS.map((section) => {
    const classification = classifyFormatSection(
      texts[section],
      input.fieldProvenance?.[section],
    );
    return {
      section,
      classification,
      requiresConfirmation: sectionRequiresOverwriteConfirmation(classification),
    };
  });
  const confirmingSections = sections
    .filter((s) => s.requiresConfirmation)
    .map((s) => s.section);
  const regionFrom = (input.currentRegion ?? "").trim() || null;
  const regionTo = (input.resolvedRegion ?? "").trim() || null;
  const regionChanging = Boolean(regionTo && regionFrom !== regionTo);
  return {
    sections,
    confirmingSections,
    requiresConfirmation: confirmingSections.length > 0,
    regionFrom,
    regionTo: regionChanging ? regionTo : null,
    regionChanging,
  };
}

/**
 * True when applying would replace radiologist-owned or ambiguous report body.
 * Prefer `analyzeFormatOverwrite` when provenance is available.
 * Legacy text-only call (no provenance) treats any non-empty body as confirm
 * (ambiguous), matching fail-safe behaviour for untracked content.
 */
export function shouldConfirmFormatOverwrite(fields: {
  technique: string;
  findings: string;
  impression: string;
  recommendation: string;
  fieldProvenance?: {
    technique?: FieldProvenanceMap;
    findings?: FieldProvenanceMap;
    impression?: FieldProvenanceMap;
    recommendation?: FieldProvenanceMap;
  };
  currentRegion?: string | null;
  resolvedRegion?: string | null;
}): boolean {
  if (fields.fieldProvenance) {
    return analyzeFormatOverwrite(fields).requiresConfirmation;
  }
  // No provenance map provided — fail safe: any meaningful text needs confirm.
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
