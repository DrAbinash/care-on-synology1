import { useState, useRef, useCallback, useEffect, forwardRef, useImperativeHandle, type ForwardedRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ZoomIn, ZoomOut, RotateCcw, Sun, Moon, ChevronLeft, ChevronRight,
  Layers, Maximize2, Minimize2, AlertTriangle, RefreshCw, ExternalLink,
} from "lucide-react";

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
}

const EmbeddedWadoViewer = forwardRef<EmbeddedViewerHandle, {
  studyInstanceUID: string | null;
  accessionNumber?: string | null;
}>(function EmbeddedWadoViewer({ studyInstanceUID, accessionNumber }, ref) {
  if (!studyInstanceUID) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground text-sm">
        <AlertTriangle className="h-8 w-8" />
        <p>No StudyInstanceUID available for this worklist entry.</p>
      </div>
    );
  }

  return <ViewerContent studyInstanceUID={studyInstanceUID} accessionNumber={accessionNumber} controlRef={ref} />;
});

export default EmbeddedWadoViewer;

function ViewerContent({ studyInstanceUID, accessionNumber, controlRef }: {
  studyInstanceUID: string;
  accessionNumber?: string | null;
  controlRef?: ForwardedRef<EmbeddedViewerHandle>;
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

  const { data: launchData } = useQuery<ViewerLaunchData>({
    queryKey: ["viewer-launch", studyInstanceUID],
    queryFn: () => api.get(`/api/radiology/studies/${encodeURIComponent(studyInstanceUID)}/ohif-launch`),
    enabled: !!studyInstanceUID,
    staleTime: 5 * 60_000,
  });

  // Fetch series from DICOMweb
  const dicomWebBase = launchData?.dicomWebBaseUrl;

  const fetchSeries = useCallback(async () => {
    if (!dicomWebBase || !studyInstanceUID) return;
    try {
      const url = `${dicomWebBase}/studies/${encodeURIComponent(studyInstanceUID)}/series`;
      const res = await fetch(url, { headers: { Accept: "application/dicom+json" } });
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
      const res = await fetch(url, { headers: { Accept: "application/dicom+json" } });
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

  // Load frame image
  useEffect(() => {
    if (!dicomWebBase || !studyInstanceUID || !selectedSeriesUID || !instances[selectedInstIdx]) return;
    const inst = instances[selectedInstIdx];
    const url = `${dicomWebBase}/studies/${encodeURIComponent(studyInstanceUID)}/series/${encodeURIComponent(selectedSeriesUID)}/instances/${encodeURIComponent(inst.uid)}/rendered?quality=90&viewport=800,800`;
    setLoadingFrames(true);
    const img = new Image();
    img.onload = () => { setFrameUrl(url); setLoadingFrames(false); };
    img.onerror = () => { setLoadingFrames(false); };
    img.src = url;
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
  useImperativeHandle(controlRef, () => ({ nextFrame, prevFrame, zoomIn, zoomOut, resetView }));

  // Escape closes the enlarged view (matches every dialog in the app).
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

  return (
    <div className={`flex flex-col rounded-lg border overflow-hidden ${isExpanded ? "fixed inset-4 z-50 bg-background shadow-2xl" : "relative h-full"}`}>
      {/* Header — double-click anywhere on the bar toggles the enlarged view.
          (Double-clicks INSIDE the OHIF iframe belong to OHIF itself — it
          uses them to maximize its own viewports — and cannot reach us.) */}
      <div
        className="flex items-center justify-between gap-2 px-3 py-2 bg-muted/50 border-b flex-wrap cursor-pointer select-none"
        onDoubleClick={() => setIsExpanded((v) => !v)}
        title={isExpanded ? "Double-click to restore" : "Double-click to enlarge"}
        data-testid="viewer-header"
      >
        <div className="flex items-center gap-2 text-xs min-w-0">
          <Layers className="h-3.5 w-3.5 shrink-0" />
          <span className="font-semibold shrink-0">DICOM Viewer</span>
          {accessionNumber && <Badge variant="outline" className="text-[10px]">{accessionNumber}</Badge>}
          <Badge variant="outline" className="text-[10px] font-mono truncate">{studyInstanceUID.slice(0, 20)}...</Badge>
        </div>
        <div className="flex items-center gap-1">
          {/* OHIF ⇄ Frames toggle — Weasis is a desktop app and launches via
              the Open Study panel, it cannot render inside the page. */}
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
          {viewMode === "OHIF" && launchData?.ohifUrl && (
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Open OHIF in a new tab"
              onClick={() => window.open(launchData.ohifUrl!, "_blank")}>
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setIsExpanded((v) => !v)} title={isExpanded ? "Collapse" : "Expand"}>
            {isExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {viewMode === "OHIF" ? (
        /* ── In-page OHIF view box ─────────────────────────────────────── */
        launchData?.ohifUrl && window.location.protocol === "https:" && launchData.ohifUrl.startsWith("http:") ? (
          /* Mixed content: the browser refuses to frame an HTTP viewer inside
             an HTTPS page and shows nothing — say so instead of a blank box. */
          <div className="flex-1 min-h-[420px] flex flex-col items-center justify-center gap-2 p-4 text-center bg-black text-white/60 text-sm">
            <AlertTriangle className="h-8 w-8" />
            <p className="font-medium">OHIF cannot be embedded here</p>
            <p className="text-xs text-white/40 max-w-xs">
              This page is HTTPS but the configured OHIF URL is HTTP — the browser blocks embedding it.
              Use an HTTPS OHIF URL in PACS / DICOM Settings, or open it in a new tab.
            </p>
            <Button size="sm" variant="outline" className="h-7 text-xs mt-1"
              onClick={() => window.open(launchData.ohifUrl!, "_blank")}>
              <ExternalLink className="h-3.5 w-3.5 mr-1" /> Open OHIF in new tab
            </Button>
          </div>
        ) : launchData?.ohifUrl ? (
          <iframe
            title="OHIF viewer"
            src={launchData.ohifUrl}
            className="flex-1 w-full min-h-[420px] border-0 bg-black"
            allow="fullscreen"
            data-testid="ohif-embed"
          />
        ) : (
          <div className="flex-1 min-h-[420px] flex flex-col items-center justify-center gap-2 p-4 text-center bg-black text-white/60 text-sm">
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
            <div className="flex-1" />
            <span className="text-[10px] text-muted-foreground">B:{brightness}% C:{contrast}%</span>
            {launchData?.ohifUrl && (
              <Button size="sm" variant="ghost" className="h-7 px-1.5 text-xs" onClick={() => window.open(launchData.ohifUrl!, "_blank")}>
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>

          {/* Canvas */}
          <div
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
                style={{ transform: imageTransform, filter: imageFilter }}
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
