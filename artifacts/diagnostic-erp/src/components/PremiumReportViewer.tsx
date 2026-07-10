/**
 * PremiumReportViewer.tsx
 * Premium publication-quality report viewer + image selector.
 *
 * HOW TO USE — drop this into RadiologyReportGenerator.tsx
 * wherever the "Preview" panel appears:
 *
 *   import PremiumReportViewer from "@/components/PremiumReportViewer";
 *   <PremiumReportViewer
 *     data={reportData}
 *     studyInstanceUID={entry.studyInstanceUID}
 *     clinicInfo={clinicInfo}
 *   />
 *
 * It is completely standalone. It reads from existing state — no new APIs
 * or DB tables required. Images are fetched directly from Orthanc DICOMweb.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  renderPremiumReport,
  structureFindings,
  type PremiumReportData,
  type PremiumKeyImage,
  type PremiumTheme,
  type PremiumRenderOptions,
  DEFAULT_PREMIUM_OPTIONS,
} from "@/lib/premiumReportRenderer";
import {
  Eye, Download, Printer, Images, Settings2, RefreshCw,
  Check, Square, ChevronDown, ChevronUp, Palette,
  Loader2, X,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClinicInfo {
  name?: string | null;
  tagline?: string | null;
  address?: string | null;
  phone?: string | null;
  logoDataUrl?: string | null;
}

interface OrthancSeries {
  id: string;
  description?: string;
  modality?: string;
  instances: string[];
}

export interface PremiumReportViewerProps {
  data: Omit<PremiumReportData, "keyImages">;
  studyInstanceUID?: string | null;
  orthancStudyId?: string | null;   // if known; otherwise looked up from studyInstanceUID
  clinicInfo?: ClinicInfo | null;
  defaultTheme?: PremiumTheme;
  onClose?: () => void;
}

// ─── Orthanc image loader ─────────────────────────────────────────────────────

async function loadOrthancImage(instanceId: string, orthanc: string, auth: string): Promise<string | null> {
  try {
    const url = `${orthanc}/instances/${instanceId}/preview`;
    const resp = await fetch(url, {
      headers: auth ? { Authorization: auth } : {},
    });
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return new Promise((res) => {
      const reader = new FileReader();
      reader.onload = () => res(reader.result as string);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PremiumReportViewer({
  data,
  studyInstanceUID,
  orthancStudyId: propOrthancId,
  clinicInfo,
  defaultTheme = "modern",
  onClose,
}: PremiumReportViewerProps) {
  const { toast } = useToast();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // ── Options ──
  const [theme, setTheme] = useState<PremiumTheme>(defaultTheme);
  const [showOpts, setShowOpts] = useState(false);
  const [showImgPanel, setShowImgPanel] = useState(true);
  const [opts, setOpts] = useState<PremiumRenderOptions>({
    ...DEFAULT_PREMIUM_OPTIONS,
    theme,
    clinicName: clinicInfo?.name || "CARE DIAGNOSTICS",
    clinicTagline: clinicInfo?.tagline || undefined,
    clinicAddress: clinicInfo?.address || undefined,
    clinicPhone: clinicInfo?.phone || undefined,
    logoDataUrl: clinicInfo?.logoDataUrl || undefined,
  });

  // ── Image state ──
  const [series, setSeries] = useState<OrthancSeries[]>([]);
  const [selectedInstances, setSelectedInstances] = useState<Record<string, { caption: string; dataUrl: string | null }>>({});
  const [loadingImages, setLoadingImages] = useState(false);
  const [orthancBase, setOrthancBase] = useState("");
  const [orthancAuth, setOrthancAuth] = useState("");
  const [orthancStudyId, setOrthancStudyId] = useState(propOrthancId || "");

  // ── Rendered HTML ──
  const [reportHtml, setReportHtml] = useState<string>("");
  const [rendering, setRendering] = useState(false);

  // ── Load viewer settings (Orthanc URL) ──
  const { data: viewerSettings } = useQuery<Record<string, string>>({
    queryKey: ["pacs-viewer-settings"],
    queryFn: () => api.get("/api/pacs/settings"),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!viewerSettings) return;
    const base = (viewerSettings["dicom_web_base_url"] || "")
      .replace(/\/dicom-web$/, "")
      .replace(/\/$/, "");
    const user = viewerSettings["orthanc_username"] || "";
    const pass = viewerSettings["orthanc_password"] || "";
    setOrthancBase(base || "http://192.168.1.137:8042");
    if (user && pass) setOrthancAuth("Basic " + btoa(`${user}:${pass}`));
  }, [viewerSettings]);

  // ── Find Orthanc study ID from StudyInstanceUID ──
  useEffect(() => {
    if (orthancStudyId || !studyInstanceUID || !orthancBase) return;
    (async () => {
      try {
        const resp = await fetch(
          `${orthancBase}/tools/find`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(orthancAuth ? { Authorization: orthancAuth } : {}) },
            body: JSON.stringify({ Level: "Study", Query: { StudyInstanceUID: studyInstanceUID } }),
          }
        );
        if (!resp.ok) return;
        const ids = await resp.json() as string[];
        if (ids[0]) setOrthancStudyId(ids[0]);
      } catch { /* silently ignore */ }
    })();
  }, [studyInstanceUID, orthancBase, orthancAuth, orthancStudyId]);

  // ── Load series list ──
  const loadSeries = useCallback(async () => {
    if (!orthancStudyId || !orthancBase) return;
    setLoadingImages(true);
    try {
      const resp = await fetch(`${orthancBase}/studies/${orthancStudyId}/series`, {
        headers: orthancAuth ? { Authorization: orthancAuth } : {},
      });
      if (!resp.ok) throw new Error("Failed to load series");
      const seriesIds = await resp.json() as string[];
      const loaded: OrthancSeries[] = [];
      for (const sid of seriesIds.slice(0, 20)) {
        const sResp = await fetch(`${orthancBase}/series/${sid}`, {
          headers: orthancAuth ? { Authorization: orthancAuth } : {},
        });
        if (!sResp.ok) continue;
        const s = await sResp.json();
        loaded.push({
          id: sid,
          description: s.MainDicomTags?.SeriesDescription || s.MainDicomTags?.ProtocolName || `Series ${loaded.length + 1}`,
          modality: s.MainDicomTags?.Modality || "",
          instances: (s.Instances || []).slice(0, 30),
        });
      }
      setSeries(loaded);
    } catch (err) {
      toast({ title: "Could not load series from Orthanc", variant: "destructive" });
    } finally {
      setLoadingImages(false);
    }
  }, [orthancStudyId, orthancBase, orthancAuth, toast]);

  useEffect(() => { if (orthancStudyId) void loadSeries(); }, [orthancStudyId, loadSeries]);

  // ── Toggle image selection ──
  const toggleInstance = useCallback(async (seriesDesc: string, instanceId: string) => {
    if (selectedInstances[instanceId]) {
      setSelectedInstances(prev => { const next = { ...prev }; delete next[instanceId]; return next; });
      return;
    }
    // Load the image
    setSelectedInstances(prev => ({ ...prev, [instanceId]: { caption: seriesDesc, dataUrl: null } }));
    const dataUrl = await loadOrthancImage(instanceId, orthancBase, orthancAuth);
    setSelectedInstances(prev => ({
      ...prev,
      [instanceId]: { caption: seriesDesc, dataUrl },
    }));
  }, [selectedInstances, orthancBase, orthancAuth]);

  // ── Build final report data ──
  const buildReportData = useCallback((): PremiumReportData => {
    const keyImages: PremiumKeyImage[] = Object.entries(selectedInstances)
      .filter(([, v]) => v.dataUrl)
      .map(([, v], i) => ({ dataUrl: v.dataUrl!, caption: v.caption, sortOrder: i }));
    return { ...data, keyImages };
  }, [data, selectedInstances]);

  // ── Render ──
  const render = useCallback(() => {
    setRendering(true);
    try {
      const finalOpts: PremiumRenderOptions = {
        ...opts,
        theme,
        showImagePanel: showImgPanel,
        clinicName: clinicInfo?.name || opts.clinicName,
        logoDataUrl: clinicInfo?.logoDataUrl || opts.logoDataUrl || null,
      };
      const html = renderPremiumReport(buildReportData(), finalOpts);
      setReportHtml(html);
      setTimeout(() => {
        const iframe = iframeRef.current;
        if (iframe) {
          iframe.srcdoc = html;
        }
      }, 50);
    } finally {
      setRendering(false);
    }
  }, [opts, theme, showImgPanel, clinicInfo, buildReportData]);

  // Re-render when core data or selections change
  useEffect(() => { render(); }, [theme, showImgPanel, selectedInstances, opts.enableStructuredFindings]);

  // ── Print ──
  const handlePrint = () => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) { toast({ title: "Preview not ready" }); return; }
    iframe.contentWindow.print();
  };

  // ── Download HTML ──
  const handleDownload = () => {
    const html = renderPremiumReport(buildReportData(), { ...opts, theme, showImagePanel: showImgPanel, clinicName: clinicInfo?.name || opts.clinicName });
    const blob = new Blob([html], { type: "text/html" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `report-${data.accessionNumber || "report"}.html`;
    a.click();
  };

  const selectedCount = Object.keys(selectedInstances).length;

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100 rounded-xl overflow-hidden border border-slate-800">

      {/* ── Toolbar ── */}
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-900 border-b border-slate-800 flex-shrink-0">
        <Eye size={14} className="text-blue-400" />
        <span className="text-xs font-semibold text-slate-300 flex-1">Premium Report Preview</span>

        {/* Theme picker */}
        <div className="flex items-center gap-1 bg-slate-800 rounded px-2 py-1">
          <Palette size={11} className="text-slate-400" />
          <select
            value={theme}
            onChange={e => setTheme(e.target.value as PremiumTheme)}
            className="bg-transparent text-[10px] text-slate-300 border-none outline-none cursor-pointer"
          >
            <option value="modern">Modern</option>
            <option value="classic">Classic</option>
            <option value="journal">Journal</option>
            <option value="premium">Premium</option>
            <option value="minimal">Minimal</option>
          </select>
        </div>

        <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]"
          onClick={() => setShowImgPanel(v => !v)}>
          <Images size={11} className="mr-1" />
          {showImgPanel ? "Hide" : "Show"} Images
        </Button>

        <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]"
          onClick={() => setShowOpts(v => !v)}>
          <Settings2 size={11} className="mr-1" />
          Options
        </Button>

        <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={render}>
          <RefreshCw size={11} className={`mr-1 ${rendering ? "animate-spin" : ""}`} />
          Refresh
        </Button>

        <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] border-slate-700"
          onClick={handlePrint}>
          <Printer size={11} className="mr-1" /> Print
        </Button>

        <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] border-slate-700"
          onClick={handleDownload}>
          <Download size={11} className="mr-1" /> HTML
        </Button>

        {onClose && (
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-slate-400" onClick={onClose}>
            <X size={12} />
          </Button>
        )}
      </div>

      {/* ── Options panel ── */}
      {showOpts && (
        <div className="bg-slate-900 border-b border-slate-800 px-3 py-2 flex flex-wrap gap-4 text-[10px]">
          {[
            ["enableStructuredFindings", "Auto-structure findings"],
            ["enableDigitalSignature", "Digital signature"],
            ["enableQrVerification", "QR verification"],
            ["enableWatermark", "Watermark"],
          ].map(([key, label]) => (
            <label key={key} className="flex items-center gap-1.5 cursor-pointer text-slate-300">
              <input type="checkbox"
                checked={!!opts[key as keyof PremiumRenderOptions]}
                onChange={e => setOpts(o => ({ ...o, [key]: e.target.checked }))}
                className="w-3 h-3"
              />
              {label}
            </label>
          ))}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">

        {/* ── Image selector panel ── */}
        {showImgPanel && (
          <div className="w-52 flex-shrink-0 bg-slate-900 border-r border-slate-800 flex flex-col overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                Select Images
              </span>
              {selectedCount > 0 && (
                <Badge className="text-[9px] bg-blue-600 border-0 px-1.5 py-0">{selectedCount}</Badge>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-2 py-2 space-y-3">
              {!orthancStudyId ? (
                <p className="text-[10px] text-slate-500 text-center mt-4">
                  No DICOM study linked.<br />
                  Link study to enable image selection.
                </p>
              ) : loadingImages ? (
                <div className="flex items-center justify-center gap-2 mt-6">
                  <Loader2 size={12} className="animate-spin text-slate-400" />
                  <span className="text-[10px] text-slate-400">Loading series…</span>
                </div>
              ) : series.length === 0 ? (
                <p className="text-[10px] text-slate-500 text-center mt-4">
                  No series found in Orthanc.
                </p>
              ) : (
                series.map(s => (
                  <SeriesBlock
                    key={s.id}
                    series={s}
                    selectedInstances={selectedInstances}
                    onToggle={(instanceId) => void toggleInstance(s.description || s.id, instanceId)}
                    orthancBase={orthancBase}
                    orthancAuth={orthancAuth}
                  />
                ))
              )}
            </div>
          </div>
        )}

        {/* ── Report preview iframe ── */}
        <div className="flex-1 overflow-hidden bg-slate-200 relative">
          {rendering && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-10">
              <Loader2 size={20} className="animate-spin text-white" />
            </div>
          )}
          <iframe
            ref={iframeRef}
            className="w-full h-full border-none"
            title="Premium Report Preview"
            sandbox="allow-same-origin allow-popups"
          />
        </div>
      </div>
    </div>
  );
}

// ─── Series block ──────────────────────────────────────────────────────────────

function SeriesBlock({
  series, selectedInstances, onToggle, orthancBase, orthancAuth,
}: {
  series: OrthancSeries;
  selectedInstances: Record<string, { caption: string; dataUrl: string | null }>;
  onToggle: (id: string) => void;
  orthancBase: string;
  orthancAuth: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasSelected = series.instances.some(id => selectedInstances[id]);

  return (
    <div className="border border-slate-700 rounded-md overflow-hidden">
      <button
        className={`w-full flex items-center gap-1.5 px-2 py-1.5 text-left transition-colors
          ${hasSelected ? "bg-blue-900/40" : "bg-slate-800 hover:bg-slate-750"}`}
        onClick={() => setExpanded(v => !v)}
      >
        {hasSelected ? <Check size={11} className="text-blue-400 flex-shrink-0" /> : <Square size={11} className="text-slate-500 flex-shrink-0" />}
        <span className="text-[10px] font-medium text-slate-200 flex-1 truncate">
          {series.description || `Series`}
        </span>
        <span className="text-[9px] text-slate-500">{series.instances.length}</span>
        {expanded ? <ChevronUp size={10} className="text-slate-500" /> : <ChevronDown size={10} className="text-slate-500" />}
      </button>

      {expanded && (
        <div className="grid grid-cols-3 gap-1 p-1.5 bg-slate-950">
          {series.instances.slice(0, 30).map((instanceId, i) => (
            <InstanceThumb
              key={instanceId}
              instanceId={instanceId}
              index={i}
              selected={!!selectedInstances[instanceId]}
              loading={selectedInstances[instanceId]?.dataUrl === null}
              dataUrl={selectedInstances[instanceId]?.dataUrl || null}
              orthancBase={orthancBase}
              orthancAuth={orthancAuth}
              onToggle={() => onToggle(instanceId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Instance thumbnail ────────────────────────────────────────────────────────

function InstanceThumb({
  instanceId, index, selected, loading, dataUrl, orthancBase, orthancAuth, onToggle,
}: {
  instanceId: string; index: number; selected: boolean; loading: boolean;
  dataUrl: string | null; orthancBase: string; orthancAuth: string; onToggle: () => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [hovering, setHovering] = useState(false);

  useEffect(() => {
    if (!hovering || preview) return;
    loadOrthancImage(instanceId, orthancBase, orthancAuth).then(d => { if (d) setPreview(d); });
  }, [hovering, instanceId, orthancBase, orthancAuth, preview]);

  return (
    <button
      className={`relative aspect-square rounded overflow-hidden border-2 transition-all
        ${selected ? "border-blue-400" : "border-slate-700 hover:border-slate-500"}`}
      onClick={onToggle}
      onMouseEnter={() => setHovering(true)}
      title={`Image ${index + 1}${selected ? " (selected)" : ""}`}
    >
      {loading ? (
        <div className="w-full h-full bg-slate-800 flex items-center justify-center">
          <Loader2 size={10} className="animate-spin text-blue-400" />
        </div>
      ) : preview || dataUrl ? (
        <img src={preview || dataUrl!} className="w-full h-full object-contain bg-black" alt="" />
      ) : (
        <div className="w-full h-full bg-slate-800 flex items-center justify-center">
          <span className="text-[8px] text-slate-500">{index + 1}</span>
        </div>
      )}
      {selected && (
        <div className="absolute top-0.5 right-0.5 w-3.5 h-3.5 bg-blue-500 rounded-full flex items-center justify-center">
          <span className="text-white text-[7px]">✓</span>
        </div>
      )}
    </button>
  );
}
