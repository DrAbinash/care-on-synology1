/**
 * draftSaveQueue.ts — one console, one draft save in flight per study.
 *
 * WHY THIS EXISTS
 *
 * The reporting workspace has many independent callers of `saveDraft`: the top
 * bar's Save button, the 30-second autosave, four Quick Select pick handlers,
 * the structured-values debounce, the Word export, the composer's Apply, the
 * pre-sign resave and the flush that runs before leaving a study. Nothing
 * ordered them. Measured in the browser against one study opened by one
 * console (tmp/evidence/diag2-cold-hydrate.json), leaving that study fired
 * THREE saves inside 40 ms:
 *
 *   #3 sentAt 01.278  id: null  expectedRevision: "absent"  → 200, created row 3
 *   #4 sentAt 01.315  id: 3     expectedRevision: dr1:4c31… → 200
 *   #5 sentAt 01.316  id: null  expectedRevision: "absent"  → 409 DRAFT_REVISION_CONFLICT
 *
 * All three read the same render closure, so #5 still claimed the study had no
 * draft row one millisecond after #3 created it. Before P0-2 that claim was
 * believed and #5 INSERTed a second row for the same study — the "two rows for
 * one study" fork the `"absent"` token was introduced to prevent. With the
 * token in place the row was protected, but the refusal landed on the flush
 * that runs before a study switch, which reads `null` as "the save failed" and
 * holds the radiologist on the study with "Could not save before leaving. Stay
 * on this study." A guard that protects the report must not trap its reader.
 *
 * THE RULE
 *
 * Saves for one study run strictly one at a time, in the order they were
 * asked for, so every save after the first reads the identity the one before
 * it proved. Saves for different studies are independent: a flush for the
 * study being left must not queue behind a save for the study being opened.
 *
 * This is a CLIENT-side ordering only. It says nothing about another window or
 * another console, which keeps its own queue and its own token — the revision
 * check on the server is still what refuses those.
 */

export type DraftSaveQueue = {
  /**
   * Run `task` once no other save for `studyId` is in flight. Resolves and
   * rejects exactly as `task` does, so every caller keeps the error handling
   * it already has; a task that throws releases the queue rather than wedging
   * the saves behind it.
   *
   * A null study has nothing to order against — there is no row to race for —
   * so it runs immediately.
   */
  run<T>(studyId: number | null | undefined, task: () => Promise<T>): Promise<T>;
};

export function createDraftSaveQueue(): DraftSaveQueue {
  /** The promise the next save for that study has to wait for. */
  const tails = new Map<number, Promise<void>>();

  return {
    run<T>(studyId: number | null | undefined, task: () => Promise<T>): Promise<T> {
      if (studyId == null) return task();

      const previous = tails.get(studyId) ?? Promise.resolve();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      tails.set(studyId, gate);

      // `previous` never rejects: the tail below is the settled form of the
      // save ahead, so a failure there still lets this one run.
      const started = previous.then(task);
      const settle = () => {
        release();
        // Only clear when this is still the tail — a save queued behind this
        // one has already replaced the entry, and deleting it would let a
        // fourth save start concurrently with the third.
        if (tails.get(studyId) === gate) tails.delete(studyId);
      };
      void started.then(settle, settle);
      return started;
    },
  };
}
