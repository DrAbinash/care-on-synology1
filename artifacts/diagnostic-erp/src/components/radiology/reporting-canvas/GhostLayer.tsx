/**
 * MRI Ghost Layer — presentation over the existing ghostText / acceptGhostText.
 * AI never commits without explicit Accept, and (C2) never commits at all once the
 * report state it was generated from has changed.
 *
 * This component READS the staleness verdict; it does not decide anything. The
 * verdict lives in `zai-workspace/aiProposalContext`, and acceptance re-checks it
 * there independently of what this render shows — so a stale suggestion that
 * reaches `acceptGhostText` by Tab, the command palette or any future caller is
 * refused by the same rule, and this banner is only the courteous version of it.
 *
 * Five different things can be wrong with a suggestion, and they are deliberately
 * shown in different places with different words, because a radiologist who cannot
 * tell them apart will dismiss the one that matters:
 *   STALE (this amber block)        — the report changed underneath the proposal;
 *   provider/model failure          — a destructive toast: "No usable AI response";
 *   nothing to parse                — the same toast, the same sentence;
 *   grounding warning               — a toast: "AI impression needs verification";
 *   cross-study arrival             — a toast: "AI impression discarded".
 * The two middle rows share a sentence on purpose (lib/aiUsableResult.ts): nothing
 * arrived, the report is untouched, and the clinician's next action is identical
 * whether the provider answered empty or answered prose. Which of the two it was is
 * a fact about the request, and it is filed in the AI audit log against the
 * request's id rather than decoded at the reporting keyboard.
 * Staleness is the only one of these that is a property of the proposal rather
 * than of the request, so it is the only one that renders here instead of in a
 * toast that fades.
 */

import { useWorkspace } from "@/lib/zai-workspace/store";
import { ActiveAnchorChip } from "./ActiveAnchorChip";

/** Copy per reason. Field names and reasons only — never report content. */
const STALE_COPY: Record<string, string> = {
  "source-changed": "The report changed after this was generated, so it may describe text that is no "
    + "longer in the Findings.",
  "study-changed": "This was generated while a different study was open.",
  "invalid-target": "This has no valid destination field in the report.",
  "unbound": "This carries no record of the report state it was generated from, so it cannot be "
    + "shown to be current.",
};

export function GhostLayer({
  contradictionHints,
}: {
  /** Deterministic contradiction ghosts from validateReport. */
  contradictionHints?: string[];
}) {
  const ghostText = useWorkspace((s) => s.ghostText);
  const ghostTarget = useWorkspace((s) => s.ghostTextTarget);
  const activeAnchor = useWorkspace((s) => s.activeAnchor);
  const accept = useWorkspace((s) => s.acceptGhostText);
  const setGhost = useWorkspace((s) => s.setGhostText);
  // Reading `ghostProposal` is what makes this re-render when a new suggestion
  // lands; the verdict itself is recomputed by the store on every read, so there
  // is no stored stale-flag to go out of date (which would need its own guard).
  const proposal = useWorkspace((s) => s.ghostProposal);
  const stale = useWorkspace((s) => s.ghostProposalStale());
  const staleReason = useWorkspace((s) => s.ghostProposalStaleReason());
  const regenerate = useWorkspace((s) => s.triggerAiImpression);

  const staleCopy = STALE_COPY[staleReason ?? "unbound"] ?? STALE_COPY.unbound;

  return (
    <div className="space-y-1.5" data-testid="ghost-layer">
      {ghostText && ghostTarget ? (
        <div
          className={
            stale
              ? "rounded-md border border-dashed border-amber-400 bg-amber-50/70 px-2 py-1.5"
              : "rounded-md border border-dashed border-violet-400 bg-violet-50/60 px-2 py-1.5"
          }
          data-testid="completion-ghost"
          data-stale={stale ? "true" : "false"}
        >
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span
              className={
                stale
                  ? "text-[9px] font-bold uppercase tracking-wide text-amber-800"
                  : "text-[9px] font-bold uppercase tracking-wide text-violet-800"
              }
            >
              {stale ? "Out of date · " : "Completion Ghost · "}
              {ghostTarget}
            </span>
            <ActiveAnchorChip anchor={activeAnchor} compact />
          </div>
          <p
            className={
              stale
                ? "text-[10px] italic text-stone-500 line-through decoration-amber-400/70"
                : "text-[10px] italic text-violet-950/80"
            }
          >
            {ghostText}
          </p>
          {stale ? (
            <>
              <p className="mt-1 text-[9px] font-semibold text-amber-900" data-testid="ghost-stale-reason">
                {staleCopy}
              </p>
              <div className="mt-1.5 flex gap-1.5">
                <button
                  type="button"
                  className="h-6 rounded bg-amber-600 px-2 text-[9px] font-semibold text-white"
                  onClick={() => void regenerate?.()}
                  data-testid="ghost-regenerate"
                >
                  Regenerate from current report
                </button>
                <button
                  type="button"
                  className="h-6 rounded border border-amber-300 px-2 text-[9px] font-semibold text-amber-900"
                  onClick={() => setGhost(null, null)}
                  data-testid="ghost-discard"
                >
                  Discard (Esc)
                </button>
              </div>
              <p className="mt-1 text-[8px] text-amber-800/80">
                Not acceptable — there is no way to insert an out-of-date suggestion. Regenerating
                sends the current report to the model; nothing changes until you accept what comes back.
              </p>
            </>
          ) : (
            <>
              <div className="mt-1.5 flex gap-1.5">
                <button
                  type="button"
                  className="h-6 rounded bg-violet-600 px-2 text-[9px] font-semibold text-white"
                  onClick={() => accept()}
                  data-testid="ghost-accept"
                >
                  Accept (Tab)
                </button>
                <button
                  type="button"
                  className="h-6 rounded border border-violet-300 px-2 text-[9px] font-semibold text-violet-800"
                  onClick={() => setGhost(null, null)}
                  data-testid="ghost-dismiss"
                >
                  Dismiss (Esc)
                </button>
              </div>
              <p className="mt-1 text-[8px] text-violet-700/70">
                Not in ledger until Accept · uses ai-draft provenance
                {proposal ? ` · generated from the current ${proposal.sourceField}` : ""}
              </p>
            </>
          )}
        </div>
      ) : null}

      {(contradictionHints ?? []).length > 0 ? (
        <div
          className="rounded-md border border-dashed border-rose-300 bg-rose-50/50 px-2 py-1.5"
          data-testid="contradiction-ghost"
        >
          <div className="text-[9px] font-bold uppercase tracking-wide text-rose-800">
            Contradiction Ghost
          </div>
          <ul className="mt-0.5 list-disc pl-4 text-[10px] text-rose-950">
            {(contradictionHints ?? []).map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
          <p className="mt-1 text-[8px] text-rose-700/80">
            Deterministic validation — edit Findings or Impression deliberately. No silent resolve.
          </p>
        </div>
      ) : null}
    </div>
  );
}
