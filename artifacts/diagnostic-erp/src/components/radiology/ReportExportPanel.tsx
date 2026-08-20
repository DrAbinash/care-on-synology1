/**
 * ReportExportPanel — Classic / Premium layout, style prefs, live preview,
 * and Word/PDF export controls for the reporting workspace.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FileDown, Printer, RefreshCw, Eye, Maximize2, ShieldCheck } from "lucide-react";
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

/** One A4 page at 96dpi — minimum preview height when measurement is unavailable. */
const MIN_PREVIEW_PAGE_PX = 1122;

function measureIframeDocHeight(iframe: HTMLIFrameElement | null): number {
  if (!iframe) return MIN_PREVIEW_PAGE_PX;
  try {
    const doc = iframe.contentDocument;
    if (!doc) return MIN_PREVIEW_PAGE_PX;
    const pages = doc.querySelectorAll(".care-doc-page");
    if (pages.length > 0) {
      let total = 0;
      pages.forEach((p) => {
        total += (p as HTMLElement).offsetHeight || 0;
      });
      if (total > 0) return Math.max(total, MIN_PREVIEW_PAGE_PX);
    }
    return Math.max(
      doc.body?.scrollHeight ?? 0,
      doc.body?.offsetHeight ?? 0,
      doc.documentElement?.scrollHeight ?? 0,
      doc.documentElement?.offsetHeight ?? 0,
      MIN_PREVIEW_PAGE_PX,
    );
  } catch {
    return MIN_PREVIEW_PAGE_PX;
  }
}

