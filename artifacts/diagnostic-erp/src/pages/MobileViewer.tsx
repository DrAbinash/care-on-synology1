/**
 * Mobile-optimized DICOM study viewer.
 * Accessed at /m/viewer/:studyInstanceUID — requires staff login.
 * Loads JPEG frames via Orthanc DICOMweb. Falls back to OHIF iframe on desktop.
 */
import { useState, useRef, useCallback } from "react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { readStaffSession } from "@/lib/staffSession";
import {
  ArrowLeft, ZoomIn, ZoomOut, RotateCcw, BrainCircuit,
  Sun, Moon, ChevronLeft, ChevronRight, Layers, ExternalLink,
  MonitorPlay, RefreshCw, AlertTriangle, Maximize2,
} from "lucide-react";

interface StudyInfo {
  studyInstanceUID: string;
  patientName: string | null;
  accessionNumber: string | null;
  ohifUrl: string | null;
  dicomWebBaseUrl: string | null;
  pacsType: string | null;
  error?: string;
}

interface DcmSeries {
  uid: string;
  description: string;
  modality: string;
  numInstances: number;
}

interface DcmInstance {
  uid: string;
  instanceNumber: number;
}

const TOUCH_THRESHOLD = 10;

function useGestureZoom(onZoom: (scale: number) => void) {
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

export default function MobileViewer() {
  const { studyInstanceUID } = useParams<{ studyInstanceUID: string }>();
  const session = readStaffSession();

  const [selectedSeriesUID, setSelectedSeriesUID] = useState<string | null>(null);
  const [selectedInstIdx, setSelectedInstIdx] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [showControls, setShowControls] = useState(true);
  const [showSeriesPanel, setShowSeriesPanel] = useState(false);
  const [series, setSeries] = useState<DcmSeries[]>([]);
  const [instances, setInstances] = useState<DcmInstance[]>([]);
  const [loadingFrames, setLoadingFrames] = useState(false);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);

  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, startPanX: 0, startPanY: 0 });

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-black text-white gap-4">
        <AlertTriangle size={32} className="text-amber-400" />
        <p className="font-semibold">Not authenticated</p>
        <a href="/erp" className="text-blue-400 underline text-sm">Log in to the ERP</a>
      </div>
    );
  }

  const { data: studyInfo, isLoading } = useQuery<StudyInfo>({
    queryKey: ["ohif-launch", studyInstanceUID],
    queryFn: () => api.get(`/api/radiology/studies/${studyInstanceUID}/ohif-launch`),
    enabled: !!studyInstanceUID,
    staleTime: 60_000,
  });

  async function loadSeriesFromDicomWeb(baseUrl: string) {
    try {
      const resp = await fetch(`${baseUrl}/studies/${studyInstanceUID}/series`, { headers: { Accept: "application/json" } });
      if (!resp.ok) return;
      const data = await resp.json() as Array<Record<string, { Value?: string[] }>>;
      const seriesList: DcmSeries[] = data.map((s) => ({
        uid: (s["0020000E"]?.Value?.[0] ?? "") as string,
        description: (s["0008103E"]?.Value?.[0] ?? s["00080060"]?.Value?.[0] ?? "Series") as string,
        modality: (s["00080060"]?.Value?.[0] ?? "OT") as string,
        numInstances: parseInt(String(s["00201209"]?.Value?.[0] ?? "0"), 10),
      })).filter((s) => s.uid);
      setSeries(seriesList);
      if (seriesList[0]) void loadInstances(baseUrl, seriesList[0].uid);
    } catch { /* silent */ }
  }

  async function loadInstances(baseUrl: string, seriesUID: string) {
    setSelectedSeriesUID(seriesUID);
    setSelectedInstIdx(0);
    setLoadingFrames(true);
    try {
      const resp = await fetch(`${baseUrl}/studies/${studyInstanceUID}/series/${seriesUID}/instances`, { headers: { Accept: "application/json" } });
      if (!resp.ok) return;
      const data = await resp.json() as Array<Record<string, { Value?: string[] }>>;
      const insts: DcmInstance[] = data
        .map((i) => ({
          uid: (i["00080018"]?.Value?.[0] ?? "") as string,
          instanceNumber: parseInt(String(i["00200013"]?.Value?.[0] ?? "0"), 10),
        }))
        .filter((i) => i.uid)
        .sort((a, b) => a.instanceNumber - b.instanceNumber);
      setInstances(insts);
      if (insts[0]) loadFrame(baseUrl, seriesUID, insts[0].uid);
    } finally {
      setLoadingFrames(false);
    }
  }

  function loadFrame(baseUrl: string, seriesUID: string, instanceUID: string) {
    const url = `${baseUrl}/studies/${studyInstanceUID}/series/${seriesUID}/instances/${instanceUID}/rendered?quality=80&viewport=512,512`;
    setFrameUrl(url);
  }

  function navigateFrame(dir: -1 | 1) {
    const newIdx = Math.max(0, Math.min(instances.length - 1, selectedInstIdx + dir));
    if (newIdx === selectedInstIdx) return;
    setSelectedInstIdx(newIdx);
    const inst = instances[newIdx];
    if (inst && selectedSeriesUID && studyInfo?.dicomWebBaseUrl) {
      loadFrame(studyInfo.dicomWebBaseUrl, selectedSeriesUID, inst.uid);
    }
  }

  const { handleTouchMove: handleZoomTouchMove, handleTouchEnd: handleZoomTouchEnd } = useGestureZoom(
    (delta) => setZoom((z) => Math.min(5, Math.max(0.5, z * delta))),
  );

  function handleMouseDown(e: React.MouseEvent) {
    dragRef.current = { dragging: true, startX: e.clientX, startY: e.clientY, startPanX: panX, startPanY: panY };
  }
  function handleMouseMove(e: React.MouseEvent) {
    if (!dragRef.current.dragging) return;
    if (Math.abs(e.clientX - dragRef.current.startX) < TOUCH_THRESHOLD && Math.abs(e.clientY - dragRef.current.startY) < TOUCH_THRESHOLD) return;
    setPanX(dragRef.current.startPanX + e.clientX - dragRef.current.startX);
    setPanY(dragRef.current.startPanY + e.clientY - dragRef.current.startY);
  }
  function handleMouseUp() { dragRef.current.dragging = false; }

  function resetView() { setZoom(1); setPanX(0); setPanY(0); setBrightness(100); setContrast(100); }

  const hasFrames = !!studyInfo?.dicomWebBaseUrl;

  return (
    <div className="flex flex-col h-screen bg-black overflow-hidden select-none">
      {/* Top bar */}
      {showControls && (
        <div className="flex items-center gap-2 px-3 py-2 bg-black/80 backdrop-blur-sm border-b border-white/10 shrink-0 z-20">
          <button className="text-white/70 hover:text-white p-1" onClick={() => window.history.back()}>
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-white text-xs font-semibold truncate">{studyInfo?.patientName ?? studyInstanceUID?.slice(0, 20)}</p>
            {studyInfo?.accessionNumber && <p className="text-white/50 text-[10px] font-mono">{studyInfo.accessionNumber}</p>}
          </div>
          <div className="flex items-center gap-2">
            {studyInfo?.ohifUrl && (
              <a href={studyInfo.ohifUrl} target="_blank" rel="noopener noreferrer">
                <button className="flex items-center gap-1 text-xs text-white/70 hover:text-white px-2 py-1 rounded border border-white/20">
                  <MonitorPlay size={12} /> OHIF
                </button>
              </a>
            )}
            <button className="text-white/70 hover:text-white p-1" onClick={() => setShowSeriesPanel(!showSeriesPanel)}>
              <Layers size={18} />
            </button>
          </div>
        </div>
      )}

      {/* Main viewer area */}
      <div
        className="flex-1 relative overflow-hidden cursor-grab active:cursor-grabbing"
        onClick={() => setShowControls(!showControls)}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchMove={handleZoomTouchMove}
        onTouchEnd={handleZoomTouchEnd}
      >
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <RefreshCw size={32} className="text-white/50 animate-spin" />
          </div>
        )}

        {!isLoading && !hasFrames && studyInfo?.ohifUrl && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6">
            <p className="text-white/60 text-sm text-center">DICOMweb not configured. Open in OHIF for full viewing.</p>
            <a href={studyInfo.ohifUrl} target="_blank" rel="noopener noreferrer">
              <Button className="gap-2">
                <MonitorPlay size={14} /> Open OHIF Viewer
              </Button>
            </a>
          </div>
        )}

        {!isLoading && hasFrames && instances.length === 0 && series.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Button className="gap-2" onClick={() => void loadSeriesFromDicomWeb(studyInfo?.dicomWebBaseUrl ?? "")}>
              <RefreshCw size={14} /> Load Study
            </Button>
          </div>
        )}

        {frameUrl && (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ transform: `translate(${panX}px, ${panY}px)` }}
          >
            <img
              src={frameUrl}
              alt="DICOM frame"
              className="max-w-none"
              style={{
                transform: `scale(${zoom})`,
                filter: `brightness(${brightness}%) contrast(${contrast}%)`,
                imageRendering: "pixelated",
                maxHeight: "100vh",
                maxWidth: "100vw",
                userSelect: "none",
              }}
              draggable={false}
              onError={() => setFrameUrl(null)}
            />
          </div>
        )}

        {loadingFrames && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <RefreshCw size={24} className="text-white animate-spin" />
          </div>
        )}

        {/* Frame counter */}
        {instances.length > 0 && (
          <div className="absolute bottom-20 left-1/2 -translate-x-1/2 bg-black/60 text-white/70 text-xs px-2 py-1 rounded-full">
            {selectedInstIdx + 1} / {instances.length}
          </div>
        )}
      </div>

      {/* Series panel */}
      {showSeriesPanel && (
        <div className="absolute right-0 top-12 bottom-0 w-64 bg-black/90 backdrop-blur border-l border-white/10 z-30 overflow-y-auto">
          <div className="p-3 border-b border-white/10 flex items-center justify-between">
            <p className="text-white text-xs font-semibold">Series</p>
            <button onClick={() => setShowSeriesPanel(false)} className="text-white/50"><X size={14} /></button>
          </div>
          {series.length === 0 ? (
            <div className="p-4">
              <Button size="sm" className="w-full gap-2 text-xs" onClick={() => void loadSeriesFromDicomWeb(studyInfo?.dicomWebBaseUrl ?? "")}>
                <RefreshCw size={12} /> Load Series
              </Button>
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {series.map((s) => (
                <button key={s.uid}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors ${selectedSeriesUID === s.uid ? "bg-white/20 text-white" : "text-white/60 hover:bg-white/10"}`}
                  onClick={() => studyInfo?.dicomWebBaseUrl && void loadInstances(studyInfo.dicomWebBaseUrl, s.uid)}
                >
                  <p className="font-medium truncate">{s.description || s.modality}</p>
                  <p className="text-[10px] opacity-60">{s.numInstances} images</p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Bottom controls */}
      {showControls && (
        <div className="shrink-0 bg-black/80 backdrop-blur border-t border-white/10 p-3 space-y-2 z-20">
          {/* Frame navigation */}
          {instances.length > 1 && (
            <div className="flex items-center gap-2">
              <button className="text-white/70 hover:text-white p-1" onClick={() => navigateFrame(-1)}><ChevronLeft size={20} /></button>
              <input
                type="range" min={0} max={instances.length - 1} value={selectedInstIdx}
                onChange={(e) => {
                  const idx = Number(e.target.value);
                  setSelectedInstIdx(idx);
                  const inst = instances[idx];
                  if (inst && selectedSeriesUID && studyInfo?.dicomWebBaseUrl) {
                    loadFrame(studyInfo.dicomWebBaseUrl, selectedSeriesUID, inst.uid);
                  }
                }}
                className="flex-1 h-1.5 accent-white"
              />
              <button className="text-white/70 hover:text-white p-1" onClick={() => navigateFrame(1)}><ChevronRight size={20} /></button>
            </div>
          )}

          {/* Zoom / Brightness / Contrast */}
          <div className="flex items-center gap-3">
            <button className="text-white/70 hover:text-white p-1" onClick={() => setZoom((z) => Math.min(5, z + 0.25))}><ZoomIn size={16} /></button>
            <button className="text-white/70 hover:text-white p-1" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}><ZoomOut size={16} /></button>
            <button className="text-white/70 hover:text-white p-1" onClick={resetView}><RotateCcw size={15} /></button>
            <div className="flex-1 flex items-center gap-1">
              <Sun size={12} className="text-white/50" />
              <input type="range" min={50} max={200} value={brightness} onChange={(e) => setBrightness(Number(e.target.value))} className="flex-1 h-1 accent-white" />
            </div>
            <div className="flex items-center gap-1">
              <Moon size={12} className="text-white/50" />
              <input type="range" min={50} max={200} value={contrast} onChange={(e) => setContrast(Number(e.target.value))} className="w-16 h-1 accent-white" />
            </div>
            <span className="text-white/40 text-xs font-mono">{Math.round(zoom * 100)}%</span>
          </div>
        </div>
      )}
    </div>
  );
}

// X is used above but not imported — add it:
function X({ size }: { size: number }) {
  return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>;
}
