/**
 * usgCompanionReadiness.ts — CARE USG Companion (Phase 1).
 *
 * The "Report Readiness Score" (0-100) is a PURE WORKFLOW-COMPLETENESS signal —
 * NOT AI, NOT clinical quality. It answers "how much of the pre-report workflow
 * has the Companion + radiologist completed?" across six axes: measurements,
 * template, protocol, clinical history, quick findings, and Copilot review.
 *
 * This is a deliberate SIBLING of `reportValidator.computeQualityScore` (which
 * scores text quality/consistency), not an extension of it — the two axes are
 * shown side by side. Pure and deterministic (root-testable).
 */

export interface ReadinessInput {
  /** expected measurements for the detected study type (0 → axis auto-complete). */
  measurementsExpected: number;
  measurementsFound: number;
  /** a template is loaded for the study. */
  templateSelected: boolean;
  /** a protocol is loaded/applied for the study. */
  protocolSelected: boolean;
  /** clinical history text is present. */
  historyPresent: boolean;
  /** at least one quick finding / structured selection is in the report. */
  quickFindingsSelected: boolean;
  /** Copilot has run and no unresolved critical/blocking items remain. */
  copilotClear: boolean;
}

export interface ReadinessAxis {
  key: "measurements" | "template" | "protocol" | "history" | "quickFindings" | "copilot";
  label: string;
  weight: number;
  earned: number;
  done: boolean;
  detail?: string;
}

export interface ReadinessScore {
  score: number; // 0-100
  axes: ReadinessAxis[];
}

const WEIGHTS = {
  measurements: 25,
  template: 15,
  protocol: 15,
  history: 15,
  quickFindings: 15,
  copilot: 15,
} as const;

function clampInt(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
}

export function computeReadinessScore(input: ReadinessInput): ReadinessScore {
  const expected = clampInt(input.measurementsExpected);
  const found = Math.min(expected, clampInt(input.measurementsFound));

  // Measurements axis: proportional credit. If the study type has no
  // auto-extractable measurements (expected === 0), the axis is complete — a
  // thyroid/breast study is not penalised for having nothing to import.
  const measRatio = expected === 0 ? 1 : found / expected;
  const measEarned = Math.round(measRatio * WEIGHTS.measurements);

  const axes: ReadinessAxis[] = [
    {
      key: "measurements",
      label: "Measurements",
      weight: WEIGHTS.measurements,
      earned: measEarned,
      done: expected === 0 || found >= expected,
      detail: expected === 0 ? "No auto-measurements for this study type" : `${found}/${expected} imported`,
    },
    { key: "template", label: "Template", weight: WEIGHTS.template, earned: input.templateSelected ? WEIGHTS.template : 0, done: !!input.templateSelected },
    { key: "protocol", label: "Protocol", weight: WEIGHTS.protocol, earned: input.protocolSelected ? WEIGHTS.protocol : 0, done: !!input.protocolSelected },
    { key: "history", label: "Clinical History", weight: WEIGHTS.history, earned: input.historyPresent ? WEIGHTS.history : 0, done: !!input.historyPresent },
    { key: "quickFindings", label: "Quick Findings", weight: WEIGHTS.quickFindings, earned: input.quickFindingsSelected ? WEIGHTS.quickFindings : 0, done: !!input.quickFindingsSelected },
    { key: "copilot", label: "Copilot Review", weight: WEIGHTS.copilot, earned: input.copilotClear ? WEIGHTS.copilot : 0, done: !!input.copilotClear },
  ];

  const score = Math.max(0, Math.min(100, axes.reduce((s, a) => s + a.earned, 0)));
  return { score, axes };
}

// ── Companion Timeline ────────────────────────────────────────────────────────
// The 7 workflow stages. Server provides the timestamps it knows (received,
// measurements imported); the workspace provides the live stages (template,
// protocol, edited, saved, finalized) from its own state.

export type TimelineStageKey =
  | "received" | "measurements" | "template" | "protocol" | "edited" | "saved" | "finalized";

export interface TimelineStage {
  key: TimelineStageKey;
  label: string;
  done: boolean;
  at: string | null; // ISO timestamp when known
}

export interface TimelineInput {
  receivedAt: string | null;
  measurementsImported: boolean;
  measurementsAt: string | null;
  templateLoaded: boolean;
  protocolLoaded: boolean;
  userEdited: boolean;
  reportSaved: boolean;
  reportFinalized: boolean;
}

export function buildCompanionTimeline(input: TimelineInput): TimelineStage[] {
  return [
    { key: "received", label: "Study Received", done: !!input.receivedAt, at: input.receivedAt },
    { key: "measurements", label: "Measurements Imported", done: !!input.measurementsImported, at: input.measurementsAt },
    { key: "template", label: "Template Loaded", done: !!input.templateLoaded, at: null },
    { key: "protocol", label: "Protocol Loaded", done: !!input.protocolLoaded, at: null },
    { key: "edited", label: "Radiologist Edited", done: !!input.userEdited, at: null },
    { key: "saved", label: "Report Saved", done: !!input.reportSaved, at: null },
    { key: "finalized", label: "Report Finalized", done: !!input.reportFinalized, at: null },
  ];
}