/** Wheel on nested workspace columns is stolen by parents — drive scrollTop on the pane. */
function usePreviewWheelScroll(
  ref: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  deps: unknown[],
) {
  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (el.scrollHeight <= el.clientHeight + 1) return;
      e.preventDefault();
      e.stopPropagation();
      el.scrollTop += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => el.removeEventListener("wheel", onWheel, { capture: true });
  }, [enabled, ref, ...deps]);
}

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
  /** Double-click preview → jump to an editor section in the workspace. */
  onEditSection?: (field: "clinicalHistory" | "technique" | "findings" | "impression" | "recommendation") => void;
  /** Sign/finalize from the enlarged preview (same action as workspace header). */
  onFinalize?: () => void | Promise<void>;
  finalizeDisabled?: boolean;
  finalizeLabel?: string;
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
  onEditSection,
  onFinalize,
  finalizeDisabled,
  finalizeLabel = "Finalize",
  exportingWord,
  exportingPdf,
  printingLikeFinal,
  disabled,
}: ReportExportPanelProps) {
  const [open, setOpen] = useState(true);
  const [previewRefresh, setPreviewRefresh] = useState(0);
  const [enlarged, setEnlarged] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [editPickerOpen, setEditPickerOpen] = useState(false);
  const [docHeightPx, setDocHeightPx] = useState(MIN_PREVIEW_PAGE_PX);
  const inlineScrollRef = useRef<HTMLDivElement>(null);
  const enlargedScrollRef = useRef<HTMLDivElement>(null);
  const inlineIframeRef = useRef<HTMLIFrameElement>(null);
  const enlargedIframeRef = useRef<HTMLIFrameElement>(null);

  const syncPreviewHeight = useCallback((iframe: HTMLIFrameElement | null) => {
    const h = measureIframeDocHeight(iframe);
    setDocHeightPx((prev) => Math.max(prev, h));
    if (iframe) iframe.style.height = `${h}px`;
  }, []);

  const editSections: Array<{ field: "clinicalHistory" | "technique" | "findings" | "impression" | "recommendation"; label: string }> = [
    { field: "clinicalHistory", label: "History" },
    { field: "technique", label: "Technique" },
    { field: "findings", label: "Findings" },
    { field: "impression", label: "Impression" },
    { field: "recommendation", label: "Recommendation" },
  ];

  const handlePreviewDoubleClick = () => {
    if (onEditSection) {
      setEditPickerOpen(true);
      setEnlarged(true);
      return;
    }
    setEnlarged(true);
  };

  const jumpToSection = (field: "clinicalHistory" | "technique" | "findings" | "impression" | "recommendation") => {
    onEditSection?.(field);
    setEditPickerOpen(false);
    setEnlarged(false);
  };

  const serverPreviewUrl = useMemo(() => {
    const templateQs = reportLayoutTemplateQuery(reportLayout);
    const styleQs = `impressionStyle=${encodeURIComponent(impressionStyle)}`;
    if (linkedReportId) {
      return `/api/patient-reports/${linkedReportId}/print?preview=true&${templateQs}&${styleQs}`;
    }
    if (draftId) {
      return `/api/radiology/report-generator/drafts/${draftId}/print-preview?${templateQs}&${styleQs}`;
    }
    return null;
  }, [draftId, linkedReportId, reportLayout, impressionStyle]);

  const { data: serverHtml, isFetching: serverLoading, refetch } = useQuery<string>({
    queryKey: ["report-export-server-preview", serverPreviewUrl, previewRefresh],
    queryFn: () => api.get<string>(serverPreviewUrl!),
    enabled: (open || enlarged) && !!serverPreviewUrl,
    staleTime: 15_000,
  });

  const showServerLayout = !!serverPreviewUrl;
  const displayHtml = showServerLayout && serverHtml ? serverHtml : previewHtml;

  useEffect(() => {
    setDocHeightPx(MIN_PREVIEW_PAGE_PX);
    const t = window.setTimeout(() => {
      syncPreviewHeight(inlineIframeRef.current);
      if (enlarged) syncPreviewHeight(enlargedIframeRef.current);
    }, 80);
    return () => window.clearTimeout(t);
  }, [displayHtml, enlarged, syncPreviewHeight]);

  usePreviewWheelScroll(inlineScrollRef, open, [displayHtml, docHeightPx]);
  usePreviewWheelScroll(enlargedScrollRef, enlarged, [displayHtml, docHeightPx, previewZoom]);

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
          {onFinalize ? (
            <Button
              size="sm"
              className="h-6 text-[10px] px-2 bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={disabled || finalizeDisabled}
              onClick={() => void onFinalize()}
              title="Sign and finalize this report"
              data-testid="report-layout-finalize-btn"
            >
              <ShieldCheck className="h-3 w-3 mr-1" />
              {finalizeLabel}
            </Button>
          ) : null}
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
              {showServerLayout && (
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

          {!serverPreviewUrl && (
            <p className="text-[10px] text-amber-700">
              Save a draft to load the clinic print layout (letter-pad header + images). Showing a simplified preview until then.
            </p>
          )}
          {showServerLayout && serverLoading && !serverHtml && (
            <p className="text-[10px] text-muted-foreground">Loading print layout…</p>
          )}

          <div className="relative group">
            {/* Compact preview: scroll the outer pane. Do NOT cover it with a
                full-bleed click overlay — that steals wheel and chains scroll
                to the parent worklist column. Print HTML often sets
                overflow:hidden on body, so iframe-internal scroll is unreliable. */}
            <div
              ref={inlineScrollRef}
              className="h-64 overflow-y-scroll overflow-x-hidden rounded border bg-white overscroll-contain touch-pan-y"
              data-testid="report-layout-preview-inline-scroll"
              onDoubleClick={handlePreviewDoubleClick}
              title={onEditSection
                ? "Scroll to review · double-click to edit a section · Enlarge for full page"
                : "Scroll to review · double-click or use Enlarge for full page"}
            >
              <iframe
                ref={inlineIframeRef}
                title="Report layout preview"
                srcDoc={displayHtml}
                className="w-full bg-white border-0 pointer-events-none block"
                style={{ height: docHeightPx, minHeight: MIN_PREVIEW_PAGE_PX }}
                onLoad={(e) => syncPreviewHeight(e.currentTarget)}
                tabIndex={-1}
                data-testid="report-layout-preview"
              />
            </div>
            <button
              type="button"
              className="absolute bottom-2 right-2 z-10 text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-900/70 text-white hover:bg-slate-900 shadow-sm"
              onClick={() => setEnlarged(true)}
              title="Enlarge report preview — check layout and content before finalize"
              data-testid="report-layout-preview-enlarge"
              aria-label="Enlarge report preview"
            >
              Click to enlarge
            </button>
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
              {onEditSection ? " Double-click the compact preview to pick a section to edit." : ""}
            </DialogDescription>
            {editPickerOpen && onEditSection && (
              <div className="flex flex-wrap gap-1 pt-1" data-testid="report-preview-edit-sections">
                {editSections.map((s) => (
                  <Button key={s.field} size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => jumpToSection(s.field)}>
                    Edit {s.label}
                  </Button>
                ))}
              </div>
            )}
          </DialogHeader>
          <div className="flex items-center gap-1 shrink-0 flex-wrap">
            {onFinalize ? (
              <Button
                size="sm"
                className="h-7 text-[10px] bg-emerald-600 hover:bg-emerald-700"
                disabled={finalizeDisabled}
                onClick={() => void onFinalize()}
                data-testid="report-preview-finalize"
              >
                <ShieldCheck className="h-3.5 w-3.5 mr-1" />
                {finalizeLabel}
              </Button>
            ) : null}
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
          <div
            ref={enlargedScrollRef}
            className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden rounded border bg-slate-100 p-3 overscroll-contain touch-pan-y"
            data-testid="report-layout-preview-scroll"
          >
            {/* pointer-events-none: wheel/trackpad scroll the outer pane. Print
                HTML often uses overflow:hidden on body, so iframe-internal
                scroll is a dead end after Enlarge. Height follows full doc. */}
            <iframe
              ref={enlargedIframeRef}
              title="Enlarged report layout preview"
              srcDoc={displayHtml}
              className="bg-white shadow-md mx-auto border-0 pointer-events-none block"
              data-testid="report-layout-preview-enlarged"
              style={{
                zoom: previewZoom,
                width: 794,
                height: docHeightPx,
                minHeight: MIN_PREVIEW_PAGE_PX,
              }}
              onLoad={(e) => syncPreviewHeight(e.currentTarget)}
              tabIndex={-1}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
