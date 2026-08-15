/**
 * ReportExportPanel — Classic / Premium layout, style prefs, live preview,
 * and Word/PDF export controls for the reporting workspace.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FileDown, Printer, RefreshCw, Eye, Maximize2 } from "lucide-react";
import { api } from "@/lib/fetchApi";
import ReportLayoutQuickSelect, {
  type ReportLayoutKey,
  reportLayoutTemplateQuery,
} from "@/components/radiology/ReportLayoutQuickSelect";
import type {
  ReportHeadingCase,
  ReportSectionSpacing,
  ReportImpressionStyle,
} from "@/lib/radiologyReportPreviewHtml";

export type ReportExportPanelProps = {
  draftId: number | null;
  linkedReportId?: number | null;
  previewHtml: string;
  reportLayout: ReportLayoutKey;
  clinicActiveLayout?: string | null;
  onLayoutChange: (key: ReportLayoutKey) => void;
  headingCase: ReportHeadingCase;
  onHeadingCaseChange: (v: ReportHeadingCase) => void;
  sectionSpacing: ReportSectionSpacing;
  onSectionSpacingChange: (v: ReportSectionSpacing) => void;
  impressionStyle: ReportImpressionStyle;
  onImpressionStyleChange: (v: ReportImpressionStyle) => void;
  onExportWord: () => void | Promise<void>;
  onExportPdf: () => void | Promise<void>;
  /** Draft-only: open print preview without the DRAFT watermark. */
  onPrintLikeFinal?: () => void | Promise<void>;
  exportingWord?: boolean;
  exportingPdf?: boolean;
  printingLikeFinal?: boolean;
  disabled?: boolean;
};

