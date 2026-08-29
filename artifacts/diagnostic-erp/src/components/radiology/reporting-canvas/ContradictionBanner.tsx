/**
 * Contradiction + stale banners for Reporting Canvas R2.
 * Never silently resolves — surfaces validateReport / impression refresh only.
 */

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

export function ImpressionStaleBanner({
  needsRefresh,
  onRefresh,
  disabled,
}: {
  needsRefresh: boolean;
  onRefresh: () => void;
  disabled?: boolean;
}) {
  if (!needsRefresh) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-[10px] text-amber-950"
      data-testid="impression-stale-banner"
    >
      <span className="font-bold">⚠ Impression needs refresh</span>
      <button
        type="button"
        className="rounded bg-amber-600 px-2 py-0.5 text-[9px] font-semibold text-white disabled:opacity-40"
        disabled={disabled}
        onClick={onRefresh}
        data-testid="refresh-impression-from-findings"
      >
        Refresh from Finding
      </button>
    </div>
  );
}
