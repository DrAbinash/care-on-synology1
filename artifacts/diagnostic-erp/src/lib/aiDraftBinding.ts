/**
 * AI draft → report-editor binding — pure logic (P3 completion patch).
 *
 * Encodes the safety rules of the editor binding so they can be unit-tested:
 *  - Accept/Edit insert into the working draft; Ignore/Reject do not.
 *  - The saved human draft ALWAYS wins over AI on reopen — AI is never
 *    auto-prefilled; its content enters the report only via an explicit Accept.
 * Accepted content is inserted into the EXISTING findings editor state
 * (setRawFindings), which the existing autosave persists to radiology_report_drafts.
 * The AI never writes the draft store, patient_reports, or the signature directly.
 */
export interface BindableFinding {
  key: string;
  text: string;
  laterality?: string;
}

export type DraftAction = "accept" | "edit" | "ignore" | "reject";

/**
 * Legacy: Accept/Edit immediately inserted into the working draft.
 * Reporting Workspace now uses Composer-style review — see shouldStageOnAction.
 * Keep this for non-workspace callers that still insert directly.
 */
export function shouldInsertOnAction(action: DraftAction): boolean {
  return action === "accept" || action === "edit";
}

/**
 * One AI Accept culture (Reporting Workspace): Accept/Edit STAGE proposals for
 * Composer review/Apply. They must NOT silently write the report. Ignore/Reject
 * only record feedback.
 */
export function shouldStageOnAction(action: DraftAction): boolean {
  return action === "accept" || action === "edit";
}

/** Structured finding → the text inserted into the findings editor. */
export function formatFindingForInsertion(f: BindableFinding): string {
  const side = f.laterality && f.laterality !== "none" ? `${cap(f.laterality)}: ` : "";
  return `${side}${f.text}`.trim();
}

/** Append accepted AI text to the existing findings editor content. */
export function appendToFindings(existing: string, text: string): string {
  const t = text.trim();
  if (!t) return existing;
  return existing.trim() ? `${existing.trimEnd()}\n${t}` : t;
}

/**
 * Decide what prefills the report editor when a study is (re)opened. The saved
 * human draft ALWAYS wins; AI is never auto-applied. Reopening therefore restores
 * the radiologist's own content from the normal draft store, never a
 * reconstruction from the AI result.
 */
export function chooseReportPrefill(savedHumanDraft: string | null | undefined): { content: string; source: "human_draft" | "empty" } {
  if (savedHumanDraft && savedHumanDraft.trim()) return { content: savedHumanDraft, source: "human_draft" };
  return { content: "", source: "empty" }; // never the AI draft — AI enters only via explicit Accept
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** One row of `GET /api/ai-reporting/drafts/:studyInstanceUID`, as far as this file cares. */
export interface AiReportDraftRow {
  id: number;
  status: string;
  draftText?: string | null;
  aiResponse?: string | null;
}

/**
 * The staging key for a queued AI draft. Stable per row, so the same draft offered
 * twice — a re-render, a second open of the same study, a double click — replaces
 * itself in the queue instead of stacking a second copy of one sentence.
 */
export function aiReportInsertKey(draftId: number | string): string {
  return `ai-report-draft:${draftId}`;
}

/**
 * Which of a study's saved AI drafts the clinician has already sent to the report.
 *
 * `status === "inserted"` is the queue. It is written by
 * `POST /api/ai-reporting/insert-to-report`, which — after PR #1113 measured that it
 * wrote nothing anywhere — stages rather than replaces: the report body belongs to the
 * reporting workspace, and its one authoritative path is stage → Apply → the same
 * awaited save the Save button uses. So the workspace reads this list when a study
 * opens, and the text reaches Findings only through the clinician's own Apply.
 *
 * Nothing is filtered by author on purpose. The queue is about the examination: a
 * colleague's staged sentence is still a sentence this report has not been shown yet,
 * and Discard is right there.
 */
export function pendingReportInserts(
  rows: readonly AiReportDraftRow[],
): { findingKey: string; text: string; draftId: number }[] {
  const out: { findingKey: string; text: string; draftId: number }[] = [];
  for (const row of rows) {
    if (row.status !== "inserted") continue;
    // `draftText` is what the clinician left in the editor after editing the model's
    // answer; `aiResponse` is the raw answer. The edited text wins — that is the
    // radiologist's own words, and the whole point of the review step.
    const text = (row.draftText ?? row.aiResponse ?? "").trim();
    if (!text) continue;
    out.push({ findingKey: aiReportInsertKey(row.id), text, draftId: row.id });
  }
  return out;
}

