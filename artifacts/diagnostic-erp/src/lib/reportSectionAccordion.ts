// Progressive-disclosure state + collapsed-summary builders for the main
// reporting pane of RadiologyReportingWorkspace.
//
// The pane used to render every reporting tool as a vertically stacked card,
// so a radiologist had to scroll past Demography, History, Technique, the full
// Findings Quick Select tile wall, Clinic Quick Select, Structured and the
// report preview to reach any one of them. This module owns the "one active
// major section at a time" rules and the one-line summaries shown on the
// collapsed headers, so the layout logic is unit-testable without a DOM.
//
// Nothing here decides what a section CONTAINS — the workspace still renders
// the same existing components. Collapse is visual only; every section keeps
// its children mounted so editor/panel state is never destroyed.

export type ReportSectionId =
  | "demography"
  | "refDoctor"
  | "region"
  | "history"
  | "technique"
  | "findings"
  | "impression"
  | "recommendation"
  | "report";

export type ReportSectionAccent = "slate" | "sky" | "emerald" | "teal" | "violet" | "amber" | "rose";

export interface ReportSectionMeta {
  id: ReportSectionId;
  label: string;
  accent: ReportSectionAccent;
}

/** Top-to-bottom order of the major reporting sections. */
export const REPORT_SECTIONS: readonly ReportSectionMeta[] = [
  { id: "demography", label: "Demography", accent: "slate" },
  { id: "refDoctor", label: "Ref. Doctor", accent: "sky" },
  { id: "region", label: "Region / Study / Report Format", accent: "emerald" },
  { id: "history", label: "History", accent: "teal" },
  { id: "technique", label: "Technique", accent: "violet" },
  { id: "findings", label: "Findings", accent: "emerald" },
  { id: "impression", label: "Impression", accent: "violet" },
  { id: "recommendation", label: "Recommendation", accent: "amber" },
  { id: "report", label: "Report / Layout / Export", accent: "rose" },
] as const;

/**
 * Accordion transition. Clicking a different header moves focus there;
 * clicking the header of the already-open section collapses everything, which
 * gives an at-a-glance overview of all nine summaries.
 */
export function nextActiveSection(
  current: ReportSectionId | null,
  clicked: ReportSectionId,
): ReportSectionId | null {
  return current === clicked ? null : clicked;
}

/** Alt+1…Alt+9 → section id. Returns null for any other digit. */
export function sectionForAltDigit(digit: string): ReportSectionId | null {
  const n = Number(digit);
  if (!Number.isInteger(n) || n < 1 || n > REPORT_SECTIONS.length) return null;
  return REPORT_SECTIONS[n - 1].id;
}

// ── Findings assistance drawers (nested, independent of the major accordion) ──

export type FindingsToolId = "quickSelect" | "quickAdd" | "structured" | "suggestions";

export interface FindingsToolMeta {
  id: FindingsToolId;
  label: string;
}

export const FINDINGS_TOOLS: readonly FindingsToolMeta[] = [
  { id: "quickSelect", label: "Quick Select" },
  { id: "quickAdd", label: "Quick Add" },
  { id: "structured", label: "Structured" },
  { id: "suggestions", label: "Suggestions" },
] as const;

/** Only one drawer open at a time; re-clicking the open tab hides the drawer. */
export function nextFindingsTool(
  current: FindingsToolId | null,
  clicked: FindingsToolId,
): FindingsToolId | null {
  return current === clicked ? null : clicked;
}

// ── Collapsed summaries ─────────────────────────────────────────────────────

const BULLET = " • ";

function joinParts(parts: Array<string | null | undefined>): string {
  return parts.filter((p): p is string => !!p && p.trim().length > 0).join(BULLET);
}

/** Collapses whitespace and clips to `max` characters with an ellipsis. */
export function clip(text: string, max = 64): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function summarizeDemography(d: {
  patientName?: string | null;
  age?: string | number | null;
  sex?: string | null;
  patientCode?: string | null;
}): string {
  const ageSex = joinAgeSex(d.age, d.sex);
  return joinParts([d.patientName ? clip(d.patientName, 32) : null, ageSex, d.patientCode]) || "No patient loaded";
}

function joinAgeSex(age?: string | number | null, sex?: string | null): string | null {
  const a = age == null || age === "" ? null : String(age).trim();
  const s = sex ? String(sex).trim().charAt(0).toUpperCase() : null;
  if (a && s) return `${a}/${s}`;
  return a ?? s ?? null;
}

export function summarizeRefDoctor(name?: string | null): string {
  const n = (name ?? "").trim();
  if (!n) return "Not set";
  return /^dr\b/i.test(n) ? clip(n, 40) : clip(`Dr ${n}`, 40);
}

export function summarizeRegion(input: {
  regions: readonly string[];
  protocolName?: string | null;
  testName?: string | null;
  templateMismatch?: boolean;
}): string {
  const regions = input.regions.filter(Boolean);
  const regionPart = regions.length === 0
    ? "No region"
    : regions.length <= 2
      ? regions.join(" + ")
      : `${regions.slice(0, 2).join(" + ")} +${regions.length - 2}`;
  const status = input.templateMismatch
    ? "template mismatch"
    : input.protocolName
      ? clip(input.protocolName, 28)
      : "protocol not applied";
  return joinParts([regionPart, input.testName ? clip(input.testName, 30) : null, status]);
}

