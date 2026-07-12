import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { api } from "@/lib/fetchApi";
import { readStaffSession, ERP_SESSION_KEY, canAccess, normalizeRole } from "@/lib/staffSession";
import { toUnifiedStatus, worklistRoleView, priorityInfo, type WorklistRoleView } from "@/lib/radiologyStatus";
import { launchViewer } from "@/lib/viewerService";
import { normalizeModality, isUltrasoundModality } from "@/lib/usgModality";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  ScanSearch, RefreshCw, ExternalLink, Sparkles, FileEdit, CheckCircle2,
  Search, Filter, Clock, CheckCheck, AlertCircle, MonitorPlay, Tv2,
  ClipboardList, CalendarDays, ShieldCheck, ShieldOff, Database,
  ChevronDown, ChevronUp, Eye, MessageSquare, ThumbsUp, ThumbsDown, Trash2,
  X, Activity, Stethoscope, Printer, Gem,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { MwlPanel } from "@/pages/MwlDashboard";

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
  ipAddress: string | null;
  port: number | null;
  referringDoctor: string | null;
  weasisUrl: string | null;
  sourceAeTitle: string | null;
  status: string;
  assignedRadiologist: string | null;
  aiDraftStatus: string;
  reportId: number | null;
  deliveryStatus: string | null;
  uhid?: string | null;        // Phase C: ERP UHID via patients join
  billNumber?: string | null;  // Phase C: bill number via study→bill join
  priority?: string | null;    // Phase C: reuses radiology_studies.priority
  // R2.0 — canonical ultrasound integration: USG/Doppler measurement +
  // key-image counts and latest report-draft status, scalar-subqueried by
  // worklistId in GET /api/radiology/pacs-worklist. Present for every row;
  // 0/null for non-ultrasound studies with no USG data.
  usgMeasurementCount?: number;
  usgKeyImageCount?: number;
  usgReportStatus?: "draft" | "pending_review" | "verified" | "finalized" | "amended" | "archived" | null;
  createdAt: string;
  updatedAt: string;
  lockUserId?: number | null;
  lockUserName?: string | null;
  lockTime?: string | null;
  lockLastActivityAt?: string | null;
  lockWorkstation?: string | null;
};

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  STUDY_RECEIVED: { label: "Received", color: "bg-blue-100 text-blue-800 border-blue-200", icon: <Clock className="h-3 w-3" /> },
  AI_DRAFT_READY: { label: "AI Draft Ready", color: "bg-purple-100 text-purple-800 border-purple-200", icon: <Sparkles className="h-3 w-3" /> },
  REPORT_IN_PROGRESS: { label: "In Progress", color: "bg-yellow-100 text-yellow-800 border-yellow-200", icon: <FileEdit className="h-3 w-3" /> },
  REPORT_FINAL: { label: "Final", color: "bg-green-100 text-green-800 border-green-200", icon: <CheckCircle2 className="h-3 w-3" /> },
  DELIVERED: { label: "Delivered", color: "bg-gray-100 text-gray-700 border-gray-200", icon: <CheckCheck className="h-3 w-3" /> },
};

