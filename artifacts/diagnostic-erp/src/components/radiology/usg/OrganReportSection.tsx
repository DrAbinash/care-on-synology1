/**
 * OrganReportSection — one organ's block in the center report column (P0/P1).
 * Renders the (editable) prose, the structured finding chips, and a per-organ
 * "Normal" control. The section text stays the radiologist's to edit; the
 * builder appends to it non-destructively and never rewrites it silently.
 */

import { effectiveFindingText } from "@/lib/usgFindingBuilder";
import { organStatus, type UsgOrganSection, type OrganStatus } from "@/lib/usgReportComposer";

export interface OrganReportSectionProps {
  section: UsgOrganSection;
  active: boolean;
  onActivate: () => void;
  onChangeText: (text: string) => void;
  onMarkNormal: () => void;
  onRemoveFinding: (index: number) => void;
  readOnly?: boolean;
}

const PILL: Record<OrganStatus, string> = {
  untouched: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  normal: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  abnormal: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  incomplete: "bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300",
};

export default function OrganReportSection({
  section, active, onActivate, onChangeText, onMarkNormal, onRemoveFinding, readOnly,
}: OrganReportSectionProps) {
  const status = organStatus(section);
  return (
    <div
      onClick={onActivate}
      className={[
        "rounded-lg border p-3 transition-colors cursor-pointer",
        active ? "border-teal-400 ring-1 ring-teal-300/50" : "border-slate-200 dark:border-slate-700",
        status === "abnormal" ? "bg-amber-50/40 dark:bg-amber-950/10" : "bg-white dark:bg-slate-900/30",
      ].join(" ")}
      data-testid={`usg-organ-section-${section.organ}`}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className="font-semibold text-sm text-slate-800 dark:text-slate-100">{section.label}</span>
        <span className={`text-[10px] font-medium rounded-full px-2 py-0.5 ${PILL[status]}`}>{status}</span>
        <div className="flex-1" />
        {!readOnly && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onMarkNormal(); }}
            className="text-xs rounded px-2 py-0.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100"
            title="Insert this organ's normal statement (N)"
          >
            Normal
          </button>
        )}
      </div>

      {section.findings.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {section.findings.map((f, i) => (
            <span key={i} className="inline-flex items-center gap-1 text-[11px] rounded-full bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-200 px-2 py-0.5"
              title={effectiveFindingText(f)}>
              {f.findingType}
              {!readOnly && (
                <button type="button" onClick={(e) => { e.stopPropagation(); onRemoveFinding(i); }}
                  className="text-amber-500 hover:text-amber-700" aria-label={`Remove ${f.findingType}`}>×</button>
              )}
            </span>
          ))}
        </div>
      )}

      <textarea
        value={section.text}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onChangeText(e.target.value)}
        readOnly={readOnly}
        rows={Math.max(2, section.text.split("\n").length)}
        placeholder={`${section.label} findings…`}
        className="w-full resize-y rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-teal-400"
      />
    </div>
  );
}
