/**
 * AI timeline shaping — Phase P4 / Gate G19 (pure).
 *
 * Shapes the IMMUTABLE history of AI activity for one study into an ordered
 * timeline for the radiologist-facing "AI history" view. Every provisional
 * version (ai_shadow_drafts, append-only), its snapshot revision, and the
 * radiologist feedback events (ai_draft_feedback) become chronologically
 * ordered entries. Pure + unit-tested: the service layer loads the rows and
 * this function orders/labels them. No mutation, no DB, no clock — timestamps
 * are passed in as epoch millis so ordering is deterministic and testable.
 */

export interface TimelineDraftInput {
  version: number;
  createdAtMs: number;
  snapshotRevision?: number | null;
  modelDigest?: string | null;
  promptVersion?: string | null;
  findingCount: number;
  qualityScore?: number | null;
  degraded?: boolean | null;
  source?: string | null;
}
export interface TimelineFeedbackInput {
  createdAtMs: number;
  action: string; // accept | edit | ignore | reject
  findingKey?: string | null;
  staffId?: number | null;
}
export interface TimelineFinalizeInput {
  createdAtMs: number;
  reportId: number;
  event: string; // e.g. "finalized" | "signed"
}

export type TimelineEntry =
  | {
      kind: "ai_version";
      atMs: number;
      version: number;
      snapshotRevision?: number | null;
      modelDigest?: string | null;
      promptVersion?: string | null;
      findingCount: number;
      qualityScore?: number | null;
      degraded: boolean;
      source?: string | null;
    }
  | {
      kind: "feedback";
      atMs: number;
      action: string;
      findingKey?: string | null;
      staffId?: number | null;
    }
  | {
      kind: "report";
      atMs: number;
      reportId: number;
      event: string;
    };

export interface AiTimeline {
  studyInstanceUid: string;
  entries: TimelineEntry[];
  versionCount: number;
  feedbackCount: number;
  latestVersion: number | null;
}

export interface TimelineInput {
  studyInstanceUid: string;
  drafts: TimelineDraftInput[];
  feedback?: TimelineFeedbackInput[];
  reportEvents?: TimelineFinalizeInput[];
}

/**
 * Build the ordered timeline. Entries are sorted by timestamp ascending; ties
 * break deterministically by kind priority (ai_version → feedback → report)
 * then by version/reportId so the output is stable regardless of input order.
 */
export function buildAiTimeline(input: TimelineInput): AiTimeline {
  const entries: TimelineEntry[] = [];

  for (const d of input.drafts) {
    entries.push({
      kind: "ai_version",
      atMs: d.createdAtMs,
      version: d.version,
      snapshotRevision: d.snapshotRevision ?? null,
      modelDigest: d.modelDigest ?? null,
      promptVersion: d.promptVersion ?? null,
      findingCount: d.findingCount,
      qualityScore: d.qualityScore ?? null,
      degraded: Boolean(d.degraded),
      source: d.source ?? null,
    });
  }
  for (const f of input.feedback ?? []) {
    entries.push({
      kind: "feedback",
      atMs: f.createdAtMs,
      action: f.action,
      findingKey: f.findingKey ?? null,
      staffId: f.staffId ?? null,
    });
  }
  for (const r of input.reportEvents ?? []) {
    entries.push({ kind: "report", atMs: r.createdAtMs, reportId: r.reportId, event: r.event });
  }

  const kindPriority: Record<TimelineEntry["kind"], number> = { ai_version: 0, feedback: 1, report: 2 };
  entries.sort((a, b) => {
    if (a.atMs !== b.atMs) return a.atMs - b.atMs;
    if (a.kind !== b.kind) return kindPriority[a.kind] - kindPriority[b.kind];
    if (a.kind === "ai_version" && b.kind === "ai_version") return a.version - b.version;
    if (a.kind === "report" && b.kind === "report") return a.reportId - b.reportId;
    return 0;
  });

  const versions = input.drafts.map((d) => d.version);
  return {
    studyInstanceUid: input.studyInstanceUid,
    entries,
    versionCount: input.drafts.length,
    feedbackCount: (input.feedback ?? []).length,
    latestVersion: versions.length ? Math.max(...versions) : null,
  };
}
