/**
 * ReportLayoutQuickSelect — Classic vs Premium presentation tabs.
 *
 * Used in preview surfaces (per-session ?template= override) and in admin
 * settings (activates the clinic-wide standard template).
 */

export type ReportLayoutKey = "care-classic" | "care-premium";

export const REPORT_LAYOUT_OPTIONS: ReadonlyArray<{
  key: ReportLayoutKey;
  label: string;
  shortLabel: string;
}> = [
  { key: "care-classic", label: "Classic", shortLabel: "Classic" },
  { key: "care-premium", label: "Premium", shortLabel: "✦ Premium" },
];

export function isReportLayoutKey(value: string | null | undefined): value is ReportLayoutKey {
  return value === "care-classic" || value === "care-premium";
}

/** Map any active template key to the nearest quick-select option. */
export function quickSelectLayoutKey(activeKey: string | null | undefined): ReportLayoutKey {
  return activeKey === "care-premium" ? "care-premium" : "care-classic";
}

export function reportLayoutTemplateQuery(key: ReportLayoutKey): string {
  return `template=${encodeURIComponent(key)}`;
}

interface ReportLayoutQuickSelectProps {
  value: ReportLayoutKey;
  onChange: (key: ReportLayoutKey) => void;
  /** Clinic-wide active template — tab shows a small "Active" hint when it matches. */
  activeKey?: string | null;
  disabled?: boolean;
  className?: string;
}

export default function ReportLayoutQuickSelect({
  value,
  onChange,
  activeKey,
  disabled = false,
  className = "",
}: ReportLayoutQuickSelectProps) {
  const clinicActive = quickSelectLayoutKey(activeKey);

  return (
    <div
      className={`flex items-center gap-2 ${className}`}
      role="tablist"
      aria-label="Report layout"
    >
      {REPORT_LAYOUT_OPTIONS.map((opt) => {
        const selected = value === opt.key;
        const isClinicDefault = clinicActive === opt.key;
        const premium = opt.key === "care-premium";
        return (
          <button
            key={opt.key}
            type="button"
            role="tab"
            aria-selected={selected}
            disabled={disabled}
            className={[
              "flex-1 py-1.5 px-2 text-xs font-semibold border transition-colors disabled:opacity-50",
              opt.key === "care-classic" ? "rounded-l-md" : "rounded-r-md -ml-px",
              selected && premium
                ? "bg-slate-900 text-amber-400 border-amber-600 z-10"
                : selected
                  ? "bg-primary text-primary-foreground border-primary z-10"
                  : "bg-muted text-muted-foreground border-border hover:bg-muted/80",
            ].join(" ")}
            onClick={() => onChange(opt.key)}
          >
            <span>{opt.shortLabel}</span>
            {isClinicDefault && (
              <span className="ml-1 text-[9px] font-normal opacity-80">· Active</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