function StatusBadge({ status, deliveryStatus }: { status: string; deliveryStatus?: string | null }) {
  // Phase C: staff always see the unified 7-step vocabulary. The raw
  // internal status stays visible in the tooltip for troubleshooting.
  const u = toUnifiedStatus(status, deliveryStatus);
  const icon = STATUS_CONFIG[status]?.icon ?? null;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${u.color}`}
      title={`Internal status: ${status}${deliveryStatus ? ` · delivery: ${deliveryStatus}` : ""}`}
    >
      {icon}
      {u.label}
    </span>
  );
}

function LockBadge({ entry, currentUserId }: { entry: any; currentUserId?: number | null }) {
  const lastAct = entry.lockLastActivityAt || entry.lockTime;
  // M1.6A — prefer the SERVER-computed expiry (lock_last_activity_at + the
  // configured TTL); the 30-minute window is only the pre-lock-era fallback.
  const isLocked = entry.lockUserId && (
    entry.lockExpiresAt
      ? new Date(entry.lockExpiresAt).getTime() > Date.now()
      : lastAct && (Date.now() - new Date(lastAct).getTime()) <= 30 * 60 * 1000
  );
  
  if (!isLocked) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/50">
        <span className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse" />
        Available
      </span>
    );
  }

  const isMine = entry.lockUserId === currentUserId;
  const timeStr = entry.lockTime ? new Date(entry.lockTime).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : "";

  if (isMine) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-400 border border-yellow-200 dark:border-yellow-900/50" title={`Locked by you at ${timeStr}`}>
        <span className="w-1 h-1 rounded-full bg-yellow-500" />
        Opened by You
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-400 border border-red-200 dark:border-red-900/50" title={`Locked by ${entry.lockUserName || "another user"} at ${timeStr}`}>
      <span className="w-1 h-1 rounded-full bg-red-500" />
      Locked by {entry.lockUserName || "User"}
    </span>
  );
}

const MODALITY_OPTIONS = ["all", "CR", "MR", "CT", "US", "MG", "BMD", "OT"];
const STATUS_OPTIONS = ["all", "STUDY_RECEIVED", "AI_DRAFT_READY", "REPORT_IN_PROGRESS", "REPORT_FINAL", "DELIVERED"];

const AI_DRAFT_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  NONE:    { label: "None",    color: "bg-gray-100 text-gray-600 border-gray-200" },
  PENDING: { label: "Pending", color: "bg-yellow-50 text-yellow-700 border-yellow-200" },
  READY:   { label: "Ready",   color: "bg-purple-50 text-purple-700 border-purple-200" },
  ERROR:   { label: "Error",   color: "bg-red-50 text-red-700 border-red-200" },
};

// R2.0 — USG/Doppler report-draft lifecycle status badge, styled consistently
// with STATUS_CONFIG/AI_DRAFT_STATUS_CONFIG's Record<label,color> + rounded
// pill convention above.
const USG_REPORT_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  draft:          { label: "Draft",          color: "bg-gray-100 text-gray-600 border-gray-200" },
  pending_review: { label: "Pending Review", color: "bg-yellow-50 text-yellow-700 border-yellow-200" },
  verified:       { label: "Verified",       color: "bg-blue-50 text-blue-700 border-blue-200" },
  finalized:      { label: "Finalized",      color: "bg-green-100 text-green-800 border-green-200" },
  amended:        { label: "Amended",        color: "bg-purple-50 text-purple-700 border-purple-200" },
  archived:       { label: "Archived",       color: "bg-gray-100 text-gray-500 border-gray-200" },
};

function UsgReportStatusBadge({ status }: { status?: string | null }) {
  if (!status) return <span className="text-xs text-muted-foreground">—</span>;
  const cfg = USG_REPORT_STATUS_CONFIG[status] ?? { label: status, color: "bg-gray-100 text-gray-600 border-gray-200" };
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

// R2.0 — small count badge for the Measurements/Images columns. Zero renders
// as a muted em-dash (matching the file's existing empty-cell convention,
// e.g. fmtDate/entry.studyDescription above), matching counts render as a
// colored pill.
function UsgCountBadge({ count, color }: { count: number; color: string }) {
  if (!count) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span className={`inline-flex items-center justify-center min-w-[22px] px-1.5 py-0.5 rounded-full text-[10px] font-semibold border ${color}`}>
      {count}
    </span>
  );
}

/**
 * Usability: hours a non-final study has been waiting, computed purely from
 * the existing createdAt timestamp already returned by the API. No new
 * column, no DB change. Threshold is configurable (see Settings → General
 * → Radiology → "Aging alert after (hours)"), default 4h.
 */
function agingHours(createdAt: string): number {
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return 0;
  return (Date.now() - created) / (1000 * 60 * 60);
}

function fmtDate(iso: string | null): string {
  if (!iso) return "\u2014";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function StudyQueuePanel() {
  const session = readStaffSession();
  const { data: studies = [], isLoading, refetch, isFetching } = useQuery<{
    id: number; patientName: string; modality: string; status: string;
    createdAt: string; assignedRadiologist: string | null;
    lockUserId?: number | null;
    lockUserName?: string | null;
    lockTime?: string | null;
    lockLastActivityAt?: string | null;
    lockWorkstation?: string | null;
  }[]>({
    queryKey: ["study-queue-brief"],
    queryFn: () => api.get("/api/radiology/worklist"),
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{studies.length} studies in queue</p>
        <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
          <RefreshCw size={14} className={isFetching ? "animate-spin mr-1.5" : "mr-1.5"} /> Refresh
        </Button>
      </div>
      {isLoading ? (
        <div className="text-sm text-muted-foreground py-10 text-center">Loading…</div>
      ) : studies.length === 0 ? (
        <div className="text-sm text-muted-foreground py-10 text-center">No studies in queue</div>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wide">
                <th className="px-3 py-2 text-left">Patient</th>
                <th className="px-3 py-2 text-left">Modality</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Lock Status</th>
                <th className="px-3 py-2 text-left">Radiologist</th>
                <th className="px-3 py-2 text-left">Received</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {studies.slice(0, 100).map((s) => (
                <tr key={s.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2 font-medium">{s.patientName}</td>
                  <td className="px-3 py-2">
                    <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 text-xs font-medium">{s.modality}</span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="px-1.5 py-0.5 rounded bg-muted text-xs">{s.status}</span>
                  </td>
                  <td className="px-3 py-2">
                    <LockBadge entry={s} currentUserId={session?.user?.id} />
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{s.assignedRadiologist ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDate(s.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Live Debug Panel ─────────────────────────────────────────────────────────
function PacsDebugPanel({
  entries,
  filtered,
  isLoading,
  isError,
  error,
  lastRefresh,
  statusFilter,
  modalityFilter,
  search,
  dbTotalRows,
  onForceRefresh,
  onClearCache,
  showSentinel,
  onToggleSentinel,
}: {
  entries: WorklistEntry[];
  filtered: WorklistEntry[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  lastRefresh: Date | null;
  statusFilter: string;
  modalityFilter: string;
  search: string;
  dbTotalRows: number | null;
  onForceRefresh: () => void;
  onClearCache: () => void;
  showSentinel: boolean;
  onToggleSentinel: () => void;
}) {
  const session = readStaffSession();
  const hasToken = !!session?.token;
  const tokenSnippet = session?.token
    ? session.token.slice(0, 12) + "…"
    : "none";

  const [expanded, setExpanded] = useState(true);

  return (
    <div className="rounded-lg border-2 border-blue-400 bg-blue-50 dark:bg-blue-950/40 dark:border-blue-600 overflow-hidden">
      {/* Header */}
      <button
        className="w-full flex items-center justify-between px-4 py-2 bg-blue-100 dark:bg-blue-900/50 hover:bg-blue-200 dark:hover:bg-blue-900/70 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-2 font-mono text-xs font-bold text-blue-900 dark:text-blue-200">
          <Database className="h-3.5 w-3.5" />
          PACS WORKLIST / DICOM RECEIVED STUDIES — LIVE DIAGNOSTIC PANEL
          {isLoading && <span className="ml-2 text-blue-500 animate-pulse">● fetching…</span>}
          {isError && <span className="ml-2 text-red-600">⚠ ERROR</span>}
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 text-blue-600" /> : <ChevronDown className="h-4 w-4 text-blue-600" />}
      </button>

      {expanded && (
        <div className="p-3 font-mono text-xs grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
          {/* Auth */}
          <div className="col-span-full flex items-center gap-2 mb-1">
            {hasToken
              ? <><ShieldCheck className="h-3.5 w-3.5 text-green-600" /><span className="text-green-700 dark:text-green-400 font-semibold">AUTH: ACTIVE</span></>
              : <><ShieldOff className="h-3.5 w-3.5 text-red-600" /><span className="text-red-700 font-semibold">AUTH: NO TOKEN — will get 401</span></>
            }
          </div>

          <div><span className="text-blue-500 select-none">Username      : </span>{session?.user?.name ?? "—"}</div>
          <div><span className="text-blue-500 select-none">Email         : </span>{session?.user?.email ?? "—"}</div>
          <div><span className="text-blue-500 select-none">Role          : </span><span className="font-bold">{session?.user?.role ?? "—"}</span></div>
          <div><span className="text-blue-500 select-none">Token prefix  : </span>{tokenSnippet}</div>
          <div><span className="text-blue-500 select-none">Permissions   : </span>{session?.user?.permissions?.join(", ") || "none"}</div>

          <div className="col-span-full border-t border-blue-200 dark:border-blue-700 my-1" />

          <div><span className="text-blue-500 select-none">API endpoint  : </span>GET /api/radiology/pacs-worklist</div>
          <div><span className="text-blue-500 select-none">Active status : </span>{statusFilter === "all" ? "ALL (no filter)" : statusFilter}</div>
          <div><span className="text-blue-500 select-none">Active modality: </span>{modalityFilter === "all" ? "ALL (no filter)" : modalityFilter}</div>
          <div><span className="text-blue-500 select-none">Search text   : </span>{search || "(empty)"}</div>

          <div className="col-span-full border-t border-blue-200 dark:border-blue-700 my-1" />

          <div>
            <span className="text-blue-500 select-none">DB total rows : </span>
            {dbTotalRows === null
              ? <span className="text-blue-400">loading…</span>
              : <span className={dbTotalRows === 0 ? "text-red-600 font-bold" : "text-green-700 dark:text-green-400 font-bold"}>{dbTotalRows} rows in radiology_worklist</span>
            }
          </div>
          <div>
            <span className="text-blue-500 select-none">API returned  : </span>
            <span className={entries.length === 0 && !isLoading ? "text-orange-600 font-bold" : "font-bold"}>{isLoading ? "…" : `${entries.length} rows`}</span>
          </div>
          <div><span className="text-blue-500 select-none">After filter  : </span>{isLoading ? "…" : `${filtered.length} rows visible`}</div>
          <div><span className="text-blue-500 select-none">Last refresh  : </span>{lastRefresh ? lastRefresh.toLocaleTimeString() : "pending…"}</div>

          {isError && (
            <div className="col-span-full text-red-700 font-semibold">
              Error: {error?.message ?? "unknown"}
            </div>
          )}

          <div className="col-span-full border-t border-blue-200 dark:border-blue-700 my-1" />

          <div className="col-span-full flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="h-7 text-xs border-blue-400 text-blue-700 hover:bg-blue-100" onClick={onForceRefresh}>
              <RefreshCw className="h-3 w-3 mr-1" /> Force Refetch
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs border-blue-400 text-blue-700 hover:bg-blue-100" onClick={onClearCache}>
              Clear RQ Cache + Refetch
            </Button>
            <Button
              size="sm"
              variant={showSentinel ? "default" : "outline"}
              className="h-7 text-xs"
              onClick={onToggleSentinel}
              title="Inject a fake hardcoded row to confirm the table renders correctly"
            >
              {showSentinel ? "Hide" : "Show"} Sentinel Row
            </Button>
          </div>
          <div className="col-span-full text-blue-400 mt-1">
            Check browser Console → filter "[PACS" for request/response logs.
          </div>
        </div>
      )}
    </div>
  );
}

// Hardcoded sentinel row — proves the table renders when shown
const SENTINEL_ROW: WorklistEntry = {
  id: -1,
  studyId: null,
  patientId: null,
  dicomPatientId: "TEST-001",
  patientName: "SENTINEL TEST PATIENT",
  age: "40Y",
  sex: "M",
  modality: "CT",
  studyDescription: "HARDCODED SENTINEL — table render test",
  studyDate: new Date().toISOString().slice(0, 10),
  accessionNumber: "ACC-SENTINEL-001",
  studyInstanceUID: null,
  aeTitle: "SENTINEL_AE",
  ipAddress: null,
  port: null,
  referringDoctor: "Debug Doctor",
  weasisUrl: null,
  sourceAeTitle: "SENTINEL_AE",
  status: "STUDY_RECEIVED",
  assignedRadiologist: null,
  aiDraftStatus: "NONE",
  reportId: null,
  deliveryStatus: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

export default function RadiologyWorklist() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const session = readStaffSession();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  // ── Phase C: role-based view. Page ACCESS is still governed solely by the
  // existing permission system; this only decides which action buttons render.
  const viewRole: WorklistRoleView = worklistRoleView(normalizeRole(session?.user?.role || ""));
  const isOwnerView = viewRole === "owner";
  const isRadView = viewRole === "radiologist" || isOwnerView;
  const isTechView = viewRole === "technician";
  const isReceptionView = viewRole === "reception";
  const may = (path: string) => canAccess(session, path);
  const [modalityFilter, setModalityFilter] = useState("all");
  const [lockFilter, setLockFilter] = useState("all");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [showSentinel, setShowSentinel] = useState(false);
  const [showRawJson, setShowRawJson] = useState(false);
  const [draftViewer, setDraftViewer] = useState<{ id: number; draft: Record<string, unknown> | null } | null>(null);
  // M1.6B1 — assignment management + live workload
  const [showWorkload, setShowWorkload] = useState(false);
  const [feedbackEntry, setFeedbackEntry] = useState<number | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const prevEntriesLen = useRef(-1);

  const { data: entries = [], isLoading, isError, error, refetch } = useQuery<WorklistEntry[]>({
    queryKey: ["radiology-pacs-worklist"],
    queryFn: async () => {
      const url = `/api/radiology/pacs-worklist`;
      console.log("[PACS-WORKLIST] Fetching:", url);
      const session = readStaffSession();
      console.log("[PACS-WORKLIST] Auth token present:", !!session?.token, "| role:", session?.user?.role);
      try {
        const result = await api.get<WorklistEntry[]>(url);
        console.log("PACS API RESPONSE", result);
        console.log("[PACS-WORKLIST] Rows returned:", result.length);
        if (result.length > 0) {
          console.log("[PACS-WORKLIST] First row:", JSON.stringify(result[0]).slice(0, 400));
        } else {
          console.warn("[PACS-WORKLIST] API returned 0 rows. Check radiology_worklist table in DB.");
        }
        return result;
      } catch (err) {
        console.error("[PACS-WORKLIST] Fetch/auth error:", err);
        throw err;
      }
    },
    staleTime: 0,
    gcTime: 0,
    refetchInterval: 30_000,
  });

  // DB total count — separate query, no filters, for debug panel
  const { data: countData } = useQuery<{ totalRows: number }>({
    queryKey: ["radiology-pacs-worklist-count"],
    queryFn: async () => {
      const result = await api.get<{ totalRows: number }>("/api/radiology/pacs-worklist/count");
      console.log("[PACS-WORKLIST] DB total rows:", result.totalRows);
      return result;
    },
    staleTime: 0,
    refetchInterval: 60_000,
  });

  // M1.6B1 — assignable radiologists + assignment writes + live workload.
  const { data: radiologistsData } = useQuery<{ success: boolean; radiologists: Array<{ id: number; name: string; role: string }> }>({
    queryKey: ["radiology-radiologists"],
    queryFn: () => api.get("/api/radiology/radiologists"),
    staleTime: 5 * 60_000,
  });
  const radiologists = radiologistsData?.radiologists ?? [];

  const assignMutation = useMutation({
    mutationFn: async ({ worklistId, radiologistId }: { worklistId: number; radiologistId: number | null }) => {
      const path = radiologistId === null
        ? `/api/radiology/worklist-assignment/${worklistId}/unassign`
        : `/api/radiology/worklist-assignment/${worklistId}/assign`;
      return api.post<{ success: boolean; outcome: string; assignment?: { assignedRadiologistName?: string | null } }>(
        path, radiologistId === null ? {} : { radiologistId },
      );
    },
    onSuccess: (res) => {
      if (!res.success) {
        toast({ title: "Assignment not changed", description: res.outcome.replaceAll("_", " ").toLowerCase(), variant: "destructive" });
      }
      void qc.invalidateQueries({ queryKey: ["radiology-pacs-worklist"] });
      void qc.invalidateQueries({ queryKey: ["radiology-workload"] });
    },
    onError: (err) => {
      toast({ title: "Assignment failed", description: err instanceof Error ? err.message : "Error", variant: "destructive" });
    },
  });

  const { data: workload } = useQuery<{
    success: boolean;
    radiologists: Array<{ radiologistId: number; radiologistName: string; assignedPending: number; lockedNow: number; completedToday: number; avgPendingAgeHours: number | null }>;
    unassignedPending: number;
  }>({
    queryKey: ["radiology-workload"],
    queryFn: () => api.get("/api/radiology/workload"),
    enabled: showWorkload,
    refetchInterval: showWorkload ? 60_000 : false,
  });

  const { data: pacsViewerSettings = {} as Record<string, string> } = useQuery<Record<string, string>>({
    queryKey: ["pacs-viewer-settings"],
    queryFn: async () => {
      const rows = await api.get<{ key: string; value: string; category: string }[]>("/api/radiology/pacs-settings");
      const map: Record<string, string> = {};
      for (const r of rows) if (r.category === "viewer" || r.category === "radiology") map[r.key] = r.value;
      return map;
    },
    staleTime: 120_000,
  });

  // Phase E "Highlight Urgent / VIP studies" toggle (default ON when unset)
  const urgentHighlightOn = (pacsViewerSettings["urgent_highlight_enabled"] ?? "true") !== "false";

  useEffect(() => {
    if (!isLoading && prevEntriesLen.current !== entries.length) {
      setLastRefresh(new Date());
      prevEntriesLen.current = entries.length;
      // Auto-show raw JSON if API returned rows but table is likely empty (first load)
      if (entries.length > 0) setShowRawJson(false);
    }
  }, [entries, isLoading]);

  const aiDraftMutation = useMutation({
    mutationFn: (entry: WorklistEntry) =>
      api.post("/api/internal/radiology/ai-draft", {
        studyId: entry.id,
        modality: entry.modality,
        studyDescription: entry.studyDescription ?? entry.modality,
        patientName: entry.patientName,
        age: entry.age ?? "",
        sex: entry.sex ?? "",
        accessionNumber: entry.accessionNumber,
        studyDate: entry.studyDate ?? "",
      }),
    onSuccess: (_data, entry) => {
      toast({ title: "AI Draft Ready", description: `Draft generated for ${entry.patientName}` });
      void qc.invalidateQueries({ queryKey: ["radiology-pacs-worklist"] });
    },
    onError: (err) => {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Failed to generate draft", variant: "destructive" });
    },
  });

  const markFinalMutation = useMutation({
    mutationFn: (entry: WorklistEntry) =>
      api.post("/api/internal/radiology/report-status", {
        accessionNumber: entry.accessionNumber,
        studyInstanceUID: entry.studyInstanceUID,
        status: "REPORT_FINAL",
        actor: "staff",
      }),
    onSuccess: (_data, entry) => {
      toast({ title: "Marked Final", description: `Study ${entry.accessionNumber} marked as final` });
      void qc.invalidateQueries({ queryKey: ["radiology-pacs-worklist"] });
    },
    onError: (err) => {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Update failed", variant: "destructive" });
    },
  });

  const filtered = entries.filter((e) => {
    // Client-side status filter
    if (statusFilter !== "all" && e.status !== statusFilter) return false;
    // Client-side modality filter — normalize both sides so raw PACS
    // spellings ("USG", "Doppler", "OB US", ...) fold into the one "US"
    // filter chip instead of silently failing exact-string equality (R2.0).
    if (modalityFilter !== "all" && normalizeModality(e.modality) !== normalizeModality(modalityFilter)) return false;

    // Client-side lock filter — server-computed expiry first (M1.6A)
    const lastAct = e.lockLastActivityAt || e.lockTime;
    const isLocked = e.lockUserId && (
      (e as { lockExpiresAt?: string | null }).lockExpiresAt
        ? new Date((e as { lockExpiresAt?: string | null }).lockExpiresAt as string).getTime() > Date.now()
        : lastAct && (Date.now() - new Date(lastAct).getTime()) <= 30 * 60 * 1000
    );
    const isMine = isLocked && e.lockUserId === session?.user?.id;

    if (lockFilter === "available" && isLocked) return false;
    if (lockFilter === "mine" && !isMine) return false;
    if (lockFilter === "locked" && (!isLocked || isMine)) return false;

    if (!search) return true;
    const s = search.toLowerCase();
    return (
      (e.patientName ?? "").toLowerCase().includes(s) ||
      (e.accessionNumber ?? "").toLowerCase().includes(s) ||
      (e.studyDescription ?? "").toLowerCase().includes(s) ||
      (e.referringDoctor ?? "").toLowerCase().includes(s)
    );
  });

  // Rows to render in table — real rows + optional sentinel
  const tableRows = [
    ...(showSentinel ? [SENTINEL_ROW] : []),
    ...filtered,
  ];

  function openWeasis(entry: WorklistEntry) {
    const template = pacsViewerSettings["weasis_manifest_url_template"];
    if (template && entry.studyInstanceUID) {
      window.open(template.replace(/\{studyInstanceUID\}/g, entry.studyInstanceUID), "_blank");
      return;
    }
    const url = entry.weasisUrl;
    if (!url) {
      toast({ title: "Weasis URL not available", description: "Configure Weasis Manifest URL Template in PACS Settings → Viewer Settings.", variant: "destructive" });
      return;
    }
    window.open(url, "_blank");
  }

  function handleClearCache() {
    void qc.resetQueries({ queryKey: ["radiology-pacs-worklist"] });
    void qc.resetQueries({ queryKey: ["radiology-pacs-worklist-count"] });
    window.localStorage.removeItem("pacs_worklist_cache");
    console.log("[PACS-WORKLIST] React Query cache cleared, re-fetching…");
    setTimeout(() => void refetch(), 100);
  }

  // Phase 8: View stored AI draft
  async function viewAiDraft(id: number) {
    try {
      const result = await api.get<{ draft: Record<string, unknown> | null; safetyNote: string }>(`/api/radiology/pacs-worklist/${id}/ai-draft`);
      setDraftViewer({ id, draft: result.draft });
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Failed to load draft", variant: "destructive" });
    }
  }

  // Phase 11: Submit feedback (thumbs up/down) with optional text
  async function submitFeedback(id: number, verdict: "helpful" | "needs_improvement" | "inaccurate") {
    if (verdict === "needs_improvement" || verdict === "inaccurate") {
      setFeedbackEntry(id);
      return; // wait for text dialog
    }
    try {
      await api.post(`/api/radiology/pacs-worklist/${id}/ai-feedback`, { verdict, notes: "" });
      toast({ title: "Feedback saved" });
      void qc.invalidateQueries({ queryKey: ["radiology-pacs-worklist"] });
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Failed to save feedback", variant: "destructive" });
    }
  }

  async function submitFeedbackWithNotes() {
    if (!feedbackEntry) return;
    try {
      await api.post(`/api/radiology/pacs-worklist/${feedbackEntry}/ai-feedback`, { verdict: "needs_improvement", notes: feedbackText });
      toast({ title: "Feedback saved" });
      setFeedbackEntry(null);
      setFeedbackText("");
      void qc.invalidateQueries({ queryKey: ["radiology-pacs-worklist"] });
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Failed to save feedback", variant: "destructive" });
    }
  }

  const trulyEmpty = entries.length === 0 && !isLoading;
  const filteredEmpty = entries.length > 0 && tableRows.length === 0;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <PageHeader title="Worklist Hub" subtitle="Study queue, PACS worklist, and modality worklist in one place" />

      <Tabs defaultValue="pacs-worklist" className="space-y-4">
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="study-queue"><ClipboardList size={14} className="mr-1.5" />RIS Study Queue (Billing Orders)</TabsTrigger>
          <TabsTrigger value="pacs-worklist"><ScanSearch size={14} className="mr-1.5" />PACS Worklist / DICOM Received Studies</TabsTrigger>
          <TabsTrigger value="mwl"><CalendarDays size={14} className="mr-1.5" />MWL (Modality Worklist)</TabsTrigger>
        </TabsList>

        <TabsContent value="study-queue">
          <StudyQueuePanel />
        </TabsContent>

        <TabsContent value="pacs-worklist">
          <div className="flex flex-col gap-4">

            {/* ── LIVE DEBUG PANEL ── */}
            <PacsDebugPanel
              entries={entries}
              filtered={filtered}
              isLoading={isLoading}
              isError={isError}
              error={error as Error | null}
              lastRefresh={lastRefresh}
              statusFilter={statusFilter}
              modalityFilter={modalityFilter}
              search={search}
              dbTotalRows={countData?.totalRows ?? null}
              onForceRefresh={() => void refetch()}
              onClearCache={handleClearCache}
              showSentinel={showSentinel}
              onToggleSentinel={() => setShowSentinel((v) => !v)}
            />

            {/* Summary bar */}
            <div className="flex items-center justify-between bg-slate-100 dark:bg-muted/40 border border-slate-200 dark:border-card-border rounded-lg px-4 py-2">
              <span className="text-sm font-bold text-slate-700 dark:text-slate-300">
                PACS Worklist / DICOM Received Studies: <span className="text-lg text-slate-900 dark:text-foreground tabular-nums">{entries.length}</span>
              </span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {isLoading ? "Loading..." : filtered.length === entries.length ? "All visible" : `${filtered.length} filtered`}
                </span>
                <Button variant="outline" size="sm" onClick={() => void refetch()}>
                  <RefreshCw className="h-4 w-4 mr-1" /> Refresh
                </Button>
              </div>
            </div>

            {/* Filters — all default to ALL */}
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="Search patient, accession..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[160px]">
                  <Filter className="h-4 w-4 mr-1 text-muted-foreground" />
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>{s === "all" ? "All Statuses" : toUnifiedStatus(s).label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={modalityFilter} onValueChange={setModalityFilter}>
                <SelectTrigger className="w-[130px]">
                  <SelectValue placeholder="Modality" />
                </SelectTrigger>
                <SelectContent>
                  {MODALITY_OPTIONS.map((m) => (
                    <SelectItem key={m} value={m}>{m === "all" ? "All Modalities" : m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={lockFilter} onValueChange={setLockFilter}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Lock Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Locks</SelectItem>
                  <SelectItem value="available">🟢 Available</SelectItem>
                  <SelectItem value="mine">🟡 Opened by You</SelectItem>
                  <SelectItem value="locked">🔴 Locked by Others</SelectItem>
                </SelectContent>
              </Select>
              {(statusFilter !== "all" || modalityFilter !== "all" || lockFilter !== "all" || search) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() => { setSearch(""); setStatusFilter("all"); setModalityFilter("all"); setLockFilter("all"); }}
                >
                  Clear filters
                </Button>
              )}
            </div>

            {/* Status chips */}
            <div className="flex gap-2 flex-wrap">
              {Object.entries(STATUS_CONFIG).map(([key, cfg]) => {
                const count = entries.filter((e) => e.status === key).length;
                if (count === 0) return null;
                return (
                  <button
                    key={key}
                    onClick={() => setStatusFilter(statusFilter === key ? "all" : key)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border cursor-pointer transition-opacity ${cfg.color} ${statusFilter === key ? "opacity-100 ring-2 ring-offset-1 ring-current" : "opacity-80 hover:opacity-100"}`}
                  >
                    {cfg.icon} {cfg.label} ({count})
                  </button>
                );
              })}
            </div>

            {/* M1.6B1 — live radiologist workload (reuses worklist data only) */}
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowWorkload((v) => !v)} data-testid="btn-workload">
                {showWorkload ? "Hide workload" : "Workload"}
              </Button>
            </div>
            {showWorkload && (
              <div className="rounded-lg border p-3 bg-muted/10" data-testid="workload-panel">
                <div className="text-xs font-semibold mb-2">
                  Radiologist workload
                  <span className="text-muted-foreground font-normal ml-2">
                    {workload ? `${workload.unassignedPending} unassigned pending` : "loading…"}
                  </span>
                </div>
                {workload && (
                  <table className="text-xs w-full max-w-2xl">
                    <thead>
                      <tr className="text-left text-muted-foreground">
                        <th className="pr-4 py-0.5 font-medium">Radiologist</th>
                        <th className="pr-4 py-0.5 font-medium">Assigned</th>
                        <th className="pr-4 py-0.5 font-medium">Locked now</th>
                        <th className="pr-4 py-0.5 font-medium">Done today</th>
                        <th className="pr-4 py-0.5 font-medium">Avg pending age</th>
                        <th className="pr-4 py-0.5 font-medium">Parked</th>
                      </tr>
                    </thead>
                    <tbody>
                      {workload.radiologists.map((r) => (
                        <tr key={r.radiologistId}>
                          <td className="pr-4 py-0.5">{r.radiologistName}</td>
                          <td className="pr-4 py-0.5">{r.assignedPending}</td>
                          <td className="pr-4 py-0.5">{r.lockedNow}</td>
                          <td className="pr-4 py-0.5">{r.completedToday}</td>
                          <td className="pr-4 py-0.5">{r.avgPendingAgeHours != null ? `${r.avgPendingAgeHours} h` : "—"}</td>
                          <td className="pr-4 py-0.5 text-muted-foreground">
                            {/* Parked state is browser-local (M1.5) — only this
                                workstation's own count is truthfully knowable. */}
                            {r.radiologistId === session?.user?.id
                              ? (() => { try { return (JSON.parse(localStorage.getItem("radiology_parked_studies_v1") ?? "[]") as unknown[]).length; } catch { return 0; } })()
                              : "n/a"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* Table */}
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : trulyEmpty && !showSentinel ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
                <ScanSearch className="h-12 w-12" />
                <p className="text-base font-semibold">No PACS studies found</p>
                <p className="text-sm max-w-md text-center">
                  {(countData?.totalRows ?? 0) === 0
                    ? "The radiology_worklist table is empty. Push a study via your DICOM agent / Conquest PACS to see entries here."
                    : `DB has ${countData?.totalRows} rows but API returned 0. Check auth token / filters above.`
                  }
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowSentinel(true)}
                  className="mt-1"
                >
                  Show sentinel row (render test)
                </Button>
              </div>
            ) : filteredEmpty ? (
              <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
                <ScanSearch className="h-10 w-10" />
                <p className="text-sm font-semibold">No studies match your filters</p>
                <p className="text-xs">{entries.length} total in database. Try clearing search or changing filters.</p>
                <Button variant="outline" size="sm" className="mt-2" onClick={() => { setSearch(""); setStatusFilter("all"); setModalityFilter("all"); }}>
                  Clear All Filters
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50 text-left">
                      {showSentinel && <th className="px-3 py-2.5 font-medium whitespace-nowrap text-orange-600">⚠ Debug</th>}
                      <th className="px-3 py-2.5 font-medium whitespace-nowrap">Patient Name</th>
                      <th className="px-3 py-2.5 font-medium whitespace-nowrap">Age/Sex</th>
                      <th className="px-3 py-2.5 font-medium whitespace-nowrap">UHID</th>
                      <th className="px-3 py-2.5 font-medium whitespace-nowrap">Bill No</th>
                      <th className="px-3 py-2.5 font-medium whitespace-nowrap">Modality</th>
                      {/* R2.0 — canonical ultrasound integration: USG/Doppler measurement + key-image counts and report-draft status, folded into the ONE worklist. */}
                      <th className="px-3 py-2.5 font-medium whitespace-nowrap text-center">Measurements</th>
                      <th className="px-3 py-2.5 font-medium whitespace-nowrap text-center">Images</th>
                      <th className="px-3 py-2.5 font-medium whitespace-nowrap">USG Report</th>
                      <th className="px-3 py-2.5 font-medium whitespace-nowrap">Priority</th>
                      <th className="px-3 py-2.5 font-medium whitespace-nowrap">Study Description</th>
                      <th className="px-3 py-2.5 font-medium whitespace-nowrap">Ref. Doctor</th>
                      <th className="px-3 py-2.5 font-medium whitespace-nowrap">Accession No</th>
                      <th className="px-3 py-2.5 font-medium whitespace-nowrap">Study Date</th>
                      <th className="px-3 py-2.5 font-medium whitespace-nowrap">Source AE</th>
                      <th className="px-3 py-2.5 font-medium whitespace-nowrap">Created At</th>
                      <th className="px-3 py-2.5 font-medium whitespace-nowrap">Status</th>
                      <th className="px-3 py-2.5 font-medium whitespace-nowrap">Radiologist</th>
                      <th className="px-3 py-2.5 font-medium whitespace-nowrap">Lock Status</th>
                      <th className="px-3 py-2.5 font-medium whitespace-nowrap">AI Draft</th>
                      <th className="px-3 py-2.5 font-medium text-right whitespace-nowrap">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {tableRows.map((entry) => (
                      <tr
                        key={entry.id}
                        className={`hover:bg-muted/30 transition-colors ${entry.id === -1 ? "bg-orange-50 dark:bg-orange-950/20" : (urgentHighlightOn && priorityInfo(entry.priority).highlight) ? "bg-red-50/50 dark:bg-red-950/10" : ""}`}
                      >
                        {showSentinel && (
                          <td className="px-3 py-2.5 text-xs text-orange-600 font-mono">
                            {entry.id === -1 ? "SENTINEL" : "real"}
                          </td>
                        )}
                        <td className="px-3 py-2.5 font-medium whitespace-nowrap">{entry.patientName}</td>
                        <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                          {[entry.age, entry.sex].filter(Boolean).join(" / ") || "\u2014"}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground whitespace-nowrap" title={entry.dicomPatientId ?? undefined}>
                          {entry.uhid ?? entry.dicomPatientId ?? "\u2014"}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap">
                          {entry.billNumber ?? "\u2014"}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <Badge variant="outline" className="font-mono text-xs">{entry.modality}</Badge>
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          {(() => { const pr = priorityInfo(entry.priority); return (
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-semibold ${pr.color}`}>
                              {pr.label}
                            </span>
                          ); })()}
                        </td>
                        <td className="px-3 py-2.5 max-w-[200px] truncate" title={entry.studyDescription ?? ""}>
                          {entry.studyDescription || "\u2014"}
                        </td>
                        <td className="px-3 py-2.5 text-xs whitespace-nowrap max-w-[140px] truncate" title={entry.referringDoctor ?? ""}>
                          {entry.referringDoctor ?? "\u2014"}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap">{entry.accessionNumber}</td>
                        <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                          {entry.studyDate ?? "\u2014"}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground text-xs whitespace-nowrap">
                          {entry.sourceAeTitle ?? entry.aeTitle ?? "\u2014"}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground text-xs whitespace-nowrap">
                          {fmtDate(entry.createdAt)}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <StatusBadge status={entry.status} deliveryStatus={entry.deliveryStatus} />
                          {entry.status !== "REPORT_FINAL" && entry.status !== "DELIVERED" && (() => {
                            const threshold = Number(pacsViewerSettings["radiology_aging_alert_hours"] ?? "4") || 4;
                            const hrs = agingHours(entry.createdAt);
                            if (hrs < threshold) return null;
                            return (
                              <span
                                title={`Waiting ${hrs.toFixed(1)}h since received — configurable in Radiology Settings`}
                                className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-semibold bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-900"
                              >
                                {hrs >= 24 ? `${Math.floor(hrs / 24)}d` : `${Math.floor(hrs)}h`} waiting
                              </span>
                            );
                          })()}
                        </td>
                        <td className="px-3 py-2.5 text-xs whitespace-nowrap max-w-[120px] truncate" title={entry.assignedRadiologist ?? ""}>
                          {entry.assignedRadiologist ?? "\u2014"}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <div className="flex flex-col gap-1">
                            <LockBadge entry={entry} currentUserId={session?.user?.id} />
                            {/* M1.6B1 — assignment control: organizational
                                ownership, distinct from the lock above. The
                                server enforces who may assign/reassign. */}
                            {entry.id !== -1 && (
                              <select
                                className="h-6 max-w-[150px] text-[10px] border rounded px-1 bg-background text-muted-foreground"
                                value={(entry as { assignedRadiologistId?: number | null }).assignedRadiologistId ?? ""}
                                disabled={assignMutation.isPending || entry.status === "REPORT_FINAL" || entry.status === "DELIVERED"}
                                title={(() => {
                                  const e = entry as { assignedAt?: string | null; assignedByName?: string | null };
                                  return e.assignedAt
                                    ? `Assigned ${new Date(e.assignedAt).toLocaleString()}${e.assignedByName ? ` by ${e.assignedByName}` : ""}`
                                    : entry.assignedRadiologist
                                      ? `Assigned to ${entry.assignedRadiologist} (legacy, no timestamp)`
                                      : "Unassigned — pick a radiologist to assign";
                                })()}
                                onChange={(ev) => {
                                  const v = ev.target.value;
                                  assignMutation.mutate({ worklistId: entry.id, radiologistId: v === "" ? null : Number(v) });
                                }}
                                data-testid={`assign-select-${entry.id}`}
                              >
                                <option value="">
                                  {(entry as { assignedRadiologistId?: number | null }).assignedRadiologistId == null && entry.assignedRadiologist
                                    ? `Unassigned (was: ${entry.assignedRadiologist})`
                                    : "Unassigned"}
                                </option>
                                {radiologists.map((r) => (
                                  <option key={r.id} value={r.id}>{r.name}</option>
                                ))}
                              </select>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          {entry.id === -1 ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            <div className="flex items-center gap-1">
                              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium ${AI_DRAFT_STATUS_CONFIG[entry.aiDraftStatus]?.color ?? "bg-gray-100 text-gray-600 border-gray-200"}`}>
                                {entry.aiDraftStatus === "NONE" && "—"}
                                {entry.aiDraftStatus === "PENDING" && (
                                  <><RefreshCw className="h-3 w-3 animate-spin" /> PENDING</>
                                )}
                                {entry.aiDraftStatus === "READY" && (
                                  <><Sparkles className="h-3 w-3" /> READY</>
                                )}
                                {entry.aiDraftStatus === "ERROR" && (
                                  <><AlertCircle className="h-3 w-3" /> ERROR</>
                                )}
                              </span>
                              {entry.aiDraftStatus === "READY" && (
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-xs" title="View AI Draft" onClick={() => viewAiDraft(entry.id)}>
                                  <Eye className="h-3 w-3" />
                                </Button>
                              )}
                              {entry.aiDraftStatus === "READY" && (
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-xs text-green-600" title="Helpful" onClick={() => submitFeedback(entry.id, "helpful")}>
                                  <ThumbsUp className="h-3 w-3" />
                                </Button>
                              )}
                              {entry.aiDraftStatus === "READY" && (
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-xs text-red-500" title="Needs Improvement" onClick={() => submitFeedback(entry.id, "needs_improvement")}>
                                  <ThumbsDown className="h-3 w-3" />
                                </Button>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center justify-end gap-1 flex-wrap">
                            {entry.id !== -1 && !isReceptionView && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs"
                                onClick={() => launchViewer(entry.studyInstanceUID, "WEASIS", pacsViewerSettings, toast)}
                                title="Open in Weasis"
                              >
                                <Tv2 className="h-3 w-3 mr-1" />
                                Weasis
                              </Button>
                            )}

                            {entry.id !== -1 && !isReceptionView && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs text-blue-700 border-blue-300 hover:bg-blue-50"
                                onClick={() => launchViewer(entry.studyInstanceUID, "OHIF", pacsViewerSettings, toast)}
                                title="Open in OHIF"
                              >
                                <MonitorPlay className="h-3 w-3 mr-1" />
                                OHIF
                              </Button>
                            )}

                            {entry.status !== "REPORT_FINAL" && entry.status !== "DELIVERED" && entry.id !== -1 && isRadView && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs"
                                onClick={() => aiDraftMutation.mutate(entry)}
                                disabled={aiDraftMutation.isPending}
                                title="Generate AI Draft"
                              >
                                <Sparkles className="h-3 w-3 mr-1" />
                                AI
                              </Button>
                            )}

                            {entry.id !== -1 && isOwnerView && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs border-emerald-500 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/20"
                                onClick={() => navigate(`/radiology/command-center/${entry.id}`)}
                                title="Open in Command Center"
                              >
                                <Activity className="h-3 w-3 mr-1" />
                                Command Center
                              </Button>
                            )}

                            {/* R1.4 — the primary "Report" action now opens the
                                CANONICAL Reporting Workspace (/radiology/report/:studyId),
                                not the deprecated Cockpit. Previously this was the
                                ONLY "start reporting" entry point on the whole
                                Worklist, and it sent every radiologist to a page
                                carrying zero R1.3 image-panel/R1.2 template/M1.4
                                validation support — that work was reachable only
                                by typing the canonical URL by hand. */}
                            {entry.id !== -1 && isRadView && may("/radiology/report") && (
                              <Button
                                size="sm"
                                className="h-7 px-2 text-xs bg-indigo-600 hover:bg-indigo-700 text-white"
                                onClick={() => navigate(`/radiology/report/${entry.id}`)}
                                title="Open in the Reporting Workspace"
                              >
                                <Stethoscope className="h-3 w-3 mr-1" />
                                Report
                              </Button>
                            )}

                            {(entry.status === "REPORT_IN_PROGRESS" || entry.status === "AI_DRAFT_READY") && entry.id !== -1 && isRadView && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs border-green-500 text-green-700 hover:bg-green-50"
                                onClick={() => {
                                  if (confirm(`Mark study ${entry.accessionNumber} as FINAL?`)) {
                                    markFinalMutation.mutate(entry);
                                  }
                                }}
                                disabled={markFinalMutation.isPending}
                                title="Mark Final"
                              >
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                Final
                              </Button>
                            )}

                            {entry.status === "REPORT_FINAL" && (
                              <span className="text-xs text-green-700 font-medium flex items-center gap-1">
                                <CheckCircle2 className="h-3 w-3" /> Finalized
                              </span>
                            )}

                            {/* Phase C: Premium Report entry point (preview lives in Report Generator — not expanded here) */}
                            {entry.id !== -1 && isRadView && may("/radiology/report-generator") &&
                              (entry.reportId != null || entry.status === "REPORT_IN_PROGRESS" || entry.status === "REPORT_FINAL") && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs border-amber-500 text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/20"
                                onClick={() => navigate(`/radiology/report-generator/${entry.id}?premium=1`)}
                                title="Open Premium Report Preview"
                              >
                                <Gem className="h-3 w-3 mr-1" />
                                Premium
                              </Button>
                            )}

                            {/* Phase C: one-click print of the saved report (all roles incl. reception) */}
                            {entry.id !== -1 && entry.reportId != null && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs"
                                onClick={() => window.open(`/api/patient-reports/${entry.reportId}/print`, "_blank", "noopener,noreferrer")}
                                title="Print / Share report"
                              >
                                <Printer className="h-3 w-3 mr-1" />
                                Print
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* ── Emergency fallback: raw JSON cards ── */}
            {entries.length > 0 && (
              <div>
                <button
                  className="text-xs text-muted-foreground underline hover:text-foreground"
                  onClick={() => setShowRawJson((v) => !v)}
                >
                  {showRawJson ? "Hide" : "Show"} raw API response ({entries.length} rows) — use if table appears blank
                </button>
                {showRawJson && (
                  <div className="mt-2 space-y-2 max-h-96 overflow-y-auto">
                    {entries.map((entry, idx) => (
                      <pre
                        key={entry.id ?? idx}
                        className="rounded border bg-slate-50 dark:bg-muted/40 p-2 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all"
                      >
                        {JSON.stringify(entry, null, 2)}
                      </pre>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="text-xs text-muted-foreground text-right">
              {filtered.length} of {entries.length} entries
              {entries.length > 0 && <span> &middot; Auto-refreshes every 30s</span>}
            </div>

            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <div>
                <span className="font-semibold">Safety: </span>
                AI drafts are never automatically marked as final. A radiologist must review and explicitly save the final report.
                Automated email delivery is not enabled — status is set to READY_TO_SEND only.
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="mwl">
          <MwlPanel />
        </TabsContent>
      </Tabs>

      {/* Phase 8: AI Draft Viewer Dialog */}
      <Dialog open={!!draftViewer} onOpenChange={() => setDraftViewer(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-purple-500" /> AI Draft Viewer
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              AI Draft — Requires Radiologist Review
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            {draftViewer?.draft ? (
              <div className="rounded border bg-muted/40 p-3 max-h-96 overflow-y-auto">
                <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(draftViewer.draft, null, 2)}</pre>
              </div>
            ) : (
              <p className="text-muted-foreground">No draft stored for this study.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Phase 11: Feedback Text Dialog */}
      <Dialog open={!!feedbackEntry} onOpenChange={() => { setFeedbackEntry(null); setFeedbackText(""); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">AI Draft Feedback</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Describe what was wrong or what needs improvement.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Textarea
              placeholder="e.g. Findings were inaccurate, impression was too vague, missed a lesion...
              "
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              rows={4}
            />
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => { setFeedbackEntry(null); setFeedbackText(""); }}>
                Cancel
              </Button>
              <Button size="sm" onClick={submitFeedbackWithNotes} disabled={!feedbackText.trim()}>
                Submit Feedback
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