/** First meaningful line of a free-text field, for History / Recommendation. */
export function summarizeFieldText(text: string, emptyLabel: string, max = 56): string {
  const lines = splitLines(text);
  if (lines.length === 0) return emptyLabel;
  const first = clip(lines[0], max);
  return lines.length > 1 ? `${first}${BULLET}+${lines.length - 1} more` : first;
}

export function splitLines(text: string): string[] {
  return (text ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export function summarizeTechnique(input: {
  techniqueText: string;
  protocolName?: string | null;
}): string {
  const lines = splitLines(input.techniqueText);
  if (lines.length === 0) return input.protocolName ? `${clip(input.protocolName, 34)}${BULLET}not written` : "Not written";
  return joinParts([clip(lines[0], 44), lines.length > 1 ? `+${lines.length - 1} more` : null]);
}

export function summarizeFindings(input: {
  findingsText: string;
  structured: boolean;
  structuredSectionCount?: number;
  assistedCount?: number;
  lintCount?: number;
}): string {
  if (input.structured) {
    const n = input.structuredSectionCount ?? 0;
    return joinParts([
      `Structured${BULLET}${n} section${n === 1 ? "" : "s"}`.replace(BULLET, " · "),
      warningPart(input.lintCount),
    ]);
  }
  const lines = splitLines(input.findingsText);
  if (lines.length === 0) return "Empty";
  return joinParts([
    `${lines.length} line${lines.length === 1 ? "" : "s"}`,
    input.assistedCount ? `${input.assistedCount} assisted` : null,
    warningPart(input.lintCount),
  ]);
}

function warningPart(lintCount?: number): string {
  return lintCount && lintCount > 0
    ? `${lintCount} warning${lintCount === 1 ? "" : "s"}`
    : "no unresolved warnings";
}

export function summarizeImpression(text: string): string {
  const lines = splitLines(text);
  if (lines.length === 0) return "Empty";
  if (lines.length === 1) return clip(lines[0], 56);
  return `${lines.length} impression lines${BULLET}${clip(lines[0], 32)}`;
}

export function summarizeReport(input: {
  layoutLabel?: string | null;
  paper?: string | null;
  imageCount?: number;
}): string {
  return joinParts([
    input.layoutLabel ? clip(input.layoutLabel, 24) : "Classic",
    input.paper ?? "A4",
    input.imageCount ? `${input.imageCount} image${input.imageCount === 1 ? "" : "s"}` : null,
  ]);
}

export function summarizeRecommendation(text: string, critical: boolean): string {
  const base = summarizeFieldText(text, "Empty");
  return critical ? `${base}${BULLET}CRITICAL` : base;
}

// ── Section completion ticks ────────────────────────────────────────────────

export type SectionStatus = "empty" | "done" | "attention";

export function sectionStatuses(input: {
  hasPatient: boolean;
  refDoctor?: string | null;
  regions: readonly string[];
  templateMismatch?: boolean;
  clinicalHistoryText: string;
  techniqueText: string;
  findingsText: string;
  structured: boolean;
  structuredSectionCount?: number;
  impressionText: string;
  recommendationText: string;
  critical?: boolean;
  reportReady?: boolean;
}): Record<ReportSectionId, SectionStatus> {
  const findingsFilled = input.structured
    ? (input.structuredSectionCount ?? 0) > 0
    : splitLines(input.findingsText).length > 0;
  return {
    demography: input.hasPatient ? "done" : "empty",
    refDoctor: (input.refDoctor ?? "").trim() ? "done" : "empty",
    region: input.templateMismatch ? "attention" : input.regions.length > 0 ? "done" : "empty",
    history: splitLines(input.clinicalHistoryText).length > 0 ? "done" : "empty",
    technique: splitLines(input.techniqueText).length > 0 ? "done" : "empty",
    findings: findingsFilled ? "done" : "empty",
    impression: splitLines(input.impressionText).length > 0 ? "done" : "empty",
    recommendation: input.critical
      ? "attention"
      : splitLines(input.recommendationText).length > 0
        ? "done"
        : "empty",
    report: input.reportReady ? "done" : "empty",
  };
}

// ── Compact provenance ("Sources: Manual 8 • Quick Select 4") ───────────────

export interface ProvenanceSegmentLike {
  kind: string;
  label: string;
}

/**
 * Counts provenance segments per source kind, most frequent first, so the
 * editor can show a one-line read-only summary instead of a chip legend plus
 * a full per-segment list. The detailed list is still available behind the
 * "details" toggle — this only changes how much is visible by default.
 */
export function provenanceCounts(
  segments: readonly ProvenanceSegmentLike[],
): Array<{ kind: string; label: string; count: number }> {
  const byKind = new Map<string, { kind: string; label: string; count: number }>();
  for (const seg of segments) {
    const existing = byKind.get(seg.kind);
    if (existing) existing.count += 1;
    else byKind.set(seg.kind, { kind: seg.kind, label: seg.label, count: 1 });
  }
  return [...byKind.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function formatProvenanceSummary(
  counts: ReadonlyArray<{ label: string; count: number }>,
): string {
  if (counts.length === 0) return "Manual";
  return counts.map((c) => `${c.label} ${c.count}`).join(BULLET);
}

/** Number of non-manual segments — drives the Findings "N assisted" summary. */
export function countAssisted(segments: readonly ProvenanceSegmentLike[]): number {
  return segments.filter((s) => s.kind !== "manual").length;
}
