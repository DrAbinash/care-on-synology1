/**
 * Radiology Command Center — operational console.
 *
 * @deprecated M1.1 consolidation — RadiologyReportingWorkspace
 * (/radiology/report/:studyId) is the canonical radiology reporting page, and
 * since B-10 it is the ONLY page that can author or sign a radiology report.
 *
 * This page used to carry a complete second copy of that workflow: its own
 * Findings/Impression/Recommendation/Technique fields, its own AI generators
 * writing straight into them, its own draft-save and finalize+sign buttons, and
 * its own HTML assembly that was stored verbatim as the signed report body. It
 * reached the same rows through lib/radiologyReportLifecycle, but with none of
 * the protections that live at the authoritative boundary — no Observation
 * Ledger, no placeholder guard, no non-destructive merge, no AI acceptance
 * target or proposal fingerprint, no signed-refusal, and no `isFinalized`
 * check (its report status was a label). A report could therefore be written
 * and signed here without ever passing through the surface that decides what a
 * report may say.
 *
 * What remains is operational and read-only: the worklist queue and its search,
 * per-study and patient context, the prior-report list, viewer launch (WEASIS,
 * OHIF, embedded), study locks and the takeover dialog, PACS archive retry, and
 * the dashboard metrics. Clinical text is edited, accepted from AI, finalized
 * and signed only in the Reporting Workspace, which this console hands off to
 * through lib/reportingWorkspaceRoute with the selected study's own row id.
 */

import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { api } from "@/lib/fetchApi";
import { readStaffSession, normalizeRole } from "@/lib/staffSession";
import { reportingWorkspacePath } from "@/lib/reportingWorkspaceRoute";
import DeprecatedSurfaceBanner from "@/components/radiology/DeprecatedSurfaceBanner";
import { useToast } from "@/hooks/use-toast";
import { launchViewer } from "@/lib/viewerService";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Activity, AlertCircle, AlertTriangle, ArrowUpRight, FileText, Grid,
  Info, Layers, ListCollapse, MonitorPlay, RefreshCw, Search, Send, Tv2, Wifi
} from "lucide-react";
import EmbeddedWadoViewer from "@/components/EmbeddedWadoViewer";

