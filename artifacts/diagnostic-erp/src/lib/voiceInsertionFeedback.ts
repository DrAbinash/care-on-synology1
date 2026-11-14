import type { QuickToggleOutcome } from "@/lib/zai-workspace/quickSelectTilePayload";

/**
 * What the voice bar answers a Quick Select command with.
 *
 * `useVoiceSession` renders this answer as the `✓`/`✗` line in the voice command
 * bar (`VoiceCommandBar.tsx:162`) and, when `ok` is true and an `undo` came back,
 * arms the bar's Undo button. `useVoiceReporting` used to call the toggle and
 * discard the verdict it returns — `"refused"` for a `{side}` nobody chose, for a
 * `{size}` no chip offers, for a sentence already in the report, and (once the
 * contrast rule sits at the write boundary) for a contrast-only box on a study
 * reported without contrast; `"pending"` for the overwrite dialog that has not
 * been answered yet — and then return `ok: true, message: 'Selected "…"'` for
 * every one of them (`ba207aa62`, `useVoiceReporting.ts:294-297` and `:151-164`).
 *
 * So the bar said `✓ Selected "Glioma recurrence"` over a report that does not
 * contain it, while the boundary's own toast three feet away said nothing was
 * written. A radiologist who dictated the next sentence from the finding they
 * heard they had just added has no reason to look for the contradiction.
 *
 * These two functions hold only the wording. The verdict comes from the store
 * boundary, which is the thing that actually knows.
 */

export type VoiceInsertionReport = { ok: boolean; message: string };

/**
 * One box, one click.
 *
 * `"applied"` and `"removed"` are the two verdicts that changed the report.
 * `"refused"` changed nothing and says so in the same voice the boundary's own
 * toast uses, without restating its reason — the toast already named it, and two
 * sentences on screen push each other off. `"pending"` is the overwrite
 * confirmation dialog: nothing is written until somebody answers it on screen,
 * so the voice bar cannot claim the finding is in the report and must not offer
 * an undo of a write that has not happened.
 */
export function describeQuickSelectOutcome(
  outcome: QuickToggleOutcome,
  label: string,
  nowSelected: boolean,
): VoiceInsertionReport {
  if (outcome === "refused") {
    return {
      ok: false,
      message: `“${label}” was not ${nowSelected ? "added" : "removed"} — the report is unchanged`,
    };
  }
  if (outcome === "pending") {
    return {
      ok: false,
      message: `“${label}” needs the on-screen confirmation first — nothing has been written yet`,
    };
  }
  return {
    ok: true,
    message: `${nowSelected ? "Selected" : "Removed"} “${label}”`,
  };
}

/**
 * The dictation path's verdicts: one spoken sentence can match several boxes.
 *
 * Partial is the case that used to be invisible. The loop counted every box it
 * had clicked as applied, so a click that landed on two boxes and was refused on
 * a third said "Applied A · B · C" — and the report said A and B.
 *
 * Returns `null` when nothing was clicked at all: that is not a refusal, it is
 * the already-selected case, and its caller falls through to inserting the
 * dictated words as text, which is what that path has always done.
 */
export function summarizeCatalogApplyOutcomes(
  applied: readonly string[],
  withheld: readonly string[],
  awaiting: readonly string[],
): VoiceInsertionReport | null {
  if (applied.length === 0 && withheld.length === 0 && awaiting.length === 0) return null;
  const quoted = withheld.map((w) => `“${w}”`).join(" · ");
  const refusedSentence = withheld.length === 0 ? ""
    : `Nothing was applied — ${quoted} ${withheld.length === 1 ? "was" : "were"} not added`;
  const pendingSentence = awaiting.length === 0 ? ""
    : `${awaiting.map((w) => `“${w}”`).join(" · ")} ${awaiting.length === 1 ? "needs" : "need"} the on-screen confirmation first`;
  const said = [refusedSentence, pendingSentence].filter(Boolean);
  if (applied.length === 0) {
    return { ok: false, message: said.join(". ") };
  }
  return {
    ok: true,
    message: [
      `Applied ${applied.map((w) => `“${w}”`).join(" · ")}`,
      withheld.length > 0 ? `not added: ${quoted}` : "",
      awaiting.length > 0 ? pendingSentence : "",
    ].filter(Boolean).join(". "),
  };
}
