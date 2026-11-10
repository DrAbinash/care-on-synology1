/**
 * ReportLivePreviewColumn — the rendered report in a column of its own.
 *
 * OWNER DECISION 2026-11-01: "LEFT: DICOM viewer. MIDDLE: Findings/Impression editor.
 * RIGHT: Live formatted report preview."
 *
 * This is the layout correction `ReportCanvas` recorded and deliberately did not make:
 * the live preview used to be a pane under the editors, inside the "Report / Layout /
 * Export" accordion section. Measured at 1536x800 on the rig, that put the Impression
 * editor at y=824 of an 800px viewport — entirely below the fold — and the preview only
 * existed while that section was open, so watching the rendered report cost closing the
 * editor it was rendered from. A persistent preview beside a comfortable editor is a
 * layout decision, and the owner made it.
 *
 * The column is a sibling of the editor column INSIDE the report panel, not a third
 * panel of the `ReportCanvas | ReportingToolsRail` group. Measured with it in that
 * group: adding a child re-normalises the group's percentages, which pushed the Quick
 * Select rail to its `minSize` and left the preview at its collapsed strip — the rail
 * and the pane-focus machinery both speak in percentages of the group they live in, so
 * a new sibling silently repriced them. Wrapping the untouched editor group in one
 * panel of its own keeps every existing percentage meaning what it meant before.
 *
 * One panel, always mounted: collapsing swaps its CONTENT for a strip instead of
 * unmounting the panel, because a panel that leaves the group reprices its siblings,
 * and the radiologist should not lose the width he set for the editors every time the
 * preview closes.
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { ResizablePanel } from "@/components/ui/resizable";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { Eye } from "lucide-react";
import ReportExportPanel from "@/components/radiology/ReportExportPanel";
import { BROWSER_DICOMWEB_BASE } from "@/lib/browserDicomWeb";
import {
  MIN_PREVIEW_PANE_PCT,
  PREVIEW_OPEN_KEY,
  PREVIEW_STRIP_PCT,
  PREVIEW_WIDTH_KEY,
  clampPreviewPaneWidthPct,
  editorHasRoomForPreview,
  readPreviewPrefs,
  writePreviewPref,
} from "@/lib/reportPreviewPrefs";
import type { RadiologyWorkspaceVm } from "./types";

/** How long the layout is allowed to still be moving before a squeeze counts.
 *  Measured by sampling the editor column every 120ms after Quick Select opens
 *  (tmp/rig/j33-fold-trace.mjs): it dips to 431px and the pane-focus compensation hands
 *  the width back at ~400ms, settling at 598px. A fold judged earlier than that punishes
 *  a preview that had room. */
const SETTLE_MS = 600;

