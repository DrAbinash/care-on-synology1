import { Activity, AlertTriangle, CheckCircle2, ClipboardList, Ruler } from "lucide-react";
import { Button } from "@/components/ui/button";

export type MriReadinessStripProps = {
  studyRegion: string | null;
  protocolName: string | null;
  protocolApplied: boolean;
  templateName: string | null;
  templateMismatch: boolean;
  priorCount: number;
  pendingMeasurements: number;
  checklistPercent: number | null;
  qualityScore: number;
  disabled?: boolean;
  onOpenTab: (tab: string) => void;
};

/** Compact MRI readiness checklist — parity with USG Companion at a glance. */
export default function MriReadinessStrip({
  studyRegion,
  protocolName,
  protocolApplied,
  templateName,
  templateMismatch,
  priorCount,
  pendingMeasurements,
  checklistPercent,
  qualityScore,
  disabled,
  onOpenTab,
}: MriReadinessStripProps) {
  const items = [
    {
      ok: protocolApplied,
      label: protocolName ? `Protocol: ${protocolName}` : "Protocol not applied",
      action: () => onOpenTab("quickselect"),
    },
    {
      ok: !!templateName && !templateMismatch,
      label: templateName
        ? (templateMismatch ? `Template mismatch: ${templateName}` : `Template: ${templateName}`)
        : "No template",
      action: () => onOpenTab("templates"),
    },
    {
      ok: priorCount === 0 || priorCount > 0,
      warn: priorCount > 0,
      label: priorCount > 0 ? `${priorCount} prior report${priorCount > 1 ? "s" : ""}` : "No priors",
      action: () => onOpenTab("prior"),
    },
    {
      ok: pendingMeasurements === 0,
      warn: pendingMeasurements > 0,
      label: pendingMeasurements > 0 ? `${pendingMeasurements} pending measurement${pendingMeasurements > 1 ? "s" : ""}` : "Measurements clear",
      action: () => onOpenTab("measurements"),
    },
  ];

  const ready = protocolApplied && !!templateName && !templateMismatch && pendingMeasurements === 0;

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 px-1.5 py-1 rounded-md border border-violet-200 bg-violet-50/70 text-[11px] shrink-0"
      data-testid="mri-readiness-strip"
    >
      <Activity size={14} className="text-violet-600 shrink-0" />
      <span className="font-semibold text-violet-900">
        MRI readiness{studyRegion ? ` · ${studyRegion}` : ""}
      </span>
      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium border ${
        ready ? "bg-emerald-100 text-emerald-800 border-emerald-200" : "bg-amber-100 text-amber-800 border-amber-200"
      }`}>
        {ready ? "Ready to report" : "Setup needed"}
      </span>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          disabled={disabled}
          onClick={item.action}
          className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 border text-[10px] transition-colors disabled:opacity-50 ${
            item.ok && !item.warn
              ? "bg-white/80 border-emerald-200 text-emerald-800"
              : item.warn
                ? "bg-amber-50 border-amber-200 text-amber-800"
                : "bg-white/80 border-red-200 text-red-700"
          }`}
        >
          {item.ok && !item.warn ? <CheckCircle2 size={10} /> : <AlertTriangle size={10} />}
          {item.label}
        </button>
      ))}
      {checklistPercent != null && (
        <span className="text-violet-800/80 flex items-center gap-0.5">
          <ClipboardList size={10} /> Checklist {checklistPercent}%
        </span>
      )}
      <span className="text-violet-800/80 ml-auto">Quality {qualityScore}/100</span>
      {pendingMeasurements > 0 && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-6 text-[10px] border-violet-300"
          disabled={disabled}
          onClick={() => onOpenTab("measurements")}
        >
          <Ruler size={10} className="mr-0.5" /> Review measurements
        </Button>
      )}
    </div>
  );
}
