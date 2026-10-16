/**
 * structuredNormalFormats.ts — a Normal Format IS the row on the Templates screen.
 *
 * The workspace used to hold two copies of the same idea: the Full Report Format
 * library (localStorage + radiology_snippets), which the auto-open bootstrap and
 * the Quick Normal button read, and `structured_report_templates`, which the
 * Templates screen edits. They never intersected, so editing a Normal report in
 * the UI could not change what printed, and the bootstrap overwrote the edited
 * wording because template provenance is in its replaceable set.
 *
 * A row that carries a complete normal report is adapted here into the format
 * shape the existing resolution, apply, undo and overwrite-confirmation paths
 * already understand. Nothing is invented: a row missing its findings or
 * impression is not a normal report and yields no format. The built-in
 * baselines stay in the list — a row that is later deleted or edited into
 * something incomplete must fall back to them, not leave the exam with no
 * normal at all. The resolver is what prefers the row.
 *
 * These formats are in-memory only. `saveFormats` refuses them, because the
 * database row is the single copy of the wording — a stored duplicate would be
 * a second, staler Normal Format for the same exam.
 */

import { adaptSectionsJson } from "@/lib/structuredFormat/adapter";
import { studyRegionToBodyPart } from "@/lib/pickStructuredTemplate";
import { baselineManifestForFormat } from "./fullReportBaseline";
import type { Modality, ReportFormat } from "./types";

/** The subset of a structured_report_templates row this adapter reads. */
export type StructuredNormalRow = {
  id: number;
  templateName: string;
  modality: string;
  bodyPart: string;
  studyType: string | null;
  sectionsJson: string | null;
  defaultFindings: string | null;
  defaultImpression: string | null;
  isActive?: boolean;
  isDefault?: boolean;
};

/**
 * Template `body_part` codes are internal (SPINE_LS); the format library speaks
 * study-region names, which is what the resolver canonicalises both sides to.
 * Every value here must round-trip back through `studyRegionToBodyPart`.
 */
const REGION_BY_BODY_PART: Record<string, string> = {
  SPINE_WHOLE: "Whole Spine",
  SPINE_CERVICAL: "Cervical Spine",
  SPINE_DORSAL: "Dorsal Spine",
  SPINE_LS: "LS Spine",
  BRAIN: "Brain",
  CHEST: "Chest",
  ABDOMEN: "Abdomen",
};

const MODALITY_BY_CATALOG_CODE: Record<string, Modality> = {
  MRI: "MR",
  MR: "MR",
  CT: "CT",
  "X-RAY": "XR",
  XR: "XR",
  DR: "XR",
};

export function regionNameForBodyPart(code: string | null | undefined): string {
  const key = (code ?? "").trim().toUpperCase().replace(/[\s-]/g, "_");
  return REGION_BY_BODY_PART[key] ?? "";
}

/**
 * Adapt one Templates-screen row into a Normal Format, or null when the row is
 * not a complete normal report (or is not an exam this clinic bootstraps).
 */
export function structuredTemplateToNormalFormat(
  row: StructuredNormalRow,
  now: string,
): ReportFormat | null {
  if (row.isActive === false) return null;
  const modality = MODALITY_BY_CATALOG_CODE[(row.modality ?? "").trim().toUpperCase()];
  if (!modality) return null;
  const findings = (row.defaultFindings ?? "").trim();
  const impression = (row.defaultImpression ?? "").trim();
  if (!findings || !impression) return null;
  const region = regionNameForBodyPart(row.bodyPart);
  if (!region || studyRegionToBodyPart(region) !== row.bodyPart.trim().toUpperCase()) return null;

  const doc = adaptSectionsJson(row.sectionsJson);
  const format: ReportFormat = {
    id: `structured:${row.id}`,
    name: row.templateName,
    modality,
    bodyPart: region,
    diagnosisTags: [],
    clinicalHistory: "",
    technique: (doc.technique ?? "").trim(),
    findings: row.defaultFindings ?? "",
    impression: row.defaultImpression ?? "",
    recommendation: (doc.recommendation ?? "").trim(),
    protocolScope: row.studyType ?? "",
    structuredTemplateId: row.id,
    isCommon: true,
    createdAt: now,
    updatedAt: now,
  };
  // A row authored over a curated baseline's own sentences carries that baseline's
  // ownership with it, so the retirement engine can still attribute every normal on
  // the page. `baselineManifestForFormat` validates the manifest AGAINST this row's
  // findings and impression: renaming a row to a curated name without keeping its
  // sentences yields nothing, and the edited wording is then the clinic's own choice
  // rather than something CARE auto-applied.
  format.baselineManifest = baselineManifestForFormat(format);
  return format;
}

/**
 * Merge the Templates rows into a format library.
 *
 * Structured entries are rebuilt from `rows` on every call and library entries
 * are never removed, so this is idempotent and lossless: refreshing the screen
 * cannot accumulate duplicates, and deleting a row falls the exam back to its
 * built-in baseline instead of leaving the report with no normal at all.
 * Which copy wins is the resolver's call, not this function's.
 */
export function mergeStructuredNormalFormats(
  formats: ReportFormat[],
  rows: StructuredNormalRow[],
  now = new Date().toISOString(),
): ReportFormat[] {
  const library = formats.filter((f) => f.structuredTemplateId == null);
  const incoming: ReportFormat[] = [];
  for (const row of rows) {
    const f = structuredTemplateToNormalFormat(row, now);
    if (f) incoming.push(f);
  }
  return [...incoming, ...library];
}
