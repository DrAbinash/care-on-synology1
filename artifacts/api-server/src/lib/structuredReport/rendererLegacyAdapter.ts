// ─────────────────────────────────────────────────────────────────────────────
// rendererLegacyAdapter.ts — Ticket D4, Phase 3 (legacy compatibility adapter).
//
// Maps the pure D4 renderer's output (renderer.ts) into the EXISTING legacy
// report field shape used by radiology_report_drafts (findingsSections /
// impression[] / recommendation / formattedReportText / technique), and offers
// a field-by-field comparator for side-by-side "legacy vs D1 renderer" checks.
//
// This does NOT replace runtime rendering (Ticket D4 is build-only). It exists
// so a later cutover ticket can diff D1-rendered output against the legacy
// producer and prove equivalence (or document intended differences) before
// switching anything.
// ─────────────────────────────────────────────────────────────────────────────

import type { RenderResult } from "./renderer";

/** The legacy draft-report field shape (radiology_report_drafts columns):
 *  findings_sections is a { sectionName: text } object, impression a bullet
 *  array, recommendation/technique free text, plus the assembled plain-text
 *  body. */
export interface LegacyReportShape {
  findingsSections: Record<string, string>;
  impression: string[];
  recommendation: string;
  technique: string;
  formattedReportText: string;
}

export interface ToLegacyOptions {
  /** Section name to file the (single) findings block under. Defaults to
   *  "FINDINGS", matching the plain-text heading. */
  findingsSectionName?: string;
}

/** Strip a leading display-numbering prefix ("1. ", "2) ") so the legacy
 *  impression bullet array holds bare lines (legacy re-adds numbering at
 *  render). A pure, well-defined transform — not prose parsing. */
function stripNumbering(line: string): string {
  return line.replace(/^\s*\d+[.)]\s+/, "");
}

/**
 * Map a RenderResult into the legacy draft field shape. Pure; does not mutate
 * the input.
 */
export function toLegacyReportShape(result: RenderResult, opts: ToLegacyOptions = {}): LegacyReportShape {
  const sectionName = opts.findingsSectionName ?? "FINDINGS";
  const findingsText = result.findings.map((l) => l.text).join("\n");

  return {
    findingsSections: findingsText ? { [sectionName]: findingsText } : {},
    // Legacy stores bare bullets; a pinned item's authored "N. " numbering is
    // stripped here so it matches the legacy array convention (see the D4 final
    // report's "legacy differences" note).
    impression: result.impression.map((l) => stripNumbering(l.text)),
    recommendation: result.recommendations.map((l) => l.text).join("\n"),
    technique: result.technique,
    formattedReportText: result.body,
  };
}

// ── Side-by-side comparison ──────────────────────────────────────────────────

export interface FieldDifference {
  field: string;
  legacy: string;
  d1: string;
}

export interface LegacyComparison {
  identical: boolean;
  differences: FieldDifference[];
}

function norm(v: string): string {
  return v;
}

/**
 * Field-by-field comparison of a legacy-produced report shape against the
 * D1-renderer-produced one. Byte-exact per field; every mismatch is reported
 * (never silently coalesced), so a caller can assert equivalence or document
 * each intended difference.
 */
export function compareLegacyVsD1(legacy: LegacyReportShape, d1: LegacyReportShape): LegacyComparison {
  const differences: FieldDifference[] = [];

  const legacyKeys = Object.keys(legacy.findingsSections);
  const d1Keys = Object.keys(d1.findingsSections);
  const allKeys = Array.from(new Set([...legacyKeys, ...d1Keys]));
  for (const k of allKeys) {
    const a = legacy.findingsSections[k] ?? "";
    const b = d1.findingsSections[k] ?? "";
    if (norm(a) !== norm(b)) differences.push({ field: `findingsSections.${k}`, legacy: a, d1: b });
  }

  const maxImp = Math.max(legacy.impression.length, d1.impression.length);
  for (let i = 0; i < maxImp; i++) {
    const a = legacy.impression[i] ?? "";
    const b = d1.impression[i] ?? "";
    if (norm(a) !== norm(b)) differences.push({ field: `impression[${i}]`, legacy: a, d1: b });
  }

  for (const field of ["recommendation", "technique", "formattedReportText"] as const) {
    if (norm(legacy[field]) !== norm(d1[field])) {
      differences.push({ field, legacy: legacy[field], d1: d1[field] });
    }
  }

  return { identical: differences.length === 0, differences };
}
