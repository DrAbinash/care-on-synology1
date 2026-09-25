import { ContradictionBanner, ImpressionStaleBanner } from "./ContradictionBanner";

/**
 * One impression warning surface: stale (manual impression only) and
 * contradiction. Replaces the separate banners plus the collapsed-header chip.
 */
export function ImpressionWarningStrip({
  showStale,
  warnings,
  onRefresh,
  disabled,
}: {
  showStale: boolean;
  warnings: string[];
  onRefresh: () => void;
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
        />
      ) : null}
      <ContradictionBanner warnings={warnings} />
    </div>
  );
}