export function ReportLivePreviewColumn({
  vm,
  editorColumnRef,
}: {
  vm: RadiologyWorkspaceVm;
  /** The Findings/Impression editor's own element. Passed from `WorkspaceShell`,
   *  which owns the layout: a panel ref is an imperative handle with no DOM, so this
   *  column cannot ask the editor panel how wide it ended up by itself. */
  editorColumnRef: RefObject<HTMLDivElement | null>;
}) {
  const {
    canonicalDemography,
    draftId,
    exportingPdf,
    exportingWord,
    findingsProvenance,
    findingsText,
    focusReportField,
    frozenKeyImages,
    handleExportPdf,
    handleExportWord,
    handlePrintLikeFinal,
    headingCase,
    imageRefs,
    impressionProvenance,
    impressionStyle,
    impressionText,
    linkedReportId,
    signedReport,
    printShareCount,
    livePrintBodyHtml,
    presentationTemplates,
    previewHtml,
    printFormat,
    printFormatLocked,
    printingLikeFinal,
    reportLayout,
    saveDraft,
    sectionSpacing,
    setHeadingCase,
    setImpressionStyle,
    setPreviewLayoutOverride,
    setSectionSpacing,
    setShowLetterpadHeader,
    showLetterpadHeader,
    stepPrintFormat,
  } = vm;

  const [widthPct, setWidthPct] = useState(() => readPreviewPrefs().widthPct);
  const [collapsed, setCollapsed] = useState(() => !readPreviewPrefs().open);
  const panelRef = useRef<ImperativePanelHandle>(null);

  /** The current fold was made by the layout, not asked for. `onCollapse` reads it so
   *  an automatic fold does not become a stored preference: he never said he wanted the
   *  preview gone, and next study it would be shut on him. */
  const autoFoldRef = useRef(false);

  /** The automatic rule is in force while the editor has room. Clicking the strip
   *  anyway disarms it — a fold that came back the instant he reopened would make the
   *  button dead, and a fold/expand pair that keeps chasing its own width flickers.
   *  Room returning re-arms it for the next squeeze. */
  const armedRef = useRef(true);

  // "At constrained widths, collapse the preview automatically instead of squeezing
  // the editor." The editors' floor is the rule and this column is what gives way —
  // never the other way round. The editor element is what is measured, because the
  // reading queue, the viewer, the Quick Select rail and this column each take a share
  // he controls: only its width answers "is he being squeezed?".
  useEffect(() => {
    const editor = editorColumnRef.current;
    if (!editor) return;
    let settle: number | undefined;
    const evaluate = () => {
      if (editorHasRoomForPreview(editor.clientWidth)) {
        armedRef.current = true;
        // The squeeze went away before the fold was due — opening Quick Select takes
        // the width and the pane-focus compensation hands it back a frame later, and
        // measured at 1536x800 that transient (598px settled, 558px mid-move) was
        // enough to fold a preview that had every right to stay open.
        if (settle !== undefined) window.clearTimeout(settle);
        settle = undefined;
        return;
      }
      if (!armedRef.current || settle !== undefined) return;
      settle = window.setTimeout(() => {
        settle = undefined;
        if (!editorHasRoomForPreview(editor.clientWidth)) {
          autoFoldRef.current = true;
          panelRef.current?.collapse();
        }
      }, SETTLE_MS);
    };
    evaluate();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(evaluate);
    ro.observe(editor);
    return () => {
      ro.disconnect();
      if (settle !== undefined) window.clearTimeout(settle);
    };
  }, [editorColumnRef]);

  const expand = () => {
    // The library also calls this when a panel that is NOT collapsed mounts, so
    // "he reopened it" is answered by the state, not by the callback: disarming on the
    // mount call switched the squeeze rule off for the rest of the session, measured as
    // a reload that restored a 44% preview beside a 458px editor and never folded it.
    const reopenedByHim = collapsed;
    autoFoldRef.current = false;
    if (reopenedByHim) armedRef.current = false;
    setCollapsed(false);
    writePreviewPref(PREVIEW_OPEN_KEY, "1");
    panelRef.current?.expand();
    // A column that mounted folded has no earlier size to go back to, so the library
    // restores its floor — measured as 18% of a group he had left at 44%.
    const size = panelRef.current?.getSize() ?? 0;
    if (Math.abs(size - widthPct) > 0.5) {
      const wanted = widthPct;
      requestAnimationFrame(() => panelRef.current?.resize(wanted));
    }
  };

  const persistWidth = () => {
    // A folded column sits at the strip's 3%; clamping that to the minimum and storing
    // it would replace the width he chose with a slit for the next study.
    if (collapsed) return;
    const next = panelRef.current?.getSize();
    if (typeof next !== "number" || !Number.isFinite(next)) return;
    const rounded = clampPreviewPaneWidthPct(next);
    // Only a position he moved is persisted, so an ordinary click inside the column
    // costs no write and a drag costs one — never one per pixel, which is the rule the
    // old bottom pane followed for its height.
    if (rounded === widthPct) return;
    setWidthPct(rounded);
    writePreviewPref(PREVIEW_WIDTH_KEY, String(rounded));
  };

  // The pointer is released on the separator, not inside this panel, so the settle is
  // heard on the window. A drag that starts anywhere in the group ends here.
  useEffect(() => {
    window.addEventListener("pointerup", persistWidth);
    return () => window.removeEventListener("pointerup", persistWidth);
  }, [persistWidth]);

  return (
    <ResizablePanel
      id="workspace-live-preview"
      defaultSize={collapsed ? PREVIEW_STRIP_PCT : widthPct}
      // 18, not the 3% strip: with `minSize === collapsedSize` the strip's Expand
      // restored a 3% panel, measured at 33px of content — the button worked and the
      // preview stayed unreadable. The queue (12/3) and the rail (22/3) already keep
      // their expanded floor above the strip.
      minSize={MIN_PREVIEW_PANE_PCT}
      maxSize={45}
      collapsible
      collapsedSize={PREVIEW_STRIP_PCT}
      onCollapse={() => {
        // An automatic fold is still a fold — the strip and the collapsed content are
        // what the layout just decided — but it is not a preference he holds.
        setCollapsed(true);
        if (autoFoldRef.current) return;
        writePreviewPref(PREVIEW_OPEN_KEY, "0");
      }}
      // `expand` is also the strip button's handler, which is what keeps a manual
      // reopen and a library-driven one on the same path.
      onExpand={expand}
      ref={panelRef}
    >
      {collapsed ? (
        <button
          type="button"
          className="flex h-full w-full flex-col items-center justify-center gap-2 py-3 text-emerald-600 hover:bg-emerald-50 transition-colors"
          onClick={expand}
          title="Show the live report preview"
          data-testid="live-preview-expand"
        >
          <Eye className="h-4 w-4" />
          <span
            className="text-[9px] font-semibold tracking-wider uppercase text-emerald-700"
            style={{ writingMode: "vertical-rl" }}
          >
            Live preview
          </span>
        </button>
      ) : (
        <div className="h-full min-h-0 flex flex-col" data-testid="live-preview-column">
          <ReportExportPanel
            onCollapseColumn={() => panelRef.current?.collapse()}
            draftId={draftId ?? null}
            linkedReportId={linkedReportId}
            linkedReportSigned={signedReport.state === "signed"}
            printShareCount={printShareCount}
            previewHtml={previewHtml}
            reportLayout={reportLayout}
            clinicActiveLayout={presentationTemplates?.active?.standard}
            onLayoutChange={setPreviewLayoutOverride}
            headingCase={headingCase}
            onHeadingCaseChange={setHeadingCase}
            sectionSpacing={sectionSpacing}
            onSectionSpacingChange={setSectionSpacing}
            impressionStyle={impressionStyle}
            onImpressionStyleChange={setImpressionStyle}
            onExportWord={handleExportWord}
            onExportPdf={handleExportPdf}
            onPrintLikeFinal={handlePrintLikeFinal}
            onEditSection={focusReportField}
            exportingWord={exportingWord}
            exportingPdf={exportingPdf}
            printingLikeFinal={printingLikeFinal}
            disabled={false}
            imageRefs={imageRefs}
            frozenKeyImages={frozenKeyImages}
            dicomWebBase={BROWSER_DICOMWEB_BASE}
            showLetterpadHeader={showLetterpadHeader}
            onShowLetterpadHeaderChange={setShowLetterpadHeader}
            printFormat={printFormat}
            printFormatLocked={printFormatLocked}
            onPrintFormatStep={stepPrintFormat}
            livePrintBodyHtml={livePrintBodyHtml}
            findingsText={findingsText}
            impressionText={impressionText}
            findingsProvenance={findingsProvenance}
            impressionProvenance={impressionProvenance}
            demography={{
              patientName: canonicalDemography.patientName,
              age: canonicalDemography.age,
              sex: canonicalDemography.sex,
              referringDoctor: canonicalDemography.referringDoctor,
              studyDate: canonicalDemography.studyDate,
              // The letterpad patch rebuilds the whole demography table — without the
              // identifiers it drops the UHID/ACCESSION row the server HTML (and the
              // durable PDF) prints, and the on-screen preview stops matching Print.
              uhid: canonicalDemography.uhid,
              patientId: canonicalDemography.patientId,
              accessionNumber: canonicalDemography.accessionNumber,
              // P1-1/P2-5 — the corrections reach the patched STUDY | DOB row and
              // the fallback header, matching the server render.
              studyDescription: canonicalDemography.studyDescription,
              dateOfBirth: canonicalDemography.dateOfBirth,
            }}
            onEnsureDraftSaved={() => saveDraft({ silent: true })}
          />
        </div>
      )}
    </ResizablePanel>
  );
}
