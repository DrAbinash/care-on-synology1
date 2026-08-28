/**
 * MRI Ghost Layer — presentation over existing ghostText / acceptGhostText.
 * AI never commits without explicit Accept.
 */

import { useWorkspace } from "@/lib/zai-workspace/store";
import { ActiveAnchorChip } from "./ActiveAnchorChip";

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

  return (
    <div className="space-y-1.5" data-testid="ghost-layer">
      {ghostText && ghostTarget ? (
        <div
          className="rounded-md border border-dashed border-violet-400 bg-violet-50/60 px-2 py-1.5"
          data-testid="completion-ghost"
        >
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="text-[9px] font-bold uppercase tracking-wide text-violet-800">
              Completion Ghost · {ghostTarget}
            </span>
            <ActiveAnchorChip anchor={activeAnchor} compact />
          </div>
          <p className="text-[10px] italic text-violet-950/80">{ghostText}</p>
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
          </p>
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
