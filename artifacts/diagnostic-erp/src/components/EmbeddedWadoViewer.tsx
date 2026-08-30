import { useState, useRef, useCallback, useEffect, forwardRef, useImperativeHandle, type ForwardedRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ZoomIn, ZoomOut, RotateCcw, Sun, Moon, ChevronLeft, ChevronRight,
  Layers, Maximize2, Minimize2, Expand, Shrink, AlertTriangle, RefreshCw, ExternalLink, Camera,
} from "lucide-react";
import { captureFramesViewport } from "@/lib/framesViewportCapture";
import { framesAnchorStudyAllowed } from "@/lib/framesJumpBack";
import { BROWSER_DICOMWEB_BASE, dicomWebFetch, withDicomWebAuth } from "@/lib/browserDicomWeb";
import { planStudyLaunch, localStorageRouteCache, type StudyLaunchResult, type NetworkMode } from "@/lib/studyLaunchService";
import type { ViewportContext } from "@/lib/observationAnchor";
import { viewportContextsEqual } from "@/lib/observationAnchor";
import {
  embedNetworkModeOptions,
  readViewerNetworkMode,
  writeViewerNetworkMode,
  VIEWER_NETWORK_MODE_EVENT,
} from "@/lib/viewerNetworkPreference";
import { prefetchActiveStudySeries } from "@/lib/mriStudyPrefetch";

interface Series {
  uid: string;
  description: string | null;
  modality: string | null;
  numInstances: number;
}

interface Instance {
  uid: string;
  instanceNumber: number | null;
  rows: number | null;
  columns: number | null;
}

interface ViewerLaunchData {
  studyInstanceUID: string;
  patientName?: string | null;
  accessionNumber?: string | null;
  ohifUrl?: string | null;
  weasisUrl?: string | null;
  dicomWebBaseUrl?: string | null;
  wadoBaseUrl?: string | null;
  pacsType?: string | null;
  error?: string;
}

const TOUCH_THRESHOLD = 10;

/** Which renderer fills the in-page view box. OHIF is the full viewer in an
 *  iframe; FRAMES is the lightweight WADO frame-by-frame renderer. Weasis is
 *  a desktop application (weasis:// protocol) and can only be launched, never
 *  embedded in a web page. */
type EmbeddedViewMode = "OHIF" | "FRAMES";
const VIEW_MODE_KEY = "embedded_viewer_mode";

function useGestureZoom(onZoom: (delta: number) => void) {
  const lastDist = useRef(0);
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length < 2) return;
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (lastDist.current > 0) {
      const delta = dist / lastDist.current;
      onZoom(delta);
    }
    lastDist.current = dist;
  }, [onZoom]);
  const handleTouchEnd = useCallback(() => { lastDist.current = 0; }, []);
  return { handleTouchMove, handleTouchEnd };
}

/** M1.6B2 — the viewer operations that really exist, exposed for the voice
 *  layer. The handle is non-null only while a study is actually rendered. */
export interface EmbeddedViewerHandle {
  nextFrame: () => void;
  prevFrame: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
  /**
   * FRAMES jump-back: select series/SOP/frame from provenance.
   * Returns false when UIDs are missing or not found in the loaded study.
   */
  goToAnchor: (anchor: {
    studyInstanceUID?: string | null;
    seriesInstanceUID?: string | null;
    sopInstanceUID?: string | null;
    frameNumber?: number | null;
  }) => boolean;
  /** OHIF iframe contentWindow when OHIF mode is active (cross-origin OK for postMessage). */
  getOhifWindow: () => Window | null;
}

