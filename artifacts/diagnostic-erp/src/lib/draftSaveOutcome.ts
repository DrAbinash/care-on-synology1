/**
 * What one POST /api/radiology/report-generator/save-draft response means for
 * the editor's dirty state.
 *
 * The server writes the narrative columns (raw_findings, impression, technique,
 * clinical_history) and the structured_json envelope (observation ledger,
 * viewer measurements, canal AP provenance, vascular technique, applied
 * patterns, linked study, format identity) separately, and reports an envelope
 * failure on an otherwise-successful response via
 * `structuredJsonPersistFailed`. It stayed `success: true` before this too —
 * the route returned `formatStatePersistFailed` and the client discarded it,
 * then cleared isDirty.
 *
 * Clearing isDirty on a partial save is the actual data loss: the 30s autosave
 * effect returns early when the study is not dirty, so it never re-arms, and the
 * radiologist reopens the study to find their measurements and ledger entries
 * gone with nothing having said so. So the dirty flag is cleared only on a
 * fully-persisted save, and a partial one is surfaced even when the save was
 * silent — an autosave nobody asked for is exactly the case where a quiet
 * partial failure would otherwise go unnoticed.
 *
 * A partial save still returns the draft id. The narrative did commit, so
 * blocking navigation over it would strand the radiologist on a study that is
 * in fact saved; and the id is needed anyway, because saving again without it
 * would insert a second draft row for the same study.
 */

import type { SavedDraftResponseRow } from "./radiologyDraftId";

export type DraftSaveResponse = {
  success?: boolean;
  /** The saved row. Only `id` is relied on unconditionally — the narrative
   *  columns of a save response are read by `acknowledgedDraftRow()`, which
   *  falls back to what the request itself carried. */
  draft?: SavedDraftResponseRow & { id: number };
  id?: number;
  /** Set when the narrative columns saved but structured_json did not. */
  structuredJsonPersistFailed?: boolean;
  /**
   * P0-2 — the revision of the row as it stands after this save, issued by the
   * server. Null/absent when the surface does not report one.
   */
  revision?: string | null;
};

/**
 * P0-2 — the code the route uses when the report moved underneath this editor,
 * so the save was NOT written. Mirrored from
 * `api-server/src/lib/radiologyDraftRevision.ts`.
 */
export const DRAFT_REVISION_CONFLICT = "DRAFT_REVISION_CONFLICT";

/**
 * The code of a 409 the server REFUSED, or null when this was a failure.
 *
 * #862 established the distinction for the composer's Apply: a refusal means the
 * server deliberately wrote nothing, so the radiologist's text stays in the
 * editor, the autosave must stay armed, and the chip must not say "Saved" — but
 * calling it "Save failed" reports a loss that did not happen and, with
 * TOAST_LIMIT at 1, evicts the sentence that explained it. `LOCKED_BY_OTHER` and
 * `REPORT_LOCKED` arrive the same way and are named here for the same reason;
 * each one says what the radiologist can actually do next.
 *
 * Structural on purpose: it reads the shape `fetchApi` builds
 * (`HttpError.details` is the parsed body), so the caller can classify a real
 * transport error without importing the transport.
 */
export function draftSaveRefusalCode(
  err: { status?: number; details?: unknown } | null | undefined,
): string | null {
  if (!err || err.status !== 409) return null;
  const code = (err.details as { code?: unknown } | undefined)?.code;
  return typeof code === "string" && code ? code : null;
}

export type DraftSaveOutcome = {
  /** Draft row id to remember, or null when the response carried none. */
  id: number | null;
  /** Only a fully-persisted save may clear the editor's dirty flag. */
  clearDirty: boolean;
  status: "saved" | "error";
  /** "partial" is shown even for a silent autosave. */
  notice: "saved" | "partial";
};

export function draftSaveOutcome(
  res: DraftSaveResponse | null | undefined,
): DraftSaveOutcome {
  const id = res?.draft?.id ?? res?.id ?? null;
  const envelopeFailed = res?.structuredJsonPersistFailed === true;
  return {
    id,
    clearDirty: id != null && !envelopeFailed,
    status: envelopeFailed ? "error" : "saved",
    notice: envelopeFailed ? "partial" : "saved",
  };
}

/**
 * The five narrative fields one save-draft request carries, captured at click
 * time. This is the byte-level identity `clinicalTextsPersistedAck` compares.
 */
export type ClinicalTextsAtSave = {
  clinicalHistoryText: string;
  techniqueText: string;
  findingsText: string;
  impressionText: string;
  recommendationText: string;
};

/**
 * D-05 / F3 — does the save response still describe the editor's newest text?
 *
 * A save-draft response is an acknowledgement of the BYTES THE REQUEST CARRIED.
 * The generation guard (`shouldCommitAutosave`) only refuses an ack after a
 * STUDY SWITCH, because that is the only thing that bumps the generation — the
 * radiologist typing more while the request was in flight leaves it untouched,
 * and the ack then cleared `isDirty` over text that had never been persisted.
 * The 30-second autosave effect arms on `isDirty`, so it never re-armed; the
 * chip said "Saved", the badge said otherwise, and reopening lost the newest
 * sentences. Byte equality is the truth here: no normalisation, no
 * fuzzy matching — one character of difference is one character unsaved.
 */
export function clinicalTextsPersistedAck(
  sent: ClinicalTextsAtSave,
  liveNow: ClinicalTextsAtSave,
): boolean {
  return sent.clinicalHistoryText === liveNow.clinicalHistoryText
    && sent.techniqueText === liveNow.techniqueText
    && sent.findingsText === liveNow.findingsText
    && sent.impressionText === liveNow.impressionText
    && sent.recommendationText === liveNow.recommendationText;
}

export type DraftSaveAckEffects = {
  /** The response's own outcome, unchanged. */
  outcome: DraftSaveOutcome;
  /**
   * False when the response acknowledges text the editor has since moved past:
   * the radiologist typed while the request was in flight, and what is on the
   * server is a stale rescue point rather than the report.
   */
  ackCoversNewestText: boolean;
  /** The dirty flag may be cleared only by an ack that covers the newest text. */
  clearDirty: boolean;
};

/**
 * What one save response means for the editor, evaluated against the LIVE store
 * at acknowledgement time rather than against the request's own snapshot.
 * Extracted so the hook's wiring is executed, not asserted from source strings
 * (the repo has no DOM/React harness — see refusedSaveIsNotAFailedSave.test.ts
 * for the same idiom).
 */
export function evaluateDraftSaveAck(
  outcome: DraftSaveOutcome,
  sent: ClinicalTextsAtSave,
  liveNow: ClinicalTextsAtSave,
): DraftSaveAckEffects {
  const ackCoversNewestText = clinicalTextsPersistedAck(sent, liveNow);
  return {
    outcome,
    ackCoversNewestText,
    clearDirty: outcome.clearDirty && ackCoversNewestText,
  };
}