// ─── Types ──────────────────────────────────────────────────────────────────
type WorklistEntry = {
  id: number;
  studyId: number | null;
  patientId: number | null;
  dicomPatientId: string | null;
  patientName: string;
  age: string | null;
  sex: string | null;
  modality: string;
  studyDescription: string | null;
  studyDate: string | null;
  accessionNumber: string;
  studyInstanceUID: string | null;
  aeTitle: string | null;
  referringDoctor: string | null;
  weasisUrl: string | null;
  status: string;
  assignedRadiologist: string | null;
  aiDraftStatus: string;
  aiDraftJson?: string | null;
  reportId: number | null;
  deliveryStatus: string | null;
  pacsArchiveStatus?: string;
  pacsArchiveResponse?: string | null;
  pacsInstanceId?: string | null;
  bodyPart?: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * RIS-010 V3 (post-merge compatibility audit) — the archive can refuse for reasons that have nothing to
 * do with a missing signature: no Study Instance UID to link the object to, no patient record, or a
 * PCPNDT Form-F hold. `pacs_archive_response.blockReasons` is written by the server, so the badge names
 * the blocker it was given. An unreadable or absent payload falls back to the neutral wording — never to
 * a claim about signatures that the data does not support.
 */
function refusalBlockReasons(entry: { pacsArchiveResponse?: string | null }): string[] {
  try {
    const parsed = JSON.parse(String(entry.pacsArchiveResponse ?? "{}")) as { blockReasons?: unknown };
    return Array.isArray(parsed.blockReasons) ? parsed.blockReasons.map(String) : [];
  } catch {
    return [];
  }
}

function refusalLabel(entry: { pacsArchiveResponse?: string | null }): string {
  const codes = refusalBlockReasons(entry);
  if (codes.includes("no_study_uid")) return "Not Archived — No Study Instance UID";
  if (codes.some((c) => c.startsWith("pcpndt"))) return "Not Archived — Form-F Hold";
  if (codes.includes("no_patient")) return "Not Archived — No Patient Record";
  if (codes.some((c) => c === "no_report" || c === "not_finalized" || c === "superseded_report")) {
    return "Not Archived — No Signed Report";
  }
  return "Not Archived — See Retry";
}

function refusalDetail(entry: { pacsArchiveResponse?: string | null }): string {
  try {
    const parsed = JSON.parse(String(entry.pacsArchiveResponse ?? "{}")) as { message?: unknown };
    return typeof parsed.message === "string" && parsed.message.trim() ? parsed.message : "No reason recorded.";
  } catch {
    return "No reason recorded.";
  }
}

export default function RadiologyCommandCenter({ studyId }: { studyId?: number }) {
  const { studyId: routeStudyId } = useParams<{ studyId?: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const session = readStaffSession();

  // Active view: "workspace" or "dashboard"
  const [activeView, setActiveView] = useState<"workspace" | "dashboard">("workspace");

  // Selected study state
  const [activeStudyId, setActiveStudyId] = useState<number | null>(
    studyId ? Number(studyId) : routeStudyId ? Number(routeStudyId) : null
  );
  const [worklistOpen, setWorklistOpen] = useState(true);

  // Search & Filter for worklist sidebar
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [sidebarModality, setSidebarModality] = useState("all");


  // ══════════════════════════════════════════════════════════════════════════
  // DATA FETCHING
  // ══════════════════════════════════════════════════════════════════════════

  // 1. Worklist Queue for Sidebar
  const { data: queue = [], isLoading: queueLoading } = useQuery<WorklistEntry[]>({
    queryKey: ["radiology-pacs-worklist"],
    queryFn: () => api.get<WorklistEntry[]>("/api/radiology/pacs-worklist"),
    refetchInterval: 30000,
  });

  // 2. Active Study Details
  const { data: study, isLoading: studyLoading } = useQuery<WorklistEntry>({
    queryKey: ["workspace-entry", activeStudyId],
    queryFn: () => api.get<WorklistEntry>(`/api/internal/radiology/worklist/${activeStudyId}`),
    enabled: activeStudyId !== null,
  });

  // 3. Viewer settings
  const { data: pacsViewerSettings = {} } = useQuery<Record<string, string>>({
    queryKey: ["pacs-viewer-settings"],
    queryFn: async () => {
      const rows = await api.get<any[]>("/api/radiology/pacs-settings");
      const map: Record<string, string> = {};
      for (const r of rows) if (r.category === "viewer") map[r.key] = r.value;
      return map;
    },
  });

  // 5. Patient's Prior Reports
  const activePatientId = study?.patientId;
  const { data: priorReports } = useQuery<any>({
    queryKey: ["patient-prior-reports", activePatientId],
    queryFn: () => api.get<any>(`/api/patient-reports/patient/${activePatientId}`),
    enabled: !!activePatientId,
  });

  // 6. Operational Dashboard metrics
  const { data: metrics, refetch: refetchMetrics } = useQuery<any>({
    queryKey: ["command-center"],
    queryFn: () => api.get("/api/radiology-workflow/command-center"),
    enabled: activeView === "dashboard",
    refetchInterval: 10000,
  });


  // ══════════════════════════════════════════════════════════════════════════
  // EFFECTS & AUTO-DETECTION
  // ══════════════════════════════════════════════════════════════════════════

  // Auto-load parameter if route changes
  useEffect(() => {
    if (routeStudyId) {
      setActiveStudyId(Number(routeStudyId));
    }
  }, [routeStudyId]);

  // Locking system states
  const [isViewOnly, setIsViewOnly] = useState(false);
  const [takeoverOpen, setTakeoverOpen] = useState(false);
  const [currentLockOwner, setCurrentLockOwner] = useState<{ userId: number; userName: string; workstation?: string; lockTime?: string } | null>(null);

  // Periodic lock acquisition and heartbeat hook
  useEffect(() => {
    if (!activeStudyId || !session) return;

    let heartbeatInterval: any;

    const acquireOrRefreshLock = async (forceOverride = false) => {
      try {
        const res = await api.post<{ success: boolean; error?: string; lock?: any }>(
          `/api/radiology/studies/${activeStudyId}/lock`,
          { workstation: window.location.hostname || "WebBrowser", force: forceOverride }
        );
        if (res.success) {
          setIsViewOnly(false);
          setTakeoverOpen(false);
          setCurrentLockOwner(null);
        }
      } catch (err: any) {
        if (err.status === 409) {
          // Conflict: locked by someone else
          try {
            const data = await err.json();
            if (data.lock) {
              setCurrentLockOwner(data.lock);
              setIsViewOnly(true);
              setTakeoverOpen(true);
            }
          } catch {
            setIsViewOnly(true);
            setTakeoverOpen(true);
          }
        } else {
          console.error("Lock error:", err);
        }
      }
    };

    // Initial acquire
    acquireOrRefreshLock();

    // Heartbeat every 10 seconds
    heartbeatInterval = setInterval(() => {
      if (!isViewOnly) {
        acquireOrRefreshLock();
      }
    }, 10000);

    // Release lock on unmount or active study change
    return () => {
      clearInterval(heartbeatInterval);
      api.delete(`/api/radiology/studies/${activeStudyId}/lock`).catch(() => undefined);
    };
  }, [activeStudyId, session, isViewOnly]);

  // Page unload release handler
  useEffect(() => {
    const handleUnload = () => {
      if (activeStudyId && !isViewOnly) {
        // Use keepalive / sendBeacon pattern or sync fetch
        navigator.sendBeacon(`/api/radiology/studies/${activeStudyId}/lock`);
      }
    };
    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, [activeStudyId, isViewOnly]);

  // If no study loaded yet, auto-load the first one from the queue
  useEffect(() => {
    if (!activeStudyId && queue.length > 0) {
      setActiveStudyId(queue[0].id);
    }
  }, [queue, activeStudyId]);




  // ══════════════════════════════════════════════════════════════════════════
  // RENDER FILTERED SIDEBAR WORKLIST
  // ══════════════════════════════════════════════════════════════════════════
  const filteredQueue = useMemo(() => {
    return queue.filter((e) => {
      if (sidebarModality !== "all" && e.modality !== sidebarModality) return false;
      if (!sidebarSearch) return true;
      const s = sidebarSearch.toLowerCase();
      return (
        e.patientName.toLowerCase().includes(s) ||
        (e.accessionNumber || "").toLowerCase().includes(s) ||
        (e.studyDescription || "").toLowerCase().includes(s)
      );
    });
  }, [queue, sidebarSearch, sidebarModality]);


  return (
    <div className="min-h-[calc(100vh-3rem)] bg-slate-950 text-slate-100 flex flex-col font-sans select-none">
      <DeprecatedSurfaceBanner
        surface="Radiology Command Center"
        note="reports finalized here now follow the canonical READY_TO_SEND flow"
      />

      {/* Header bar */}
      <div className="h-14 border-b border-slate-800 bg-slate-900/90 flex items-center justify-between px-4 shrink-0 z-10">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="text-slate-400 hover:text-slate-100"
            onClick={() => setWorklistOpen(!worklistOpen)}
          >
            <ListCollapse size={18} />
          </Button>
          <span className="font-bold text-sm tracking-wide text-slate-200 uppercase flex items-center gap-2">
            <Layers className="text-emerald-500 w-4 h-4" />
            Radiology Command Center
          </span>
          
          {/* View switcher */}
          <div className="flex bg-slate-950 rounded-lg p-1 border border-slate-800 ml-4">
            <button
              onClick={() => setActiveView("workspace")}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${activeView === "workspace" ? "bg-slate-800 text-emerald-400" : "text-slate-400 hover:text-slate-200"}`}
            >
              Interactive Workspace
            </button>
            <button
              onClick={() => setActiveView("dashboard")}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${activeView === "dashboard" ? "bg-slate-800 text-emerald-400" : "text-slate-400 hover:text-slate-200"}`}
            >
              Operational Dashboard
            </button>
          </div>
        </div>

        {/* B-10: this header link carries the selected study, so leaving the
            console does not drop the radiologist on an empty workspace. */}
        <div className="flex items-center gap-2">
          <Button variant="link" onClick={() => navigate(activeStudyId !== null ? reportingWorkspacePath(activeStudyId) : "/radiology/reporting-workspace")} className="text-xs text-emerald-400 hover:text-emerald-300 p-1">
            Reporting Workspace (canonical)
          </Button>
          <span className="text-slate-700">|</span>
          <Button variant="link" onClick={() => navigate("/radiology/structured-report-templates")} className="text-xs text-slate-400 hover:text-slate-200 p-1">
            Legacy Templates
          </Button>
          <span className="text-slate-700">|</span>
          <Button variant="link" onClick={() => navigate("/radiology/normal-templates")} className="text-xs text-slate-400 hover:text-slate-200 p-1">
            Legacy Findings
          </Button>
        </div>
      </div>

      {/* Main Layout Area */}
      {activeView === "dashboard" ? (
        /* Render Operational Dashboard metrics (preserved feature) */
        <div className="p-6 overflow-y-auto flex-1">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-6">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-slate-400">Pending Reports</p>
              <h3 className="text-2xl font-bold text-slate-100">{metrics?.pendingReports ?? "—"}</h3>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-slate-400">Critical Alerts</p>
              <h3 className="text-2xl font-bold text-rose-500">{metrics?.criticalAlerts ?? "—"}</h3>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-slate-400">Studies Today</p>
              <h3 className="text-2xl font-bold text-emerald-400">{metrics?.studiesToday ?? "—"}</h3>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-slate-400">AI Queued</p>
              <h3 className="text-2xl font-bold text-cyan-400">{metrics?.aiQueue?.queued ?? "—"}</h3>
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-6">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <Wifi size={14} className="text-emerald-400" /> Modality Stations Status
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-4">
              {metrics?.modalities?.map((m: any) => (
                <div key={m.modality} className="border border-slate-800 rounded-lg p-3 text-center">
                  <p className="text-xs text-slate-400 uppercase font-mono">{m.modality}</p>
                  <p className="text-lg font-bold mt-1 text-slate-100">{m.online}/{m.total}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        /* Workspace mode */
        <div className="flex flex-1 overflow-hidden">
          
          {/* 1. COLLAPSIBLE WORKLIST SIDEBAR */}
          {worklistOpen && (
            <div className="w-80 border-r border-slate-800 bg-slate-900/60 backdrop-blur flex flex-col shrink-0">
              <div className="p-3 border-b border-slate-800 flex flex-col gap-2 shrink-0">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Queue</span>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-500" />
                  <Input
                    placeholder="Search patients..."
                    value={sidebarSearch}
                    onChange={(e) => setSidebarSearch(e.target.value)}
                    className="h-8 pl-8 text-xs bg-slate-950 border-slate-800 text-slate-200"
                  />
                </div>
                <select
                  value={sidebarModality}
                  onChange={(e) => setSidebarModality(e.target.value)}
                  className="h-8 text-xs border border-slate-800 rounded bg-slate-950 text-slate-200"
                >
                  <option value="all">All Modalities</option>
                  <option value="MR">MRI</option>
                  <option value="CT">CT</option>
                  <option value="X-RAY">X-Ray</option>
                  <option value="US">Ultrasound</option>
                </select>
              </div>

              <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                {queueLoading ? (
                  <p className="text-xs text-slate-500 text-center py-4">Loading queue...</p>
                ) : filteredQueue.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-4">No studies found</p>
                ) : (
                  filteredQueue.map((e) => (
                    <button
                      key={e.id}
                      onClick={() => setActiveStudyId(e.id)}
                      className={`w-full text-left p-3 rounded-lg border transition-all flex flex-col gap-1 ${e.id === activeStudyId ? "bg-slate-800 border-emerald-500 shadow-md" : "bg-slate-900/40 border-slate-800 hover:bg-slate-800/40"}`}
                    >
                      <div className="flex justify-between items-start">
                        <span className="font-bold text-xs text-slate-200 truncate flex-1 pr-1">{e.patientName}</span>
                        <Badge variant="outline" className="text-[9px] px-1 h-4 font-mono text-emerald-400 border-emerald-800/40">{e.modality}</Badge>
                      </div>
                      <span className="text-[10px] text-slate-500 truncate">{e.studyDescription || "No study desc"}</span>
                      <div className="flex justify-between items-center text-[9px] text-slate-500 font-mono mt-1 pt-1 border-t border-slate-800/40">
                        <span>ACC: {e.accessionNumber}</span>
                        <span>{e.studyDate || "—"}</span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Core Workspace containing Left, Center, Right & Bottom Reporting panels */}
          <div className="flex-1 flex flex-col overflow-hidden">
            
            {/* Top Workspace Grid (Left Panel + Center Panel + Right Panel) */}
            <div className="flex-1 flex overflow-hidden">
              
              {/* 2. LEFT PANEL: Study information & Patient details */}
              <div className="w-80 border-r border-slate-800 bg-slate-950 overflow-y-auto p-4 flex flex-col gap-4">
                <div className="space-y-3">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Patient & Study Info</h3>
                  {studyLoading ? (
                    <p className="text-xs text-slate-500">Loading study info...</p>
                  ) : !study ? (
                    <p className="text-xs text-slate-500">Select a study to view details</p>
                  ) : (
                    <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-3 space-y-2.5 text-xs">
                      <div>
                        <p className="text-slate-500 text-[10px]">Patient Name</p>
                        <p className="font-semibold text-slate-200">{study.patientName}</p>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <p className="text-slate-500 text-[10px]">Age / Sex</p>
                          <p className="font-semibold text-slate-200">{[study.age, study.sex].filter(Boolean).join(" / ")}</p>
                        </div>
                        <div>
                          <p className="text-slate-500 text-[10px]">Modality</p>
                          <Badge className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">{study.modality}</Badge>
                        </div>
                      </div>
                      <div>
                        <p className="text-slate-500 text-[10px]">Accession Number</p>
                        <p className="font-mono text-slate-200">{study.accessionNumber}</p>
                      </div>
                      <div>
                        <p className="text-slate-500 text-[10px]">Study Description</p>
                        <p className="font-semibold text-slate-200">{study.studyDescription || "—"}</p>
                      </div>
                      <div>
                        <p className="text-slate-500 text-[10px]">Referring Doctor</p>
                        <p className="text-slate-300">{study.referringDoctor || "—"}</p>
                      </div>
                      <div>
                        <p className="text-slate-500 text-[10px]">Study Date</p>
                        <p className="text-slate-300">{study.studyDate || "—"}</p>
                      </div>
                      <div>
                        <p className="text-slate-500 text-[10px]">Report Status</p>
                        <Badge variant="outline" className="mt-0.5 text-slate-300 border-slate-700 bg-slate-950 font-mono">
                          {study.status || "DRAFT"}
                        </Badge>
                      </div>
                      <div>
                        <p className="text-slate-500 text-[10px]">PACS Archival Status</p>
                        <div className="mt-1 flex items-center gap-2 flex-wrap">
                          {study.pacsArchiveStatus === "success" && (
                            <Badge className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                              ✓ Archived to PACS
                            </Badge>
                          )}
                          {(study.pacsArchiveStatus === "pending" || study.pacsArchiveStatus === "REPORT_FINAL") && (
                            <Badge className="bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse">
                              Pending PACS Archive
                            </Badge>
                          )}
                          {study.pacsArchiveStatus === "failed" && (
                            <Badge className="bg-red-500/10 text-red-400 border border-red-500/20">
                              Archive Failed
                            </Badge>
                          )}
                          {/* RIS-010 DECISION 2 — nothing was filed, and it is not a failure, so it must
                              not read as one. RIS-010 V3 (post-merge audit) — the label names the blocker
                              the archive actually reported instead of asserting a missing signature. */}
                          {study.pacsArchiveStatus === "refused" && (
                            <Badge
                              className="bg-slate-500/10 text-slate-300 border border-slate-500/25"
                              title={refusalDetail(study)}
                            >
                              {refusalLabel(study)}
                            </Badge>
                          )}
                          {(!study.pacsArchiveStatus || study.pacsArchiveStatus === "none") && (
                            <Badge variant="outline" className="text-slate-400 border-slate-800">
                              Not Archived
                            </Badge>
                          )}
                          
                          {(study.pacsArchiveStatus === "failed" || study.pacsArchiveStatus === "refused" || study.pacsArchiveStatus === "none" || !study.pacsArchiveStatus) && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-5 px-2 text-[9px] text-emerald-400 hover:text-emerald-300 hover:bg-slate-800 flex items-center gap-1"
                              onClick={async () => {
                                try {
                                  toast({ title: "Retrying archive...", description: "Uploading report to PACS..." });
                                  const res = await api.post<{
                                    success: boolean; error?: string; message?: string;
                                    idempotent?: boolean; refused?: boolean;
                                  }>(`/api/radiology/studies/${study.studyId}/archive-retry`, {});
                                  if (res.success && res.idempotent) {
                                    // DECISION 3 — this revision is already in PACS; no second copy was made.
                                    toast({ title: "Already archived", description: res.message || "This report version is already in PACS." });
                                  } else if (res.success) {
                                    toast({ title: "Archived", description: "Report successfully archived to PACS!" });
                                  } else if (res.refused) {
                                    toast({ title: "Not archived", description: res.message || res.error || "No finalized signed report available for this examination." });
                                  } else {
                                    toast({ title: "Archive Failed", description: res.error || "Unknown error occurred", variant: "destructive" });
                                  }
                                  qc.invalidateQueries({ queryKey: ["workspace-entry", activeStudyId] });
                                } catch (err: any) {
                                  toast({ title: "Error", description: err.message, variant: "destructive" });
                                }
                              }}
                            >
                              <RefreshCw size={8} /> Retry
                            </Button>
                          )}
                        </div>
                      </div>
                      <div>
                        <p className="text-slate-500 text-[10px]">Study Instance UID / ID</p>
                        <p className="font-mono text-[10px] text-slate-400 break-all select-all">
                          {study.studyInstanceUID || "—"}
                        </p>
                        {!study.studyInstanceUID && (
                          <p className="text-red-400 font-semibold text-[10px] mt-1 flex items-center gap-1">
                            <AlertCircle size={10} className="shrink-0 animate-bounce" />
                            Study UID missing; viewer launch may not work.
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Patient's Previous Reports */}
                <div className="space-y-2 border-t border-slate-800 pt-4 flex-1">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <FileText size={13} className="text-emerald-400" />
                    Previous Reports
                  </h3>
                  <div className="space-y-2 overflow-y-auto">
                    {priorReports?.items?.length > 0 ? (
                      priorReports.items.map((r: any) => (
                        <div key={r.id} className="border border-slate-800 bg-slate-900/30 p-2.5 rounded text-[11px] hover:bg-slate-900/50 cursor-pointer">
                          <p className="font-semibold text-slate-300">{r.title}</p>
                          <p className="text-slate-500 font-mono mt-0.5">{new Date(r.createdAt).toLocaleDateString()}</p>
                          <p className="text-slate-400 line-clamp-2 mt-1">{r.impression || r.body}</p>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-slate-500">No prior reports found for this patient.</p>
                    )}
                  </div>
                </div>
              </div>

              {/* 3. CENTER PANEL: Viewer Area */}
              <div className="flex-1 bg-slate-950 border-r border-slate-800 flex flex-col overflow-hidden">
                <div className="p-3 border-b border-slate-800 bg-slate-900/20 flex items-center justify-between shrink-0">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Viewer Workspace</span>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
                      onClick={() => launchViewer(study?.studyInstanceUID, "WEASIS", pacsViewerSettings, toast)}
                      disabled={!study}
                    >
                      <Tv2 size={12} className="mr-1.5 text-blue-400" /> Weasis
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
                      onClick={() => launchViewer(study?.studyInstanceUID, "OHIF", pacsViewerSettings, toast)}
                      disabled={!study}
                    >
                      <MonitorPlay size={12} className="mr-1.5 text-emerald-400" /> OHIF
                    </Button>
                  </div>
                </div>

                <div className="flex-1 bg-slate-900/30 overflow-hidden relative">
                  {study?.studyInstanceUID ? (
                    <EmbeddedWadoViewer
                      studyInstanceUID={study.studyInstanceUID}
                      accessionNumber={study.accessionNumber}
                    />
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center">
                      <MonitorPlay size={44} className="text-slate-800 animate-pulse mb-3" />
                      <p className="text-sm font-semibold text-slate-400">PACS DICOM Viewer Viewport</p>
                      <p className="text-xs text-slate-500 mt-1 max-w-sm">
                        Use the top Weasis or OHIF buttons to open the complete image stacks in an external window.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* 4. RIGHT PANEL: operational state + handoff. Reporting lives
                  in RadiologyReportingWorkspace: this console has no narrative
                  field, no AI insert, no draft save and no finalize. */}
              <div className="w-80 border-slate-800 bg-slate-950 overflow-y-auto p-4 flex flex-col gap-4">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 shrink-0">
                  <Activity size={12} /> Study Status
                </h3>
                <dl className="space-y-2 text-xs">
                  {([
                    ["Report status", study?.status ?? "—"],
                    ["AI draft", study?.aiDraftStatus ?? "—"],
                    ["Delivery", study?.deliveryStatus ?? "—"],
                    ["Report row", study?.reportId ? String(study.reportId) : "none yet"],
                    ["Accession", study?.accessionNumber || "—"],
                    ["Assigned", study?.assignedRadiologist || "unassigned"],
                  ] as [string, string][]).map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-2 border-b border-slate-900 pb-1">
                      <dt className="text-slate-500 shrink-0">{label}</dt>
                      <dd className="text-slate-300 text-right truncate">{value}</dd>
                    </div>
                  ))}
                </dl>

                <div
                  data-testid="command-center-report-handoff"
                  className="mt-auto rounded-lg border border-emerald-900/60 bg-emerald-950/20 p-3 flex flex-col gap-2"
                >
                  <p className="text-[11px] text-emerald-200 font-semibold flex items-center gap-1.5">
                    <FileText size={12} /> Reporting happens in the Reporting Workspace
                  </p>
                  <p className="text-[10px] text-slate-400 leading-relaxed">
                    Findings, Impression, AI acceptance, finalizing and signing are only
                    available there, so a report has one authoring boundary. This screen
                    stays operational: queue, images, locks and status.
                  </p>
                  <Button
                    size="sm"
                    className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-semibold justify-center"
                    disabled={activeStudyId === null}
                    onClick={() => {
                      if (activeStudyId !== null) navigate(reportingWorkspacePath(activeStudyId));
                    }}
                  >
                    <ArrowUpRight size={12} className="mr-1.5" />
                    Open in Reporting Workspace
                  </Button>
                </div>
              </div>


            </div>


          </div>
        </div>
      )}

      {/* Lock Takeover Modal / Overlay */}
      {takeoverOpen && currentLockOwner && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in zoom-in-95 duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-red-500">
              <AlertTriangle className="h-6 w-6 animate-bounce" />
              <h3 className="text-lg font-bold text-slate-200">Concurrent Reporting Alert</h3>
            </div>
            
            <p className="text-sm text-slate-400">
              This study is currently locked for reporting by <span className="font-semibold text-slate-200">{currentLockOwner.userName}</span> (Workstation: {currentLockOwner.workstation || "Unknown"}) since {currentLockOwner.lockTime ? new Date(currentLockOwner.lockTime).toLocaleTimeString() : "some time"}.
            </p>

            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800/60 text-xs text-slate-500">
              <span className="font-semibold block text-slate-400 mb-1">Takeover / View Only Policy:</span>
              To prevent accidental report overwrites and duplicate reporting, you are in <span className="text-red-400 font-semibold">View-Only</span> mode.
            </div>

            <div className="flex flex-col gap-2 pt-2">
              <Button
                variant="outline"
                className="w-full text-xs h-9 bg-slate-950 hover:bg-slate-900 border-slate-800 text-slate-300"
                onClick={() => setTakeoverOpen(false)}
              >
                Continue in View Only Mode
              </Button>

              <Button
                variant="outline"
                className="w-full text-xs h-9 border-slate-800 text-slate-300 hover:bg-slate-900 flex items-center justify-center gap-1.5"
                onClick={async () => {
                  try {
                    // Send notification to lock owner (mock or audit log based)
                    await api.post(`/api/radiology/knowledge/analytics/usage`, {
                      action: "LOCK_RELEASE_REQUESTED",
                      details: JSON.stringify({
                        studyId: activeStudyId,
                        requestedBy: session?.user?.name,
                        lockOwner: currentLockOwner.userName
                      })
                    });
                    toast({
                      title: "Release Request Logged",
                      description: `Logged a request to release study lock for ${currentLockOwner.userName}. Please contact them.`
                    });
                  } catch (err: any) {
                    toast({ title: "Request failed", description: err.message, variant: "destructive" });
                  }
                }}
              >
                Request Lock Release
              </Button>

              {(normalizeRole(session?.user?.role ?? "") === "admin" || normalizeRole(session?.user?.role ?? "") === "super_admin") && (
                <Button
                  className="w-full text-xs h-9 bg-red-600 hover:bg-red-700 text-white font-semibold flex items-center justify-center gap-1.5"
                  onClick={async () => {
                    if (confirm(`ADMIN OVERRIDE: Break lock held by ${currentLockOwner.userName}?`)) {
                      try {
                        const res = await api.post<{ success: boolean; error?: string; lock?: any }>(
                          `/api/radiology/studies/${activeStudyId}/lock`,
                          { force: true, workstation: window.location.hostname || "WebBrowser" }
                        );
                        if (res.success) {
                          setIsViewOnly(false);
                          setTakeoverOpen(false);
                          setCurrentLockOwner(null);
                          toast({ title: "Lock Overridden", description: "You have acquired the lock. Draft is now editable." });
                        }
                      } catch (err: any) {
                        toast({ title: "Override failed", description: err.message, variant: "destructive" });
                      }
                    }
                  }}
                >
                  Force Admin Override
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