const EmbeddedWadoViewer = forwardRef<EmbeddedViewerHandle, {
  studyInstanceUID: string | null;
  accessionNumber?: string | null;
  patientName?: string | null;
  /**
   * Vertical enlarge inside the center (viewer) column only — grow UP/DOWN to
   * reclaim space above/below the view box (Open Study chrome, Report/Print
   * pickers). Distinct from near-fullscreen overlay and from open-in-new-tab.
   */
  columnExpanded?: boolean;
  onColumnExpandedChange?: (expanded: boolean) => void;
  /** Frames mode: add the visible instance to the report image rail. */
  onAddCurrentFrameToReport?: (ref: {
    studyInstanceUID: string;
    seriesInstanceUID: string;
    sopInstanceUID: string;
    frameNumber: number;
  }) => void;
  /** FRAMES-first live viewport context for Reporting Canvas R2 activeAnchor. */
  onViewportContextChange?: (ctx: ViewportContext | null) => void;
  /**
   * Frozen viewport capture (Phase 1). Returns JPEG blobs of the displayed
   * FRAMES image (zoom/pan/WL applied). No annotation overlays exist in FRAMES.
   */
  onCaptureViewport?: (payload: {
    blob: Blob;
    mimeType: string;
    snapshotJson: string;
    context: ViewportContext;
  }) => void | Promise<void>;
  captureBusy?: boolean;
  /** Ask CARE OHIF extension for annotated viewport capture (parent registers requestId). */
  onRequestOhifAnnotatedCapture?: () => void;
}>(function EmbeddedWadoViewer({ studyInstanceUID, accessionNumber, patientName, columnExpanded = false, onColumnExpandedChange, onAddCurrentFrameToReport, onViewportContextChange, onCaptureViewport, captureBusy, onRequestOhifAnnotatedCapture }, ref) {
  if (!studyInstanceUID) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground text-sm">
        <AlertTriangle className="h-8 w-8" />
        <p>No StudyInstanceUID available for this worklist entry.</p>
      </div>
    );
  }

  return (
    <ViewerContent
      studyInstanceUID={studyInstanceUID}
      accessionNumber={accessionNumber}
      patientName={patientName}
      controlRef={ref}
      columnExpanded={columnExpanded}
      onColumnExpandedChange={onColumnExpandedChange}
      onAddCurrentFrameToReport={onAddCurrentFrameToReport}
      onViewportContextChange={onViewportContextChange}
      onCaptureViewport={onCaptureViewport}
      captureBusy={captureBusy}
      onRequestOhifAnnotatedCapture={onRequestOhifAnnotatedCapture}
    />
  );
});

export default EmbeddedWadoViewer;

