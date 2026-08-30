/**
 * First-class whole-report Format control for the main reporting canvas.
 * Lives below Demography and before Region / Clinical History.
 * Reuses the same Zustand applyFormatById engine as the right-rail picker.
 */

import { useMemo } from "react";
import { useWorkspace, useWorkspaceSelector } from "@/lib/zai-workspace/store";
import { lookupFormatsForPicker } from "@/lib/zai-workspace/report-formats-library";
import type { ReportingStudyContext } from "@/lib/reportingStudyContext";
import { FileText } from "lucide-react";

export type WholeReportFormatControlProps = {
  reportingContext: ReportingStudyContext;
  modality?: string | null;
  bodyPartFallback?: string | null;
  studyDescription?: string | null;
  disabled?: boolean;
};

export function WholeReportFormatControl({
  reportingContext,
  modality,
  bodyPartFallback,
  studyDescription,
  disabled,
}: WholeReportFormatControlProps) {
  const reportFormats = useWorkspaceSelector((s) => s.reportFormats);
  const appliedFormatName = useWorkspaceSelector((s) => s.appliedFormatName);
  const appliedFormatReportTitle = useWorkspaceSelector((s) => s.appliedFormatReportTitle);
  const applyFormatById = useWorkspace((s) => s.applyFormatById);
  const isFinalized = useWorkspaceSelector((s) => s.isFinalized);
  const activeStudy = useWorkspaceSelector((s) => s.studies.find((x) => x.id === s.activeStudyId));
  const effectiveModality = (modality ?? activeStudy?.modality ?? null) as
    | "MR"
    | "CT"
    | "US"
    | "XR"
    | "MG"
    | null;

  const formatLookup = useMemo(
    () =>
      lookupFormatsForPicker(
        reportFormats,
        effectiveModality ?? undefined,
        reportingContext,
        {
          protocolName: reportingContext.protocolName,
          studyDescription:
            reportingContext.studyDescription
            ?? studyDescription
            ?? activeStudy?.studyDescription
            ?? undefined,
          bodyPartFallback: bodyPartFallback ?? reportingContext.region ?? activeStudy?.bodyPart,
        },
      ),
    [reportFormats, effectiveModality, reportingContext, studyDescription, bodyPartFallback, activeStudy],
  );

  // Primary one-click selector must include cross-region formats for this modality
  // so Format can establish reporting region (Brain → LS Spine) without a prior
  // region pick. Region-scoped hits stay ranked first via formatContextRank.
  const formats = useMemo(() => {
    if (!effectiveModality) return formatLookup.formats;
    if (formatLookup.scope === "modality") return formatLookup.formats;
    const allModality = reportFormats.filter((f) => f.modality === effectiveModality);
    if (allModality.length <= formatLookup.formats.length) return formatLookup.formats;
    const preferred = new Set(formatLookup.formats.map((f) => f.id));
    const rest = allModality.filter((f) => !preferred.has(f.id));
    return [...formatLookup.formats, ...rest];
  }, [effectiveModality, formatLookup, reportFormats]);
  const locked = Boolean(disabled || isFinalized);
  const appliedLabel = appliedFormatName || appliedFormatReportTitle;

  return (
    <div
      className="space-y-1.5 rounded-md border border-emerald-300/70 bg-gradient-to-r from-emerald-50/70 via-card to-emerald-50/30 px-3 py-2.5 shadow-sm"
      data-testid="whole-report-format-control"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5 text-emerald-700" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-800">
            Report Format
          </span>
        </div>
        {appliedLabel ? (
          <span
            className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-800"
            data-testid="r2-applied-format"
            title="Last applied whole-report format"
          >
            <span className="font-semibold">Applied:</span> {appliedLabel}
          </span>
        ) : null}
      </div>
      <select
        className="h-9 w-full min-w-[14rem] rounded-md border border-emerald-200 bg-background px-2 text-[12px] font-medium shadow-sm"
        value=""
        disabled={locked || formats.length === 0}
        onChange={(e) => {
          const id = e.target.value;
          if (id) applyFormatById(id);
          e.currentTarget.value = "";
        }}
        data-testid="whole-report-format-select"
        aria-label="Whole report format"
        title="One click applies reporting region (when unambiguous), title, technique, findings, impression, and recommendation"
      >
        <option value="">
          {formats.length === 0
            ? "No whole-report formats for this modality yet"
            : "Select a report format to start…"}
        </option>
        {formats.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
            {f.bodyPart ? ` · ${f.bodyPart}` : ""}
            {f.reportTitle ? ` · ${f.reportTitle}` : ""}
          </option>
        ))}
      </select>
      <p className="text-[10px] leading-snug text-muted-foreground">
        One click sets the starting report — region, title, and clinical sections — when the format maps cleanly.
        Does not change patient or DICOM identity.
      </p>
    </div>
  );
}
