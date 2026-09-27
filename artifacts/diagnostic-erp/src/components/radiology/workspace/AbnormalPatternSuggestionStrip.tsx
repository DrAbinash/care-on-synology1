/**
 * Suggestion-only strip. Apply / Dismiss never call applyMacroBundle.
 * Confirm lives on the merge-preview dialog.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { AbnormalPatternHit } from "@/lib/reporting/abnormalPatterns";
import type { AppliedPatternMarker } from "@/lib/abnormalPatternDraft";

export function AbnormalPatternSuggestionStrip({
  suggestions,
  appliedMarkers,
  suggestionsEnabled,
  contentLocked,
  isFinalized,
  onApply,
  onDismiss,
}: {
  suggestions: AbnormalPatternHit[];
  appliedMarkers: AppliedPatternMarker[];
  suggestionsEnabled: boolean;
  contentLocked: boolean;
  isFinalized: boolean;
  onApply: (patternId: string) => void;
  onDismiss: (patternId: string) => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  if (!suggestionsEnabled || contentLocked || isFinalized) return null;
  const top = suggestions[0];
  const rest = suggestions.slice(1);
  if (!top && appliedMarkers.length === 0) return null;

  return (
    <div
      className="mb-2 rounded-md border border-amber-200 bg-amber-50/70 px-2 py-1.5"
      data-testid="abnormal-pattern-strip"
    >
      {appliedMarkers.map((marker) => (
        <div key={`${marker.patternId}-${marker.version}`} className="mb-1 text-[10px] font-semibold text-amber-900">
          pattern v{marker.version} applied
        </div>
      ))}
      {top && (
        <PatternRow
          hit={top}
          onApply={onApply}
          onDismiss={onDismiss}
          primary
        />
      )}
      {rest.length > 0 && (
        <div className="mt-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-[10px]"
            data-testid="abnormal-pattern-more"
            onClick={() => setMoreOpen((open) => !open)}
          >
            {rest.length} more
          </Button>
          {moreOpen && (
            <div className="mt-1 space-y-1 border-t border-amber-200 pt-1">
              {rest.map((hit) => (
                <PatternRow
                  key={hit.pattern.id}
                  hit={hit}
                  onApply={onApply}
                  onDismiss={onDismiss}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PatternRow({
  hit,
  onApply,
  onDismiss,
  primary = false,
}: {
  hit: AbnormalPatternHit;
  onApply: (patternId: string) => void;
  onDismiss: (patternId: string) => void;
  primary?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-[11px] font-semibold text-amber-950">{hit.pattern.label}</span>
      {hit.reasons.map((reason) => (
        <span
          key={reason}
          className="rounded bg-white/80 px-1 py-0.5 text-[9px] text-amber-900 ring-1 ring-amber-200"
        >
          {reason}
        </span>
      ))}
      {primary ? (
        <>
          <Button
            type="button"
            size="sm"
            className="h-6 px-2 text-[10px]"
            data-testid="abnormal-pattern-apply"
            onClick={() => onApply(hit.pattern.id)}
          >
            Apply
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[10px]"
            data-testid="abnormal-pattern-dismiss"
            onClick={() => onDismiss(hit.pattern.id)}
          >
            Dismiss
          </Button>
        </>
      ) : (
        <>
          <Button type="button" size="sm" className="h-6 px-2 text-[10px]" onClick={() => onApply(hit.pattern.id)}>
            Apply
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => onDismiss(hit.pattern.id)}>
            Dismiss
          </Button>
        </>
      )}
    </div>
  );
}