export default function ReportExportPanel({
  draftId,
  linkedReportId,
  previewHtml,
  reportLayout,
  clinicActiveLayout,
  onLayoutChange,
  headingCase,
  onHeadingCaseChange,
  sectionSpacing,
  onSectionSpacingChange,
  impressionStyle,
  onImpressionStyleChange,
  onExportWord,
  onExportPdf,
  onPrintLikeFinal,
  exportingWord,
  exportingPdf,
  printingLikeFinal,
  disabled,
}: ReportExportPanelProps) {
  const [open, setOpen] = useState(true);
  const [previewRefresh, setPreviewRefresh] = useState(0);
  const [enlarged, setEnlarged] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(1);

  const serverPreviewUrl = useMemo(() => {
    const templateQs = reportLayoutTemplateQuery(reportLayout);
    if (linkedReportId) {
      return `/api/patient-reports/${linkedReportId}/print?preview=true&${templateQs}`;
    }
    if (draftId) {
      return `/api/radiology/report-generator/drafts/${draftId}/print-preview?${templateQs}`;
    }
    return null;
  }, [draftId, linkedReportId, reportLayout]);

  const { data: serverHtml, isFetching: serverLoading, refetch } = useQuery<string>({
    queryKey: ["report-export-server-preview", serverPreviewUrl, previewRefresh],
    queryFn: () => api.get<string>(serverPreviewUrl!),
    enabled: (open || enlarged) && !!serverPreviewUrl && reportLayout === "care-premium",
    staleTime: 15_000,
  });

  const showServerPremium = reportLayout === "care-premium" && !!serverPreviewUrl;
  const displayHtml = showServerPremium && serverHtml ? serverHtml : previewHtml;

  return (
    <div className="border rounded-md bg-card shadow-sm" data-testid="report-export-panel">
      <div className="flex items-center justify-between gap-2 px-2 py-1.5 border-b bg-muted/30 flex-wrap">
        <button
          type="button"
          className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground inline-flex items-center gap-1"
          onClick={() => setOpen((v) => !v)}
        >
          <Eye className="h-3 w-3" />
          Report layout & export {open ? "▾" : "▸"}
        </button>
        <div className="flex items-center gap-1 flex-wrap">
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[10px] px-2"
            disabled={disabled || exportingWord}
            onClick={() => void onExportWord()}
            title="Download as Word — same layout as preview"
            data-testid="export-word"
          >
            {exportingWord ? <RefreshCw className="h-3 w-3 mr-1 animate-spin" /> : <FileDown className="h-3 w-3 mr-1" />}
            Word
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[10px] px-2"
            disabled={disabled || exportingPdf}
            onClick={() => void onExportPdf()}
            title="Download PDF including selected report images"
            data-testid="export-pdf"
          >
            {exportingPdf ? <RefreshCw className="h-3 w-3 mr-1 animate-spin" /> : <Printer className="h-3 w-3 mr-1" />}
            PDF
          </Button>
          {onPrintLikeFinal && draftId && !linkedReportId && (
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[10px] px-2"
              disabled={disabled || printingLikeFinal}
              onClick={() => void onPrintLikeFinal()}
              title="Print draft using final layout (no DRAFT watermark)"
              data-testid="print-like-final"
            >
              {printingLikeFinal ? <RefreshCw className="h-3 w-3 mr-1 animate-spin" /> : <Printer className="h-3 w-3 mr-1" />}
              Print like final
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[10px] px-2"
            onClick={() => {
              setOpen(true);
              setEnlarged(true);
            }}
            title="Enlarge report preview to check layout and content before finalize"
            data-testid="report-layout-preview-enlarge-header"
          >
            <Maximize2 className="h-3 w-3 mr-1" />
            Enlarge
          </Button>
        </div>
      </div>

      {open && (
        <div className="p-2 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-semibold text-muted-foreground shrink-0">Layout</span>
            <ReportLayoutQuickSelect
              value={reportLayout}
              activeKey={clinicActiveLayout}
              onChange={onLayoutChange}
              className="max-w-xs flex-1 min-w-[10rem]"
            />
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-[10px]"
                onClick={() => onHeadingCaseChange(headingCase === "all_caps" ? "title_case" : "all_caps")}
              >
                {headingCase === "all_caps" ? "ALL CAPS" : "Title Case"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-[10px]"
                onClick={() => onSectionSpacingChange(sectionSpacing === "spaced" ? "compact" : "spaced")}
              >
                {sectionSpacing}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-[10px]"
                onClick={() =>
                  onImpressionStyleChange(
                    impressionStyle === "bulleted"
                      ? "numbered"
                      : impressionStyle === "numbered"
                        ? "plain"
                        : "bulleted",
                  )
                }
              >
                {impressionStyle}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-[10px]"
                title="Enlarge report preview to check layout before finalize"
                onClick={() => setEnlarged(true)}
                data-testid="report-layout-preview-enlarge-btn"
              >
                <Maximize2 className="h-3 w-3 mr-1" />
                Enlarge
              </Button>
              {showServerPremium && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-[10px]"
                  title="Refresh server premium preview"
                  onClick={() => {
                    setPreviewRefresh((n) => n + 1);
                    void refetch();
                  }}
                >
                  <RefreshCw className={`h-3 w-3 ${serverLoading ? "animate-spin" : ""}`} />
                </Button>
              )}
            </div>
          </div>

          {reportLayout === "care-premium" && !serverPreviewUrl && (
            <p className="text-[10px] text-amber-700">
              Save a draft to load the clinic Premium print layout (server-rendered). Showing classic client preview until then.
            </p>
          )}
          {showServerPremium && serverLoading && !serverHtml && (
            <p className="text-[10px] text-muted-foreground">Loading Premium layout…</p>
          )}

          <div className="relative group">
            <iframe
              title="Report layout preview"
              srcDoc={displayHtml}
              className="w-full h-64 border rounded bg-white pointer-events-none"
              tabIndex={-1}
              data-testid="report-layout-preview"
            />
            <button
              type="button"
              className="absolute inset-0 rounded border-0 bg-slate-900/0 hover:bg-slate-900/10 focus-visible:ring-2 focus-visible:ring-emerald-500 cursor-zoom-in"
              onClick={() => setEnlarged(true)}
              title="Click to enlarge — check layout and content before finalize"
              data-testid="report-layout-preview-enlarge"
              aria-label="Enlarge report preview"
            />
            <span className="pointer-events-none absolute bottom-2 right-2 text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-900/70 text-white opacity-80 group-hover:opacity-100">
              Click to enlarge
            </span>
          </div>
        </div>
      )}

      <Dialog open={enlarged} onOpenChange={setEnlarged}>
        <DialogContent
          className="max-w-[min(1100px,96vw)] w-[96vw] h-[92vh] p-3 gap-2 flex flex-col"
          data-testid="report-layout-preview-dialog"
        >
          <DialogHeader className="space-y-1 pr-8 shrink-0">
            <DialogTitle className="text-base">Report preview</DialogTitle>
            <DialogDescription className="text-xs">
              Full-page layout and content as it will print. Review before finalize. Esc or ✕ to close.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-1 shrink-0">
            {([0.9, 1, 1.25] as const).map((z) => (
              <Button
                key={z}
                size="sm"
                variant={previewZoom === z ? "default" : "outline"}
                className="h-6 text-[10px] px-2"
                onClick={() => setPreviewZoom(z)}
              >
                {Math.round(z * 100)}%
              </Button>
            ))}
          </div>
          <div className="flex-1 min-h-0 overflow-auto rounded border bg-slate-100 p-3">
            <iframe
              title="Enlarged report layout preview"
              srcDoc={displayHtml}
              className="w-full min-h-[1122px] bg-white shadow-md mx-auto border-0"
              style={{ zoom: previewZoom }}
              data-testid="report-layout-preview-enlarged"
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
