/**
 * First-class whole-report Format control for the main reporting canvas.
 * Lives below Demography and before Region / Clinical History.
 * Reuses the same Zustand applyFormatById engine as the right-rail picker.
 */

import { useEffect, useMemo, useState } from "react";
import { useWorkspace, useWorkspaceSelector } from "@/lib/zai-workspace/store";
import { lookupFormatsForPicker } from "@/lib/zai-workspace/report-formats-library";
import type { ReportingStudyContext } from "@/lib/reportingStudyContext";
import { FileText } from "lucide-react";
import { REPORT_FORMAT_SETTINGS } from "@/lib/reportSectionAccordion";
import { SectionSettingsLink } from "@/components/radiology/zai-workspace/section-settings-link";
import { Button } from "@/components/ui/button";

export type WholeReportFormatControlProps = {
  reportingContext: ReportingStudyContext;
  modality?: string | null;
  bodyPartFallback?: string | null;
  studyDescription?: string | null;
  disabled?: boolean;
  /** When true (or a format is already applied), render a compact bar instead of the large starter card. */
  hasReportContent?: boolean;
};

export function WholeReportFormatControl({
  reportingContext,
  modality,
  bodyPartFallback,
  studyDescription,
  disabled,
  hasReportContent = false,
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
  const rankedFormats = useMemo(
    () => [...formats].sort((a, b) =>
      Number(Boolean(b.baselineManifest)) - Number(Boolean(a.baselineManifest))),
    [formats],
  );
  const preferred = rankedFormats.find((f) => f.baselineManifest) ?? rankedFormats[0] ?? null;
  const [selectedId, setSelectedId] = useState("");
  useEffect(() => {
    if (!selectedId || !rankedFormats.some((f) => f.id === selectedId)) {
      setSelectedId(preferred?.id ?? "");
    }
  }, [preferred?.id, rankedFormats, selectedId]);
  const locked = Boolean(disabled || isFinalized);
  const appliedLabel = appliedFormatName || appliedFormatReportTitle;

  const compact = Boolean(appliedLabel || hasReportContent);

  if (compact) {
    return (
      <div
        className="flex flex-wrap items-center gap-2 rounded-md border border-border/70 bg-card px-2.5 py-1.5"
        data-testid="whole-report-format-control"
        data-compact="true"
      >
        <FileText className="h-3.5 w-3.5 shrink-0 text-emerald-700" />
        <span className="shrink-0 text-[11px] font-semibold text-foreground/90">Report Format</span>
        {appliedLabel ? (
          <span
            className="min-w-0 flex-1 truncate rounded border border-emerald-200/80 bg-emerald-50/80 px-1.5 py-0.5 text-[10px] text-emerald-900"
            data-testid="r2-applied-format"
            title="Last applied whole-report format"
          >
            <span className="font-semibold">Applied:</span> {appliedLabel}
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
            Change format anytime — patient / DICOM identity stay the same
          </span>
        )}
        <select
          className="h-8 min-w-[11rem] max-w-[18rem] flex-1 rounded-md border border-border bg-background px-2 text-[11px] font-medium"
          value={selectedId}
          disabled={locked || formats.length === 0}
          onChange={(e) => setSelectedId(e.target.value)}
          data-testid="whole-report-format-select"
          aria-label="Whole report format"
          title="One click applies reporting region (when unambiguous), title, technique, findings, impression, and recommendation"
        >
          {rankedFormats.length === 0 ? <option value="">
            {formats.length === 0
              ? "No formats for this modality"
              : appliedLabel
                ? "Replace format…"
                : "Select format…"}
          </option> : null}
          {rankedFormats.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
              {f.baselineManifest ? " · owned baseline" : ""}
              {f.bodyPart ? ` · ${f.bodyPart}` : ""}
              {f.reportTitle ? ` · ${f.reportTitle}` : ""}
            </option>
          ))}
        </select>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 shrink-0 text-[10px]"
          disabled={locked || !selectedId}
          onClick={() => selectedId && applyFormatById(selectedId)}
          data-testid="apply-full-report"
        >
          Apply Full Report
        </Button>
        <SectionSettingsLink
          {...REPORT_FORMAT_SETTINGS}
          testId="report-format-settings-link"
          iconOnly
        />
      </div>
    );
  }

  // Empty-study starter: keep it discoverable but visually quieter than
  // Findings / Impression — radiologists were reading the green hero card as
  // the main work surface even mid-report.
  return (
    <div
      className="space-y-1 rounded-md border border-border/70 bg-card px-2.5 py-2"
      data-testid="whole-report-format-control"
      data-compact="false"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[11px] font-semibold tracking-tight text-foreground/85">
            Report Format
          </span>
          <span className="text-[10px] text-muted-foreground">optional seed</span>
          <SectionSettingsLink
            {...REPORT_FORMAT_SETTINGS}
            testId="report-format-settings-link"
            iconOnly
          />
        </div>
      </div>
      <select
        className="h-8 w-full min-w-[14rem] rounded-md border border-border bg-background px-2 text-[12px] font-medium"
        value={selectedId}
        disabled={locked || formats.length === 0}
        onChange={(e) => setSelectedId(e.target.value)}
        data-testid="whole-report-format-select"
        aria-label="Whole report format"
        title="One click applies reporting region (when unambiguous), title, technique, findings, impression, and recommendation"
      >
        {rankedFormats.length === 0 ? <option value="">
          {formats.length === 0
            ? "No formats for this modality yet"
            : "Optional — seed Technique / Findings / Impression…"}
        </option> : null}
        {rankedFormats.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
            {f.baselineManifest ? " · owned baseline" : ""}
            {f.bodyPart ? ` · ${f.bodyPart}` : ""}
            {f.reportTitle ? ` · ${f.reportTitle}` : ""}
          </option>
        ))}
      </select>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground">
          {preferred?.baselineManifest
            ? "Recommended normal canvas · concept-owned and reversible"
            : "Legacy narrative format · replacement ownership unavailable"}
        </span>
        <Button
          type="button"
          size="sm"
          className="h-8 shrink-0 bg-emerald-600 text-[11px] hover:bg-emerald-700"
          disabled={locked || !selectedId}
          onClick={() => selectedId && applyFormatById(selectedId)}
          data-testid="apply-full-report"
        >
          Apply Full Report
        </Button>
      </div>
    </div>
  );
}
