/**
 * Contradiction + stale banners for Reporting Canvas R2.
 * Never silently resolves — surfaces validateReport / impression refresh only.
 */
import { useState } from "react";

export function ContradictionBanner({
  warnings,
}: {
  warnings: string[];
}) {
  if (warnings.length === 0) return null;
  return (
    <div
      className="rounded-md border border-rose-300 bg-rose-50 px-2 py-1.5 text-[10px] text-rose-950"
      data-testid="contradiction-banner"
      role="status"
    >
      <div className="font-bold uppercase tracking-wide text-rose-800">Contradiction</div>
      <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
        {warnings.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
      <p className="mt-1 text-[9px] text-rose-800/80">
        Never auto-resolved — choose Keep / Edit / Refresh intentionally.
      </p>
    </div>
  );
}

/**
 * Phase 3, item D — the stale banner asks before it overwrites.
 *
 * The radiologist's Conclusion is manual when this banner is visible, so the
 * single "Refresh from Finding" press used to be a one-click overwrite of a
 * doctor's own words with no preview at all. The flow is now explicit, and the
 * component stays dumb: `onPreview` returns the derived text (the store's
 * read-only `previewImpressionFromLedger` — the same derivation the Accept
 * button's Refresh runs), `onRefresh` accepts it, and `onKeepEdit` keeps the
 * manual wording (the store's `markImpressionReviewed`, which records the
 * decision against the clinical content and re-arms only when Findings
 * change again).
 */
export function ImpressionStaleBanner({
  needsRefresh,
  onRefresh,
  onPreview,
  onKeepEdit,
  disabled,
}: {
  needsRefresh: boolean;
  onRefresh: () => void;
  /** Read-only derivation of what Accept would write; null/undefined hides the preview door. */
  onPreview?: () => { next: string; refused: string | null } | undefined;
  /** Records "the Conclusion stands as written"; disarms the banner until Findings change. */
  onKeepEdit?: () => void;
  disabled?: boolean;
}) {
  const [previewText, setPreviewText] = useState<string | null>(null);
  if (!needsRefresh) return null;
  return (
    <div
      className="space-y-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-[10px] text-amber-950"
      data-testid="impression-stale-banner"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold">⚠ Impression may be stale</span>
        <button
          type="button"
          className="rounded border border-amber-400 bg-white/70 px-2 py-0.5 text-[9px] font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-40"
          disabled={disabled || !onPreview}
          onClick={() => {
            const p = onPreview?.();
            if (p?.refused) return;
            setPreviewText(p?.next ?? null);
          }}
          data-testid="preview-impression-update"
        >
          Preview update
        </button>
        {onKeepEdit ? (
          <button
            type="button"
            className="rounded border border-amber-400 bg-white/70 px-2 py-0.5 text-[9px] font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-40"
            disabled={disabled}
            onClick={onKeepEdit}
            data-testid="keep-manual-impression"
          >
            Keep my edit
          </button>
        ) : null}
      </div>
      {previewText !== null && (
        <div
          className="rounded border border-amber-200 bg-white/80 px-2 py-1.5"
          data-testid="impression-refresh-preview"
        >
          <div className="font-semibold text-amber-900">Derived from your findings:</div>
          <div className="mt-0.5 whitespace-pre-wrap text-[10px] leading-relaxed text-amber-950">
            {previewText.trim() || "(no abnormal conclusion is derivable — nothing would be written)"}
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <button
              type="button"
              className="rounded bg-amber-600 px-2 py-0.5 text-[9px] font-semibold text-white hover:bg-amber-700 disabled:opacity-40"
              disabled={disabled}
              onClick={onRefresh}
              data-testid="refresh-impression-from-findings"
            >
              Accept update
            </button>
            <button
              type="button"
              className="rounded border border-amber-400 px-2 py-0.5 text-[9px] font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-40"
              disabled={disabled}
              onClick={() => setPreviewText(null)}
              data-testid="dismiss-impression-preview"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
