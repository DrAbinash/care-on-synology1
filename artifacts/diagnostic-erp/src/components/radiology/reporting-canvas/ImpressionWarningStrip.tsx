import { ContradictionBanner, ImpressionStaleBanner } from "./ContradictionBanner";

/**
 * One impression warning surface: stale (manual impression only) and
 * contradiction. Replaces the separate banners plus the collapsed-header chip.
 *
 * Phase 3, item D: the stale banner now asks before it overwrites a manual
 * Conclusion — `onPreview` returns the read-only derivation of what Accept
 * would write, and `onKeepEdit` records "it stands as written". Both stay
 * optional so non-workspace callers keep the old behaviour.
 */
export function ImpressionWarningStrip({
  showStale,
  warnings,
  onRefresh,
  onPreview,
  onKeepEdit,
  disabled,
}: {
  showStale: boolean;
  warnings: string[];
  onRefresh: () => void;
  onPreview?: () => { next: string; refused: string | null } | undefined;
  onKeepEdit?: () => void;
  disabled?: boolean;
}) {
  if (!showStale && warnings.length === 0) return null;
  return (
    <div className="space-y-1.5" data-testid="impression-warning-strip">
      {showStale ? (
        <ImpressionStaleBanner
          needsRefresh
          disabled={disabled}
          onRefresh={onRefresh}
          onPreview={onPreview}
          onKeepEdit={onKeepEdit}
        />
      ) : null}
      <ContradictionBanner warnings={warnings} />
    </div>
  );
}
