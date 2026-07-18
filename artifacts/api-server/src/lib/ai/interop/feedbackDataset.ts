/**
 * Human feedback dataset shaping — Phase P4 / Gate G21 (pure).
 *
 * Shapes accept/edit/ignore/reject events (ai_draft_feedback) into a clean,
 * de-identified training-DATASET export. This is a DATASET ONLY — the platform
 * NEVER auto-learns and NEVER retrains from it (constitution: AI never
 * auto-learns). The rows are anonymized r, aggregated statistics, and JSONL
 * records a human can later curate for offline model work.
 *
 * Pure + unit-tested: the service layer reads the feedback rows and passes
 * plain objects here; nothing here touches the DB.
 *
 * De-identification contract: only STRUCTURED, non-identifying fields are
 * emitted (finding key, action, laterality, measurement ref, confidence,
 * prompt/model version, and a wasEdited boolean). The two FREE-TEXT fields that
 * can carry operator-typed PHI — `editedText` (the corrected report text) and
 * `reason` — are NEVER emitted; `editedText` collapses to `wasEdited` and
 * `reason` is dropped entirely. `reason` is still captured in ai_draft_feedback
 * (Gate G21) for authorized, non-de-identified analytics — it just never enters
 * this export. No patient identifiers are ever emitted.
 */

export interface RawFeedbackRow {
  action: string; // accept | edit | ignore | reject
  findingKey?: string | null;
  studyInstanceUid?: string | null;
  laterality?: string | null;
  measurementRef?: string | null;
  confidence?: number | null;
  promptVersion?: string | null;
  modelVersion?: string | null;
  editedText?: string | null;
  reason?: string | null;
}

export interface FeedbackDatasetRecord {
  action: string;
  findingKey: string | null;
  laterality: string | null;
  measurementRef: string | null;
  confidence: number | null;
  promptVersion: string | null;
  modelVersion: string | null;
  /** True when the radiologist supplied corrected text (edit signal). The
   *  corrected text itself is intentionally NOT emitted (PHI). */
  wasEdited: boolean;
  // NOTE: free-text `reason` is deliberately omitted from the de-identified
  // export (it can contain operator-typed PHI). It stays in ai_draft_feedback.
}

export interface FeedbackDatasetStats {
  total: number;
  byAction: Record<string, number>;
  editRate: number; // edits / total
  acceptRate: number; // accepts / total
  rejectRate: number; // rejects / total
  byPromptVersion: Record<string, number>;
  byModelVersion: Record<string, number>;
}

export interface FeedbackDataset {
  records: FeedbackDatasetRecord[];
  stats: FeedbackDatasetStats;
}

const VALID_ACTIONS = new Set(["accept", "edit", "ignore", "reject"]);
const clean = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t ? t : null;
};

/**
 * Shape raw feedback rows into a de-identified dataset + aggregate stats.
 * Rows with an unrecognized action are dropped (defensive; keeps the dataset
 * clean). No patient identifiers are ever emitted — only the finding key,
 * action, and model/prompt provenance survive.
 */
export function buildFeedbackDataset(rows: RawFeedbackRow[]): FeedbackDataset {
  const records: FeedbackDatasetRecord[] = [];
  const byAction: Record<string, number> = {};
  const byPromptVersion: Record<string, number> = {};
  const byModelVersion: Record<string, number> = {};

  for (const r of rows) {
    const action = clean(r.action)?.toLowerCase();
    if (!action || !VALID_ACTIONS.has(action)) continue;
    const editedText = clean(r.editedText);
    records.push({
      action,
      findingKey: clean(r.findingKey),
      laterality: clean(r.laterality),
      measurementRef: clean(r.measurementRef),
      confidence: typeof r.confidence === "number" ? r.confidence : null,
      promptVersion: clean(r.promptVersion),
      modelVersion: clean(r.modelVersion),
      wasEdited: action === "edit" || Boolean(editedText),
      // `reason` (free text) is intentionally NOT emitted — see de-id contract.
    });
    byAction[action] = (byAction[action] ?? 0) + 1;
    const pv = clean(r.promptVersion);
    if (pv) byPromptVersion[pv] = (byPromptVersion[pv] ?? 0) + 1;
    const mv = clean(r.modelVersion);
    if (mv) byModelVersion[mv] = (byModelVersion[mv] ?? 0) + 1;
  }

  const total = records.length;
  const rate = (n: number) => (total > 0 ? Math.round((n / total) * 1000) / 1000 : 0);

  return {
    records,
    stats: {
      total,
      byAction,
      editRate: rate((byAction.edit ?? 0) + records.filter((r) => r.action !== "edit" && r.wasEdited).length),
      acceptRate: rate(byAction.accept ?? 0),
      rejectRate: rate(byAction.reject ?? 0),
      byPromptVersion,
      byModelVersion,
    },
  };
}

/** Serialize the dataset records as JSONL (one record per line) for export. */
export function toJsonl(records: FeedbackDatasetRecord[]): string {
  return records.map((r) => JSON.stringify(r)).join("\n");
}