function ViewerContent({ studyInstanceUID, accessionNumber, patientName, controlRef, columnExpanded, onColumnExpandedChange, onAddCurrentFrameToReport, onViewportContextChange, onCaptureViewport, captureBusy, onRequestOhifAnnotatedCapture }: {
  studyInstanceUID: string;
  accessionNumber?: string | null;
  patientName?: string | null;
  controlRef?: ForwardedRef<EmbeddedViewerHandle>;
  columnExpanded?: boolean;
  onColumnExpandedChange?: (expanded: boolean) => void;
  onAddCurrentFrameToReport?: (ref: {
    studyInstanceUID: string;
    seriesInstanceUID: string;
    sopInstanceUID: string;
    frameNumber: number;
  }) => void;
  onViewportContextChange?: (ctx: ViewportContext | null) => void;
  onCaptureViewport?: (payload: {
    blob: Blob;
    mimeType: string;
    snapshotJson: string;
    context: ViewportContext;
  }) => void | Promise<void>;
  captureBusy?: boolean;
  onRequestOhifAnnotatedCapture?: () => void;
}) {
  const [selectedSeriesUID, setSelectedSeriesUID] = useState<string | null>(null);
  const [selectedInstIdx, setSelectedInstIdx] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [isExpanded, setIsExpanded] = useState(false);
  const [series, setSeries] = useState<Series[]>([]);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [loadingFrames, setLoadingFrames] = useState(false);
  // null = no explicit choice yet → default to OHIF whenever it is configured.
  const [chosenMode, setChosenMode] = useState<EmbeddedViewMode | null>(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem(VIEW_MODE_KEY) : null;
    return stored === "OHIF" || stored === "FRAMES" ? stored : null;
  });

  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, startPanX: 0, startPanY: 0 });
  const imgRef = useRef<HTMLImageElement>(null);
  const framesViewportRef = useRef<HTMLDivElement>(null);
  const ohifIframeRef = useRef<HTMLIFrameElement>(null);

  const { data: launchData } = useQuery<ViewerLaunchData>({
    queryKey: ["viewer-launch", studyInstanceUID],
    queryFn: () => api.get(`/api/radiology/studies/${encodeURIComponent(studyInstanceUID)}/ohif-launch`),
    enabled: !!studyInstanceUID,
    staleTime: 5 * 60_000,
  });

  // Network-aware embed URL — reuses the SAME LAN/Tailscale/Cloudflare/Public
  // auto-detect + mixed-content-aware selection the "Open Study" (Weasis)
  // launch button already uses (studyLaunchService.ts), instead of the single
  // static server-side ohif_base_url the /ohif-launch endpoint above returns.
  // Query key/shape matches OpenStudyPanel.tsx exactly so the two components
  // share one cached fetch when mounted together.
  const { data: viewerSettings = {} as Record<string, string> } = useQuery<Record<string, string>>({
    queryKey: ["pacs-viewer-settings"],
    queryFn: async () => {
      const rows = await api.get<{ key: string; value: string }[]>("/api/radiology/pacs-settings");
      return Object.fromEntries(rows.map((r) => [r.key, r.value]));
    },
    staleTime: 60_000,
  });
  // Staff-selectable OHIF path — LAN default (AUTO was unreliable once Tailscale
  // was linked). Shared localStorage key with Open Study panel.
  const [networkMode, setNetworkMode] = useState<NetworkMode>(() => readViewerNetworkMode());
  useEffect(() => {
    const sync = () => setNetworkMode(readViewerNetworkMode());
    window.addEventListener(VIEWER_NETWORK_MODE_EVENT, sync as EventListener);
    return () => window.removeEventListener(VIEWER_NETWORK_MODE_EVENT, sync as EventListener);
  }, []);
  // undefined = not yet planned (probing in flight); null = planned but no
  // usable route; StudyLaunchResult = plan complete (success or typed failure).
  const [embedPlan, setEmbedPlan] = useState<StudyLaunchResult | null | undefined>(undefined);
  useEffect(() => {
    if (!studyInstanceUID || Object.keys(viewerSettings).length === 0) return;
    let cancelled = false;
    setEmbedPlan(undefined);
    planStudyLaunch(
      { studyInstanceUID, accessionNumber: accessionNumber ?? null, viewer: "OHIF", requestedMode: networkMode },
      viewerSettings,
      { pageIsHttps: window.location.protocol === "https:", cache: localStorageRouteCache() },
    ).then((res) => { if (!cancelled) setEmbedPlan(res); });
    return () => { cancelled = true; };
  }, [studyInstanceUID, accessionNumber, viewerSettings, networkMode]);
  // Best URL to hand to "open in new tab" — new-tab navigation isn't subject
  // to mixed-content blocking, so prefer the selected network route, falling
  // back to the legacy static LAN URL from /ohif-launch.
  const bestOhifUrl = embedPlan?.finalLaunchUrl ?? launchData?.ohifUrl ?? null;

  const chooseNetworkMode = (next: NetworkMode) => {
    writeViewerNetworkMode(next);
    setNetworkMode(next);
  };

  // Same-origin ERP proxy — works on LAN, Tailscale, and public HTTPS alike.
  const dicomWebBase = BROWSER_DICOMWEB_BASE;

  const fetchSeries = useCallback(async () => {
    if (!dicomWebBase || !studyInstanceUID) return;
    try {
      const url = `${dicomWebBase}/studies/${encodeURIComponent(studyInstanceUID)}/series`;
      const res = await dicomWebFetch(url);
      if (!res.ok) return;
      const data = await res.json();
      const mapped: Series[] = (Array.isArray(data) ? data : []).map((s: any) => ({
        uid: s["0020000E"]?.Value?.[0] ?? "",
        description: s["0008103E"]?.Value?.[0] ?? null,
        modality: s["00080060"]?.Value?.[0] ?? null,
        numInstances: s["00201209"]?.Value?.[0] ?? 0,
      })).filter((s: Series) => s.uid);
      setSeries(mapped);
      if (mapped.length > 0 && !selectedSeriesUID) setSelectedSeriesUID(mapped[0].uid);
    } catch { /* ignore */ }
  }, [dicomWebBase, studyInstanceUID, selectedSeriesUID]);

  const fetchInstances = useCallback(async () => {
    if (!dicomWebBase || !studyInstanceUID || !selectedSeriesUID) return;
    try {
      const url = `${dicomWebBase}/studies/${encodeURIComponent(studyInstanceUID)}/series/${encodeURIComponent(selectedSeriesUID)}/instances`;
      const res = await dicomWebFetch(url);
      if (!res.ok) return;
      const data = await res.json();
      const mapped: Instance[] = (Array.isArray(data) ? data : []).map((i: any) => ({
        uid: i["00080018"]?.Value?.[0] ?? "",
        instanceNumber: i["00200013"]?.Value?.[0] ?? null,
        rows: i["00280010"]?.Value?.[0] ?? null,
        columns: i["00280011"]?.Value?.[0] ?? null,
      })).filter((i: Instance) => i.uid);
      setInstances(mapped);
      setSelectedInstIdx(0);
    } catch { /* ignore */ }
  }, [dicomWebBase, studyInstanceUID, selectedSeriesUID]);

  useEffect(() => { fetchSeries(); }, [fetchSeries]);
  useEffect(() => { fetchInstances(); }, [fetchInstances]);

  // Emit live FRAMES viewport context (no poll; skip identical payloads).
  const lastViewportRef = useRef<ViewportContext | null>(null);
  useEffect(() => {
    if (!onViewportContextChange) return;
    const seriesMeta = series.find((s) => s.uid === selectedSeriesUID);
    const inst = instances[selectedInstIdx];
    if (!selectedSeriesUID || !inst) {
      if (lastViewportRef.current !== null) {
        lastViewportRef.current = null;
        onViewportContextChange(null);
      }
      return;
    }
    const next: ViewportContext = {
      studyInstanceUID,
      seriesInstanceUID: selectedSeriesUID,
      sopInstanceUID: inst.uid,
      frameNumber: selectedInstIdx + 1,
      instanceNumber: inst.instanceNumber ?? selectedInstIdx + 1,
      seriesDescription: seriesMeta?.description ?? undefined,
      totalFrames: instances.length || seriesMeta?.numInstances || undefined,
      modality: seriesMeta?.modality ?? undefined,
      viewer: "frames",
    };
    if (viewportContextsEqual(lastViewportRef.current, next)) return;
    lastViewportRef.current = next;
    onViewportContextChange(next);
  }, [onViewportContextChange, studyInstanceUID, selectedSeriesUID, selectedInstIdx, series, instances]);

  // Warm every series (metadata + first frame) for the open study so switching
  // sequences in Frames / next OHIF load hits Orthanc + browser HTTP cache.
  useEffect(() => {
    if (!studyInstanceUID) return;
    prefetchActiveStudySeries({ studyInstanceUID, dicomWebBaseUrl: dicomWebBase });
  }, [studyInstanceUID, dicomWebBase]);

  // Load frame image
  useEffect(() => {
    if (!dicomWebBase || !studyInstanceUID || !selectedSeriesUID || !instances[selectedInstIdx]) return;
    const inst = instances[selectedInstIdx];
    const url = `${dicomWebBase}/studies/${encodeURIComponent(studyInstanceUID)}/series/${encodeURIComponent(selectedSeriesUID)}/instances/${encodeURIComponent(inst.uid)}/rendered?quality=90&viewport=800,800`;
    setLoadingFrames(true);
    const img = new Image();
    img.onload = () => { setFrameUrl(url); setLoadingFrames(false); };
    img.onerror = () => { setLoadingFrames(false); };
    img.src = withDicomWebAuth(url) ?? url;
  }, [dicomWebBase, studyInstanceUID, selectedSeriesUID, instances, selectedInstIdx]);

  const zoomIn = () => setZoom((z) => Math.min(z * 1.2, 5));
  const zoomOut = () => setZoom((z) => Math.max(z / 1.2, 0.3));
  const resetView = () => { setZoom(1); setPanX(0); setPanY(0); setBrightness(100); setContrast(100); };

  const gesture = useGestureZoom((delta) => {
    setZoom((z) => Math.min(Math.max(z * delta, 0.3), 5));
  });

  const handleMouseDown = (e: React.MouseEvent) => {
    dragRef.current = { dragging: true, startX: e.clientX, startY: e.clientY, startPanX: panX, startPanY: panY };
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current.dragging) return;
    setPanX(dragRef.current.startPanX + (e.clientX - dragRef.current.startX) / zoom);
    setPanY(dragRef.current.startPanY + (e.clientY - dragRef.current.startY) / zoom);
  };
  const handleMouseUp = () => { dragRef.current.dragging = false; };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((z) => Math.min(Math.max(z * delta, 0.3), 5));
  };

  const nextFrame = () => setSelectedInstIdx((i) => Math.min(i + 1, instances.length - 1));
  const prevFrame = () => setSelectedInstIdx((i) => Math.max(i - 1, 0));

  // M1.6B2 — same setters the toolbar buttons call, nothing more.
  useImperativeHandle(controlRef, () => ({
    nextFrame,
    prevFrame,
    zoomIn,
    zoomOut,
    resetView,
    goToAnchor: (anchor) => {
      if (!framesAnchorStudyAllowed(studyInstanceUID, anchor.studyInstanceUID)) {
        return false;
      }
      if (anchor.seriesInstanceUID) {
        const seriesHit = series.find((s) => s.uid === anchor.seriesInstanceUID);
        if (!seriesHit) return false;
        if (selectedSeriesUID !== anchor.seriesInstanceUID) {
          setSelectedSeriesUID(anchor.seriesInstanceUID);
        }
      }
      if (anchor.sopInstanceUID) {
        const idx = instances.findIndex((i) => i.uid === anchor.sopInstanceUID);
        if (idx >= 0) {
          setSelectedInstIdx(idx);
          return true;
        }
        // Series may still be loading — remember intent via frameNumber fallback
      }
      if (anchor.frameNumber != null && Number.isFinite(anchor.frameNumber)) {
        const idx = Math.max(0, Math.min(instances.length - 1, Math.floor(anchor.frameNumber) - 1));
        if (instances.length > 0) {
          setSelectedInstIdx(idx);
          return true;
        }
      }
      return Boolean(anchor.seriesInstanceUID);
    },
    getOhifWindow: () => ohifIframeRef.current?.contentWindow ?? null,
  }));

  // Escape exits near-fullscreen overlay (column expand is restored via its own control).
  useEffect(() => {
    if (!isExpanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setIsExpanded(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isExpanded]);

  const imageTransform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  const imageFilter = `brightness(${brightness}%) contrast(${contrast}%)`;

  // OHIF is the default whenever the launch endpoint produced a URL; the
  // frames renderer is the fallback (and stays available as an explicit tab).
  const viewMode: EmbeddedViewMode = chosenMode ?? (launchData?.ohifUrl ? "OHIF" : "FRAMES");
  const chooseMode = (m: EmbeddedViewMode) => {
    setChosenMode(m);
    try { localStorage.setItem(VIEW_MODE_KEY, m); } catch { /* private mode */ }
  };

  const toggleColumnExpanded = () => onColumnExpandedChange?.(!columnExpanded);

  return (
    <div className={`flex flex-col rounded-lg border overflow-hidden min-h-0 ${isExpanded ? "fixed inset-4 z-50 bg-background shadow-2xl" : "relative h-full"}`}>
      {/* Three enlarge modes:
          1) Maximize — grow view box UP/DOWN inside the center column only
          2) Expand — near-fullscreen overlay (whole workspace chrome)
          3) ExternalLink — OHIF in a new browser tab
          Double-click header also toggles near-fullscreen. */}
      <div
        className="flex items-center justify-between gap-2 px-3 py-1.5 bg-muted/50 border-b flex-wrap cursor-pointer select-none shrink-0"
        onDoubleClick={() => setIsExpanded((v) => !v)}
        title={isExpanded ? "Double-click to exit fullscreen" : "Double-click for fullscreen overlay"}
        data-testid="viewer-header"
      >
        <div className="flex items-center gap-2 text-xs min-w-0">
          <Layers className="h-3.5 w-3.5 shrink-0" />
          <span className="font-semibold shrink-0">DICOM Viewer</span>
          {(launchData?.patientName || patientName) && (
            <span className="font-semibold text-foreground truncate max-w-[14rem]" data-testid="viewer-patient-name" title={launchData?.patientName || patientName || ""}>
              {launchData?.patientName || patientName}
            </span>
          )}
          {accessionNumber && <Badge variant="outline" className="text-[10px]">{accessionNumber}</Badge>}
          <Badge variant="outline" className="text-[10px] font-mono truncate">{studyInstanceUID.slice(0, 20)}...</Badge>
        </div>
        <div className="flex items-center gap-1">
          {/* OHIF ⇄ Frames toggle — Weasis is a desktop app and launches via
              open-in-new-tab / external tools; it cannot render inside the page. */}
          <div
            className="flex items-center rounded-md border overflow-hidden text-[11px]"
            data-testid="viewer-network-toggle"
            title="OHIF network path — LAN is fastest on the clinic floor"
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {embedNetworkModeOptions().map((opt, i) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => chooseNetworkMode(opt.id)}
                className={`px-2 py-1 transition-colors ${i > 0 ? "border-l" : ""} ${
                  networkMode === opt.id ? "bg-emerald-600 text-white font-medium" : "hover:bg-muted"
                }`}
                title={opt.hint}
                data-testid={`viewer-network-${opt.id.toLowerCase()}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="flex items-center rounded-md border overflow-hidden text-[11px]" data-testid="viewer-mode-toggle">
            <button
              type="button"
              onClick={() => chooseMode("OHIF")}
              className={`px-2 py-1 transition-colors ${viewMode === "OHIF" ? "bg-primary text-primary-foreground font-medium" : "hover:bg-muted"}`}
              data-testid="viewer-mode-ohif"
            >
              OHIF
            </button>
            <button
              type="button"
              onClick={() => chooseMode("FRAMES")}
              className={`px-2 py-1 transition-colors border-l ${viewMode === "FRAMES" ? "bg-primary text-primary-foreground font-medium" : "hover:bg-muted"}`}
              data-testid="viewer-mode-frames"
            >
              Frames
            </button>
          </div>
          {viewMode === "OHIF" && embedPlan?.selectedNetworkMode && (
            <Badge
              variant="outline"
              className="text-[10px] h-5 px-1.5 border-emerald-300 text-emerald-800 bg-emerald-50"
              data-testid="viewer-network-badge"
              title={embedPlan.selectedBaseUrl ?? undefined}
            >
              via {embedPlan.selectedNetworkMode}
            </Badge>
          )}
          {viewMode === "OHIF" && bestOhifUrl && (
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Open OHIF in a new tab"
              onClick={(e) => { e.stopPropagation(); window.open(bestOhifUrl, "_blank"); }}
              data-testid="viewer-open-new-tab">
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            size="sm"
            variant={columnExpanded ? "secondary" : "ghost"}
            className="h-7 w-7 p-0"
            onClick={(e) => { e.stopPropagation(); if (isExpanded) setIsExpanded(false); toggleColumnExpanded(); }}
            title={columnExpanded ? "Restore Report/Print panels below" : "Enlarge view box up & down (center column only)"}
            data-testid="viewer-column-expand"
          >
            {columnExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </Button>
          <Button
            size="sm"
            variant={isExpanded ? "secondary" : "ghost"}
            className="h-7 w-7 p-0"
            onClick={(e) => { e.stopPropagation(); setIsExpanded((v) => !v); }}
            title={isExpanded ? "Exit fullscreen overlay" : "Fill whole screen"}
            data-testid="viewer-fullscreen"
          >
            {isExpanded ? <Shrink className="h-3.5 w-3.5" /> : <Expand className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {viewMode === "OHIF" ? (
        /* ── In-page OHIF view box — uses staff-selected LAN / Tailscale / Auto
           route (same studyLaunchService as Open Study). LAN is the default. ─ */
        embedPlan === undefined ? (
          <div className="flex-1 min-h-0 flex items-center justify-center gap-2 bg-black text-white/50 text-sm">
            <RefreshCw className="h-4 w-4 animate-spin" />
            {networkMode === "AUTO"
              ? "Detecting best viewer route…"
              : `Connecting via ${networkMode === "TAILSCALE" ? "Tailscale" : networkMode}…`}
          </div>
        ) : embedPlan?.success && embedPlan.finalLaunchUrl ? (
          <div className="flex-1 min-h-0 flex flex-col bg-black">
            <div
              className="shrink-0 px-2 py-1 text-[10px] text-amber-100/90 bg-amber-950/80 border-b border-amber-800/50 flex items-center justify-between gap-2"
              data-testid="ohif-capture-fallback-hint"
            >
              <span>
                Annotated OHIF capture requires the CARE OHIF extension (viewport-capture protocol). Without it, switch to Frames for viewport capture, save the DICOM frame, or upload a screenshot.
              </span>
              {onRequestOhifAnnotatedCapture ? (
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-6 shrink-0 text-[10px]"
                  disabled={captureBusy}
                  data-testid="ohif-request-annotated-capture"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRequestOhifAnnotatedCapture();
                  }}
                >
                  Request annotated capture
                </Button>
              ) : null}
            </div>
            <iframe
              ref={ohifIframeRef}
              title="OHIF viewer"
              src={embedPlan.finalLaunchUrl}
              className="flex-1 w-full min-h-0 h-full border-0 bg-black"
              allow="fullscreen"
              data-testid="ohif-embed"
            />
          </div>
        ) : embedPlan?.errorCode === "MIXED_CONTENT_BLOCKED" ? (
          /* Every configured OHIF route is plain http, and this page is https
             — the browser refuses to frame an http endpoint inside an https
             page, no matter which network the client is actually on. */
          <div
            className="flex-1 min-h-0 flex flex-col items-center justify-center gap-2 p-4 text-center bg-black text-white/60 text-sm"
            data-testid="ohif-mixed-content-blocked"
          >
            <AlertTriangle className="h-8 w-8" />
            <p className="font-medium">OHIF cannot be embedded here</p>
            <p className="text-xs text-white/40 max-w-sm">
              This ERP page is HTTPS, but the selected route (
              <span className="text-emerald-400 font-semibold">{networkMode}</span>
              ) is HTTP — browsers block that embed.
            </p>
            <p className="text-xs text-white/50 max-w-sm">
              Use the <span className="text-white font-medium">LAN | Tailscale | Auto</span> toggle
              in the DICOM Viewer toolbar above (next to OHIF / Frames). On{" "}
              <code className="text-white/70">caredeoghar.com</code>, pick{" "}
              <span className="text-white font-medium">Tailscale</span> only if that route is HTTPS
              (via <code className="mx-0.5">tailscale serve</code>).
            </p>
            <p className="text-[11px] text-white/35 max-w-sm">
              Configure HTTPS bases in Settings → PACS / DICOM → Viewer Network Routes
              (<code className="mx-0.5">ohif_base_url_tailscale</code> or a reverse-proxied LAN URL).
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
              {networkMode !== "TAILSCALE" && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 text-xs"
                  data-testid="ohif-try-tailscale"
                  onClick={() => chooseNetworkMode("TAILSCALE")}
                >
                  Try Tailscale
                </Button>
              )}
              {networkMode !== "AUTO" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  data-testid="ohif-try-auto"
                  onClick={() => chooseNetworkMode("AUTO")}
                >
                  Try Auto
                </Button>
              )}
              {bestOhifUrl && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => window.open(bestOhifUrl, "_blank")}
                >
                  <ExternalLink className="h-3.5 w-3.5 mr-1" /> Open OHIF in new tab
                </Button>
              )}
            </div>
          </div>
        ) : bestOhifUrl ? (
          /* planStudyLaunch didn't succeed (e.g. no reachable network probed
             yet) but a configured URL still exists — fall back to it rather
             than showing a dead end; "open in new tab" always works even if
             embedding doesn't. */
          <iframe
            ref={ohifIframeRef}
            title="OHIF viewer"
            src={bestOhifUrl}
            className="flex-1 w-full min-h-0 h-full border-0 bg-black"
            allow="fullscreen"
            data-testid="ohif-embed"
          />
        ) : (
          <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-2 p-4 text-center bg-black text-white/60 text-sm">
            <AlertTriangle className="h-8 w-8" />
            <p className="font-medium">OHIF viewer is not configured</p>
            <p className="text-xs text-white/40 max-w-xs">
              {launchData?.error
                ?? "Go to PACS / DICOM Settings → Viewer Settings and click Load Clinic Viewer Defaults, then reload this page."}
            </p>
          </div>
        )
      ) : (
      <div className="flex flex-1 min-h-0">
        {/* Series panel */}
        <div className="w-48 border-r flex flex-col bg-muted/20">
          <div className="px-2 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase">Series ({series.length})</div>
          <div className="flex-1 overflow-y-auto">
            {series.map((s) => (
              <button
                key={s.uid}
                onClick={() => setSelectedSeriesUID(s.uid)}
                className={`w-full text-left px-2 py-1.5 text-xs border-b transition-colors ${selectedSeriesUID === s.uid ? "bg-primary/10 border-l-2 border-l-primary font-medium" : "hover:bg-muted/50"}`}
              >
                <div className="truncate font-medium">{s.description || "Unnamed Series"}</div>
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Badge variant="outline" className="text-[9px] px-0.5 py-0">{s.modality ?? "OT"}</Badge>
                  {s.numInstances} img{s.numInstances !== 1 ? "s" : ""}
                </div>
              </button>
            ))}
            {series.length === 0 && (
              <div className="px-2 py-4 text-xs text-muted-foreground text-center">
                {dicomWebBase ? "Loading series..." : "No DICOMweb URL configured"}
              </div>
            )}
          </div>
        </div>

        {/* Image viewport */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Toolbar */}
          <div className="flex items-center gap-1 px-2 py-1 border-b bg-muted/30 flex-wrap">
            <Button size="sm" variant="ghost" className="h-7 px-1.5 text-xs" onClick={zoomIn}><ZoomIn className="h-3.5 w-3.5" /></Button>
            <Button size="sm" variant="ghost" className="h-7 px-1.5 text-xs" onClick={zoomOut}><ZoomOut className="h-3.5 w-3.5" /></Button>
            <Button size="sm" variant="ghost" className="h-7 px-1.5 text-xs" onClick={resetView}><RotateCcw className="h-3.5 w-3.5" /></Button>
            <div className="w-px h-4 bg-border mx-1" />
            <Button size="sm" variant="ghost" className="h-7 px-1.5 text-xs" onClick={() => setBrightness((b) => Math.min(b + 10, 200))}><Sun className="h-3.5 w-3.5" /></Button>
            <Button size="sm" variant="ghost" className="h-7 px-1.5 text-xs" onClick={() => setBrightness((b) => Math.max(b - 10, 20))}><Moon className="h-3.5 w-3.5" /></Button>
            <div className="w-px h-4 bg-border mx-1" />
            <Button size="sm" variant="ghost" className="h-7 px-1.5 text-xs" onClick={prevFrame} disabled={selectedInstIdx <= 0}><ChevronLeft className="h-3.5 w-3.5" /></Button>
            <span className="text-xs text-muted-foreground min-w-[80px] text-center">
              {instances.length > 0 ? `${selectedInstIdx + 1} / ${instances.length}` : "\u2014"}
            </span>
            <Button size="sm" variant="ghost" className="h-7 px-1.5 text-xs" onClick={nextFrame} disabled={selectedInstIdx >= instances.length - 1}><ChevronRight className="h-3.5 w-3.5" /></Button>
            {onAddCurrentFrameToReport && selectedSeriesUID && instances[selectedInstIdx] && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-[10px] border-emerald-300 text-emerald-700"
                data-testid="frames-add-to-report"
                title="Add this frame to the report image rail"
                onClick={() => onAddCurrentFrameToReport({
                  studyInstanceUID,
                  seriesInstanceUID: selectedSeriesUID,
                  sopInstanceUID: instances[selectedInstIdx].uid,
                  frameNumber: selectedInstIdx + 1,
                })}
              >
                Add to report
              </Button>
            )}
            {onCaptureViewport && selectedSeriesUID && instances[selectedInstIdx] && (
              <Button
                size="sm"
                variant="default"
                className="h-7 px-2 text-[10px] gap-1"
                data-testid="frames-capture-key-image"
                title="Capture visible viewport as frozen key image (no annotation overlays in Frames)"
                disabled={!!captureBusy || !frameUrl}
                onClick={async () => {
                  const img = imgRef.current;
                  const viewport = framesViewportRef.current;
                  if (!img || !viewport || !img.complete || !img.naturalWidth) return;
                  const seriesMeta = series.find((s) => s.uid === selectedSeriesUID);
                  const inst = instances[selectedInstIdx];
                  try {
                    const result = await captureFramesViewport({
                      img,
                      viewport,
                      zoom,
                      panX,
                      panY,
                      brightness,
                      contrast,
                    });
                    const context: ViewportContext = {
                      studyInstanceUID,
                      seriesInstanceUID: selectedSeriesUID,
                      sopInstanceUID: inst.uid,
                      frameNumber: selectedInstIdx + 1,
                      instanceNumber: inst.instanceNumber ?? selectedInstIdx + 1,
                      seriesDescription: seriesMeta?.description ?? undefined,
                      totalFrames: instances.length || seriesMeta?.numInstances || undefined,
                      modality: seriesMeta?.modality ?? undefined,
                      viewer: "frames",
                    };
                    await onCaptureViewport({
                      blob: result.blob,
                      mimeType: result.mimeType,
                      snapshotJson: JSON.stringify(result.snapshot),
                      context,
                    });
                  } catch (e) {
                    console.warn("[frames] viewport capture failed", e instanceof Error ? e.message : "unknown");
                  }
                }}
              >
                <Camera className="h-3.5 w-3.5" />
                {captureBusy ? "Capturing…" : "Capture key image"}
              </Button>
            )}
            <div className="flex-1" />
            <span className="text-[10px] text-muted-foreground">B:{brightness}% C:{contrast}%</span>
            {bestOhifUrl && (
              <Button size="sm" variant="ghost" className="h-7 px-1.5 text-xs" onClick={() => window.open(bestOhifUrl, "_blank")}>
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>

          {/* Canvas — FRAMES viewport (overflow-hidden). Capture uses this rect. */}
          <div
            ref={framesViewportRef}
            data-testid="frames-viewport"
            className="flex-1 relative overflow-hidden bg-black flex items-center justify-center cursor-grab active:cursor-grabbing"
            onDoubleClick={() => setIsExpanded((v) => !v)}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
            onTouchMove={gesture.handleTouchMove}
            onTouchEnd={gesture.handleTouchEnd}
          >
            {loadingFrames && (
              <div className="absolute inset-0 flex items-center justify-center z-10">
                <RefreshCw className="h-6 w-6 animate-spin text-white/70" />
              </div>
            )}
            {frameUrl ? (
              <img
                ref={imgRef}
                src={frameUrl}
                alt="DICOM frame"
                className="max-w-none select-none"
                style={{ transform: imageTransform, transformOrigin: "50% 50%", filter: imageFilter }}
                draggable={false}
              />
            ) : (
              <div className="text-white/50 text-sm flex flex-col items-center gap-2">
                <Layers className="h-8 w-8" />
                {dicomWebBase ? "Select a series to load images" : "DICOMweb base URL not configured. Go to PACS / DICOM Settings → Viewer Settings and click Load Clinic Viewer Defaults."}
              </div>
            )}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
