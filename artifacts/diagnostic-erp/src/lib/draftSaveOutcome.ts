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

export type DraftSaveResponse = {
  success?: boolean;
  draft?: { id: number };
  id?: number;
  /** Set when the narrative columns saved but structured_json did not. */
  structuredJsonPersistFailed?: boolean;
};

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
